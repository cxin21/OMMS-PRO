/**
 * 批处理工具模块
 * 提供批量处理、并发控制、进度追踪等功能
 * 
 * @module utils/batch
 * @since 0.1.0
 */

import type { BatchOptions, BatchConfig, ProgressTracker } from './types';

/**
 * 批处理工具类
 * 
 * 提供批量处理、并发控制、进度追踪等功能
 * 
 * @example
 * ```typescript
 * // 批量处理
 * const results = await BatchUtils.process(
 *   items,
 *   async (item) => process(item),
 *   { concurrency: 5 }
 * );
 * 
 * // 分批处理
 * const chunks = BatchUtils.chunk(array, 100);
 * ```
 */
export class BatchUtils {
  private static defaultConfig: BatchConfig = {
    concurrency: 5,
    stopOnError: false,
    chunkSize: 100,
  };

  /**
   * 配置批处理工具
   */
  static configure(config: Partial<BatchConfig>): void {
    this.defaultConfig = { ...this.defaultConfig, ...config };
  }

  /**
   * 批量处理
   * 
   * @param items - 项目数组
   * @param processor - 处理函数
   * @param options - 批处理选项
   * @returns 处理结果数组
   */
  static async process<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    options?: Partial<BatchOptions>
  ): Promise<R[]> {
    const {
      concurrency = this.defaultConfig.concurrency,
      stopOnError = this.defaultConfig.stopOnError,
      onProgress,
      onError,
    } = options ?? {};

    if (!items || items.length === 0) {
      return [];
    }

    const results: R[] = new Array(items.length);
    const errors: Error[] = [];
    let completed = 0;
    let failed = 0;

    // 创建进度追踪器
    const tracker: ProgressTracker = {
      total: items.length,
      completed: 0,
      failed: 0,
      percentage: 0,
      isComplete: false,
    };

    // 并发控制
    const executing: Promise<void>[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const index = i;

      const promise = Promise.resolve()
        .then(async () => {
          try {
            const result = await processor(item, index);
            results[index] = result;
            completed++;
          } catch (error) {
            failed++;
            const err = error instanceof Error ? error : new Error(String(error));
            errors.push(err);

            if (onError) {
              onError(err, index);
            }

            if (stopOnError) {
              throw err;
            }
          } finally {
            tracker.completed = completed;
            tracker.failed = failed;
            tracker.percentage = ((completed + failed) / items.length) * 100;
            tracker.isComplete = completed + failed === items.length;

            if (onProgress) {
              onProgress(completed, items.length, results[index]);
            }

            // 从执行队列中移除
            executing.splice(executing.indexOf(promise), 1);
          }
        })
        .catch(err => {
          if (stopOnError) {
            throw err;
          }
        });

      executing.push(promise);

      // 控制并发数
      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }

    // 等待所有任务完成
    await Promise.all(executing);

    // 如果有错误且设置了 stopOnError，抛出第一个错误
    if (errors.length > 0 && stopOnError) {
      throw errors[0];
    }

    return results;
  }

  /**
   * 分批处理（按批次顺序执行）
   */
  static async processInBatches<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    options?: Partial<BatchOptions> & {
      batchSize?: number;
      delayBetweenBatches?: number;
    }
  ): Promise<R[]> {
    const {
      batchSize = this.defaultConfig.chunkSize,
      delayBetweenBatches = 0,
      onProgress,
      onError,
    } = options ?? {};

    if (!items || items.length === 0) {
      return [];
    }

    const results: R[] = [];
    const batches = this.chunk(items, batchSize);
    let globalIndex = 0;

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const batchResults: R[] = [];

      // 处理当前批次
      for (let i = 0; i < batch.length; i++) {
        try {
          const result = await processor(batch[i], globalIndex);
          batchResults.push(result);
        } catch (error) {
          if (onError) {
            onError(error instanceof Error ? error : new Error(String(error)), globalIndex);
          }
          batchResults.push(undefined as R);
        }
        globalIndex++;
      }

      results.push(...batchResults);

      // 进度回调
      if (onProgress) {
        onProgress(results.length, items.length, null);
      }

      // 批次间延迟
      if (delayBetweenBatches > 0 && b < batches.length - 1) {
        await this.sleep(delayBetweenBatches);
      }
    }

    return results;
  }

  /**
   * 数组分块
   */
  static chunk<T>(array: T[], size: number): T[][] {
    if (!array || array.length === 0 || size <= 0) {
      return [];
    }

    const result: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size));
    }
    return result;
  }

  /**
   * 并行处理所有项目
   */
  static async processAll<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>
  ): Promise<R[]> {
    return Promise.all(items.map((item, index) => processor(item, index)));
  }

  /**
   * 串行处理
   */
  static async processSeries<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    options?: {
      onProgress?: (completed: number, total: number) => void;
    }
  ): Promise<R[]> {
    const results: R[] = [];
    const { onProgress } = options ?? {};

    for (let i = 0; i < items.length; i++) {
      const result = await processor(items[i], i);
      results.push(result);

      if (onProgress) {
        onProgress(i + 1, items.length);
      }
    }

    return results;
  }

  /**
   * 限制并发数的 Map
   */
  static async mapWithConcurrency<T, R>(
    items: T[],
    mapper: (item: T, index: number) => Promise<R>,
    concurrency: number
  ): Promise<R[]> {
    return this.process(items, mapper, { concurrency });
  }

  /**
   * 限制并发数的 Filter
   */
  static async filterWithConcurrency<T>(
    items: T[],
    predicate: (item: T, index: number) => Promise<boolean>,
    concurrency: number
  ): Promise<T[]> {
    const results = await this.process(
      items,
      async (item, index) => ({ item, keep: await predicate(item, index) }),
      { concurrency }
    );

    return results.filter(r => r.keep).map(r => r.item);
  }

  /**
   * 限制并发数的 Reduce
   */
  static async reduceWithConcurrency<T, R>(
    items: T[],
    reducer: (acc: R, item: T, index: number) => Promise<R>,
    initial: R,
    concurrency: number
  ): Promise<R> {
    // 先并发处理所有项目
    const processed = await this.process(
      items,
      async (item, index) => ({ item, index }),
      { concurrency }
    );

    // 然后串行 reduce
    let result = initial;
    for (const { item, index } of processed) {
      result = await reducer(result, item, index);
    }

    return result;
  }

  /**
   * 批处理生成器
   */
  static async *generateBatches<T>(items: T[], batchSize: number): AsyncGenerator<T[]> {
    if (!items || items.length === 0) {
      return;
    }

    for (let i = 0; i < items.length; i += batchSize) {
      yield items.slice(i, i + batchSize);
    }
  }

  /**
   * 带退避的批处理
   */
  static async processWithBackoff<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    options?: Partial<BatchOptions> & {
      maxRetries?: number;
      baseDelay?: number;
    }
  ): Promise<R[]> {
    const {
      maxRetries = 3,
      baseDelay = 1000,
      ...batchOptions
    } = options ?? {};

    const failedItems: { item: T; index: number; retries: number }[] = [];

    const processWithRetry = async (item: T, index: number): Promise<R> => {
      let lastError: Error;
      
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await processor(item, index);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          
          if (attempt < maxRetries) {
            const delay = baseDelay * Math.pow(2, attempt);
            await this.sleep(delay);
          }
        }
      }

      failedItems.push({ item, index, retries: maxRetries });
      throw lastError!;
    };

    return this.process(items, processWithRetry, batchOptions);
  }

  /**
   * 批处理管道
   */
  static async pipe<T, R>(
    items: T[],
    stages: Array<(item: T, index: number) => Promise<R>>,
    options?: Partial<BatchOptions>
  ): Promise<R[]> {
    let current: R[] = [];

    for (const stage of stages) {
      current = await this.process(current as unknown as T[], stage as any, options);
    }

    return current;
  }

  /**
   * 批处理聚合
   */
  static async aggregate<T, R>(
    items: T[],
    aggregator: (items: T[]) => Promise<R>,
    options?: {
      batchSize?: number;
    }
  ): Promise<R[]> {
    const { batchSize = this.defaultConfig.chunkSize } = options ?? {};
    const batches = this.chunk(items, batchSize);
    const results: R[] = [];

    for (const batch of batches) {
      const result = await aggregator(batch);
      results.push(result);
    }

    return results;
  }

  /**
   * 创建进度追踪器
   */
  static createTracker(total: number): ProgressTracker {
    return {
      total,
      completed: 0,
      failed: 0,
      percentage: 0,
      isComplete: false,
    };
  }

  /**
   * 更新进度追踪器
   */
  static updateTracker(
    tracker: ProgressTracker,
    completed: number,
    failed = 0
  ): ProgressTracker {
    tracker.completed = completed;
    tracker.failed = failed;
    tracker.percentage = ((completed + failed) / tracker.total) * 100;
    tracker.isComplete = completed + failed >= tracker.total;
    return tracker;
  }

  /**
   * 格式化进度
   */
  static formatProgress(tracker: ProgressTracker): string {
    const barLength = 20;
    const filledLength = Math.round((tracker.percentage / 100) * barLength);
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
    
    return `[${bar}] ${tracker.percentage.toFixed(1)}% (${tracker.completed}/${tracker.total})`;
  }

  /**
   * 睡眠
   */
  static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 批量执行（无返回值）
   */
  static async execute(
    items: unknown[],
    executor: (item: unknown, index: number) => Promise<void>,
    options?: Partial<BatchOptions>
  ): Promise<void> {
    await this.process(items, executor, options);
  }

  /**
   * 批处理分组
   */
  static async groupProcess<T, K extends string | number | symbol, R>(
    items: T[],
    grouper: (item: T) => K,
    processor: (group: K, items: T[]) => Promise<R>,
    options?: Partial<BatchOptions>
  ): Promise<Map<K, R>> {
    // 分组
    const groups: Map<K, T[]> = new Map();
    
    for (const item of items) {
      const key = grouper(item);
      const group = groups.get(key) || [];
      group.push(item);
      groups.set(key, group);
    }

    // 处理每个组
    const results: Map<K, R> = new Map();
    const groupEntries = Array.from(groups.entries());

    const processed = await this.process(
      groupEntries,
      async ([key, groupItems], index) => {
        const result = await processor(key, groupItems);
        return { key, result };
      },
      options
    );

    for (const { key, result } of processed) {
      results.set(key, result);
    }

    return results;
  }

  /**
   * 批处理去重
   */
  static async processUnique<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    keyFn?: (item: T) => string,
    options?: Partial<BatchOptions>
  ): Promise<R[]> {
    const seen = new Set<string>();
    const uniqueItems: { item: T; index: number }[] = [];

    // 去重
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const key = keyFn ? keyFn(item) : String(item);
      
      if (!seen.has(key)) {
        seen.add(key);
        uniqueItems.push({ item, index: i });
      }
    }

    // 处理
    return this.process(
      uniqueItems,
      async ({ item }, originalIndex) => processor(item, originalIndex),
      options
    );
  }

  /**
   * 批处理缓存
   */
  static async processWithCache<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    cache: Map<string, R>,
    keyFn?: (item: T) => string,
    options?: Partial<BatchOptions>
  ): Promise<R[]> {
    return this.process(items, async (item, index) => {
      const key = keyFn ? keyFn(item) : String(item);
      
      // 检查缓存
      if (cache.has(key)) {
        return cache.get(key)!;
      }

      // 处理并缓存
      const result = await processor(item, index);
      cache.set(key, result);
      return result;
    }, options);
  }

  /**
   * 批处理速率限制
   */
  static async processWithRateLimit<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    rateLimit: number, // 每秒处理数
    options?: Partial<BatchOptions>
  ): Promise<R[]> {
    const interval = 1000 / rateLimit;
    let lastTime = 0;

    return this.process(items, async (item, index) => {
      const now = Date.now();
      const elapsed = now - lastTime;
      
      if (elapsed < interval) {
        await this.sleep(interval - elapsed);
      }
      
      lastTime = Date.now();
      return processor(item, index);
    }, options);
  }

  /**
   * 批处理超时
   */
  static async processWithTimeout<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    timeout: number,
    options?: Partial<BatchOptions>
  ): Promise<{ results: R[]; timedOut: boolean; processedCount: number }> {
    const startTime = Date.now();
    const results: R[] = [];
    let processedCount = 0;
    let timedOut = false;

    try {
      const processed = await this.process(
        items,
        async (item, index) => {
          const elapsed = Date.now() - startTime;
          
          if (elapsed >= timeout) {
            timedOut = true;
            throw new Error('Batch processing timed out');
          }
          
          return processor(item, index);
        },
        options
      );

      results.push(...processed);
      processedCount = processed.length;
    } catch (error) {
      if (!timedOut) {
        throw error;
      }
    }

    return { results, timedOut, processedCount };
  }

  /**
   * 批处理优先级
   */
  static async processWithPriority<T, R>(
    items: Array<{ item: T; priority: number }>,
    processor: (item: T, index: number) => Promise<R>,
    options?: Partial<BatchOptions>
  ): Promise<R[]> {
    // 按优先级排序（数字越小优先级越高）
    const sorted = [...items].sort((a, b) => a.priority - b.priority);
    
    return this.process(
      sorted.map(({ item }) => item),
      processor,
      options
    );
  }

  /**
   * 批处理重试队列
   */
  static async processWithRetryQueue<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    options?: Partial<BatchOptions> & {
      maxRetries?: number;
    }
  ): Promise<{ results: R[]; failed: Array<{ item: T; index: number; error: Error }> }> {
    const { maxRetries = 3, ...batchOptions } = options ?? {};
    const failed: Array<{ item: T; index: number; error: Error }> = [];
    const retryQueue: Array<{ item: T; index: number; retries: number }> = [];

    const results = await this.process(
      items,
      async (item, index) => {
        try {
          return await processor(item, index);
        } catch (error) {
          retryQueue.push({ item, index, retries: 0 });
          throw error;
        }
      },
      { ...batchOptions, stopOnError: false }
    );

    // 处理重试队列
    while (retryQueue.length > 0) {
      const retryItem = retryQueue.shift()!;
      
      try {
        const result = await processor(retryItem.item, retryItem.index);
        results[retryItem.index] = result;
      } catch (error) {
        if (retryItem.retries < maxRetries) {
          retryItem.retries++;
          retryQueue.push(retryItem);
        } else {
          failed.push({
            item: retryItem.item,
            index: retryItem.index,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    }

    return { results, failed };
  }
}
