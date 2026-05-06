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

import { createServiceLogger } from '../../shared/logging';
import type { ILogger } from '../../shared/logging';

export type IndexUpdateMode = 'immediate' | 'batch' | 'scheduled';
export type IndexPriority = 'high' | 'normal' | 'low';

export type IndexUpdateTaskType = 'vector_update' | 'meta_update' | 'index_rebuild';

export interface IndexUpdateTask {
  id: string;
  memoryId: string;
  type: IndexUpdateTaskType;
  operation: 'add' | 'update' | 'delete';
  priority: IndexPriority;
  createdAt: number;
  scheduledAt?: number;
  retryCount: number;
  maxRetries: number;
  error?: string;
  // For batch aggregation
  vectors?: Array<{ id: string; memoryId: string; vector: number[]; metadata?: Record<string, unknown> }>;
  metas?: Array<{ id: string; memoryId: string; metadata: Record<string, unknown> }>;
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
  /** 初始重试延迟 (ms) */
  baseRetryDelayMs: number;
  /** 最大重试延迟 (ms) */
  maxRetryDelayMs: number;
}

/**
 * Minimal interface for vector store operations used by IndexUpdateStrategy.
 * Implementations should adapt these calls to the actual store (e.g. VectorStore.storeBatch).
 */
export interface VectorStoreInterface {
  /** Store/replace multiple vector documents */
  storeBatch(docs: Array<{ id: string; memoryId: string; vector: Float32Array | number[]; text: string; metadata?: Record<string, unknown> }>): Promise<void>;
  /** Delete vector documents by ID */
  delete(ids: string[]): Promise<void>;
  /** Rebuild the full vector index */
  rebuildIndex(): Promise<void>;
}

/**
 * Minimal interface for metadata store operations used by IndexUpdateStrategy.
 * Implementations should adapt these calls to the actual store (e.g. SQLiteMetaStore.insert).
 */
export interface MetaStoreInterface {
  /** Insert or update multiple metadata records */
  insertBatch(records: Array<{ uid: string; agentId: string; scope: string; type: string; importance: number; scopeScore: number; block: string; tags: string; palace: string; versionChain: string; version: number; isLatestVersion: number; accessCount: number; recallCount: number; createdAt: number; updatedAt: number }>): Promise<void>;
  /** Delete metadata records by UID */
  delete(uids: string[]): Promise<void>;
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

  // Batch aggregation: group same-type tasks
  private aggregationBuffer: Map<IndexUpdateTaskType, IndexUpdateTask[]> = new Map();
  private aggregationTimer: NodeJS.Timeout | null = null;

  // Statistics
  private stats = {
    totalProcessed: 0,
    totalFailed: 0,
    totalRetried: 0,
    lastProcessedAt: 0,
    lastFailedAt: 0
  };

  constructor(
    private config: IndexUpdateStrategyConfig,
    private vectorStore?: VectorStoreInterface,
    private metaStore?: MetaStoreInterface
  ) {
    this.logger = createServiceLogger('IndexUpdateStrategy');

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
   * 调度更新任务 - 支持批量聚合
   *
   * 根据模式处理任务：
   *   - immediate: 立即执行
   *   - batch: 聚合到 batchSize 或超时后执行
   *   - scheduled: 加入调度队列
   */
  async scheduleUpdate(task: IndexUpdateTask): Promise<void> {
    // Add to aggregation buffer based on task type
    if (!this.aggregationBuffer.has(task.type)) {
      this.aggregationBuffer.set(task.type, []);
    }
    this.aggregationBuffer.get(task.type)!.push(task);

    const tasksForType = this.aggregationBuffer.get(task.type)!;

    this.logger.debug('Schedule update for aggregation', {
      taskId: task.id,
      type: task.type,
      currentBatchSize: tasksForType.length,
      batchSizeThreshold: this.config.batchSize
    });

    // Check if batch threshold reached
    if (tasksForType.length >= this.config.batchSize) {
      await this.flushAggregationBuffer(task.type);
    } else {
      // Start aggregation timer
      this.startAggregationTimer();
    }
  }

  private async flushAggregationBuffer(type?: IndexUpdateTaskType): Promise<void> {
    this.stopAggregationTimer();

    if (type) {
      // Flush specific type
      const tasks = this.aggregationBuffer.get(type) || [];
      this.aggregationBuffer.set(type, []);
      await this.executeAggregatedBatch(tasks);
    } else {
      // Flush all types
      for (const [taskType, tasks] of this.aggregationBuffer) {
        if (tasks.length > 0) {
          this.aggregationBuffer.set(taskType, []);
          await this.executeAggregatedBatch(tasks);
        }
      }
    }
  }

  private async executeAggregatedBatch(tasks: IndexUpdateTask[]): Promise<void> {
    if (tasks.length === 0) return;

    this.logger.debug('Executing aggregated batch', {
      count: tasks.length,
      types: [...new Set(tasks.map(t => t.type))]
    });

    // Group tasks by type for efficient batch execution
    const tasksByType = new Map<IndexUpdateTaskType, IndexUpdateTask[]>();
    for (const task of tasks) {
      if (!tasksByType.has(task.type)) {
        tasksByType.set(task.type, []);
      }
      tasksByType.get(task.type)!.push(task);
    }

    // Execute each type group
    for (const [taskType, typeTasks] of tasksByType) {
      try {
        switch (taskType) {
          case 'vector_update': {
            const allVectors = typeTasks.flatMap(t => t.vectors || []);
            if (allVectors.length > 0 && this.vectorStore) {
              const docs = allVectors.map(v => ({ ...v, text: '', vector: v.vector }));
              await this.vectorStore.storeBatch(docs);
            }
            break;
          }
          case 'meta_update': {
            const allMetas = typeTasks.flatMap(t => t.metas || []);
            if (allMetas.length > 0 && this.metaStore) {
              const records = allMetas.map(m => ({
                uid: m.id, agentId: '', scope: 'session', type: 'fact',
                importance: 5, scopeScore: 5, block: 'working', tags: '[]',
                palace: '{}', versionChain: '[]', version: 1, isLatestVersion: 1,
                accessCount: 0, recallCount: 0, createdAt: Date.now(), updatedAt: Date.now(),
                ...m.metadata,
              }));
              await this.metaStore.insertBatch(records);
            }
            break;
          }
          case 'index_rebuild': {
            if (this.vectorStore) {
              await this.vectorStore.rebuildIndex();
            }
            break;
          }
        }

        // Mark tasks as processed
        for (const task of typeTasks) {
          this.pendingTasks.delete(task.id);
          this.stats.totalProcessed++;
          this.stats.lastProcessedAt = Date.now();
        }
      } catch (error) {
        this.logger.error('Aggregated batch execution failed', {
          type: taskType,
          error: String(error)
        });

        // Handle per-task retry for batch failures
        for (const task of typeTasks) {
          task.retryCount++;
          task.error = String(error);

          if (task.retryCount >= task.maxRetries) {
            this.stats.totalFailed++;
            this.stats.lastFailedAt = Date.now();
          } else {
            this.stats.totalRetried++;
            // Re-queue for retry
            this.pendingTasks.set(task.id, task);
          }
        }
      }
    }
  }

  private startAggregationTimer(): void {
    if (this.aggregationTimer) return;

    this.aggregationTimer = setTimeout(() => {
      this.flushAggregationBuffer().catch(err => {
        this.logger.error('Aggregation buffer flush failed', { error: String(err) });
      });
    }, this.config.batchDelayMs);
  }

  private stopAggregationTimer(): void {
    if (this.aggregationTimer) {
      clearTimeout(this.aggregationTimer);
      this.aggregationTimer = null;
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
    this.stopAggregationTimer();

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
   * Execute a single index update task with retry logic.
   *
   * Handles three types of tasks:
   *   - vector_update: Calls vectorStore.upsertBatch() to update vectors
   *   - meta_update: Calls metaStore.updateBatch() to update metadata
   *   - index_rebuild: Calls vectorStore.rebuildIndex() to rebuild the entire index
   *
   * Implements exponential backoff retry (up to maxRetries times).
   */
  /**
   * Execute a single index update task (one attempt).
   * Retry logic is handled by processTask() which re-queues failed tasks.
   */
  private async executeTask(task: IndexUpdateTask): Promise<void> {
    this.logger.debug('Executing index task', {
      taskId: task.id,
      type: task.type,
      operation: task.operation,
      memoryId: task.memoryId
    });

    switch (task.type) {
      case 'vector_update':
        if (this.vectorStore && task.vectors && task.vectors.length > 0) {
          const docs = task.vectors.map(v => ({ ...v, text: '', vector: v.vector }));
          await this.vectorStore.storeBatch(docs);
          this.logger.debug('Vector batch store completed', {
            count: task.vectors.length,
            taskId: task.id
          });
        }
        break;

      case 'meta_update':
        if (this.metaStore && task.metas && task.metas.length > 0) {
          const records = task.metas.map(m => ({
            uid: m.id, agentId: '', scope: 'session', type: 'fact',
            importance: 5, scopeScore: 5, block: 'working', tags: '[]',
            palace: '{}', versionChain: '[]', version: 1, isLatestVersion: 1,
            accessCount: 0, recallCount: 0, createdAt: Date.now(), updatedAt: Date.now(),
            ...m.metadata,
          }));
          await this.metaStore.insertBatch(records);
          this.logger.debug('Meta batch insert completed', {
            count: task.metas.length,
            taskId: task.id
          });
        }
        break;

      case 'index_rebuild':
        if (this.vectorStore) {
          await this.vectorStore.rebuildIndex();
          this.logger.debug('Index rebuild completed', { taskId: task.id });
        }
        break;
    }
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