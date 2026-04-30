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
    def invalidate_pattern(pattern: str):
        """
        Invalidate all keys matching a specific pattern (e.g., 'cache:memories:*')
        """
        try:
            keys = cache_redis.keys(pattern)
            if keys:
                cache_redis.delete(*keys)
                logger.info(f"[CACHE PATTERN INVALIDATED] {pattern} ({len(keys)} keys)")
        except Exception as e:
            logger.error(f"Cache invalidate pattern error for {pattern}: {e}")
