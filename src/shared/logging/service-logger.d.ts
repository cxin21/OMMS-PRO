/**
 * 统一服务日志工厂
 * 为各核心服务提供一致的日志配置和创建方式
 *
 * @module logging/service-logger
 */
import type { ILogger, LoggingConfig } from './types';
/**
 * 创建服务日志器
 *
 * 统一的服务日志创建函数，自动应用：
 * - 一致的日志级别（info）
 * - 文件 + 控制台双输出
 * - 日志轮转（50MB x 10 文件）
 * - 服务专用日志文件
 *
 * @param serviceName - 服务名称
 * @param overrides - 可选的配置覆盖
 * @returns ILogger 实例
 *
 * @example
 * ```typescript
 * const logger = createServiceLogger('MemoryCaptureService');
 * logger.info('Capture started', { agentId: 'claude-code' });
 *
 * // 覆盖默认配置（如调试时临时开启 debug 级别）
 * const debugLogger = createServiceLogger('MemoryCaptureService', { level: 'debug' });
 * ```
 */
export declare function createServiceLogger(serviceName: string, overrides?: Partial<LoggingConfig>): ILogger;
/**
 * 注册新的服务日志配置
 *
 * @param serviceName - 服务名称
 * @param filePath - 日志文件路径
 */
export declare function registerServiceLogConfig(serviceName: string, filePath: string): void;
