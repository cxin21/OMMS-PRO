/**
 * FileSystem Storage Backend
 * @module storage/filesystem-backend
 *
 * Implements IStorageBackend using filesystem for cold storage
 */

import { promises as fs } from 'fs';
import type { Stats } from 'fs';
import { join, dirname } from 'path';
import { brotliCompressSync, brotliDecompressSync } from 'zlib';
import type {
  IStorageBackend,
  QueryCondition,
  SearchOptions,
  SearchResult,
  StorageStats,
  StorageOperation,
} from '../core/interfaces';
import { createLogger } from '../../../shared/logging';

/** Prefix prepended to compressed file content for detection on read */
const COMPRESSED_PREFIX = 'COMPRESSED:';

/**
 * Configuration for FileSystemBackend
 */
export interface FileSystemBackendConfig {
  /** Root path for file storage */
  rootPath: string;
  /** File extension for stored files */
  fileExtension: string;
  /** Enable brotli compression for stored files (COMPRESSED: prefix + base64 encoded) */
  enableCompression: boolean;
  /** Maximum file size in bytes (enforced in set() before writing) */
  maxFileSize: number;
}

/**
 * FileSystemBackend - Filesystem implementation of IStorageBackend
 *
 * Provides simple file-based storage for cold data
 */
export class FileSystemBackend implements IStorageBackend {
  private config: Required<FileSystemBackendConfig>;
  private logger = createLogger('FileSystemBackend');
  private isInitialized = false;

  /**
   * Create a new FileSystemBackend
   */
  constructor(config: FileSystemBackendConfig) {
    this.config = {
      rootPath: config.rootPath,
      fileExtension: config.fileExtension ?? '.json',
      enableCompression: config.enableCompression ?? false,
      maxFileSize: config.maxFileSize ?? 10 * 1024 * 1024, // 10MB
    };
  }

  /**
   * Initialize the filesystem backend by ensuring root path exists
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await fs.mkdir(this.config.rootPath, { recursive: true });
      this.isInitialized = true;
      this.logger.info('FileSystemBackend initialized', {
        rootPath: this.config.rootPath,
        fileExtension: this.config.fileExtension,
        enableCompression: this.config.enableCompression,
        maxFileSize: this.config.maxFileSize,
      });
    } catch (error) {
      this.logger.error('Failed to initialize FileSystemBackend', error as Error);
      throw error;
    }
  }

  /**
   * Close the filesystem backend
   */
  async close(): Promise<void> {
    this.isInitialized = false;
    this.logger.info('FileSystemBackend closed');
  }

  /**
   * Ensure the backend is initialized
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('FileSystemBackend not initialized. Call initialize() first.');
    }
  }

  /**
   * Sanitize key for use in filename
   * Replaces invalid filename characters with underscore
   */
  private sanitizeKey(key: string): string {
    // Replace characters that are invalid in filenames
    return key.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  }

  /**
   * Get the full file path for a key
   */
  private getFilePath(key: string): string {
    const sanitized = this.sanitizeKey(key);
    return join(this.config.rootPath, `${sanitized}${this.config.fileExtension}`);
  }

  /**
   * Get a value by key
   */
  async get<T>(key: string): Promise<T | null> {
    this.ensureInitialized();

    try {
      const filePath = this.getFilePath(key);
      const raw = await fs.readFile(filePath, 'utf-8');

      // Handle compressed content (backward compatible with uncompressed files)
      let content: string;
      if (raw.startsWith(COMPRESSED_PREFIX)) {
        const b64 = raw.slice(COMPRESSED_PREFIX.length);
        content = brotliDecompressSync(Buffer.from(b64, 'base64')).toString('utf-8');
      } else {
        content = raw;
      }

      return JSON.parse(content) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
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
      const filePath = this.getFilePath(key);
      const dir = dirname(filePath);

      // Ensure parent directory exists
      await fs.mkdir(dir, { recursive: true });

      const serializedValue = JSON.stringify(value, null, 2);

      // Enforce maxFileSize check
      const rawSize = Buffer.byteLength(serializedValue, 'utf-8');
      if (rawSize > this.config.maxFileSize) {
        throw new Error(`File size (${rawSize} bytes) exceeds limit of ${this.config.maxFileSize} bytes`);
      }

      let content: string;
      if (this.config.enableCompression) {
        const compressed = brotliCompressSync(Buffer.from(serializedValue, 'utf-8'));
        content = COMPRESSED_PREFIX + compressed.toString('base64');
      } else {
        content = serializedValue;
      }

      await fs.writeFile(filePath, content, 'utf-8');
      this.logger.debug('Value set', { key, compressed: this.config.enableCompression });
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
      const filePath = this.getFilePath(key);
      await fs.unlink(filePath);
      this.logger.debug('Value deleted', { key });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.error('Failed to delete value', error as Error, { key });
        throw error;
      }
    }
  }

  /**
   * Get multiple values by keys
   */
  async getMany<T>(keys: string[]): Promise<Map<string, T>> {
    this.ensureInitialized();

    const result = new Map<string, T>();

    for (const key of keys) {
      try {
        const value = await this.get<T>(key);
        if (value !== null) {
          result.set(key, value);
        }
      } catch (error) {
        this.logger.error('Failed to get value in getMany', error as Error, { key });
      }
    }

    this.logger.debug('Values retrieved', { count: result.size });
    return result;
  }

  /**
   * Set multiple values
   */
  async setMany<T>(items: Map<string, T>): Promise<void> {
    this.ensureInitialized();

    for (const [key, value] of Array.from(items.entries())) {
      try {
        await this.set(key, value);
      } catch (error) {
        this.logger.error('Failed to set value in setMany', error as Error, { key });
        throw error;
      }
    }

    this.logger.debug('Values set', { count: items.size });
  }

  /**
   * Delete multiple values
   */
  async deleteMany(keys: string[]): Promise<void> {
    this.ensureInitialized();

    for (const key of keys) {
      try {
        await this.delete(key);
      } catch (error) {
        this.logger.error('Failed to delete value in deleteMany', error as Error, { key });
        throw error;
      }
    }

    this.logger.debug('Values deleted', { count: keys.length });
  }

  /**
   * Query items by condition (simplified - returns empty array)
   */
  async query(condition: QueryCondition): Promise<string[]> {
    this.ensureInitialized();

    // Simplified implementation - filesystem doesn't support advanced querying
    // Return empty array; use a search backend for vector/full-text search
    this.logger.debug('Query called with condition', { condition });
    return [];
  }

  /**
   * Search for items (simplified - returns empty array)
   */
  async search(options: SearchOptions): Promise<SearchResult[]> {
    this.ensureInitialized();

    // Filesystem doesn't support search natively
    // Return empty array; use a search backend for vector/full-text search
    this.logger.debug('Search called with options', { options });
    return [];
  }

  /**
   * Get storage statistics by walking the directory tree
   */
  async getStats(): Promise<StorageStats> {
    this.ensureInitialized();

    let totalItems = 0;
    let totalSize = 0;
    let lastUpdated = 0;

    try {
      await this.walkDirectory(this.config.rootPath, async (filePath, stats) => {
        if (filePath.endsWith(this.config.fileExtension)) {
          totalItems++;
          totalSize += stats.size;
          if (stats.mtimeMs > lastUpdated) {
            lastUpdated = stats.mtimeMs;
          }
        }
      });

      return {
        totalItems,
        totalSize,
        lastUpdated,
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
   * Walk directory tree recursively and invoke callback for each file
   */
  private async walkDirectory(
    dirPath: string,
    callback: (filePath: string, stats: Stats) => Promise<void>
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          await this.walkDirectory(fullPath, callback);
        } else if (entry.isFile()) {
          const stats = await fs.stat(fullPath);
          await callback(fullPath, stats);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Check if an operation is supported
   */
  supports(operation: StorageOperation): boolean {
    switch (operation) {
      case 'batch_operations':
        return true;
      case 'vector_search':
      case 'full_text_search':
      case 'transaction':
        return false;
      default:
        return false;
    }
  }
}
