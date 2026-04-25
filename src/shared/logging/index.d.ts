/**
 * Logging Service - 日志服务
 *
 * 提供统一的日志记录服务，支持：
 * - 多级别日志（debug/info/warn/error）
 * - 多输出目标（控制台/文件）
 * - 结构化日志（JSON/Text）
 * - 日志轮转
 * - 上下文支持
 *
 * @module logging
 *
 * @example
 * ```typescript
 * import { getLogger, createLogger } from '@logging';
 *
 * // 方式 1：获取单例日志器
 * const logger = getLogger('MemoryService');
 * logger.info('Memory stored', { memoryId: 'mem_001' });
 *
 * // 方式 2：创建新日志器
 * const configLogger = createLogger('ConfigManager', {
 *   level: 'debug',
 *   output: 'both',
 *   filePath: '~/.omms/logs/config.log',
 * });
 * configLogger.debug('Configuration loaded');
 *
 * // 方式 3：创建子日志器
 * const childLogger = logger.child('ScoringEngine');
 * childLogger.warn('Low importance score');
 * ```
 */
export type { LogLevel, LogOutput, LogFormat, LogContext, LogEntry, LoggingConfig, ILogger, ILogTransport, ILogFormatter, RotationInfo, LogStats, } from './types';
export { Logger, AsyncLogger } from './logger';
export { ConsoleTransport, FileTransport, MultiTransport, createTransport } from './transport';
export { JsonFormatter, TextFormatter, createFormatter } from './formatter';
export { LogContextManager, createLogger, getLogger, clearLoggerRegistry, removeLogger } from './context';
export { getLogger as default } from './context';
