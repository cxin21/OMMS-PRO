/**
 * 重试工具模块
 * 提供自动重试、指数退避等功能
 * 
 * @module utils/retry
 * @since 0.1.0
 */

import type { RetryOptions, RetryConfig } from './types';

/**
 * 重试工具类
 * 
 * 提供自动重试、指数退避、超时控制等功能
 * 
 * @example
 * ```typescript
 * // 简单重试
 * const result = await RetryUtils.retry(() => fetch(url));
 * 
 * // 自定义重试策略
 * const result = await RetryUtils.retry(
 *   () => apiCall(),
 *   { maxRetries: 5, baseDelay: 1000 }
 * );
 * ```
 */
export class RetryUtils {
  private static defaultConfig: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    factor: 2,
  };

  /**
   * 配置重试工具
   */
  static configure(config: Partial<RetryConfig>): void {
    this.defaultConfig = { ...this.defaultConfig, ...config };
  }

  /**
   * 执行带重试的函数
   * 
   * @param fn - 要执行的函数
   * @param options - 重试选项
   * @returns 函数执行结果
   */
  static async retry<T>(
    fn: () => Promise<T>,
    options?: Partial<RetryOptions>
  ): Promise<T> {
    const {
      maxRetries = this.defaultConfig.maxRetries,
      baseDelay = this.defaultConfig.baseDelay,
      maxDelay = this.defaultConfig.maxDelay,
      factor = this.defaultConfig.factor,
      shouldRetry,
      onRetry,
    } = options ?? {};

    let lastError: Error;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        attempt++;

        // 检查是否应该重试
        if (attempt > maxRetries) {
          throw lastError;
        }

        if (shouldRetry && !shouldRetry(lastError)) {
          throw lastError;
        }

        // 计算延迟时间
        const delay = this.exponentialBackoff(attempt, baseDelay, maxDelay, factor);

        // 调用重试回调
        if (onRetry) {
          onRetry(lastError, attempt);
        }

        // 等待
        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  /**
   * 执行带重试和超时的函数
   */
  static async retryWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number,
    options?: Partial<RetryOptions>
  ): Promise<T> {
    const startTime = Date.now();

    return this.retry(async () => {
      const elapsed = Date.now() - startTime;
      
      if (elapsed >= timeout) {
        throw new Error(`Operation timed out after ${timeout}ms`);
      }

      // 创建带超时的 Promise
      return Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          const remaining = timeout - elapsed;
          setTimeout(() => reject(new Error('Timeout')), remaining);
        }),
      ]);
    }, options);
  }

  /**
   * 指数退避计算
   * 
   * @param attempt - 当前尝试次数
   * @param baseDelay - 基础延迟
   * @param maxDelay - 最大延迟
   * @param factor - 退避因子
   * @returns 延迟时间（毫秒）
   */
  static exponentialBackoff(
    attempt: number,
    baseDelay: number,
    maxDelay: number,
    factor: number
  ): number {
    const delay = baseDelay * Math.pow(factor, attempt - 1);
    
    // 添加随机抖动（0-20%）
    const jitter = delay * 0.2 * Math.random();
    
    return Math.min(delay + jitter, maxDelay);
  }

  /**
   * 线性退避
   */
  static linearBackoff(
    attempt: number,
    baseDelay: number,
    maxDelay: number
  ): number {
    const delay = baseDelay * attempt;
    return Math.min(delay, maxDelay);
  }

  /**
   * 固定退避
   */
  static fixedBackoff(
    _attempt: number,
    baseDelay: number,
    maxDelay: number
  ): number {
    return Math.min(baseDelay, maxDelay);
  }

  /**
   * 带抖动的退避
   */
  static jitteredBackoff(
    attempt: number,
    baseDelay: number,
    maxDelay: number,
    factor: number,
    jitterFactor = 0.2
  ): number {
    const delay = baseDelay * Math.pow(factor, attempt - 1);
    const jitter = delay * jitterFactor * (Math.random() * 2 - 1);
    return Math.min(Math.max(delay + jitter, 0), maxDelay);
  }

  /**
   * 睡眠
   */
  static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 轮询直到成功或超时
   */
  static async pollUntil<T>(
    fn: () => Promise<T | null>,
    options?: {
      interval?: number;
      timeout?: number;
      predicate?: (result: T) => boolean;
    }
  ): Promise<T> {
    const {
      interval = 1000,
      timeout = 30000,
      predicate,
    } = options ?? {};

    const startTime = Date.now();

    while (true) {
      const elapsed = Date.now() - startTime;
      
      if (elapsed >= timeout) {
        throw new Error(`Polling timed out after ${timeout}ms`);
      }

      try {
        const result = await fn();
        
        if (result !== null) {
          if (!predicate || predicate(result)) {
            return result;
          }
        }
      } catch (error) {
        // 忽略错误，继续轮询
      }

      await this.sleep(interval);
    }
  }

  /**
   * 轮询带重试
   */
  static async pollWithRetry<T>(
    fn: () => Promise<T>,
    options?: Partial<RetryOptions> & {
      interval?: number;
      maxDuration?: number;
    }
  ): Promise<T> {
    const {
      interval = 1000,
      maxDuration = 60000,
      ...retryOptions
    } = options ?? {};

    const startTime = Date.now();

    return this.retry(async () => {
      const elapsed = Date.now() - startTime;
      
      if (elapsed >= maxDuration) {
        throw new Error(`Polling exceeded max duration of ${maxDuration}ms`);
      }

      return fn();
    }, retryOptions);
  }

  /**
   * 重试直到成功（无限制）
   */
  static async retryUntilSuccess<T>(
    fn: () => Promise<T>,
    options?: {
      baseDelay?: number;
      maxDelay?: number;
      factor?: number;
      onRetry?: (error: Error, attempt: number) => void;
    }
  ): Promise<T> {
    const {
      baseDelay = 1000,
      maxDelay = 30000,
      factor = 2,
      onRetry,
    } = options ?? {};

    let attempt = 0;

    while (true) {
      try {
        return await fn();
      } catch (error) {
        attempt++;
        const err = error instanceof Error ? error : new Error(String(error));
        
        if (onRetry) {
          onRetry(err, attempt);
        }

        const delay = this.exponentialBackoff(attempt, baseDelay, maxDelay, factor);
        await this.sleep(delay);
      }
    }
  }

  /**
   * 带电路断路器的重试
   */
  static async retryWithCircuitBreaker<T>(
    fn: () => Promise<T>,
    options?: Partial<RetryOptions> & {
      failureThreshold?: number;
      resetTimeout?: number;
    }
  ): Promise<T> {
    const {
      failureThreshold = 5,
      resetTimeout = 60000,
      ...retryOptions
    } = options ?? {};

    let failures = 0;
    let lastFailureTime = 0;
    let state: 'closed' | 'open' | 'half-open' = 'closed';

    const checkCircuit = () => {
      const now = Date.now();
      
      if (state === 'open') {
        if (now - lastFailureTime >= resetTimeout) {
          state = 'half-open';
          return true;
        }
        throw new Error('Circuit breaker is open');
      }
      
      return true;
    };

    const recordSuccess = () => {
      failures = 0;
      state = 'closed';
    };

    const recordFailure = () => {
      failures++;
      lastFailureTime = Date.now();
      
      if (failures >= failureThreshold) {
        state = 'open';
      }
    };

    return this.retry(async () => {
      checkCircuit();
      
      try {
        const result = await fn();
        recordSuccess();
        return result;
      } catch (error) {
        recordFailure();
        throw error;
      }
    }, retryOptions);
  }

  /**
   * 批量重试
   */
  static async batchRetry<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    options?: Partial<RetryOptions> & {
      concurrency?: number;
    }
  ): Promise<R[]> {
    const {
      concurrency = 1,
      ...retryOptions
    } = options ?? {};

    const results: R[] = new Array(items.length);
    const errors: Error[] = new Array(items.length);

    const processWithRetry = async (item: T, index: number) => {
      try {
        results[index] = await this.retry(
          () => processor(item, index),
          retryOptions
        );
      } catch (error) {
        errors[index] = error instanceof Error ? error : new Error(String(error));
      }
    };

    // 并发控制
    const chunks = this.chunk(items, concurrency);
    
    for (const chunk of chunks) {
      await Promise.all(chunk.map((item, i) => processWithRetry(item, i)));
    }

    // 如果有错误，抛出第一个错误
    const firstError = errors.find(e => e !== undefined);
    if (firstError) {
      throw firstError;
    }

    return results;
  }

  /**
   * 分块
   */
  private static chunk<T>(array: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size));
    }
    return result;
  }

  /**
   * 判断错误是否可重试
   */
  static isRetryableError(error: Error, retryableErrors?: Array<typeof Error>): boolean {
    if (!retryableErrors || retryableErrors.length === 0) {
      return true;
    }

    return retryableErrors.some(ErrorClass => error instanceof ErrorClass);
  }

  /**
   * 创建可重试函数
   */
  static createRetryable<T>(
    fn: () => Promise<T>,
    options?: Partial<RetryOptions>
  ): () => Promise<T> {
    return () => this.retry(fn, options);
  }

  /**
   * 重试统计
   */
  static getRetryStats(
    attempts: number,
    successes: number,
    failures: number
  ): {
    totalAttempts: number;
    successRate: number;
    failureRate: number;
    averageAttempts: number;
  } {
    const total = successes + failures;
    
    return {
      totalAttempts: attempts,
      successRate: total > 0 ? successes / total : 0,
      failureRate: total > 0 ? failures / total : 0,
      averageAttempts: total > 0 ? attempts / total : 0,
    };
  }

  /**
   * 延迟执行
   */
  static async delayExecute<T>(
    fn: () => Promise<T>,
    delay: number
  ): Promise<T> {
    await this.sleep(delay);
    return fn();
  }

  /**
   * 超时执行
   */
  static async withTimeout<T>(
    fn: () => Promise<T>,
    timeout: number,
    errorMessage?: string
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(errorMessage ?? `Operation timed out after ${timeout}ms`)),
          timeout
        );
      }),
    ]);
  }

  /**
   * 竞争执行（多个 Promise 取第一个成功）
   */
  static async raceWithRetry<T>(
    fns: Array<() => Promise<T>>,
    options?: Partial<RetryOptions>
  ): Promise<T> {
    const errors: Error[] = [];

    for (const fn of fns) {
      try {
        return await this.retry(fn, options);
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    throw new AggregateError(errors, 'All functions failed');
  }

  /**
   * 并行执行所有（带重试）
   */
  static async allWithRetry<T>(
    fns: Array<() => Promise<T>>,
    options?: Partial<RetryOptions>
  ): Promise<T[]> {
    return Promise.all(fns.map(fn => this.retry(fn, options)));
  }
}
