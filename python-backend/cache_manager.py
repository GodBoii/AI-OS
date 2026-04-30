# python-backend/cache_manager.py
#
# Redis-backed cache with JSON serialisation, TTL support, and non-blocking
# bulk key invalidation via SCAN (never uses the blocking KEYS command).
import json
import logging
import redis
from typing import Any, Optional
import config

logger = logging.getLogger(__name__)

# Initialize a dedicated Redis connection for caching using the global config
# Decode responses ensures we get strings back instead of bytes, making JSON parsing easier
cache_redis = redis.from_url(config.REDIS_URL, decode_responses=True)

class CacheManager:
    @staticmethod
    def get(key: str) -> Optional[Any]:
        """
        Attempt to retrieve and deserialize JSON data from Redis.
        Returns None if cache miss or error.
        """
        try:
            data = cache_redis.get(key)
            if data:
                logger.info(f"[CACHE HIT] {key}")
                return json.loads(data)
            logger.info(f"[CACHE MISS] {key}")
            return None
        except Exception as e:
            logger.error(f"Cache get error for key {key}: {e}")
            return None

    @staticmethod
    def set(key: str, data: Any, ttl_seconds: int = 3600) -> bool:
        """
        Serialize and store data in Redis with a TTL (default 1 hour = 3600 seconds).
        """
        try:
            serialized = json.dumps(data)
            # ex=ttl_seconds sets the expiration time automatically in Redis
            return cache_redis.set(key, serialized, ex=ttl_seconds)
        except Exception as e:
            logger.error(f"Cache set error for key {key}: {e}")
            return False

    @staticmethod
    def delete(key: str) -> bool:
        """
        Delete a key from Redis (used for active cache invalidation).
        """
        try:
            cache_redis.delete(key)
            logger.info(f"[CACHE INVALIDATED] {key}")
            return True
        except Exception as e:
            logger.error(f"Cache delete error for key {key}: {e}")
            return False

    @staticmethod
    def invalidate_pattern(pattern: str) -> None:
        """
        Invalidate all Redis keys matching a glob pattern (e.g. 'cache:memories:user123:*').

        Why SCAN instead of KEYS:
        - KEYS is O(N) and holds Redis's single-threaded command lock for the
          entire scan. Every other client — Flask-Limiter, SocketIO pub/sub,
          session reads — stalls until it completes. On large keyspaces this can
          mean tens of milliseconds of full Redis unavailability.
        - SCAN iterates in small cursor-based batches (count=100 per call).
          Redis can serve other commands between batches, so latency stays low
          even on keyspaces with millions of keys.

        Keys matched across all cursor pages are deleted in one single DEL call
        (one round-trip regardless of how many keys were found).
        """
        try:
            matched: list[str] = []
            cursor = 0
            while True:
                # count=100 is a hint to Redis about batch size per iteration.
                # It does NOT guarantee exactly 100 results per call — Redis may
                # return more or fewer depending on its internal data structures.
                # 100 strikes a balance between round-trip count and per-call work.
                cursor, batch = cache_redis.scan(cursor=cursor, match=pattern, count=100)
                if batch:
                    matched.extend(batch)
                # cursor returns to 0 when the full keyspace has been visited.
                if cursor == 0:
                    break

            if matched:
                # Single DEL with all keys — one network round-trip.
                cache_redis.delete(*matched)
                logger.info(
                    "[CACHE PATTERN INVALIDATED] %s (%d keys deleted)",
                    pattern,
                    len(matched),
                )
        except Exception as e:
            logger.error(f"Cache invalidate pattern error for {pattern}: {e}")
