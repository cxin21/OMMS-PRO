/**
 * Graph Retry Queue - Graph 写入重试队列
 * @module memory-service/graph-retry-queue
 *
 * 版本: v1.2.0
 * - 处理 Graph 写入失败的重试
 * - 指数退避策略
 * - 持久化队列（内存队列也写入磁盘，重启可恢复）
 * - 持久化 Dead Letter Queue（DLQ）
 * - 保证最终一致性
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import type { GraphNodeRecord, GraphEdgeRecord } from '../../../infrastructure/storage/core/types';
import { createServiceLogger } from '../../../shared/logging';
import type { ILogger } from '../../../shared/logging';
import { config } from '../../../shared/config';

export interface RetryItem {
  memoryId: string;
  entities: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
  attempts: number;
  lastAttempt: number;
  nextRetry: number;
}

export interface DLQItem extends RetryItem {
  failedAt: number;
}

export interface GraphRetryQueueConfig {
  maxRetries: number;
  retryDelayMs: number;
  queueFilePath?: string;
  dlqFilePath?: string;
}

/**
 * 获取 GraphRetryQueue 配置
 * 优先从 ConfigManager 读取，否则抛出错误
 */
function getGraphRetryQueueConfig(): { maxRetries: number; retryDelayMs: number; graphBasePath: string } {
  let graphBasePath = './data';
  if (config.isInitialized()) {
    const storageConfig = config.getConfig<{ graphBasePath?: string }>('memoryService.storage');
    if (storageConfig?.graphBasePath) {
      graphBasePath = storageConfig.graphBasePath;
    }
  }
  // 默认重试配置
  return {
    maxRetries: 3,
    retryDelayMs: 5000,
    graphBasePath,
  };
}

/**
 * GraphRetryQueue
 * Graph 写入失败时的重试队列
 * 使用指数退避策略，保证最终一致性
 * v1.2.0: 队列也持久化到磁盘，服务重启后可恢复
 */
export class GraphRetryQueue {
  private logger: ILogger;
  private queue: RetryItem[] = [];
  private dlq: DLQItem[] = [];
  private config: GraphRetryQueueConfig;
  private processorInterval?: NodeJS.Timeout;
  private isProcessing: boolean = false;
  private queueFilePath: string;
  private dlqFilePath: string;

  // 回调函数，由外部注入 GraphStore.addMemory
  private graphStoreAdder?: (
    memoryId: string,
    entities: GraphNodeRecord[],
    edges: GraphEdgeRecord[]
  ) => Promise<void>;

  constructor(userConfig?: Partial<GraphRetryQueueConfig>) {
    // 优先使用传入配置，否则从 ConfigManager 获取
    let maxRetries = 3;
    let retryDelayMs = 5000;
    let graphBasePath: string;

    if (userConfig && Object.keys(userConfig).length > 0) {
      maxRetries = userConfig.maxRetries ?? maxRetries;
      retryDelayMs = userConfig.retryDelayMs ?? retryDelayMs;
      this.config = { maxRetries, retryDelayMs, queueFilePath: userConfig.queueFilePath, dlqFilePath: userConfig.dlqFilePath };
    } else {
      const defaultConfig = getGraphRetryQueueConfig();
      maxRetries = defaultConfig.maxRetries;
      retryDelayMs = defaultConfig.retryDelayMs;
      this.config = { maxRetries, retryDelayMs };
    }

    this.logger = createServiceLogger('GraphRetryQueue');

    // 从 ConfigManager 获取路径配置
    if (userConfig?.queueFilePath && userConfig?.dlqFilePath) {
      this.queueFilePath = userConfig.queueFilePath;
      this.dlqFilePath = userConfig.dlqFilePath;
    } else {
      try {
        const storageConfig = config.isInitialized()
          ? config.getConfig<{ graphBasePath?: string }>('memoryService.storage')
          : null;
        graphBasePath = storageConfig?.graphBasePath || getGraphRetryQueueConfig().graphBasePath;
        this.queueFilePath = join(graphBasePath, 'graph-retry-queue.json');
        this.dlqFilePath = join(graphBasePath, 'graph-dlq.json');
      } catch {
        // Fallback: use config default path
        graphBasePath = './data';
        this.queueFilePath = join(graphBasePath, 'graph-retry-queue.json');
        this.dlqFilePath = join(graphBasePath, 'graph-dlq.json');
      }
    }
  }

  /**
   * 设置 GraphStore adder 函数
   */
  setGraphStoreAdder(
    adder: (
      memoryId: string,
      entities: GraphNodeRecord[],
      edges: GraphEdgeRecord[]
    ) => Promise<void>
  ): void {
    this.graphStoreAdder = adder;
  }

  /**
   * 添加到重试队列
   */
  enqueue(
    memoryId: string,
    entities: GraphNodeRecord[],
    edges: GraphEdgeRecord[]
  ): void {
    const item: RetryItem = {
      memoryId,
      entities,
      edges,
      attempts: 0,
      lastAttempt: 0,
      nextRetry: Date.now(),
    };
    this.queue.push(item);
    this._persistQueue().catch(err => {
      this.logger.error('Failed to persist retry queue after enqueue', { error: String(err) });
    });
    this.logger.debug('Item added to retry queue', {
      memoryId,
      queueLength: this.queue.length,
    });
  }

  /**
   * 处理重试
   */
  async processRetry(): Promise<void> {
    if (!this.graphStoreAdder) {
      this.logger.warn('GraphStore adder not set, skipping retry processing');
      return;
    }

    if (this.isProcessing) {
      this.logger.debug('Already processing, skipping');
      return;
    }

    this.isProcessing = true;
    const now = Date.now();
    const toRemove: string[] = [];

    try {
      for (const item of this.queue) {
        if (item.nextRetry > now) {
          continue;
        }

        item.attempts++;
        item.lastAttempt = now;

        try {
          await this.graphStoreAdder!(item.memoryId, item.entities, item.edges);
          toRemove.push(item.memoryId);
          this.logger.info('Retry successful', {
            memoryId: item.memoryId,
            attempts: item.attempts,
          });
        } catch (error) {
          this.logger.warn('Retry failed', {
            memoryId: item.memoryId,
            attempts: item.attempts,
            error: String(error),
          });

          if (item.attempts >= this.config.maxRetries) {
            toRemove.push(item.memoryId);
            // 持久化到 DLQ 而不是直接丢弃
            const dlqItem: DLQItem = {
              ...item,
              failedAt: now,
            };
            this.dlq.push(dlqItem);
            await this._persistDLQ();
            this.logger.error('Max retries exceeded, moved to DLQ', {
              memoryId: item.memoryId,
              attempts: item.attempts,
              dlqSize: this.dlq.length,
            });
          } else {
            // 计算下一次重试时间 (指数退避)
            // attempts=1 → 2^0=1x, attempts=2 → 2^1=2x, ...
            const backoffMs = this.config.retryDelayMs * Math.max(1, Math.pow(2, item.attempts - 1));
            item.nextRetry = now + backoffMs;
          }
        }
      }

      // 移除已处理的项目
      this.queue = this.queue.filter(item => !toRemove.includes(item.memoryId));
      // 持久化队列变更
      await this._persistQueue();

    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 启动定时处理器
   */
  async startProcessor(intervalMs: number = 30000): Promise<void> {
    if (this.processorInterval) {
      this.logger.warn('Processor already running');
      return;
    }

    // 启动时加载队列和 DLQ（进程重启后恢复待处理项）
    await this._loadQueue();
    await this._loadDLQ();

    this.processorInterval = setInterval(async () => {
      await this.processRetry();
      await this.processDLQ();
    }, intervalMs);

    this.logger.info('Retry processor started', {
      intervalMs,
      queueLoaded: this.queue.length,
      dlqLoaded: this.dlq.length,
    });
  }

  /**
   * 停止处理器
   */
  stopProcessor(): void {
    if (this.processorInterval) {
      clearInterval(this.processorInterval);
      this.processorInterval = undefined;
      this.logger.info('Retry processor stopped');
    }
  }

  /**
   * 获取队列状态
   */
  getStatus(): {
    queueLength: number;
    pendingCount: number;
    processing: boolean;
    dlqLength: number;
  } {
    return {
      queueLength: this.queue.length,
      pendingCount: this.queue.filter(item => item.nextRetry <= Date.now()).length,
      processing: this.isProcessing,
      dlqLength: this.dlq.length,
    };
  }

  /**
   * 清空队列和 DLQ
   */
  clear(): void {
    this.queue = [];
    this.dlq = [];
    // 清空持久化文件
    this._persistQueue().catch(() => { /* ignore */ });
    this._persistDLQ().catch(() => { /* ignore */ });
    this.logger.info('Retry queue and DLQ cleared');
  }

  /**
   * 立即处理队列中的所有项目
   */
  async flush(): Promise<void> {
    this.logger.info('Flushing retry queue', { queueLength: this.queue.length });
    await this.processRetry();
    await this.processDLQ();
  }

  /**
   * 从 DLQ 加载待处理项（进程重启后调用）
   */
  private async _loadDLQ(): Promise<void> {
    try {
      const data = await readFile(this.dlqFilePath, 'utf-8');
      const items = JSON.parse(data) as DLQItem[];
      if (Array.isArray(items) && items.length > 0) {
        // 重置重试时间，让 DLQ 项可以立即被处理
        for (const item of items) {
          item.nextRetry = Date.now();
          item.attempts = 0;
          item.lastAttempt = 0;
        }
        this.dlq = items;
        this.logger.info('DLQ items loaded', { count: items.length });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('Failed to load DLQ', { error: String(error) });
      }
    }
  }

  /**
   * 加载重试队列（进程重启后调用）
   */
  private async _loadQueue(): Promise<void> {
    try {
      const data = await readFile(this.queueFilePath, 'utf-8');
      const items = JSON.parse(data) as RetryItem[];
      if (Array.isArray(items) && items.length > 0) {
        // 重置重试时间，让队列项可以立即被处理
        for (const item of items) {
          item.nextRetry = Date.now();
          item.attempts = 0;
          item.lastAttempt = 0;
        }
        this.queue = items;
        this.logger.info('Retry queue items loaded', { count: items.length });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('Failed to load retry queue', { error: String(error) });
      }
    }
  }

  /**
   * 将重试队列持久化到磁盘
   */
  private async _persistQueue(): Promise<void> {
    try {
      await mkdir(dirname(this.queueFilePath), { recursive: true });
      await writeFile(this.queueFilePath, JSON.stringify(this.queue, null, 2), 'utf-8');
    } catch (error) {
      this.logger.error('Failed to persist retry queue', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * 将 DLQ 持久化到磁盘
   */
  private async _persistDLQ(): Promise<void> {
    try {
      await mkdir(dirname(this.dlqFilePath), { recursive: true });
      await writeFile(this.dlqFilePath, JSON.stringify(this.dlq, null, 2), 'utf-8');
    } catch (error) {
      this.logger.error('Failed to persist DLQ', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * 处理 DLQ 中的所有项目
   * 由定时器定期调用，也可在需要时手动调用
   */
  async processDLQ(): Promise<void> {
    if (!this.graphStoreAdder || this.dlq.length === 0) {
      return;
    }

    const now = Date.now();
    const toRemove: string[] = [];

    for (const item of this.dlq) {
      if (item.nextRetry > now) {
        continue;
      }

      item.attempts++;
      item.lastAttempt = now;

      try {
        await this.graphStoreAdder(item.memoryId, item.entities, item.edges);
        toRemove.push(item.memoryId);
        this.logger.info('DLQ item retry successful', {
          memoryId: item.memoryId,
          attempts: item.attempts,
        });
      } catch (error) {
        this.logger.warn('DLQ item retry failed', {
          memoryId: item.memoryId,
          attempts: item.attempts,
          error: String(error),
        });

        if (item.attempts >= this.config.maxRetries) {
          // 再次达到最大重试，从 DLQ 移除（不再重试）
          toRemove.push(item.memoryId);
          this.logger.error('DLQ item max retries exceeded, removing permanently', {
            memoryId: item.memoryId,
            attempts: item.attempts,
          });
        } else {
          // 重新计算退避时间
          const backoffMs = this.config.retryDelayMs * Math.max(1, Math.pow(2, item.attempts - 1));
          item.nextRetry = now + backoffMs;
        }
      }
    }

    if (toRemove.length > 0) {
      this.dlq = this.dlq.filter(item => !toRemove.includes(item.memoryId));
      await this._persistDLQ();
    }
  }
}
