/**
 * Logging Service 类型定义
 * 定义日志服务的所有类型和接口
 * 
 * @module logging/types
 */

/**
 * 日志级别枚举
 * 
 * debug - 调试信息，最详细的日志
 * info  - 一般信息，记录正常运行状态
 * warn  - 警告信息，需要注意但不影响运行
 * error - 错误信息，需要立即处理
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 日志输出目标
 * 
 * console - 输出到控制台
 * file    - 输出到文件
 * both    - 同时输出到控制台和文件
 */
export type LogOutput = 'console' | 'file' | 'both';

/**
 * 日志格式
 * 
 * json - JSON 格式，便于日志分析系统处理
 * text - 文本格式，便于人工阅读
 */
export type LogFormat = 'json' | 'text';

/**
 * 日志上下文
 * 
 * 用于在日志条目中附加上下文信息
 * 支持自定义字段
 */
export interface LogContext {
  sessionId?: string;
  agentId?: string;
  wingId?: string;
  roomId?: string;
  memoryId?: string;
  userId?: string;
  /** 关联 ID，用于跨服务追踪 */
  correlationId?: string;
  [key: string]: unknown;
}

/**
 * 日志条目
 * 
 * 单条日志的完整数据结构
 */
export interface LogEntry {
  /** ISO 8601 格式的时间戳 */
  timestamp: string;
  /** 日志级别 */
  level: LogLevel;
  /** 模块名称 */
  module: string;
  /** 日志消息 */
  message: string;
  /** 附加数据 */
  data?: Record<string, unknown>;
  /** 日志上下文 */
  context?: LogContext;
  /** 错误对象（如果有） */
  error?: Error;
  /** 关联 ID，用于跨服务追踪 */
  correlationId?: string;
  /** 操作耗时（毫秒） */
  durationMs?: number;
  /** 操作名称 */
  operation?: string;
}

/**
 * 日志配置
 *
 * 完整的日志系统配置项
 */
export interface LoggingConfig {
  /** 是否启用日志 */
  enabled?: boolean;
  /** 日志级别 */
  level: LogLevel;
  /** 输出目标 */
  output: LogOutput;
  /** 日志文件路径 */
  filePath?: string;
  /** 单个日志文件最大大小（字节数），来自 config.default.json */
  maxSize?: number;
  /** 单个日志文件最大大小（字符串格式），来自 LoggingConfig 类型 */
  maxFileSize?: string;
  /** 保留的日志文件最大数量 */
  maxFiles?: number;
  /** 日志格式 */
  format?: LogFormat;
  /** 是否启用控制台输出 */
  enableConsole: boolean;
  /** 是否启用文件输出 */
  enableFile: boolean;
  /** 是否启用日志轮转 */
  enableRotation: boolean;
  /** 轮转大小（已废弃，使用 maxSize 或 maxFileSize） */
  rotationSize?: string;
  /** 轮转文件保留数量（已废弃，使用 maxFiles） */
  rotationCount?: number;
  /** 是否在控制台使用颜色 */
  useColors?: boolean;
  /** 是否包含时间戳 */
  includeTimestamp?: boolean;
  /** 是否包含模块名 */
  includeModule?: boolean;
  /** 模块名称（用于子日志器） */
  module?: string;
  /** 日志刷新间隔（毫秒），默认 1000 */
  flushIntervalMs?: number;
}

/**
 * 日志器接口
 * 
 * 所有日志器必须实现的接口
 */
export interface ILogger {
  /**
   * 记录 debug 级别日志
   * @param message - 日志消息
   * @param data - 附加数据
   */
  debug(message: string, data?: Record<string, unknown>): void;
  
  /**
   * 记录 info 级别日志
   * @param message - 日志消息
   * @param data - 附加数据
   */
  info(message: string, data?: Record<string, unknown>): void;
  
  /**
   * 记录 warn 级别日志
   * @param message - 日志消息
   * @param data - 附加数据
   */
  warn(message: string, data?: Record<string, unknown>): void;
  
  /**
   * 记录 error 级别日志
   * @param message - 日志消息
   * @param error - 错误对象
   * @param data - 附加数据
   */
  error(message: string, error?: Error | Record<string, unknown>, data?: Record<string, unknown>): void;
  
  /**
   * 创建子日志器
   * @param module - 子模块名称
   * @param context - 子日志器的上下文
   * @returns 新的日志器实例
   */
  child(module: string, context?: LogContext): ILogger;
  
  /**
   * 设置上下文
   * @param context - 要设置的上下文
   */
  setContext(context: LogContext): void;
  
  /**
   * 清除上下文
   */
  clearContext(): void;

  /**
   * 开始计时，返回结束函数
   * 调用结束函数时自动记录操作耗时
   * @param operation - 操作名称
   * @param data - 附加数据
   * @returns 结束计时的函数
   */
  startTimer(operation: string, data?: Record<string, unknown>): () => void;
}

/**
 * 日志传输接口
 * 
 * 负责将日志条目写入到具体目标
 */
export interface ILogTransport {
  /**
   * 写入日志条目
   * @param entry - 日志条目
   */
  write(entry: LogEntry): void;
  
  /**
   * 关闭传输
   */
  close(): void;
}

/**
 * 日志格式化接口
 * 
 * 负责将日志条目格式化为字符串
 */
export interface ILogFormatter {
  /**
   * 格式化日志条目
   * @param entry - 日志条目
   * @returns 格式化后的字符串
   */
  format(entry: LogEntry): string;
}

/**
 * 日志轮转信息
 */
export interface RotationInfo {
  /** 当前文件大小（字节） */
  currentSize: number;
  /** 最大文件大小（字节） */
  maxSize: number;
  /** 是否需要轮转 */
  shouldRotate: boolean;
  /** 轮转文件列表 */
  rotatedFiles: string[];
}

/**
 * 日志统计信息
 */
export interface LogStats {
  /** 日志条目总数 */
  totalEntries: number;
  /** 按级别统计 */
  byLevel: Record<LogLevel, number>;
  /** 按模块统计 */
  byModule: Record<string, number>;
  /** 文件输出总数 */
  fileWrites: number;
  /** 控制台输出总数 */
  consoleWrites: number;
  /** 轮转次数 */
  rotationCount: number;
}
