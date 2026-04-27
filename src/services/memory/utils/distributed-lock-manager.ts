/**
 * Distributed Lock Manager - 分布式锁管理器
 * @module memory-service/distributed-lock-manager
 *
 * 使用 SQLite 实现分布式锁，支持多进程/多实例环境下的锁竞争
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { createServiceLogger } from '../../../shared/logging';
import type { ILogger } from '../../../shared/logging';

/**
 * 分布式锁接口
 */
export interface IDistributedLock {
  /**
   * 释放锁
   */
  release(): void;
}

/**
 * 分布式锁管理器
 * 使用 SQLite 实现，支持跨进程的锁竞争
 */
export class DistributedLockManager {
  private db: Database.Database;
  private logger: ILogger;

  // 锁表名
  private static TABLE_NAME = 'distributed_locks';

  // 默认锁过期时间（毫秒）
  private static DEFAULT_TTL_MS = 30000;

  // 默认最大锁数量
  private static DEFAULT_MAX_LOCKS = 1000;

  constructor(
    private dbPath: string,
    private ttlMs: number = DistributedLockManager.DEFAULT_TTL_MS,
    private maxLocks: number = DistributedLockManager.DEFAULT_MAX_LOCKS
  ) {
    this.logger = createServiceLogger('DistributedLockManager');
    this.db = new Database(dbPath);
    this.initialize();
  }

  /**
   * 初始化锁表
   */
  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${DistributedLockManager.TABLE_NAME} (
        lock_key TEXT PRIMARY KEY,
        lock_value TEXT NOT NULL,
        acquired_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);

    // 创建索引用于过期清理
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_locks_expires_at
      ON ${DistributedLockManager.TABLE_NAME}(expires_at)
    `);

    this.logger.debug('DistributedLockManager initialized', {
      dbPath: this.dbPath,
      ttlMs: this.ttlMs,
      maxLocks: this.maxLocks,
    });
  }

  /**
   * 尝试获取锁
   * @param lockKey 锁键
   * @param lockValue 锁值（用于标识锁持有者）
   * @param ttlMs 锁过期时间（毫秒），默认使用构造函数的 ttlMs
   * @returns true 表示获取成功，false 表示锁已被持有
   */
  async acquireLock(lockKey: string, lockValue: string, ttlMs?: number): Promise<boolean> {
    const effectiveTtl = ttlMs ?? this.ttlMs;
    const now = Date.now();
    const expiresAt = now + effectiveTtl;

    try {
      // 首先清理过期锁
      this.cleanupExpiredLocks();

      // 尝试插入锁
      const insertStmt = this.db.prepare(`
        INSERT OR REPLACE INTO ${DistributedLockManager.TABLE_NAME}
        (lock_key, lock_value, acquired_at, expires_at)
        VALUES (?, ?, ?, ?)
      `);

      // 使用事务确保原子性
      const result = this.db.transaction(() => {
        // 先检查是否存在未过期的锁
        const existingStmt = this.db.prepare(`
          SELECT lock_value, expires_at FROM ${DistributedLockManager.TABLE_NAME}
          WHERE lock_key = ? AND expires_at > ?
        `);

        const existing = existingStmt.get(lockKey, now) as {
          lock_value: string;
          expires_at: number;
        } | undefined;

        if (existing) {
          // 锁已存在且未过期
          return false;
        }

        // 插入新锁
        insertStmt.run(lockKey, lockValue, now, expiresAt);
        return true;
      })();

      if (result) {
        this.logger.debug('Distributed lock acquired', { lockKey, lockValue, ttlMs: effectiveTtl });
      } else {
        this.logger.debug('Distributed lock failed - already held', { lockKey });
      }

      return result;
    } catch (error) {
      this.logger.error('Error acquiring distributed lock', { lockKey, error: String(error) });
      return false;
    }
  }

  /**
   * 释放锁
   * 只有锁的持有者才能释放锁
   * @param lockKey 锁键
   * @param lockValue 锁值（用于验证持有者）
   */
  async releaseLock(lockKey: string, lockValue: string): Promise<void> {
    try {
      const stmt = this.db.prepare(`
        DELETE FROM ${DistributedLockManager.TABLE_NAME}
        WHERE lock_key = ? AND lock_value = ?
      `);

      const result = stmt.run(lockKey, lockValue);

      if (result.changes > 0) {
        this.logger.debug('Distributed lock released', { lockKey, lockValue });
      } else {
        this.logger.debug('Distributed lock release - not owner or not exists', { lockKey, lockValue });
      }
    } catch (error) {
      this.logger.error('Error releasing distributed lock', { lockKey, error: String(error) });
    }
  }

  /**
   * 等待获取锁
   * @param lockKey 锁键
   * @param lockValue 锁值
   * @param timeoutMs 超时时间（毫秒）
   * @param pollIntervalMs 轮询间隔（毫秒），默认 50ms
   * @returns 释放锁的函数，获取失败返回 null
   */
  async waitForLock(
    lockKey: string,
    lockValue: string,
    timeoutMs: number,
    pollIntervalMs: number = 50
  ): Promise<(() => void) | null> {
    const startTime = Date.now();

    // 先尝试获取锁
    if (await this.acquireLock(lockKey, lockValue)) {
      return () => this.releaseLock(lockKey, lockValue);
    }

    // 等待锁释放
    while (Date.now() - startTime < timeoutMs) {
      // 清理过期锁
      this.cleanupExpiredLocks();

      // 再次尝试获取
      if (await this.acquireLock(lockKey, lockValue)) {
        return () => this.releaseLock(lockKey, lockValue);
      }

      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    this.logger.warn('Failed to wait for distributed lock', { lockKey, timeoutMs });
    return null;
  }

  /**
   * 检查锁是否存在（且未过期）
   */
  async isLocked(lockKey: string): Promise<boolean> {
    const now = Date.now();

    try {
      const stmt = this.db.prepare(`
        SELECT 1 FROM ${DistributedLockManager.TABLE_NAME}
        WHERE lock_key = ? AND expires_at > ?
      `);

      const result = stmt.get(lockKey, now);
      return !!result;
    } catch (error) {
      this.logger.error('Error checking lock status', { lockKey, error: String(error) });
      return false;
    }
  }

  /**
   * 清理过期锁
   */
  private cleanupExpiredLocks(): void {
    try {
      const now = Date.now();
      const stmt = this.db.prepare(`
        DELETE FROM ${DistributedLockManager.TABLE_NAME}
        WHERE expires_at <= ?
      `);

      const result = stmt.run(now);

      if (result.changes > 0) {
        this.logger.debug('Cleaned up expired locks', { count: result.changes });
      }
    } catch (error) {
      this.logger.error('Error cleaning up expired locks', { error: String(error) });
    }
  }

  /**
   * 获取当前锁数量
   */
  getLockCount(): number {
    this.cleanupExpiredLocks();

    try {
      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM ${DistributedLockManager.TABLE_NAME}
      `);
      const result = stmt.get() as { count: number };
      return result.count;
    } catch (error) {
      this.logger.error('Error getting lock count', { error: String(error) });
      return 0;
    }
  }

  /**
   * 关闭锁管理器
   */
  close(): void {
    try {
      this.db.close();
      this.logger.debug('DistributedLockManager closed');
    } catch (error) {
      this.logger.error('Error closing DistributedLockManager', { error: String(error) });
    }
  }
}