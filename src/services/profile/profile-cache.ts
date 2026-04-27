/**
 * Profile Cache - 用户数据缓存
 *
 * 使用 LRU 缓存机制提高用户数据访问性能
 * 支持 SQLite 持久化，TTL 过期的数据在 SQLite 中标记为 expired 但保留
 */

import { createServiceLogger, type ILogger } from '../../shared/logging';
import { config } from '../../shared/config';
import { FileUtils } from '../../shared/utils/file';
import { dirname } from 'path';
import Database from 'better-sqlite3';
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
  dbPath?: string;
}

type DataType = 'persona' | 'preferences' | 'tags' | 'stats';

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
  private db: InstanceType<typeof Database> | null = null;
  private dbPath: string;
  private initialized: boolean = false;

  constructor(options?: ProfileCacheOptions) {
    this.logger = createServiceLogger('ProfileCache');

    // Try to read cache config from ConfigManager
    let cacheMaxSize = 1000;
    let cacheTtl = 5 * 60 * 1000;
    try {
      const cacheConfig = config.getConfig<{ maxSize: number; ttl: number }>('memoryService.cache');
      if (cacheConfig) {
        cacheMaxSize = cacheConfig.maxSize ?? cacheMaxSize;
        cacheTtl = cacheConfig.ttl ?? cacheTtl;
      }
    } catch {
      // ConfigManager not initialized yet, will use defaults
    }

    this.options = {
      maxSize: options?.maxSize ?? cacheMaxSize,
      ttl: options?.ttl ?? cacheTtl,
      dbPath: options?.dbPath ?? '',
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

    // Resolve dbPath from config if not provided
    this.dbPath = this.options.dbPath;
    if (!this.dbPath) {
      try {
        const storageConfig = config.getConfig<{ profileCacheDbPath: string }>('memoryService.storage');
        this.dbPath = storageConfig?.profileCacheDbPath ?? '';
      } catch {
        // ConfigManager not initialized yet, will resolve later in initialize()
      }
    }
  }

  /**
   * Initialize SQLite connection and load existing data
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Resolve dbPath if still empty (ConfigManager may not have been ready in constructor)
    if (!this.dbPath) {
      try {
        const storageConfig = config.getConfig<{ profileCacheDbPath: string }>('memoryService.storage');
        this.dbPath = storageConfig?.profileCacheDbPath ?? '';
      } catch {
        this.dbPath = '';
      }
    }

    if (!this.dbPath) {
      this.logger.warn('ProfileCache: no dbPath configured, SQLite persistence disabled');
      this.initialized = true;
      return;
    }

    try {
      await FileUtils.ensureDirectory(dirname(this.dbPath));
      this.db = new Database(this.dbPath);

      // Create table with idempotent migrations
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS profile_cache (
          userId TEXT NOT NULL,
          dataType TEXT NOT NULL,
          data TEXT NOT NULL,
          updatedAt INTEGER NOT NULL,
          createdAt INTEGER NOT NULL,
          expired INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (userId, dataType)
        )
      `);

      // Idempotent migrations: add expired column if not exists
      try {
        this.db.exec(`ALTER TABLE profile_cache ADD COLUMN expired INTEGER NOT NULL DEFAULT 0`);
        this.logger.debug('Migrated profile_cache: added expired column');
      } catch {
        // Column already exists, ignore
      }

      // Create indexes
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_profile_cache_userId ON profile_cache(userId)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_profile_cache_updatedAt ON profile_cache(updatedAt)`);

      // Load active (non-expired) data from SQLite into memory
      this.loadFromSQLite();

      this.initialized = true;
      this.logger.info('ProfileCache SQLite persistence initialized', { dbPath: this.dbPath });
    } catch (error) {
      this.logger.error('Failed to initialize ProfileCache SQLite persistence', { error });
      // Continue without persistence - memory-only mode
      this.initialized = true;
    }
  }

  /**
   * Load active (non-expired) records from SQLite into memory caches
   */
  private loadFromSQLite(): void {
    if (!this.db) return;

    try {
      const rows = this.db.prepare(
        `SELECT userId, dataType, data, updatedAt, createdAt FROM profile_cache WHERE expired = 0`
      ).all() as Array<{ userId: string; dataType: DataType; data: string; updatedAt: number; createdAt: number }>;

      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.data);
          const entry: CacheEntry<any> = {
            value: parsed,
            timestamp: row.createdAt,
            accessCount: 0,
            lastAccess: row.updatedAt,
          };

          switch (row.dataType) {
            case 'persona':
              this.personaCache.set(row.userId, entry as CacheEntry<Persona>);
              break;
            case 'preferences':
              this.preferencesCache.set(row.userId, entry as CacheEntry<UserPreferences>);
              break;
            case 'tags':
              this.tagsCache.set(row.userId, entry as CacheEntry<UserTag[]>);
              break;
            case 'stats':
              this.statsCache.set(row.userId, entry as CacheEntry<UserStats>);
              break;
          }
        } catch (parseError) {
          this.logger.warn('Failed to parse cached data from SQLite', { userId: row.userId, dataType: row.dataType, error: parseError });
        }
      }

      this.updateSize();
      this.logger.debug('Loaded profile cache from SQLite', { count: rows.length });
    } catch (error) {
      this.logger.error('Failed to load profile cache from SQLite', { error });
    }
  }

  /**
   * Persist a cache entry to SQLite (upsert)
   */
  private upsertSQLite(userId: string, dataType: DataType, value: any): void {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT INTO profile_cache (userId, dataType, data, updatedAt, createdAt, expired)
        VALUES (?, ?, ?, ?, ?, 0)
        ON CONFLICT(userId, dataType) DO UPDATE SET
          data = excluded.data,
          updatedAt = excluded.updatedAt,
          expired = 0
      `);

      const now = Date.now();
      stmt.run(userId, dataType, JSON.stringify(value), now, now);
    } catch (error) {
      this.logger.error('Failed to upsert profile cache to SQLite', { userId, dataType, error });
    }
  }

  /**
   * Mark a cache entry as expired in SQLite (retain for recovery)
   */
  private expireSQLite(userId: string, dataType: DataType): void {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        UPDATE profile_cache SET expired = 1, updatedAt = ? WHERE userId = ? AND dataType = ?
      `);
      stmt.run(Date.now(), userId, dataType);
    } catch (error) {
      this.logger.error('Failed to expire profile cache in SQLite', { userId, dataType, error });
    }
  }

  /**
   * Delete a cache entry from SQLite
   */
  private deleteSQLite(userId: string, dataType: DataType): void {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`DELETE FROM profile_cache WHERE userId = ? AND dataType = ?`);
      stmt.run(userId, dataType);
    } catch (error) {
      this.logger.error('Failed to delete profile cache from SQLite', { userId, dataType, error });
    }
  }

  /**
   * Delete all cache entries for a user from SQLite
   */
  private deleteAllForUserSQLite(userId: string): void {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`DELETE FROM profile_cache WHERE userId = ?`);
      stmt.run(userId);
    } catch (error) {
      this.logger.error('Failed to delete all profile cache for user from SQLite', { userId, error });
    }
  }

  /**
   * Clear all profile cache from SQLite
   */
  private clearSQLite(): void {
    if (!this.db) return;

    try {
      this.db.exec(`DELETE FROM profile_cache`);
    } catch (error) {
      this.logger.error('Failed to clear profile cache from SQLite', { error });
    }
  }

  /**
   * Ensure the cache is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Load a specific user's data type from SQLite and populate memory cache
   * Returns the loaded value or undefined if not found
   */
  private loadFromSQLiteByKey(userId: string, dataType: DataType): any | undefined {
    if (!this.db) return undefined;

    try {
      const row = this.db.prepare(
        `SELECT data, updatedAt, createdAt FROM profile_cache WHERE userId = ? AND dataType = ? AND expired = 0`
      ).get(userId, dataType) as { data: string; updatedAt: number; createdAt: number } | undefined;

      if (!row) return undefined;

      const parsed = JSON.parse(row.data);
      const entry: CacheEntry<any> = {
        value: parsed,
        timestamp: row.createdAt,
        accessCount: 0,
        lastAccess: row.updatedAt,
      };

      switch (dataType) {
        case 'persona':
          this.personaCache.set(userId, entry as CacheEntry<Persona>);
          break;
        case 'preferences':
          this.preferencesCache.set(userId, entry as CacheEntry<UserPreferences>);
          break;
        case 'tags':
          this.tagsCache.set(userId, entry as CacheEntry<UserTag[]>);
          break;
        case 'stats':
          this.statsCache.set(userId, entry as CacheEntry<UserStats>);
          break;
      }

      this.updateSize();
      this.logger.debug(`Loaded ${dataType} from SQLite for user ${userId}`);
      return parsed;
    } catch (error) {
      this.logger.error(`Failed to load ${dataType} from SQLite for user ${userId}`, { error });
      return undefined;
    }
  }

  /**
   * 获取 Persona
   */
  async getPersona(userId: string): Promise<Persona | undefined> {
    await this.ensureInitialized();

    const entry = this.personaCache.get(userId);

    if (!entry) {
      // Cache miss: try to load from SQLite
      const loaded = this.loadFromSQLiteByKey(userId, 'persona');
      if (loaded !== undefined) {
        return loaded as Persona;
      }
      this.stats.misses++;
      return undefined;
    }

    // 检查 TTL（使用 lastAccess 而不是 timestamp，以便活跃访问可以续期 TTL）
    if (Date.now() - entry.lastAccess > this.options.ttl) {
      this.personaCache.delete(userId);
      this.expireSQLite(userId, 'persona');
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
   * Synchronous getPersona (backward compatibility)
   */
  getPersonaSync(userId: string): Persona | undefined {
    const entry = this.personaCache.get(userId);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    if (Date.now() - entry.lastAccess > this.options.ttl) {
      this.personaCache.delete(userId);
      this.expireSQLite(userId, 'persona');
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
    this.upsertSQLite(userId, 'persona', persona);
    this.logger.debug(`Persona cached for ${userId}`);
  }

  /**
   * 获取偏好
   */
  async getPreferences(userId: string): Promise<UserPreferences | undefined> {
    await this.ensureInitialized();

    const entry = this.preferencesCache.get(userId);

    if (!entry) {
      // Cache miss: try to load from SQLite
      const loaded = this.loadFromSQLiteByKey(userId, 'preferences');
      if (loaded !== undefined) {
        return loaded as UserPreferences;
      }
      this.stats.misses++;
      return undefined;
    }

    // 检查 TTL（使用 lastAccess 而不是 timestamp，以便活跃访问可以续期 TTL）
    if (Date.now() - entry.lastAccess > this.options.ttl) {
      this.preferencesCache.delete(userId);
      this.expireSQLite(userId, 'preferences');
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
   * Synchronous getPreferences (backward compatibility)
   */
  getPreferencesSync(userId: string): UserPreferences | undefined {
    const entry = this.preferencesCache.get(userId);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    if (Date.now() - entry.lastAccess > this.options.ttl) {
      this.preferencesCache.delete(userId);
      this.expireSQLite(userId, 'preferences');
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
    this.upsertSQLite(userId, 'preferences', preferences);
    this.logger.debug(`Preferences cached for ${userId}`);
  }

  /**
   * 获取标签
   */
  async getTags(userId: string): Promise<UserTag[] | undefined> {
    await this.ensureInitialized();

    const entry = this.tagsCache.get(userId);

    if (!entry) {
      // Cache miss: try to load from SQLite
      const loaded = this.loadFromSQLiteByKey(userId, 'tags');
      if (loaded !== undefined) {
        return loaded as UserTag[];
      }
      this.stats.misses++;
      return undefined;
    }

    // 检查 TTL（使用 lastAccess 而不是 timestamp，以便活跃访问可以续期 TTL）
    if (Date.now() - entry.lastAccess > this.options.ttl) {
      this.tagsCache.delete(userId);
      this.expireSQLite(userId, 'tags');
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
   * Synchronous getTags (backward compatibility)
   */
  getTagsSync(userId: string): UserTag[] | undefined {
    const entry = this.tagsCache.get(userId);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    if (Date.now() - entry.lastAccess > this.options.ttl) {
      this.tagsCache.delete(userId);
      this.expireSQLite(userId, 'tags');
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
    this.upsertSQLite(userId, 'tags', tags);
    this.logger.debug(`Tags cached for ${userId} (${tags.length} tags)`);
  }

  /**
   * 获取统计
   */
  async getUserStats(userId: string): Promise<UserStats | undefined> {
    await this.ensureInitialized();

    const entry = this.statsCache.get(userId);

    if (!entry) {
      // Cache miss: try to load from SQLite
      const loaded = this.loadFromSQLiteByKey(userId, 'stats');
      if (loaded !== undefined) {
        return loaded as UserStats;
      }
      this.stats.misses++;
      return undefined;
    }

    // 检查 TTL（使用 lastAccess 而不是 timestamp，以便活跃访问可以续期 TTL）
    if (Date.now() - entry.lastAccess > this.options.ttl) {
      this.statsCache.delete(userId);
      this.expireSQLite(userId, 'stats');
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
   * Synchronous getUserStats (backward compatibility)
   */
  getUserStatsSync(userId: string): UserStats | undefined {
    const entry = this.statsCache.get(userId);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    if (Date.now() - entry.lastAccess > this.options.ttl) {
      this.statsCache.delete(userId);
      this.expireSQLite(userId, 'stats');
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
    this.upsertSQLite(userId, 'stats', stats);
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

    // Also remove from SQLite
    this.deleteAllForUserSQLite(userId);

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

    // Also clear SQLite
    this.clearSQLite();

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
   * Note: Expired entries are marked as expired in SQLite (retained for recovery) but removed from memory
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.personaCache) {
      if (now - entry.lastAccess > this.options.ttl) {
        this.personaCache.delete(key);
        this.expireSQLite(key, 'persona');
        cleaned++;
      }
    }

    for (const [key, entry] of this.preferencesCache) {
      if (now - entry.lastAccess > this.options.ttl) {
        this.preferencesCache.delete(key);
        this.expireSQLite(key, 'preferences');
        cleaned++;
      }
    }

    for (const [key, entry] of this.tagsCache) {
      if (now - entry.lastAccess > this.options.ttl) {
        this.tagsCache.delete(key);
        this.expireSQLite(key, 'tags');
        cleaned++;
      }
    }

    for (const [key, entry] of this.statsCache) {
      if (now - entry.lastAccess > this.options.ttl) {
        this.statsCache.delete(key);
        this.expireSQLite(key, 'stats');
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

  /**
   * 关闭缓存，释放 SQLite 连接
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
    this.logger.info('ProfileCache closed');
  }
}
