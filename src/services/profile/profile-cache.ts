/**
 * Profile Cache - 用户数据缓存
 * 
 * 使用 LRU 缓存机制提高用户数据访问性能
 */

import { createLogger, type ILogger } from '../../shared/logging';
import type {
  Persona,
  UserPreferences,
  UserTag,
  UserStats,
  CacheStats,
} from './types';

export interface ProfileCacheOptions {
  maxSize?: number;
  ttl?: number;
}

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  accessCount: number;
  lastAccess: number;
}

/**
 * 用户数据缓存类
 */
export class ProfileCache {
  private logger: ILogger;
  private options: Required<ProfileCacheOptions>;
  private personaCache: Map<string, CacheEntry<Persona>>;
  private preferencesCache: Map<string, CacheEntry<UserPreferences>>;
  private tagsCache: Map<string, CacheEntry<UserTag[]>>;
  private statsCache: Map<string, CacheEntry<UserStats>>;
  private stats: CacheStats;

  constructor(options?: ProfileCacheOptions) {
    this.logger = createLogger('profile-cache');
    this.options = {
      maxSize: options?.maxSize ?? 1000,
      ttl: options?.ttl ?? 5 * 60 * 1000, // 5 分钟
    };
    this.personaCache = new Map();
    this.preferencesCache = new Map();
    this.tagsCache = new Map();
    this.statsCache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      size: 0,
      evictions: 0,
    };
  }

  /**
   * 获取 Persona
   */
  getPersona(userId: string): Persona | undefined {
    const entry = this.personaCache.get(userId);
    
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // 检查 TTL
    if (Date.now() - entry.timestamp > this.options.ttl) {
      this.personaCache.delete(userId);
      this.stats.misses++;
      this.logger.debug(`Persona cache miss for ${userId} (expired)`);
      return undefined;
    }

    entry.accessCount++;
    entry.lastAccess = Date.now();
    this.stats.hits++;
    
    this.logger.debug(`Persona cache hit for ${userId}`);
    return entry.value;
  }

  /**
   * 设置 Persona
   */
  setPersona(userId: string, persona: Persona): void {
    this.evictIfNecessary(this.personaCache);
    
    this.personaCache.set(userId, {
      value: persona,
      timestamp: Date.now(),
      accessCount: 0,
      lastAccess: Date.now(),
    });

    this.updateSize();
    this.logger.debug(`Persona cached for ${userId}`);
  }

  /**
   * 获取偏好
   */
  getPreferences(userId: string): UserPreferences | undefined {
    const entry = this.preferencesCache.get(userId);
    
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // 检查 TTL
    if (Date.now() - entry.timestamp > this.options.ttl) {
      this.preferencesCache.delete(userId);
      this.stats.misses++;
      this.logger.debug(`Preferences cache miss for ${userId} (expired)`);
      return undefined;
    }

    entry.accessCount++;
    entry.lastAccess = Date.now();
    this.stats.hits++;
    
    this.logger.debug(`Preferences cache hit for ${userId}`);
    return entry.value;
  }

  /**
   * 设置偏好
   */
  setPreferences(userId: string, preferences: UserPreferences): void {
    this.evictIfNecessary(this.preferencesCache);
    
    this.preferencesCache.set(userId, {
      value: preferences,
      timestamp: Date.now(),
      accessCount: 0,
      lastAccess: Date.now(),
    });

    this.updateSize();
    this.logger.debug(`Preferences cached for ${userId}`);
  }

  /**
   * 获取标签
   */
  getTags(userId: string): UserTag[] | undefined {
    const entry = this.tagsCache.get(userId);
    
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // 检查 TTL
    if (Date.now() - entry.timestamp > this.options.ttl) {
      this.tagsCache.delete(userId);
      this.stats.misses++;
      this.logger.debug(`Tags cache miss for ${userId} (expired)`);
      return undefined;
    }

    entry.accessCount++;
    entry.lastAccess = Date.now();
    this.stats.hits++;
    
    this.logger.debug(`Tags cache hit for ${userId}`);
    return entry.value;
  }

  /**
   * 设置标签
   */
  setTags(userId: string, tags: UserTag[]): void {
    this.evictIfNecessary(this.tagsCache);
    
    this.tagsCache.set(userId, {
      value: tags,
      timestamp: Date.now(),
      accessCount: 0,
      lastAccess: Date.now(),
    });

    this.updateSize();
    this.logger.debug(`Tags cached for ${userId} (${tags.length} tags)`);
  }

  /**
   * 获取统计
   */
  getUserStats(userId: string): UserStats | undefined {
    const entry = this.statsCache.get(userId);
    
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // 检查 TTL
    if (Date.now() - entry.timestamp > this.options.ttl) {
      this.statsCache.delete(userId);
      this.stats.misses++;
      this.logger.debug(`Stats cache miss for ${userId} (expired)`);
      return undefined;
    }

    entry.accessCount++;
    entry.lastAccess = Date.now();
    this.stats.hits++;
    
    this.logger.debug(`Stats cache hit for ${userId}`);
    return entry.value;
  }

  /**
   * 设置统计
   */
  setUserStats(userId: string, stats: UserStats): void {
    this.evictIfNecessary(this.statsCache);
    
    this.statsCache.set(userId, {
      value: stats,
      timestamp: Date.now(),
      accessCount: 0,
      lastAccess: Date.now(),
    });

    this.updateSize();
    this.logger.debug(`Stats cached for ${userId}`);
  }

  /**
   * 清除用户缓存
   */
  invalidateUser(userId: string): void {
    this.personaCache.delete(userId);
    this.preferencesCache.delete(userId);
    this.tagsCache.delete(userId);
    this.statsCache.delete(userId);
    
    this.updateSize();
    this.logger.debug(`Cache invalidated for user ${userId}`);
  }

  /**
   * 清除所有缓存
   */
  clear(): void {
    this.personaCache.clear();
    this.preferencesCache.clear();
    this.tagsCache.clear();
    this.statsCache.clear();
    
    this.updateSize();
    this.logger.info('Cache cleared');
  }

  /**
   * 获取缓存统计
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * 获取缓存大小
   */
  getSize(): number {
    return (
      this.personaCache.size +
      this.preferencesCache.size +
      this.tagsCache.size +
      this.statsCache.size
    );
  }

  /**
   * 获取命中率
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    return total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * 清理过期缓存
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.personaCache) {
      if (now - entry.timestamp > this.options.ttl) {
        this.personaCache.delete(key);
        cleaned++;
      }
    }

    for (const [key, entry] of this.preferencesCache) {
      if (now - entry.timestamp > this.options.ttl) {
        this.preferencesCache.delete(key);
        cleaned++;
      }
    }

    for (const [key, entry] of this.tagsCache) {
      if (now - entry.timestamp > this.options.ttl) {
        this.tagsCache.delete(key);
        cleaned++;
      }
    }

    for (const [key, entry] of this.statsCache) {
      if (now - entry.timestamp > this.options.ttl) {
        this.statsCache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.updateSize();
      this.logger.debug(`Cleaned up ${cleaned} expired cache entries`);
    }

    return cleaned;
  }

  /**
   * 驱逐缓存条目
   */
  private evictIfNecessary<T>(cache: Map<string, CacheEntry<T>>): void {
    const totalSize = this.getSize();
    
    if (totalSize >= this.options.maxSize) {
      // 找到最少使用的条目
      let minAccess = Infinity;
      let minKey: string | undefined;

      for (const [key, entry] of cache) {
        if (entry.accessCount < minAccess) {
          minAccess = entry.accessCount;
          minKey = key;
        }
      }

      if (minKey) {
        cache.delete(minKey);
        this.stats.evictions++;
        this.logger.debug(`Evicted cache entry ${minKey} (LRU)`);
      }
    }
  }

  /**
   * 更新缓存大小
   */
  private updateSize(): void {
    this.stats.size = this.getSize();
  }
}
