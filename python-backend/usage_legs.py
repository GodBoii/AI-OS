"""Count cumulative native run metrics once across HITL continuations."""

FIELDS = ("input_tokens", "output_tokens", "total_tokens")


def metric_snapshot(run) -> dict[str, dict[str, int]]:
    snapshot = {}
    pending = [run] if run is not None else []
    while pending:
        current = pending.pop()
        run_id = getattr(current, "run_id", None)
        metrics = getattr(current, "metrics", None)
        if run_id and metrics:
            values = {field: max(0, int((metrics.get(field, 0) if isinstance(metrics, dict)
                else getattr(metrics, field, 0)) or 0)) for field in FIELDS}
            existing = snapshot.get(run_id, {})
            snapshot[run_id] = {field: max(existing.get(field, 0), values[field]) for field in FIELDS}
        pending.extend(getattr(current, "member_responses", None) or [])
    return snapshot


def metric_delta(current: dict, previous: dict | None = None) -> dict[str, int]:
    previous = previous or {}
    return {field: sum(max(0, values[field] - previous.get(run_id, {}).get(field, 0))
        for run_id, values in current.items()) for field in FIELDS}
