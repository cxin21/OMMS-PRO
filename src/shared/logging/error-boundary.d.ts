/**
 * 错误边界装饰器
 *
 * 仅在最外层 public 方法添加错误捕获和日志记录。
 * 内部方法不加 try/catch，让错误自然冒泡到边界层。
 *
 * @module logging/error-boundary
 *
 * @example
 * ```typescript
 * class MyService {
 *   private logger = createServiceLogger('MyService');
 *
 *   @withErrorBoundary('MyService')
 *   async doSomething(input: Input): Promise<Result> {
 *     // 内部方法不需要 try/catch
 *     const data = await this.fetchData(input);  // 错误会自动冒泡
 *     return this.processData(data);              // 错误会自动冒泡
 *   }
 * }
 * ```
 */
import type { ILogger } from './types';
/**
 * 创建带错误边界的 async 方法装饰器
 *
 * 自动为被装饰的方法添加：
 * - correlationId 生成
 * - 操作计时 (startTimer)
 * - 错误捕获 + 完整堆栈记录
 * - 成功完成日志
 * - 重新抛出错误（不吞掉异常）
 *
 * @param serviceName - 服务名称（用于日志模块名）
 * @returns 方法装饰器
 */
export declare function withErrorBoundary(serviceName: string): MethodDecorator;
/**
 * 手动包装 async 函数的错误边界（用于非类方法场景）
 *
 * @param logger - 日志器实例
 * @param operation - 操作名称
 * @param fn - 要执行的异步函数
 * @returns 包装后的函数
 *
 * @example
 * ```typescript
 * const safeCapture = wrapWithErrorBoundary(logger, 'capture', async (input) => {
 *   // 内部逻辑，不需要 try/catch
 *   return await doCapture(input);
 * });
 *
 * // 调用时自动捕获错误并记录日志
 * const result = await safeCapture(input);
 * ```
 */
export declare function wrapWithErrorBoundary<T extends (...args: any[]) => Promise<any>>(logger: ILogger, operation: string, fn: T): T;
