/**
 * SQLite Storage Backend
 * @module storage/sqlite-backend
 *
 * Implements IStorageBackend using better-sqlite3 for relational/metadata storage
 */

import Database from 'better-sqlite3';
import type {
  IStorageBackend,
  QueryCondition,
  SearchOptions,
  SearchResult,
  StorageStats,
  StorageOperation,
} from '../core/interfaces';
import { createLogger } from '../../../shared/logging';

/**
 * Configuration for SQLiteBackend
 */
export interface SQLiteBackendConfig {
  /** Path to the SQLite database file */
  dbPath: string;
  /** Name of the table to use */
  tableName: string;
  /** Enable Write-Ahead Logging mode */
  enableWAL: boolean;
  /** Cache size in pages (negative = KB) */
  cacheSize: number;
}

/**
 * SQLiteBackend - better-sqlite3 implementation of IStorageBackend
 *
 * Provides key-value storage with relational metadata capabilities
 */
export class SQLiteBackend implements IStorageBackend {
  private db: Database.Database | null = null;
  private config: SQLiteBackendConfig;
  private logger = createLogger('SQLiteBackend');
  private isInitialized = false;

  /**
   * Create a new SQLiteBackend
   */
  constructor(config: SQLiteBackendConfig) {
    this.config = { ...config };
  }

  /**
   * Initialize the SQLite database connection and table
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Open database connection
      this.db = new Database(this.config.dbPath);

      // Configure database settings
      if (this.config.enableWAL) {
        this.db.pragma('journal_mode = WAL');
      }
      if (this.config.cacheSize !== 0) {
        this.db.pragma(`cache_size = ${this.config.cacheSize}`);
      }

      // Create table with key, value, and timestamps
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS ${this.config.tableName} (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `;
      this.db.exec(createTableSQL);

      // Create index on updated_at for time-based queries
      const createIndexSQL = `
        CREATE INDEX IF NOT EXISTS idx_updated_at
        ON ${this.config.tableName}(updated_at)
      `;
      this.db.exec(createIndexSQL);

      this.isInitialized = true;
      this.logger.info('SQLiteBackend initialized', {
        dbPath: this.config.dbPath,
        tableName: this.config.tableName,
        enableWAL: this.config.enableWAL,
      });
    } catch (error) {
      this.logger.error('Failed to initialize SQLiteBackend', error as Error);
      throw error;
    }
  }

  /**
   * Ensure the database is initialized
   */
  private ensureInitialized(): void {
    if (!this.isInitialized || !this.db) {
      throw new Error('SQLiteBackend not initialized. Call initialize() first.');
    }
  }

  /**
   * Close the SQLite connection
   */
  async close(): Promise<void> {
    this.ensureInitialized();

    if (this.db) {
      this.db.close();
      this.db = null;
    }

    this.isInitialized = false;
    this.logger.info('SQLiteBackend closed');
  }

  /**
   * Get a value by key
   */
  async get<T>(key: string): Promise<T | null> {
    this.ensureInitialized();

    try {
      const stmt = this.db!.prepare(`SELECT value FROM ${this.config.tableName} WHERE key = ?`);
      const row = stmt.get(key) as { value: string } | undefined;

      if (!row) {
        return null;
      }

      return JSON.parse(row.value) as T;
    } catch (error) {
      this.logger.error('Failed to get value', error as Error, { key });
      throw error;
    }
  }

  /**
   * Set a value by key
   */
  async set<T>(key: string, value: T): Promise<void> {
    this.ensureInitialized();

    try {
      const now = Date.now();
      const serializedValue = JSON.stringify(value);

      const stmt = this.db!.prepare(`
        INSERT INTO ${this.config.tableName} (key, value, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `);

      stmt.run(key, serializedValue, now, now);
      this.logger.debug('Value set', { key });
    } catch (error) {
      this.logger.error('Failed to set value', error as Error, { key });
      throw error;
    }
  }

  /**
   * Delete a value by key
   */
  async delete(key: string): Promise<void> {
    this.ensureInitialized();

    try {
      const stmt = this.db!.prepare(`DELETE FROM ${this.config.tableName} WHERE key = ?`);
      stmt.run(key);
      this.logger.debug('Value deleted', { key });
    } catch (error) {
      this.logger.error('Failed to delete value', error as Error, { key });
      throw error;
    }
  }

  /**
   * Get multiple values by keys
   */
  async getMany<T>(keys: string[]): Promise<Map<string, T>> {
    this.ensureInitialized();

    try {
      const result = new Map<string, T>();

      if (keys.length === 0) {
        return result;
      }

      const placeholders = keys.map(() => '?').join(', ');
      const stmt = this.db!.prepare(
        `SELECT key, value FROM ${this.config.tableName} WHERE key IN (${placeholders})`
      );
      const rows = stmt.all(...keys) as Array<{ key: string; value: string }>;

      for (const row of rows) {
        result.set(row.key, JSON.parse(row.value) as T);
      }

      this.logger.debug('Values retrieved', { count: result.size });
      return result;
    } catch (error) {
      this.logger.error('Failed to get many values', error as Error, { count: keys.length });
      throw error;
    }
  }

  /**
   * Set multiple values in a transaction
   */
  async setMany<T>(items: Map<string, T>): Promise<void> {
    this.ensureInitialized();

    try {
      const now = Date.now();

      const insertStmt = this.db!.prepare(`
        INSERT INTO ${this.config.tableName} (key, value, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `);

      const transaction = this.db!.transaction(() => {
        for (const [key, value] of items) {
          const serializedValue = JSON.stringify(value);
          insertStmt.run(key, serializedValue, now, now);
        }
      });

      transaction();
      this.logger.debug('Values set', { count: items.size });
    } catch (error) {
      this.logger.error('Failed to set many values', error as Error, { count: items.size });
      throw error;
    }
  }

  /**
   * Delete multiple values in a transaction
   */
  async deleteMany(keys: string[]): Promise<void> {
    this.ensureInitialized();

    try {
      if (keys.length === 0) {
        return;
      }

      const placeholders = keys.map(() => '?').join(', ');
      const stmt = this.db!.prepare(
        `DELETE FROM ${this.config.tableName} WHERE key IN (${placeholders})`
      );

      const transaction = this.db!.transaction(() => {
        stmt.run(...keys);
      });

      transaction();
      this.logger.debug('Values deleted', { count: keys.length });
    } catch (error) {
      this.logger.error('Failed to delete many values', error as Error, { count: keys.length });
      throw error;
    }
  }

  /**
   * Query items by condition (simplified - returns empty array)
   */
  async query(condition: QueryCondition): Promise<string[]> {
    this.ensureInitialized();

    // Simplified implementation - SQLite doesn't have advanced querying built-in
    // Return empty array; use search() for vector-based queries
    this.logger.debug('Query called with condition', { condition });
    return [];
  }

  /**
   * Search for items (simplified - returns empty array)
   */
  async search(options: SearchOptions): Promise<SearchResult[]> {
    this.ensureInitialized();

    // SQLite doesn't support vector search natively
    // Return empty array; use a vector backend like LanceDB for search
    this.logger.debug('Search called with options', { options });
    return [];
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<StorageStats> {
    this.ensureInitialized();

    try {
      const countStmt = this.db!.prepare(`SELECT COUNT(*) as count FROM ${this.config.tableName}`);
      const countRow = countStmt.get() as { count: number };

      const sizeStmt = this.db!.prepare(`SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()`);
      const sizeRow = sizeStmt.get() as { size: number };

      const updatedStmt = this.db!.prepare(`SELECT MAX(updated_at) as lastUpdated FROM ${this.config.tableName}`);
      const updatedRow = updatedStmt.get() as { lastUpdated: number | null };

      return {
        totalItems: countRow.count,
        totalSize: sizeRow.size,
        lastUpdated: updatedRow.lastUpdated || 0,
      };
    } catch (error) {
      this.logger.error('Failed to get stats', error as Error);
      throw error;
    }
  }

  /**
   * Check if an operation is supported
   */
  supports(operation: StorageOperation): boolean {
    switch (operation) {
      case 'batch_operations':
        return true;
      case 'transaction':
        return true;
      case 'vector_search':
      case 'full_text_search':
        return false;
      default:
        return false;
    }
  }
}
