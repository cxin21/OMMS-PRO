/**
 * IndexUpdateStrategy - 增量索引更新策略
 *
 * 管理索引的增量更新
 * - 避免全量重建索引的高成本
 * - 支持批量更新的缓冲区
 * - 支持优先级队列
 *
 * @module storage/index-update-strategy
 */

import { createLogger } from '../../shared/logging';
import type { ILogger } from '../../shared/logging';

export type IndexUpdateMode = 'immediate' | 'batch' | 'scheduled';
export type IndexPriority = 'high' | 'normal' | 'low';

export interface IndexUpdateTask {
  id: string;
  memoryId: string;
  operation: 'add' | 'update' | 'delete';
  priority: IndexPriority;
  createdAt: number;
  scheduledAt?: number;
  retryCount: number;
  maxRetries: number;
  error?: string;
}

export interface IndexUpdateStrategyConfig {
  /** 更新模式 */
  mode: IndexUpdateMode;
  /** 批量大小 */
  batchSize: number;
  /** 批量延迟 (ms) */
  batchDelayMs: number;
  /** 最大待处理任务数 */
  maxPendingTasks: number;
  /** 高优先级阈值 */
  highPriorityThreshold: number;
  /** 调度间隔 (ms) */
  scheduledIntervalMs: number;
  /** 最大重试次数 */
  maxRetries: number;
}

interface PendingBatch {
  tasks: IndexUpdateTask[];
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * IndexUpdateStrategy
 *
 * 管理索引的增量更新，支持多种更新模式
 */
export class IndexUpdateStrategy {
  private logger: ILogger;
  private pendingTasks: Map<string, IndexUpdateTask> = new Map();
  private priorityQueue: IndexUpdateTask[] = [];
  private batchBuffer: IndexUpdateTask[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private scheduledTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private pendingBatch: PendingBatch | null = null;

  // Statistics
  private stats = {
    totalProcessed: 0,
    totalFailed: 0,
    totalRetried: 0,
    lastProcessedAt: 0,
    lastFailedAt: 0
  };

  constructor(private config: IndexUpdateStrategyConfig) {
    this.logger = createLogger('IndexUpdateStrategy');

    if (config.mode === 'scheduled') {
      this.startScheduledProcessor();
    }
  }

  /**
   * 提交索引更新任务
   */
  async submitTask(task: Omit<IndexUpdateTask, 'createdAt' | 'retryCount' | 'maxRetries'>): Promise<void> {
    const fullTask: IndexUpdateTask = {
      ...task,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: this.config.maxRetries
    };

    // Check capacity
    if (this.pendingTasks.size >= this.config.maxPendingTasks) {
      // Try to flush high priority tasks
      const highPriorityTasks = this.priorityQueue.filter(t => t.priority === 'high');
      if (highPriorityTasks.length > 0) {
        await this.flushHighPriorityTasks();
      } else {
        throw new Error(`Index update queue is full (${this.config.maxPendingTasks} tasks)`);
      }
    }

    this.pendingTasks.set(task.id, fullTask);
    this.insertIntoPriorityQueue(fullTask);

    this.logger.debug('Index task submitted', {
      taskId: task.id,
      operation: task.operation,
      priority: task.priority
    });

    // Process based on mode
    switch (this.config.mode) {
      case 'immediate':
        await this.processTask(task.id);
        break;
      case 'batch':
        this.addToBatchBuffer(fullTask);
        break;
      case 'scheduled':
        // Task waits for scheduled processing
        break;
    }
  }

  /**
   * 批量提交任务
   */
  async submitBatch(tasks: Array<Omit<IndexUpdateTask, 'createdAt' | 'retryCount' | 'maxRetries'>>): Promise<void> {
    for (const task of tasks) {
      await this.submitTask(task);
    }
  }

  /**
   * 取消任务
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const task = this.pendingTasks.get(taskId);
    if (!task) return false;

    this.pendingTasks.delete(taskId);
    this.removeFromPriorityQueue(task);
    this.removeFromBatchBuffer(task);

    this.logger.debug('Index task cancelled', { taskId });
    return true;
  }

  /**
   * 获取任务状态
   */
  async getTaskStatus(taskId: string): Promise<IndexUpdateTask | null> {
    return this.pendingTasks.get(taskId) || null;
  }

  /**
   * 获取待处理任务数
   */
  async getPendingCount(): Promise<number> {
    return this.pendingTasks.size;
  }

  /**
   * 强制刷新所有待处理任务
   */
  async flush(): Promise<void> {
    if (this.config.mode === 'batch') {
      await this.flushBatchBuffer();
    }
    await this.processAllPendingTasks();
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalProcessed: number;
    totalFailed: number;
    totalRetried: number;
    lastProcessedAt: number;
    lastFailedAt: number;
    pendingCount: number;
  } {
    return {
      ...this.stats,
      pendingCount: this.pendingTasks.size
    };
  }

  /**
   * 关闭策略处理器
   */
  async close(): Promise<void> {
    this.stopBatchTimer();
    this.stopScheduledProcessor();

    // Flush remaining tasks
    await this.flush();

    this.logger.info('IndexUpdateStrategy closed', { stats: this.stats });
  }

  // Private methods

  private insertIntoPriorityQueue(task: IndexUpdateTask): void {
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    let insertIndex = this.priorityQueue.findIndex(
      t => priorityOrder[t.priority] > priorityOrder[task.priority]
    );
    if (insertIndex === -1) {
      insertIndex = this.priorityQueue.length;
    }
    this.priorityQueue.splice(insertIndex, 0, task);
  }

  private removeFromPriorityQueue(task: IndexUpdateTask): void {
    const index = this.priorityQueue.findIndex(t => t.id === task.id);
    if (index !== -1) {
      this.priorityQueue.splice(index, 1);
    }
  }

  private addToBatchBuffer(task: IndexUpdateTask): void {
    this.batchBuffer.push(task);

    // Check if batch is full
    if (this.batchBuffer.length >= this.config.batchSize) {
      this.flushBatchBuffer().catch(err => {
        this.logger.error('Batch flush failed', { error: String(err) });
      });
    } else {
      // Start batch timer
      this.startBatchTimer();
    }
  }

  private removeFromBatchBuffer(task: IndexUpdateTask): void {
    const index = this.batchBuffer.findIndex(t => t.id === task.id);
    if (index !== -1) {
      this.batchBuffer.splice(index, 1);
    }
  }

  private startBatchTimer(): void {
    if (this.batchTimer) return;

    this.batchTimer = setTimeout(() => {
      this.flushBatchBuffer().catch(err => {
        this.logger.error('Batch flush failed', { error: String(err) });
      });
    }, this.config.batchDelayMs);
  }

  private stopBatchTimer(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  private async flushBatchBuffer(): Promise<void> {
    this.stopBatchTimer();

    if (this.batchBuffer.length === 0) return;

    const tasksToProcess = this.batchBuffer.splice(0, this.batchBuffer.length);

    return new Promise<void>((resolve, reject) => {
      this.pendingBatch = {
        tasks: tasksToProcess,
        resolve: () => { resolve(); },
        reject
      };

      // Start processing and handle errors
      this.processBatch().then(() => {
        if (this.pendingBatch) {
          this.pendingBatch.resolve();
        }
      }).catch(reject);
    });
  }

  private async processBatch(): Promise<void> {
    if (!this.pendingBatch || this.pendingBatch.tasks.length === 0) {
      return;
    }

    const batch = this.pendingBatch;
    this.pendingBatch = null;

    for (const task of batch.tasks) {
      try {
        await this.executeTask(task);
      } catch (error) {
        this.logger.error('Batch task failed', { taskId: task.id, error: String(error) });
      }
    }

    batch.resolve();
  }

  private startScheduledProcessor(): void {
    if (this.scheduledTimer) return;

    this.scheduledTimer = setInterval(() => {
      this.processScheduledTasks().catch(err => {
        this.logger.error('Scheduled processing failed', { error: String(err) });
      });
    }, this.config.scheduledIntervalMs);
  }

  private stopScheduledProcessor(): void {
    if (this.scheduledTimer) {
      clearInterval(this.scheduledTimer);
      this.scheduledTimer = null;
    }
  }

  private async processScheduledTasks(): Promise<void> {
    if (this.isProcessing) return;

    const now = Date.now();
    const readyTasks = this.priorityQueue.filter(
      t => !t.scheduledAt || t.scheduledAt <= now
    );

    if (readyTasks.length === 0) return;

    this.isProcessing = true;

    try {
      for (const task of readyTasks) {
        await this.processTask(task.id);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async processTask(taskId: string): Promise<void> {
    const task = this.pendingTasks.get(taskId);
    if (!task) return;

    try {
      await this.executeTask(task);
      this.pendingTasks.delete(taskId);
      this.removeFromPriorityQueue(task);
      this.stats.totalProcessed++;
      this.stats.lastProcessedAt = Date.now();
    } catch (error) {
      task.retryCount++;
      task.error = String(error);

      if (task.retryCount >= task.maxRetries) {
        this.logger.error('Index task failed after max retries', {
          taskId: task.id,
          error: task.error
        });
        this.pendingTasks.delete(taskId);
        this.removeFromPriorityQueue(task);
        this.stats.totalFailed++;
        this.stats.lastFailedAt = Date.now();
      } else {
        this.logger.warn('Index task failed, will retry', {
          taskId: task.id,
          retryCount: task.retryCount,
          error: task.error
        });
        this.stats.totalRetried++;
      }
    }
  }

  /**
   * Execute a single index update task.
   *
   * TODO: This is currently a placeholder. The actual implementation should
   * delegate to the appropriate index/store service based on the task operation:
   *   - 'add':    Call vectorStore.store() and/or metaStore.create() to add the memory to the index.
   *   - 'update': Call vectorStore.updateMetadata() and/or metaStore.update() to refresh the index entry.
   *   - 'delete': Call vectorStore.delete() and/or metaStore.delete() to remove the memory from the index.
   *
   * The IndexUpdateStrategy should be injected with (or receive via constructor) a reference to the
   * storage layer (e.g., VectorStore, MetaStore) to perform these operations.
   * For now, it logs the task and simulates execution.
   */
  private async executeTask(task: IndexUpdateTask): Promise<void> {
    this.logger.debug('Executing index task', {
      taskId: task.id,
      operation: task.operation,
      memoryId: task.memoryId
    });

    // Placeholder: simulate index update delay
    await new Promise(resolve => setTimeout(resolve, 1));

    this.logger.debug('Index task executed (placeholder)', {
      taskId: task.id,
      operation: task.operation,
      memoryId: task.memoryId
    });
  }

  private async processAllPendingTasks(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const taskIds = Array.from(this.pendingTasks.keys());
      for (const taskId of taskIds) {
        await this.processTask(taskId);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async flushHighPriorityTasks(): Promise<void> {
    const highPriorityTasks = this.priorityQueue.filter(t => t.priority === 'high');
    for (const task of highPriorityTasks) {
      await this.processTask(task.id);
    }
  }
}