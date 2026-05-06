/**
 * 日志上下文模块
 * 实现上下文管理和继承
 * 
 * @module logging/context
 */

import type { LogContext, ILogger, LoggingConfig } from './types';
import { Logger } from './logger';

/**
 * LogContextManager - 日志上下文管理器（单例模式）
 * 
 * 管理全局的日志上下文
 * 支持模块级别的上下文存储和继承
 */
export class LogContextManager {
  private static instance: LogContextManager;
  private contextMap: Map<string, LogContext>;
  
  /**
   * 私有构造函数（单例模式）
   */
  private constructor() {
    this.contextMap = new Map();
  }
  
  /**
   * 获取单例实例
   */
  static getInstance(): LogContextManager {
    if (!LogContextManager.instance) {
      LogContextManager.instance = new LogContextManager();
    }
    return LogContextManager.instance;
  }
  
  /**
   * 设置模块上下文
   * @param module - 模块名称
   * @param context - 上下文
   */
  setContext(module: string, context: LogContext): void {
    const existing = this.contextMap.get(module) || {};
    this.contextMap.set(module, { ...existing, ...context });
  }
  
  /**
   * 获取模块上下文
   * @param module - 模块名称
   * @returns 上下文对象
   */
  getContext(module: string): LogContext | undefined {
    return this.contextMap.get(module);
  }
  
  /**
   * 清除模块上下文
   * @param module - 模块名称
   */
  clearContext(module: string): void {
    this.contextMap.delete(module);
  }
  
  /**
   * 合并上下文
   * @param module - 模块名称
   * @param context - 要合并的上下文
   */
  mergeContext(module: string, context: LogContext): void {
    const existing = this.contextMap.get(module) || {};
    this.contextMap.set(module, { ...existing, ...context });
  }
  
  /**
   * 清除所有上下文
   */
  clearAll(): void {
    this.contextMap.clear();
  }
  
  /**
   * 获取所有模块的上下文
   */
  getAllContexts(): Map<string, LogContext> {
    return new Map(this.contextMap);
  }
}

/**
 * 深拷贝上下文
 */
function cloneContext(context: LogContext): LogContext {
  return JSON.parse(JSON.stringify(context));
}

/**
 * 合并上下文（子上下文优先）
 */
function mergeContexts(parent: LogContext, child: LogContext): LogContext {
  return { ...parent, ...child };
}

/**
 * 日志器注册表（用于单例模式）
 */
const loggerRegistry: Map<string, ILogger> = new Map();

/**
 * 默认配置
 */
const DEFAULT_CONFIG: LoggingConfig = {
  level: 'info',
  output: 'both',
  enableConsole: true,
  enableFile: true,
  enableRotation: true,
  format: 'text',
  useColors: false,
  includeTimestamp: true,
  includeModule: true,
};

/**
 * 创建日志器的工厂函数
 * 
 * @param module - 模块名称
 * @param config - 配置（可选，会使用默认配置合并）
 * @param parentContext - 父上下文（用于子日志器）
 * @returns 日志器实例
 */
export function createLogger(
  module: string,
  config?: Partial<LoggingConfig>,
  parentContext?: LogContext,
): ILogger {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  return new Logger(module, mergedConfig, parentContext);
}

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
export function getLogger(
  module: string,
  config?: Partial<LoggingConfig>,
): ILogger {
  // 检查是否已存在
  const existing = loggerRegistry.get(module);
  if (existing) {
    return existing;
  }
  
  // 创建新的日志器
  const logger = createLogger(module, config);
  loggerRegistry.set(module, logger);
  
  return logger;
}

/**
 * 清除日志器注册表
 * 主要用于测试
 */
export function clearLoggerRegistry(): void {
  loggerRegistry.clear();
}

/**
 * 移除已注册的日志器
 * @param module - 模块名称
 */
export function removeLogger(module: string): void {
  loggerRegistry.delete(module);
}
