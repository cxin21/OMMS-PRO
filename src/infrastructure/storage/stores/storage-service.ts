/**
 * Storage Service Facade
 * @module storage/storage-service
 *
 * Manages hot/warm/cold storage tiers and provides a unified interface
 */

import { createServiceLogger } from '../../../shared/logging';
import type { IStorageBackend, IVectorStorageBackend } from '../core/interfaces';
import { StorageTier } from '../core/types';

// Logger
const logger = createServiceLogger('StorageService');

// ============================================================
// Configuration Types
// ============================================================

export interface StorageServiceConfig {
  enableHotStorage: boolean;
  hotStorageCapacity: number;
  hotStorageTTL: number;
  enableAutoTiering: boolean;
  tierCheckInterval: number;
  backends: {
    hot?: IStorageBackend;
    warm?: IVectorStorageBackend;
    cold?: IStorageBackend;
  };
}

// ============================================================
// Storage Service
// ============================================================

export class StorageService {
  private config: StorageServiceConfig;
  private initialized = false;
  private tierStats: Record<StorageTier, { itemCount: number; totalSize: number }> = {
    [StorageTier.HOT]: { itemCount: 0, totalSize: 0 },
    [StorageTier.WARM]: { itemCount: 0, totalSize: 0 },
    [StorageTier.COLD]: { itemCount: 0, totalSize: 0 },
  };
  private tierCheckTimer?: NodeJS.Timeout;

  constructor(config: StorageServiceConfig) {
    this.config = config;
  }

  /**
   * Initialize all storage backends
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('StorageService already initialized');
      return;
    }

    logger.info('Initializing StorageService');

    const initPromises: Promise<void>[] = [];

    if (this.config.enableHotStorage && this.config.backends.hot) {
      initPromises.push(this.config.backends.hot.initialize());
    }

    if (this.config.backends.warm) {
      initPromises.push(this.config.backends.warm.initialize());
    }

    if (this.config.backends.cold) {
      initPromises.push(this.config.backends.cold.initialize());
    }

    await Promise.all(initPromises);
    this.initialized = true;

    // Start tier check timer if auto-tiering is enabled
    if (this.config.enableAutoTiering && this.config.tierCheckInterval > 0) {
      this.startTierCheckTimer();
    }

    logger.info('StorageService initialized successfully');
  }

  /**
   * Close all storage backends
   */
  async close(): Promise<void> {
    if (!this.initialized) {
      logger.warn('StorageService not initialized, nothing to close');
      return;
    }

    logger.info('Closing StorageService');

    // Stop tier check timer
    if (this.tierCheckTimer) {
      clearInterval(this.tierCheckTimer);
      this.tierCheckTimer = undefined;
    }

    const closePromises: Promise<void>[] = [];

    if (this.config.backends.hot) {
      closePromises.push(this.config.backends.hot.close());
    }

    if (this.config.backends.warm) {
      closePromises.push(this.config.backends.warm.close());
    }

    if (this.config.backends.cold) {
      closePromises.push(this.config.backends.cold.close());
    }

    await Promise.all(closePromises);
    this.initialized = false;

    logger.info('StorageService closed');
  }

  /**
   * Store a value in the specified tier (default: WARM)
   */
  async store<T>(
    key: string,
    value: T,
    options?: { tier?: StorageTier; ttl?: number }
  ): Promise<void> {
    const tier = options?.tier ?? StorageTier.WARM;

    logger.debug(`Storing key "${key}" in tier ${tier}`);

    let backend: IStorageBackend | IVectorStorageBackend | undefined;

    switch (tier) {
      case StorageTier.HOT:
        backend = this.config.backends.hot;
        break;
      case StorageTier.WARM:
        backend = this.config.backends.warm;
        break;
      case StorageTier.COLD:
        backend = this.config.backends.cold;
        break;
    }

    if (!backend) {
      throw new Error(`Backend not configured for tier: ${tier}`);
    }

    await backend.set(key, value);
    this.updateTierStats(tier, 'increment');

    logger.debug(`Successfully stored key "${key}" in tier ${tier}`);
  }

  /**
   * Get a value, searching HOT -> WARM -> COLD
   * If found in COLD and autoTiering is enabled, promotes to WARM
   */
  async get<T>(key: string): Promise<T | null> {
    logger.debug(`Getting key "${key}"`);

    // Try HOT first
    if (this.config.enableHotStorage && this.config.backends.hot) {
      const hotResult = await this.config.backends.hot.get<T>(key);
      if (hotResult !== null) {
        logger.debug(`Found key "${key}" in HOT tier`);
        return hotResult;
      }
    }

    // Try WARM
    if (this.config.backends.warm) {
      const warmResult = await this.config.backends.warm.get<T>(key);
      if (warmResult !== null) {
        logger.debug(`Found key "${key}" in WARM tier`);
        return warmResult;
      }
    }

    // Try COLD
    if (this.config.backends.cold) {
      const coldResult = await this.config.backends.cold.get<T>(key);
      if (coldResult !== null) {
        logger.debug(`Found key "${key}" in COLD tier`);

        // Auto-tiering: promote to WARM if enabled
        if (this.config.enableAutoTiering && this.config.backends.warm) {
          logger.info(`Promoting key "${key}" from COLD to WARM tier`);
          try {
            await this.promoteToTier(key, StorageTier.COLD, StorageTier.WARM);
          } catch (error) {
            logger.error(`Failed to promote key "${key}" from COLD to WARM: ${error}`);
          }
        }

        return coldResult;
      }
    }

    logger.debug(`Key "${key}" not found in any tier`);
    return null;
  }

  /**
   * Delete a value from all tiers
   */
  async delete(key: string): Promise<void> {
    logger.debug(`Deleting key "${key}" from all tiers`);

    const deletePromises: Promise<void>[] = [];

    if (this.config.backends.hot) {
      deletePromises.push(this.config.backends.hot.delete(key));
    }

    if (this.config.backends.warm) {
      deletePromises.push(this.config.backends.warm.delete(key));
    }

    if (this.config.backends.cold) {
      deletePromises.push(this.config.backends.cold.delete(key));
    }

    await Promise.all(deletePromises);

    // Note: We don't update tier stats on delete since we don't know which tier had the item.
    // Stats are approximations anyway, and deletes are rare.

    logger.debug(`Successfully deleted key "${key}" from all tiers`);
  }

  /**
   * Store multiple items in a specified tier
   */
  async storeMany<T>(items: Map<string, T>, tier?: StorageTier): Promise<void> {
    const targetTier = tier ?? StorageTier.WARM;

    logger.debug(`Storing ${items.size} items in tier ${targetTier}`);

    let backend: IStorageBackend | IVectorStorageBackend | undefined;

    switch (targetTier) {
      case StorageTier.HOT:
        backend = this.config.backends.hot;
        break;
      case StorageTier.WARM:
        backend = this.config.backends.warm;
        break;
      case StorageTier.COLD:
        backend = this.config.backends.cold;
        break;
    }

    if (!backend) {
      throw new Error(`Backend not configured for tier: ${targetTier}`);
    }

    await backend.setMany(items);
    this.tierStats[targetTier].itemCount += items.size;

    // Calculate approximate size
    const approxSize = Array.from(items.values()).reduce((sum, val) => {
      return sum + this.estimateSize(val);
    }, 0);
    this.tierStats[targetTier].totalSize += approxSize;

    logger.debug(`Successfully stored ${items.size} items in tier ${targetTier}`);
  }

  /**
   * Get multiple values by keys
   */
  async getMany<T>(keys: string[]): Promise<Map<string, T>> {
    logger.debug(`Getting ${keys.length} keys`);

    const results = new Map<string, T>();

    // Try to get from each tier
    const tiers: Array<{ tier: StorageTier; backend: IStorageBackend | IVectorStorageBackend | undefined }> = [
      { tier: StorageTier.HOT, backend: this.config.backends.hot },
      { tier: StorageTier.WARM, backend: this.config.backends.warm },
      { tier: StorageTier.COLD, backend: this.config.backends.cold },
    ];

    const remainingKeys = new Set(keys);

    for (const { tier, backend } of tiers) {
      if (remainingKeys.size === 0) break;
      if (!backend) continue;

      const keysToFetch = Array.from(remainingKeys);
      const tierResults = await backend.getMany<T>(keysToFetch);

      for (const [key, value] of tierResults) {
        results.set(key, value);
        remainingKeys.delete(key);
      }

      // Auto-promote from COLD if found
      if (this.config.enableAutoTiering && tier === StorageTier.COLD && this.config.backends.warm) {
        for (const key of tierResults.keys()) {
          if (results.has(key)) {
            logger.info(`Auto-promoting key "${key}" from COLD to WARM`);
            try {
              await this.promoteToTier(key, StorageTier.COLD, StorageTier.WARM);
            } catch (error) {
              logger.error(`Failed to promote key "${key}" from COLD to WARM: ${error}`);
            }
          }
        }
      }
    }

    logger.debug(`Retrieved ${results.size} of ${keys.length} keys`);
    return results;
  }

  /**
   * Get statistics for all tiers
   */
  async getStats(): Promise<Record<StorageTier, { itemCount: number; totalSize: number }>> {
    logger.debug('Getting storage stats');

    // Refresh stats from backends
    const refreshPromises: Promise<void>[] = [];

    if (this.config.backends.hot) {
      refreshPromises.push(
        this.config.backends.hot.getStats().then((stats) => {
          this.tierStats[StorageTier.HOT] = {
            itemCount: stats.totalItems,
            totalSize: stats.totalSize,
          };
        })
      );
    }

    if (this.config.backends.warm) {
      refreshPromises.push(
        this.config.backends.warm.getStats().then((stats) => {
          this.tierStats[StorageTier.WARM] = {
            itemCount: stats.totalItems,
            totalSize: stats.totalSize,
          };
        })
      );
    }

    if (this.config.backends.cold) {
      refreshPromises.push(
        this.config.backends.cold.getStats().then((stats) => {
          this.tierStats[StorageTier.COLD] = {
            itemCount: stats.totalItems,
            totalSize: stats.totalSize,
          };
        })
      );
    }

    await Promise.all(refreshPromises);

    return { ...this.tierStats };
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Promote data from one tier to a warmer tier
   */
  private async promoteToTier(key: string, sourceTier: StorageTier, targetTier: StorageTier): Promise<void> {
    logger.debug(`Promoting key "${key}" from tier ${sourceTier} to ${targetTier}`);

    const sourceBackend = sourceTier === StorageTier.COLD
      ? this.config.backends.cold
      : sourceTier === StorageTier.WARM
        ? this.config.backends.warm
        : this.config.backends.hot;
    const targetBackend = targetTier === StorageTier.COLD
      ? this.config.backends.cold
      : targetTier === StorageTier.WARM
        ? this.config.backends.warm
        : this.config.backends.hot;

    if (!sourceBackend || !targetBackend) {
      logger.warn('Cannot promote: source or target backend not available');
      return;
    }

    // Get data from source tier
    const data = await sourceBackend.get(key);
    if (data === null) {
      logger.warn(`Cannot promote key "${key}": not found in source tier`);
      return;
    }

    // Store in target tier
    await targetBackend.set(key, data);

    // Delete from source tier
    await sourceBackend.delete(key);

    // Update stats
    this.updateTierStats(sourceTier, 'decrement');
    this.updateTierStats(targetTier, 'increment');

    logger.info(`Successfully promoted key "${key}" from ${sourceTier} to ${targetTier}`);
  }

  /**
   * Start the tier check timer for auto-tiering
   */
  private startTierCheckTimer(): void {
    logger.info(`Starting tier check timer with interval ${this.config.tierCheckInterval}ms`);

    this.tierCheckTimer = setInterval(async () => {
      try {
        await this.performTierCheck();
      } catch (error) {
        logger.error('Error during tier check', error instanceof Error ? error : { message: String(error) });
      }
    }, this.config.tierCheckInterval);
  }

  /**
   * Perform periodic tier check
   */
  private async performTierCheck(): Promise<void> {
    logger.debug('Performing tier check');

    // This is a placeholder for tier migration logic
    // In a full implementation, this would:
    // 1. Check hot tier capacity and evict if needed
    // 2. Check for cold items that should be promoted
    // 3. Check for warm items that should be demoted to cold

    if (!this.config.backends.cold || !this.config.backends.warm) {
      return;
    }

    // Check if hot storage is at capacity and evict if needed
    if (this.config.enableHotStorage && this.config.backends.hot) {
      const hotStats = await this.config.backends.hot.getStats();
      if (hotStats.totalItems >= this.config.hotStorageCapacity) {
        logger.info('Hot storage at capacity, triggering eviction check', {
          currentItems: hotStats.totalItems,
          capacity: this.config.hotStorageCapacity,
        });

        // 实现 LRU 驱逐逻辑：查询最老的条目并删除
        try {
          // 查询最老的条目（按时间升序，最多查出一批用于驱逐）
          const keysToEvict = await this.config.backends.hot.query({
            orderBy: 'time',
            orderDir: 'asc',
            limit: Math.min(100, Math.ceil(hotStats.totalItems * 0.1)), // 驱逐10%或100个
          });

          if (keysToEvict.length > 0) {
            await this.config.backends.hot.deleteMany(keysToEvict);
            logger.info('Evicted items from hot storage', {
              evictedCount: keysToEvict.length,
              remainingItems: hotStats.totalItems - keysToEvict.length,
            });
          }
        } catch (error) {
          logger.error('Failed to evict items from hot storage', { error: String(error) });
        }
      }
    }
  }

  /**
   * Update tier statistics
   */
  private updateTierStats(tier: StorageTier, operation: 'increment' | 'decrement'): void {
    if (operation === 'increment') {
      this.tierStats[tier].itemCount++;
    } else {
      this.tierStats[tier].itemCount = Math.max(0, this.tierStats[tier].itemCount - 1);
    }
  }

  /**
   * Estimate the size of a value in bytes
   */
  private estimateSize(value: unknown): number {
    try {
      return JSON.stringify(value).length;
    } catch {
      return 0;
    }
  }
}
