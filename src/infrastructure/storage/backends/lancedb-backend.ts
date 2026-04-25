/**
 * LanceDB Storage Backend
 * @module storage/lancedb-backend
 *
 * Implements IVectorStorageBackend using LanceDB for vector storage
 */

import type {
  IVectorStorageBackend,
  VectorStorageMetadata,
  VectorItem,
  SearchOptions,
  SearchResult,
  QueryCondition,
  StorageStats,
  StorageOperation,
} from '../core/interfaces';
import { createLogger } from '../../../shared/logging';

/**
 * Configuration for LanceDBBackend
 */
export interface LanceDBBackendConfig {
  /** Path to the LanceDB database directory */
  dbPath: string;
  /** Name of the table to use */
  tableName: string;
  /** Dimension of vectors */
  dimension: number;
  /** Whether to automatically build indices */
  autoIndex: boolean;
  /** Interval in milliseconds for index rebuilding */
  indexRebuildInterval: number;
  /** Additional connection options for LanceDB */
  connectionOptions?: Record<string, unknown>;
}

/**
 * LanceDBBackend - LanceDB implementation of IVectorStorageBackend
 *
 * Provides vector storage and search capabilities using LanceDB
 */
export class LanceDBBackend implements IVectorStorageBackend {
  private db: any = null;
  private table: any = null;
  private config: LanceDBBackendConfig;
  private logger = createLogger('LanceDBBackend');
  private indexRebuildTimer: NodeJS.Timeout | null = null;
  private isInitialized = false;

  /**
   * 转义 SQL-like 过滤器中的单引号，防止注入
   */
  private escapeSqlValue(value: string): string {
    return value.replace(/'/g, "''");
  }

  /**
   * Create a new LanceDBBackend
   */
  constructor(config: LanceDBBackendConfig) {
    this.config = { ...config };
  }

  /**
   * Initialize the LanceDB connection and table
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Dynamic import for LanceDB
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const lancedb = require('lancedb');

      // Connect to the database
      this.db = await lancedb.connect(this.config.dbPath, this.config.connectionOptions);

      // Define schema for vectors
      const schema = {
        vector: {
          type: 'fixed',
          dimension: this.config.dimension,
        },
        id: 'string',
        metadata: 'json',
      };

      // Get or create table
      const tableNames = await this.db.tableNames();
      if (tableNames.includes(this.config.tableName)) {
        this.table = await this.db.openTable(this.config.tableName);
      } else {
        this.table = await this.db.createTable(this.config.tableName, schema);
      }

      // Auto-index setup
      if (this.config.autoIndex) {
        this.startIndexRebuildTimer();
      }

      this.isInitialized = true;
      this.logger.info('LanceDBBackend initialized', {
        dbPath: this.config.dbPath,
        tableName: this.config.tableName,
        dimension: this.config.dimension,
      });
    } catch (error) {
      this.logger.error('Failed to initialize LanceDBBackend', error as Error);
      throw error;
    }
  }

  /**
   * Close the LanceDB connection
   */
  async close(): Promise<void> {
    this.stopIndexRebuildTimer();

    if (this.table) {
      this.table = null;
    }

    if (this.db) {
      await this.db.close();
      this.db = null;
    }

    this.isInitialized = false;
    this.logger.info('LanceDBBackend closed');
  }

  /**
   * Add a single vector to the store
   */
  async addVector(id: string, vector: number[], metadata?: VectorStorageMetadata): Promise<void> {
    await this.ensureInitialized();

    try {
      await this.table.add([
        {
          id,
          vector,
          metadata: metadata || {},
        },
      ]);
      this.logger.debug('Vector added', { id, dimension: vector.length });
    } catch (error) {
      this.logger.error('Failed to add vector', error as Error, { id });
      throw error;
    }
  }

  /**
   * Add multiple vectors to the store
   */
  async addVectors(vectors: VectorItem[]): Promise<void> {
    await this.ensureInitialized();

    try {
      const records = vectors.map((item) => ({
        id: item.id,
        vector: item.vector,
        metadata: item.metadata || {},
      }));

      await this.table.add(records);
      this.logger.debug('Vectors added', { count: vectors.length });
    } catch (error) {
      this.logger.error('Failed to add vectors', error as Error, { count: vectors.length });
      throw error;
    }
  }

  /**
   * Delete a single vector by ID
   */
  async deleteVector(id: string): Promise<void> {
    await this.ensureInitialized();

    try {
      await this.table.delete(`id = '${this.escapeSqlValue(id)}'`);
      this.logger.debug('Vector deleted', { id });
    } catch (error) {
      this.logger.error('Failed to delete vector', error as Error, { id });
      throw error;
    }
  }

  /**
   * Delete multiple vectors by IDs
   */
  async deleteVectors(ids: string[]): Promise<void> {
    await this.ensureInitialized();

    try {
      // Build delete expression for multiple IDs (转义单引号防止注入)
      const idList = ids.map((id) => `'${this.escapeSqlValue(id)}'`).join(', ');
      await this.table.delete(`id IN (${idList})`);
      this.logger.debug('Vectors deleted', { count: ids.length });
    } catch (error) {
      this.logger.error('Failed to delete vectors', error as Error, { count: ids.length });
      throw error;
    }
  }

  /**
   * Search for nearest vectors to a query vector
   */
  async searchNearest(queryVector: number[], options: SearchOptions): Promise<SearchResult[]> {
    await this.ensureInitialized();

    try {
      const limit = options.limit || 10;
      const minScore = options.minScore ?? 0;

      // Use LanceDB's nearestTo query
      let query = this.table.query();
      query = query.nearestTo(queryVector);

      if (options.filters?.uids && options.filters.uids.length > 0) {
        const uidList = options.filters.uids.map((uid) => `'${this.escapeSqlValue(uid)}'`).join(', ');
        query = query.where(`id IN (${uidList})`);
      }

      const results = await query.limit(limit).toArray();

      // Convert LanceDB results to SearchResult format
      // LanceDB distance: 0 = identical, higher = more different
      // Convert to similarity score: 1 = identical, 0 = completely different
      const searchResults: SearchResult[] = results
        .map((row: any) => {
          const score = row._distance !== undefined ? 1 - row._distance : 0;
          return {
            id: row.id,
            score,
            metadata: row.metadata,
          };
        })
        .filter((result: SearchResult) => result.score >= minScore);

      return searchResults;
    } catch (error) {
      this.logger.error('Failed to search nearest vectors', error as Error, {
        dimension: queryVector.length,
        limit: options.limit,
      });
      throw error;
    }
  }

  /**
   * Update a vector's values
   */
  async updateVector(id: string, vector: number[]): Promise<void> {
    await this.ensureInitialized();

    try {
      // 先读取现有记录的 metadata
      const existing = await this.table.query().where(`id = '${this.escapeSqlValue(id)}'`).toArray();
      const metadata = existing.length > 0 ? (existing[0].metadata || {}) : {};

      // 删除旧记录
      await this.table.delete(`id = '${this.escapeSqlValue(id)}'`);

      // 添加新记录，保留原有 metadata
      await this.table.add([
        {
          id,
          vector,
          metadata,
        },
      ]);

      this.logger.debug('Vector updated', { id });
    } catch (error) {
      this.logger.error('Failed to update vector', error as Error, { id });
      throw error;
    }
  }

  /**
   * Get the dimension of vectors in this store
   */
  getDimension(): number {
    return this.config.dimension;
  }

  /**
   * Rebuild the vector index
   */
  async rebuildIndex(): Promise<void> {
    await this.ensureInitialized();

    try {
      // LanceDB handles indexing automatically, but we can trigger optimization
      if (this.table.optimize) {
        await this.table.optimize();
      }
      this.logger.info('Index rebuild completed');
    } catch (error) {
      this.logger.error('Failed to rebuild index', error as Error);
      throw error;
    }
  }

  // ============================================================
  // IStorageBackend implementation
  // ============================================================

  /**
   * Get a value by key (not directly supported for vectors, returns null)
   */
  async get<T>(key: string): Promise<T | null> {
    await this.ensureInitialized();

    try {
      const results = await this.table.query().where(`id = '${this.escapeSqlValue(key)}'`).toArray();
      if (results.length === 0) {
        return null;
      }
      return results[0].metadata as T;
    } catch (error) {
      this.logger.error('Failed to get value', error as Error, { key });
      return null;
    }
  }

  /**
   * Set a value by key (not directly supported for vectors)
   */
  async set<T>(key: string, value: T): Promise<void> {
    await this.ensureInitialized();

    // 先删除已有记录，再添加新记录，避免重复
    try {
      const existing = await this.table.query().where(`id = '${this.escapeSqlValue(key)}'`).toArray();
      if (existing.length > 0) {
        await this.table.delete(`id = '${this.escapeSqlValue(key)}'`);
      }
    } catch {
      // 查询失败不影响写入
    }

    await this.table.add([
      {
        id: key,
        vector: new Array(this.config.dimension).fill(0),
        metadata: value,
      },
    ]);
  }

  /**
   * Delete by key
   */
  async delete(key: string): Promise<void> {
    await this.deleteVector(key);
  }

  /**
   * Get multiple values by keys
   */
  async getMany<T>(keys: string[]): Promise<Map<string, T>> {
    await this.ensureInitialized();

    const results = new Map<string, T>();

    try {
      const idList = keys.map((id) => `'${this.escapeSqlValue(id)}'`).join(', ');
      const rows = await this.table.query().where(`id IN (${idList})`).toArray();

      for (const row of rows) {
        results.set(row.id, row.metadata as T);
      }
    } catch (error) {
      this.logger.error('Failed to get many values', error as Error, { count: keys.length });
    }

    return results;
  }

  /**
   * Set multiple key-value pairs
   */
  async setMany<T>(items: Map<string, T>): Promise<void> {
    await this.ensureInitialized();

    const records: any[] = [];
    const entries = Array.from(items.entries());
    for (const [key, value] of entries) {
      records.push({
        id: key,
        vector: new Array(this.config.dimension).fill(0),
        metadata: value,
      });
    }

    await this.table.add(records);
  }

  /**
   * Delete multiple keys
   */
  async deleteMany(keys: string[]): Promise<void> {
    await this.deleteVectors(keys);
  }

  /**
   * Query vectors based on conditions
   */
  async query(condition: QueryCondition): Promise<string[]> {
    await this.ensureInitialized();

    try {
      let query = this.table.query();

      // Apply filters based on condition (转义单引号防止注入)
      if (condition.agentId) {
        query = query.where(`metadata.agentId = '${this.escapeSqlValue(condition.agentId)}'`);
      }
      if (condition.scope) {
        query = query.where(`metadata.scope = '${this.escapeSqlValue(condition.scope)}'`);
      }
      if (condition.type) {
        query = query.where(`metadata.type = '${this.escapeSqlValue(condition.type)}'`);
      }

      const limit = condition.limit || 100;
      const offset = condition.offset || 0;

      const results = await query.limit(limit).offset(offset).toArray();
      return results.map((row: any) => row.id);
    } catch (error) {
      this.logger.error('Failed to query vectors', error as Error);
      return [];
    }
  }

  /**
   * Search vectors (requires queryVector for vector search)
   */
  async search(options: SearchOptions): Promise<SearchResult[]> {
    if (!options.queryVector) {
      return [];
    }
    return this.searchNearest(options.queryVector, options);
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<StorageStats> {
    await this.ensureInitialized();

    try {
      const count = await this.table.count();
      return {
        totalItems: count,
        totalSize: 0, // LanceDB doesn't provide size directly
        lastUpdated: Date.now(),
      };
    } catch (error) {
      this.logger.error('Failed to get stats', error as Error);
      return {
        totalItems: 0,
        totalSize: 0,
        lastUpdated: Date.now(),
      };
    }
  }

  /**
   * Check if an operation is supported
   */
  supports(operation: StorageOperation): boolean {
    switch (operation) {
      case 'vector_search':
        return true;
      case 'full_text_search':
        return false;
      case 'transaction':
        return false;
      case 'batch_operations':
        return true;
      default:
        return false;
    }
  }

  // ============================================================
  // Private helper methods
  // ============================================================

  /**
   * Ensure the backend is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  /**
   * Start the automatic index rebuild timer
   */
  private startIndexRebuildTimer(): void {
    if (this.indexRebuildTimer) {
      return;
    }

    this.indexRebuildTimer = setInterval(async () => {
      try {
        await this.rebuildIndex();
      } catch (error) {
        this.logger.error('Automatic index rebuild failed', error as Error);
      }
    }, this.config.indexRebuildInterval);
  }

  /**
   * Stop the automatic index rebuild timer
   */
  private stopIndexRebuildTimer(): void {
    if (this.indexRebuildTimer) {
      clearInterval(this.indexRebuildTimer);
      this.indexRebuildTimer = null;
    }
  }
}
