/**
 * Cache Manager - LRU 缓存管理
 * @module storage/cache-manager
 */

import type { ICacheManager, CacheConfig, CacheStats } from '../core/types';
import { createServiceLogger, ILogger } from '../../../shared/logging';
import { config } from '../../../shared/config';
import { MemoryDefaults } from '../../../config';

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxSize: MemoryDefaults.cacheMaxSize,
  ttl: MemoryDefaults.cacheTTL,
  evictionPolicy: 'lru',
};

interface CacheEntry {
  memory: any;  // Memory 对象
  accessTime: number;
  accessCount: number;
}

/**
 * LRU Cache implementation for Memory objects
 */
export class CacheManager implements ICacheManager {
  private cache: Map<string, CacheEntry>;
  private config: CacheConfig;
  private logger: ILogger;
  private stats: {
    hits: number;
    misses: number;
    evictions: number;
  };

  constructor(userConfig: Partial<CacheConfig> = {}) {
    // 如果传入配置则使用，否则从 ConfigManager 获取
    if (userConfig && Object.keys(userConfig).length > 0) {
      this.config = { ...DEFAULT_CACHE_CONFIG, ...userConfig };
    } else {
      // ConfigManager 未初始化时使用默认值（与 config.default.json 一致）
      let resolvedConfig = { ...DEFAULT_CACHE_CONFIG };
      if (config.isInitialized()) {
        const managerCacheConfig = config.getConfig<{ maxSize: number; ttl: number; evictionPolicy?: string }>('memoryService.cache');
        if (managerCacheConfig) {
          // 验证 evictionPolicy 只接受 'lru' 或 'lfu'
          const validPolicies = ['lru', 'lfu'];
          const policy = managerCacheConfig.evictionPolicy;
          const isValidPolicy = policy && validPolicies.includes(policy);
          resolvedConfig = {
            maxSize: managerCacheConfig.maxSize ?? DEFAULT_CACHE_CONFIG.maxSize,
            ttl: managerCacheConfig.ttl ?? DEFAULT_CACHE_CONFIG.ttl,
            evictionPolicy: isValidPolicy ? policy as 'lru' | 'lfu' : DEFAULT_CACHE_CONFIG.evictionPolicy,
          };
        }
      }
      this.config = resolvedConfig;
    }
    this.cache = new Map();
    this.logger = createServiceLogger('CacheManager');
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  /**
   * Get a memory from cache by UID.
   * Uses Map re-insertion for O(1) LRU: delete+re-set to move entry to "most recently used" end.
   */
  async get(uid: string): Promise<any | null> {
    const entry = this.cache.get(uid);

    if (!entry) {
      this.stats.misses++;
      this.logger.debug('Cache miss', { uid });
      return null;
    }

    // Check TTL
    if (Date.now() - entry.accessTime > this.config.ttl) {
      this.cache.delete(uid);
      this.stats.misses++;
      this.logger.debug('Cache expired', { uid });
      return null;
    }

    // Update access metadata and move to MRU end (delete+re-set for Map insertion-order LRU)
    entry.accessTime = Date.now();
    entry.accessCount++;
    this.cache.delete(uid);
    this.cache.set(uid, entry);

    this.stats.hits++;
    this.logger.debug('Cache hit', { uid, accessCount: entry.accessCount });
    return entry.memory;
  }

  /**
   * Set a memory in cache
   */
  async set(memory: any): Promise<void> {
    const uid = memory.uid;
    // Check if we need to evict
    if (this.cache.size >= this.config.maxSize && !this.cache.has(uid)) {
      this.evict();
    }

    const entry: CacheEntry = {
      memory,
      accessTime: Date.now(),
      accessCount: 0,
    };

    this.cache.set(uid, entry);
    this.logger.debug('Cache set', { uid, size: this.cache.size });
  }

  /**
   * Delete a memory from cache by UID
   */
  async delete(uid: string): Promise<void> {
    const deleted = this.cache.delete(uid);
    if (deleted) {
      this.logger.debug('Cache delete', { uid });
    }
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    this.cache.clear();
    this.logger.info('Cache cleared');
  }

  /**
   * Check if memory exists in cache (without updating access time)
   * Includes TTL check - expired entries are removed and return false
   */
  has(uid: string): boolean {
    const entry = this.cache.get(uid);
    if (!entry) return false;

    // Check TTL - remove expired entry
    if (Date.now() - entry.accessTime > this.config.ttl) {
      this.cache.delete(uid);
      this.logger.debug('Cache expired on has() check', { uid });
      return false;
    }

    return true;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      size: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }

  /**
   * Evict the least recently used entry
   */
  private evict(): void {
    if (this.config.evictionPolicy === 'lru') {
      this.evictLRU();
    } else {
      this.evictLFU();
    }
  }

  /**
   * Evict least recently used entry in O(1) using Map insertion order.
   * Map preserves insertion order; the first key is the least recently used.
   */
  private evictLRU(): void {
    const oldestKey = this.cache.keys().next().value as string | undefined;
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
      this.logger.debug('LRU eviction', { uid: oldestKey });
    }
  }

  /**
   * Evict least frequently used entry
   */
  private evictLFU(): void {
    let leastFreqId: string | null = null;
    let leastFreq = Infinity;

    for (const [id, entry] of this.cache.entries()) {
      if (entry.accessCount < leastFreq) {
        leastFreq = entry.accessCount;
        leastFreqId = id;
      }
    }

    if (leastFreqId) {
      this.cache.delete(leastFreqId);
      this.stats.evictions++;
      this.logger.debug('LFU eviction', { uid: leastFreqId });
    }
  }

  /**
   * Get multiple memories from cache
   */
  async getMany(uids: string[]): Promise<Map<string, any>> {
    if (uids.length === 0) return new Map();

    // 并行获取所有记忆（优化 N+1 查询）
    const results = await Promise.all(uids.map(uid => this.get(uid)));
    const result = new Map<string, any>();
    results.forEach((memory, i) => {
      if (memory) result.set(uids[i], memory);
    });

    return result;
  }

  /**
   * Set multiple memories in cache
   */
  async setMany(memories: any[]): Promise<void> {
    if (memories.length === 0) return;

    // 并行设置所有记忆（优化 N+1 查询）
    await Promise.all(memories.map(memory => this.set(memory)));
  }

  /**
   * Delete multiple memories from cache
   */
  async deleteMany(uids: string[]): Promise<void> {
    if (uids.length === 0) return;

    // 并行删除所有记忆（优化 N+1 查询）
    await Promise.all(uids.map(uid => this.delete(uid)));
  }

  /**
   * Remove memories by filter
   */
  async removeByFilter(filter: (memory: any) => boolean): Promise<number> {
    let removed = 0;

    for (const [uid, entry] of this.cache.entries()) {
      if (filter(entry.memory)) {
        this.cache.delete(uid);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.info('Cache bulk delete', { count: removed });
    }

    return removed;
  }

  /**
   * Get memories sorted by importance
   */
  async getTopByImportance(limit: number): Promise<any[]> {
    const entries = Array.from(this.cache.values());

    entries.sort((a, b) => b.memory.importanceScore - a.memory.importanceScore);

    return entries.slice(0, limit).map(e => e.memory);
  }
}
