/**
 * 核心日志器模块
 * 实现 Logger 类，提供完整的日志记录功能
 *
 * @module logging/logger
 */
import type { ILogger, LogEntry, LogLevel, LogContext, LoggingConfig, LogStats } from './types';
/**
 * Logger - 核心日志器类
 *
 * 实现 ILogger 接口，提供完整的日志记录功能
 * 支持多传输、格式化、上下文继承、日志轮转
 */
export declare class Logger implements ILogger {
    private module;
    protected config: LoggingConfig;
    private context;
    private transports;
    private formatter;
    private stats;
    /**
     * 创建日志器实例
     *
     * @param module - 模块名称
     * @param config - 日志配置
     * @param parentContext - 父上下文（用于子日志器继承）
     */
    constructor(module: string, config: LoggingConfig, parentContext?: LogContext);
    /**
     * 创建初始统计信息
     */
    private createInitialStats;
    /**
     * 创建传输列表
     */
    private createTransports;
    /**
     * 记录 debug 级别日志
     */
    debug(message: string, data?: Record<string, unknown>): void;
    /**
     * 记录 info 级别日志
     */
    info(message: string, data?: Record<string, unknown>): void;
    /**
     * 记录 warn 级别日志
     */
    warn(message: string, data?: Record<string, unknown>): void;
    /**
     * 记录 error 级别日志
     */
    error(message: string, errorOrData?: Error | Record<string, unknown>, data?: Record<string, unknown>): void;
    /**
     * 创建子日志器
     *
     * 子日志器继承父日志器的配置和上下文
     * 可以添加自己的上下文
     *
     * @param module - 子模块名称
     * @param context - 子日志器的上下文
     * @returns 新的日志器实例
     */
    child(module: string, context?: LogContext): Logger;
    /**
     * 设置上下文
     */
    setContext(context: LogContext): void;
    /**
     * 清除上下文
     */
    clearContext(): void;
    /**
     * 获取统计信息
     */
    getStats(): LogStats;
    /**
     * 内部日志方法
     *
     * @param level - 日志级别
     * @param message - 日志消息
     * @param error - 错误对象
     * @param data - 附加数据
     */
    protected log(level: LogLevel, message: string, error?: Error, data?: Record<string, unknown>): void;
    /**
     * 检查是否应该记录该级别的日志
     */
    protected shouldLog(level: LogLevel): boolean;
    /**
     * 创建日志条目
     */
    protected createEntry(level: LogLevel, message: string, error?: Error, data?: Record<string, unknown>): LogEntry;
    /**
     * 写入传输
     */
    protected writeToTransports(entry: LogEntry): void;
    /**
     * 更新统计信息
     */
    private updateStats;
    /**
     * 关闭日志器
     */
    close(): void;
}
/**
 * 异步日志器（支持队列缓冲）
 */
export declare class AsyncLogger extends Logger {
    private queue;
    private flushInterval;
    private maxQueueSize;
    constructor(module: string, config: LoggingConfig, parentContext?: LogContext, maxQueueSize?: number);
    /**
     * 启动定时刷新
     */
    private startFlushInterval;
    /**
     * 重写日志方法，加入队列
     */
    protected log(level: LogLevel, message: string, error?: Error, data?: Record<string, unknown>): void;
    /**
     * 刷新队列
     */
    flush(): void;
    /**
     * 关闭日志器
     */
    close(): void;
}
