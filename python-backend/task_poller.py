# python-backend/task_poller.py
"""
Schedule-Aware Task Polling Service
Single background thread that checks for due tasks every 60 seconds.
Uses atomic DB status transition to prevent duplicate execution across workers.
"""

import logging
import time
import threading
import os
from datetime import datetime, timezone
from typing import Dict, Any, Optional

import redis
import config
from supabase_client import supabase_client

logger = logging.getLogger(__name__)


class TaskPoller:
    """
    Background service that polls for scheduled tasks and executes them.
    Only ONE instance across all workers will actually process tasks,
    enforced by atomic DB status transitions (pending -> in_progress).
    """

    def __init__(self, poll_interval: int = 60):
        self.poll_interval = poll_interval
        self.running = False
        self.thread = None
        self.redis_client = redis.from_url(config.REDIS_URL, decode_responses=True)
        self.worker_id = f"{os.getpid()}:{threading.get_ident()}"
        self.lock_key = "locks:task-poller:leader"

    def start(self):
        """Start the background polling thread."""
        if self.running:
            return

        self.running = True
        self.thread = threading.Thread(target=self._poll_loop, daemon=True)
        self.thread.start()
        logger.info(f"Task poller started (interval: {self.poll_interval}s)")

    def stop(self):
        """Stop the background polling thread."""
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)

    def _poll_loop(self):
        """Main polling loop. Uses Redis lock so only one worker polls."""
        # Random startup delay (1-5s) to stagger workers
        import random
        time.sleep(random.uniform(1, 5))

        while self.running:
            try:
                # Try to acquire leader lock for this cycle (expires in 55s)
                acquired = self.redis_client.set(
                    self.lock_key, self.worker_id, nx=True, ex=55
                )
                if acquired:
                    self._check_and_execute_due_tasks()
            except Exception as e:
                logger.error(f"Error in task poll loop: {e}")

            time.sleep(self.poll_interval)

    def _check_and_execute_due_tasks(self):
        """Query for pending tasks that are due and execute them."""
        try:
            now = datetime.now(timezone.utc)

            # Fetch all pending tasks
            response = supabase_client.table("tasks").select(
                "id, user_id, text, description, priority, deadline, tags, metadata, status"
            ).eq("status", "pending").execute()

            if not response.data:
                return

            for task in response.data:
                if self._is_task_due(task, now):
                    self._dispatch_task(task)

        except Exception as e:
            logger.error(f"Error checking due tasks: {e}")

    def _is_task_due(self, task: Dict[str, Any], now: datetime) -> bool:
        """Check if task's scheduled time has passed."""
        metadata = task.get('metadata', {}) or {}
        next_run_at = metadata.get('next_run_at')

        # Check next_run_at from metadata first
        if next_run_at:
            scheduled = self._parse_datetime(next_run_at)
            if scheduled:
                return now >= scheduled

        # Fallback: check deadline field
        deadline = task.get('deadline')
        if deadline:
            deadline_dt = self._parse_datetime(deadline)
            if deadline_dt:
                return now >= deadline_dt

        # No schedule = immediate execution
        if not next_run_at and not deadline:
            return True

        return False

    def _parse_datetime(self, dt_str: str) -> Optional[datetime]:
        """Parse ISO datetime string to timezone-aware UTC datetime."""
        if not dt_str:
            return None
        try:
            # Handle various formats
            dt_str = dt_str.strip()
            
            # If it has timezone info (e.g., +05:30, +00:00, Z)
            if '+' in dt_str[10:] or dt_str.endswith('Z'):
                dt_str = dt_str.replace('Z', '+00:00')
                dt = datetime.fromisoformat(dt_str)
                # Convert to UTC
                return dt.astimezone(timezone.utc)
            else:
                # No timezone info — assume it's already UTC
                dt = datetime.fromisoformat(dt_str)
                return dt.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError) as e:
            logger.debug(f"Failed to parse datetime '{dt_str}': {e}")
            return None

    def _dispatch_task(self, task: Dict[str, Any]):
        """Atomically claim and execute a task."""
        task_id = task['id']
        user_id = task['user_id']

        # Atomic claim: only update if still pending (prevents duplicate execution)
        try:
            result = supabase_client.table("tasks").update({
                "status": "in_progress"
            }).eq("id", task_id).eq("status", "pending").execute()

            # If no rows updated, another worker already claimed it
            if not result.data:
                return

        except Exception as e:
            logger.error(f"Failed to claim task {task_id}: {e}")
            return

        logger.info(f"Executing task: {task.get('text')} (id: {task_id})")

        # Execute in a separate thread to not block polling
        execution_thread = threading.Thread(
            target=self._execute_wrapper,
            args=(task_id, user_id, task),
            daemon=True
        )
        execution_thread.start()

    def _execute_wrapper(self, task_id: str, user_id: str, task: Dict[str, Any]):
        """Execute task and handle recurring schedule."""
        try:
            from task_executor import run_autonomous_task
            run_autonomous_task(task_id, user_id, sid=None)

            # Handle recurring schedule after success
            self._handle_recurring(task_id, task)

        except Exception as e:
            logger.error(f"Task execution failed for {task_id}: {e}")
            # Revert to pending
            try:
                supabase_client.table("tasks").update({
                    "status": "pending"
                }).eq("id", task_id).execute()
            except Exception:
                pass

    def _handle_recurring(self, task_id: str, task: Dict[str, Any]):
        """For recurring tasks: compute next run and reset to pending."""
        metadata = task.get('metadata', {}) or {}
        repeat = metadata.get('repeat', 'none')

        if not repeat or repeat == 'none':
            return  # One-time task, stays completed

        from datetime import timedelta

        next_run = self._compute_next_run(metadata, repeat)
        if not next_run:
            return

        updated_metadata = dict(metadata)
        updated_metadata['next_run_at'] = next_run.isoformat()
        updated_metadata['last_run_at'] = datetime.now(timezone.utc).isoformat()

        try:
            supabase_client.table("tasks").update({
                "status": "pending",
                "metadata": updated_metadata,
                "deadline": next_run.isoformat(),
                "task_work": None
            }).eq("id", task_id).execute()
            logger.info(f"Recurring task {task_id} rescheduled -> {next_run.isoformat()}")
        except Exception as e:
            logger.error(f"Failed to reschedule task {task_id}: {e}")

    def _compute_next_run(self, metadata: Dict[str, Any], repeat: str) -> Optional[datetime]:
        """Compute next execution time based on repeat pattern."""
        from datetime import timedelta

        base_str = metadata.get('next_run_at')
        base = self._parse_datetime(base_str) if base_str else datetime.now(timezone.utc)
        if not base:
            base = datetime.now(timezone.utc)

        schedule_time = metadata.get('schedule_time', '09:00')
        try:
            hour, minute = map(int, schedule_time.split(':'))
        except (ValueError, TypeError):
            hour, minute = 9, 0

        # Get user timezone offset from metadata
        tz_offset_minutes = metadata.get('tz_offset_minutes', 0)

        if repeat == 'daily':
            next_day = base + timedelta(days=1)
            return next_day.replace(hour=hour, minute=minute, second=0, microsecond=0)

        elif repeat == 'weekdays':
            next_day = base + timedelta(days=1)
            while next_day.weekday() >= 5:
                next_day += timedelta(days=1)
            return next_day.replace(hour=hour, minute=minute, second=0, microsecond=0)

        elif repeat == 'weekly':
            return (base + timedelta(weeks=1)).replace(hour=hour, minute=minute, second=0, microsecond=0)

        elif repeat == 'monthly':
            month = base.month + 1
            year = base.year
            if month > 12:
                month = 1
                year += 1
            day = min(base.day, 28)
            return datetime(year, month, day, hour, minute, 0, tzinfo=timezone.utc)

        elif repeat == 'custom':
            custom_interval = metadata.get('custom_interval', {})
            value = int(custom_interval.get('value', 1))
            unit = custom_interval.get('unit', 'days')

            if unit == 'hours':
                return base + timedelta(hours=value)
            elif unit == 'days':
                return (base + timedelta(days=value)).replace(hour=hour, minute=minute, second=0, microsecond=0)
            elif unit == 'weeks':
                return (base + timedelta(weeks=value)).replace(hour=hour, minute=minute, second=0, microsecond=0)

        return None


# ---------------------------------------------------------------------------
# Global singleton with proper dedup
# ---------------------------------------------------------------------------
_poller_instance = None
_poller_lock = threading.Lock()


def start_task_poller(poll_interval: int = 60):
    """Start the global task poller (only one per process)."""
    global _poller_instance
    with _poller_lock:
        if _poller_instance is not None:
            return  # Already running in this process
        _poller_instance = TaskPoller(poll_interval=poll_interval)
        _poller_instance.start()


def stop_task_poller():
    """Stop the global task poller."""
    global _poller_instance
    with _poller_lock:
        if _poller_instance:
            _poller_instance.stop()
            _poller_instance = None
