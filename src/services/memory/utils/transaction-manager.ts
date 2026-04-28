/**
 * Transaction Manager - 存储层事务管理
 * @module memory-service/transaction-manager
 *
 * 版本: v1.0.0
 * - 提供存储层操作的原子性保证
 * - 支持操作回滚
 */

import { createServiceLogger } from '../../../shared/logging';
import type { ILogger } from '../../../shared/logging';

export interface StorageOperation {
  layer: 'cache' | 'vector' | 'meta' | 'palace' | 'graph';
  operation: 'insert' | 'update' | 'delete';
  targetId: string;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
}

/**
 * 可准备操作的存储操作接口
 * prepare 用于预留资源或做预检，commit 用于确认执行，rollback 用于回滚
 * 适用于需要两阶段提交的操作（如文件系统的原子移动）
 */
export interface PreparableStorageOperation extends StorageOperation {
  /**
   * 准备阶段：预留资源或预检
   * 如果返回 false，表示无法准备，回滚
   */
  prepare?: () => Promise<boolean>;
}

export interface Transaction {
  id: string;
  operations: StorageOperation[];
  status: 'pending' | 'preparing' | 'prepared' | 'committing' | 'committed' | 'rolled_back';
  createdAt: number;
  preparedAt?: number;
}

/**
 * TransactionManager
 * 统一管理所有存储层操作的事务
 * 支持提交和回滚，保证数据一致性
 */
export class TransactionManager {
  private logger: ILogger;
  private transactions: Map<string, Transaction>;

  constructor() {
    this.logger = createServiceLogger('TransactionManager');
    this.transactions = new Map();
  }

  /**
   * 开启新事务
   */
  beginTransaction(): Transaction {
    const id = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const tx: Transaction = {
      id,
      operations: [],
      status: 'pending',
      createdAt: Date.now(),
    };
    this.transactions.set(id, tx);
    this.logger.debug('Transaction started', { transactionId: id });
    return tx;
  }

  /**
   * 注册操作到事务（不执行）
   * 支持普通操作和可准备操作（两阶段提交）
   */
  registerOperation(transactionId: string, op: StorageOperation | PreparableStorageOperation): void {
    const tx = this.transactions.get(transactionId);
    if (!tx) {
      this.logger.error('Transaction not found in registerOperation', { transactionId, availableKeys: Array.from(this.transactions.keys()) });
      throw new Error(`Transaction not found: ${transactionId}`);
    }
    if (tx.status !== 'pending') {
      throw new Error(`Transaction is not pending: ${transactionId}`);
    }
    tx.operations.push(op);
    this.logger.debug('Operation registered', { transactionId, layer: op.layer, operation: op.operation, targetId: op.targetId.substring(0, 20) });
  }

  /**
   * 批量注册操作到事务（同一层的多个操作合并执行）
   * 适用于批量删除、批量更新等场景，减少数据库往返次数
   *
   * @param transactionId 事务 ID
   * @param batchOp 批量操作，包含同一层的多个操作
   */
  registerBatchOperation(transactionId: string, batchOp: {
    layer: 'cache' | 'vector' | 'meta' | 'palace' | 'graph';
    operation: 'insert' | 'update' | 'delete';
    targetIds: string[];
    commitBatch: (targetIds: string[]) => Promise<void>;
    rollbackBatch: (targetIds: string[]) => Promise<void>;
  }): void {
    const tx = this.transactions.get(transactionId);
    if (!tx) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }
    if (tx.status !== 'pending') {
      throw new Error(`Transaction is not pending: ${transactionId}`);
    }

    // 创建单一操作来代表整个批量操作
    const op: StorageOperation = {
      layer: batchOp.layer,
      operation: batchOp.operation,
      targetId: batchOp.targetIds.join(','),
      commit: async () => {
        await batchOp.commitBatch(batchOp.targetIds);
      },
      rollback: async () => {
        await batchOp.rollbackBatch(batchOp.targetIds);
      },
    };
    tx.operations.push(op);

    this.logger.debug('Batch operation registered', { transactionId, layer: batchOp.layer, count: batchOp.targetIds.length });
  }

  /**
   * 两阶段提交 - 准备阶段
   * 对所有支持 prepare 的操作执行准备
   * 成功返回 true，失败自动回滚并返回 false
   */
  async prepare(transactionId: string): Promise<boolean> {
    const tx = this.transactions.get(transactionId);
    if (!tx) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }
    if (tx.status !== 'pending') {
      throw new Error(`Transaction is not pending: ${transactionId}`);
    }

    this.logger.debug('Preparing transaction', { transactionId, operationCount: tx.operations.length });

    tx.status = 'preparing';

    // Execute prepare for operations that have it
    for (const op of tx.operations) {
      if (typeof (op as PreparableStorageOperation).prepare === 'function') {
        try {
          const canProceed = await (op as PreparableStorageOperation).prepare!();
          if (!canProceed) {
            this.logger.warn('Prepare returned false, rolling back', {
              transactionId,
              layer: op.layer,
              targetId: op.targetId,
            });
            await this.rollback(transactionId);
            return false;
          }
        } catch (error) {
          this.logger.error('Prepare failed, rolling back', {
            transactionId,
            layer: op.layer,
            targetId: op.targetId,
            error: String(error),
          });
          await this.rollback(transactionId);
          return false;
        }
      }
    }

    tx.status = 'prepared';
    tx.preparedAt = Date.now();
    this.logger.debug('Transaction prepared', { transactionId });
    return true;
  }

  /**
   * 提交事务（执行所有操作）
   * 支持两种模式：
   * 1. 单阶段提交：从 pending 直接提交（适用于无 prepare 的操作）
   * 2. 两阶段提交：先 prepare 再 commit（适用于需要预留资源的操作）
   */
  async commit(transactionId: string): Promise<void> {
    const tx = this.transactions.get(transactionId);
    if (!tx) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    // Two-phase: if pending, prepare first then commit
    if (tx.status === 'pending') {
      const prepared = await this.prepare(transactionId);
      if (!prepared) {
        throw new Error('Transaction prepare failed');
      }
    }

    if (tx.status !== 'prepared') {
      throw new Error(`Transaction is not prepared: ${transactionId}`);
    }

    tx.status = 'committing';

    // Execute all commit operations
    for (const op of tx.operations) {
      try {
        await op.commit();
      } catch (error) {
        this.logger.error('Commit failed, rolling back', {
          transactionId,
          layer: op.layer,
          targetId: op.targetId,
          error: String(error),
        });
        const rollbackResult = await this.rollback(transactionId);
        if (!rollbackResult.success) {
          this.logger.error('Rollback after commit failure had partial failures', {
            transactionId,
            failedOperations: rollbackResult.failedOperations,
          });
        }
        throw error;
      }
    }

    tx.status = 'committed';
    this.transactions.delete(transactionId);
  }

  /**
   * 回滚事务（逆序执行所有回滚）
   */
  async rollback(transactionId: string): Promise<{ success: boolean; failedOperations: Array<{ layer: string; targetId: string; error: string }> }> {
    const tx = this.transactions.get(transactionId);
    if (!tx) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }
    // Allow rollback from pending, prepared, or committing states (but not already rolled_back or committed)
    if (tx.status === 'rolled_back' || tx.status === 'committed') {
      this.logger.warn('Transaction already processed, skipping rollback', {
        transactionId,
        status: tx.status,
      });
      return { success: true, failedOperations: [] };
    }

    this.logger.debug('Rolling back transaction', { transactionId, operationCount: tx.operations.length });

    // 收集回滚失败的操作
    const failedOperations: Array<{ layer: string; targetId: string; error: string }> = [];

    // 逆序执行回滚
    const reversedOps = [...tx.operations].reverse();
    for (const op of reversedOps) {
      try {
        await op.rollback();
        this.logger.debug('Operation rolled back', { layer: op.layer, targetId: op.targetId.substring(0, 20) });
      } catch (error) {
        const errorMsg = String(error);
        this.logger.error('Rollback failed for operation', {
          layer: op.layer,
          targetId: op.targetId,
          error: errorMsg,
        });
        failedOperations.push({
          layer: op.layer,
          targetId: op.targetId,
          error: errorMsg,
        });
        // 继续回滚其他操作
      }
    }

    tx.status = 'rolled_back';

    if (failedOperations.length > 0) {
      this.logger.error('Transaction rolled back with failures, manual intervention may be required', {
        transactionId,
        failedOperations,
      });
      // 即使有失败操作，也清理事务防止内存泄漏
      this.transactions.delete(transactionId);
      return { success: false, failedOperations };
    }

    this.logger.info('Transaction rolled back successfully', { transactionId });
    // 清理已完成的事务，防止内存泄漏
    this.transactions.delete(transactionId);
    return { success: true, failedOperations: [] };
  }

  /**
   * 获取事务
   */
  getTransaction(transactionId: string): Transaction | undefined {
    return this.transactions.get(transactionId);
  }

  /**
   * 清理已完成的事务
   */
  clearCompletedTransactions(): void {
    for (const [id, tx] of this.transactions.entries()) {
      if (tx.status !== 'pending') {
        this.transactions.delete(id);
      }
    }
  }
}

// ============================================================
// 跨服务事务协调器
// ============================================================

/**
 * TransactionCoordinator - 跨服务事务协调器
 *
 * 单例模式，用于协调多个服务之间的事务
 * 当一个操作需要多个服务协同时使用
 *
 * 使用方式：
 * 1. 在主服务中创建协调器
 * 2. 将协调器传递给其他服务
 * 3. 其他服务使用协调器注册操作
 * 4. 主服务提交或回滚整个事务
 */
export class TransactionCoordinator {
  private static instance: TransactionCoordinator | null = null;
  private txManager: TransactionManager;

  private constructor() {
    this.txManager = new TransactionManager();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): TransactionCoordinator {
    if (!TransactionCoordinator.instance) {
      TransactionCoordinator.instance = new TransactionCoordinator();
    }
    return TransactionCoordinator.instance;
  }

  /**
   * 获取事务管理器（供服务使用）
   */
  getTransactionManager(): TransactionManager {
    return this.txManager;
  }

  /**
   * 开始跨服务事务
   */
  beginTransaction(): Transaction {
    return this.txManager.beginTransaction();
  }

  /**
   * 提交跨服务事务
   */
  async commit(transactionId: string): Promise<void> {
    return this.txManager.commit(transactionId);
  }

  /**
   * 回滚跨服务事务
   */
  async rollback(transactionId: string) {
    return this.txManager.rollback(transactionId);
  }

  /**
   * 重置单例（用于测试）
   */
  static resetInstance(): void {
    TransactionCoordinator.instance = null;
  }
}
