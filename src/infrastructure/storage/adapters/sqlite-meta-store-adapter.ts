import type { IStorageBackend, StorageStats, QueryCondition, SearchOptions, SearchResult } from '../core/interfaces';
import type { SQLiteMetaStore } from '../stores/sqlite-meta-store';
import type { SQLiteQueryOptions } from '../core/types';
import type { MemoryScope, MemoryType } from '../../../core/types/memory';

export class SQLiteMetaStoreAdapter implements IStorageBackend {
  constructor(private metaStore: SQLiteMetaStore) {}

  async initialize(): Promise<void> { await this.metaStore.initialize(); }
  async close(): Promise<void> { this.metaStore.close(); }

  async get<T>(key: string): Promise<T | null> {
    try {
      const records = await this.metaStore.getByIds([key]);
      return records.length > 0 ? records[0] as T : null;
    } catch (error) {
      throw new Error(`Failed to get record ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async set<T>(key: string, value: T): Promise<void> { /* no-op - use metaStore directly */ }
  async delete(key: string): Promise<void> {
    try {
      await this.metaStore.delete(key);
    } catch (error) {
      throw new Error(`Failed to delete record ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getMany<T>(keys: string[]): Promise<Map<string, T>> {
    try {
      const records = await this.metaStore.getByIds(keys);
      return new Map(records.map(r => [r.uid, r as T]));
    } catch (error) {
      throw new Error(`Failed to get records: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async setMany<T>(items: Map<string, T>): Promise<void> { /* no-op */ }
  async deleteMany(keys: string[]): Promise<void> {
    // No-op: batch delete not directly supported, delegate to individual deletes
    try {
      for (const key of keys) await this.delete(key);
    } catch (error) {
      throw new Error(`Failed to delete records: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async query(condition: QueryCondition): Promise<string[]> {
    try {
      // Convert QueryCondition to SQLiteQueryOptions
      const queryOptions: SQLiteQueryOptions = {
        agentId: condition.agentId,
        scope: condition.scope as MemoryScope,
        type: condition.type as MemoryType,
        limit: condition.limit
      };
      const results = await this.metaStore.query(queryOptions);
      return results.map(r => r.uid);
    } catch (error) {
      throw new Error(`Failed to query records: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async search(options: SearchOptions): Promise<SearchResult[]> { return []; }
  async getStats(): Promise<StorageStats> {
    try {
      const stats = await this.metaStore.getStats();
      // Map SQLiteMetaStore stats to StorageStats format
      return {
        totalItems: stats.total,
        totalSize: 0,  // SQLiteMetaStore doesn't track size
        lastUpdated: Date.now()
      };
    } catch (error) {
      throw new Error(`Failed to get stats: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  supports(operation: string): boolean {
    return ['transaction', 'batch_operations'].includes(operation);
  }
}