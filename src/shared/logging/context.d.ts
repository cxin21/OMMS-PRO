/**
 * 日志上下文模块
 * 实现上下文管理和继承
 *
 * @module logging/context
 */
import type { LogContext, ILogger, LoggingConfig } from './types';
/**
 * LogContextManager - 日志上下文管理器（单例模式）
 *
 * 管理全局的日志上下文
 * 支持模块级别的上下文存储和继承
 */
export declare class LogContextManager {
    private static instance;
    private contextMap;
    /**
     * 私有构造函数（单例模式）
     */
    private constructor();
    /**
     * 获取单例实例
     */
    static getInstance(): LogContextManager;
    /**
     * 设置模块上下文
     * @param module - 模块名称
     * @param context - 上下文
     */
    setContext(module: string, context: LogContext): void;
    /**
     * 获取模块上下文
     * @param module - 模块名称
     * @returns 上下文对象
     */
    getContext(module: string): LogContext | undefined;
    /**
     * 清除模块上下文
     * @param module - 模块名称
     */
    clearContext(module: string): void;
    /**
     * 合并上下文
     * @param module - 模块名称
     * @param context - 要合并的上下文
     */
    mergeContext(module: string, context: LogContext): void;
    /**
     * 清除所有上下文
     */
    clearAll(): void;
    /**
     * 获取所有模块的上下文
     */
    getAllContexts(): Map<string, LogContext>;
}
/**
 * 创建日志器的工厂函数
 *
 * @param module - 模块名称
 * @param config - 配置（可选，会使用默认配置合并）
 * @param parentContext - 父上下文（用于子日志器）
 * @returns 日志器实例
 */
export declare function createLogger(module: string, config?: Partial<LoggingConfig>, parentContext?: LogContext): ILogger;
/**
 * 获取或创建日志器（单例模式）
 *
 * 相同的模块名会返回同一个日志器实例
 * 适用于模块级别的日志器
 *
 * @param module - 模块名称
 * @param config - 配置（可选，仅首次创建时使用）
 * @returns 日志器实例
 */
export declare function getLogger(module: string, config?: Partial<LoggingConfig>): ILogger;
/**
 * 清除日志器注册表
 * 主要用于测试
 */
export declare function clearLoggerRegistry(): void;
/**
 * 移除已注册的日志器
 * @param module - 模块名称
 */
export declare function removeLogger(module: string): void;
