/**
 * 日志格式化模块
 * 实现 JSON 和 Text 两种格式化器
 * 
 * @module logging/formatter
 */

import type { LogEntry, ILogFormatter, LogLevel } from './types';
import { TimeUtils } from '../utils/time';

/**
 * 日志级别颜色映射（用于控制台输出）
 */
const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m',   // 青色
  info: '\x1b[32m',    // 绿色
  warn: '\x1b[33m',    // 黄色
  error: '\x1b[31m',   // 红色
};

/**
 * 重置颜色代码
 */
const RESET_COLOR = '\x1b[0m';

/**
 * JsonFormatter - JSON 格式化器
 * 
 * 将日志条目格式化为 JSON 字符串
 * 适用于日志分析系统（如 ELK、Splunk）
 */
export class JsonFormatter implements ILogFormatter {
  /**
   * 格式化日志条目
   * @param entry - 日志条目
   * @returns JSON 格式的字符串
   */
  format(entry: LogEntry): string {
    const sanitized = this.sanitize(entry);
    return JSON.stringify(sanitized);
  }
  
  /**
   * 清理数据，确保可以序列化
   * @param data - 要清理的数据
   * @returns 清理后的数据
   */
  private sanitize(data: unknown): unknown {
    if (data === null || data === undefined) {
      return data;
    }
    
    if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
      return data;
    }
    
    if (data instanceof Error) {
      return {
        name: data.name,
        message: data.message,
        stack: data.stack,
      };
    }
    
    if (Array.isArray(data)) {
      return data.map(item => this.sanitize(item));
    }
    
    if (typeof data === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        result[key] = this.sanitize(value);
      }
      return result;
    }
    
    // 无法序列化的类型转换为字符串
    return String(data);
  }
}

/**
 * TextFormatter - 文本格式化器
 * 
 * 将日志条目格式化为人类可读的文本
 * 适用于开发调试和人工查看
 */
export class TextFormatter implements ILogFormatter {
  private showColors: boolean;
  
  /**
   * 创建文本格式化器
   * @param showColors - 是否显示颜色（默认 true）
   */
  constructor(showColors = true) {
    this.showColors = showColors;
  }
  
  /**
   * 格式化日志条目
   * @param entry - 日志条目
   * @returns 格式化后的文本字符串
   */
  format(entry: LogEntry): string {
    const parts: string[] = [];
    
    // 时间戳
    if (entry.timestamp) {
      parts.push(this.formatTimestamp(entry.timestamp));
    }
    
    // 日志级别
    parts.push(this.formatLevel(entry.level));
    
    // 模块名
    if (entry.module) {
      parts.push(this.formatModule(entry.module));
    }
    
    // 消息
    parts.push(this.formatMessage(entry.message));
    
    // 错误信息
    if (entry.error) {
      parts.push(this.formatError(entry.error));
    }
    
    // 附加数据
    if (entry.data && Object.keys(entry.data).length > 0) {
      parts.push(this.formatData(entry.data));
    }
    
    // 上下文
    if (entry.context && Object.keys(entry.context).length > 0) {
      parts.push(this.formatContext(entry.context));
    }
    
    return parts.join(' ');
  }
  
  /**
   * 格式化时间戳
   */
  private formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    const timeStr = TimeUtils.format(date.getTime(), 'YYYY-MM-DD HH:mm:ss.SSS');
    return this.colorize(`[${timeStr}]`, '\x1b[90m');
  }
  
  /**
   * 格式化日志级别
   */
  private formatLevel(level: LogLevel): string {
    const levelStr = level.toUpperCase().padEnd(5);
    const color = LEVEL_COLORS[level];
    return this.colorize(`[${levelStr}]`, color);
  }
  
  /**
   * 格式化模块名
   */
  private formatModule(module: string): string {
    return this.colorize(`[${module}]`, '\x1b[36m');
  }
  
  /**
   * 格式化消息
   */
  private formatMessage(message: string): string {
    return message;
  }
  
  /**
   * 格式化错误
   */
  private formatError(error: Error): string {
    const errorStr = `Error: ${error.message}`;
    return this.colorize(errorStr, '\x1b[31m');
  }
  
  /**
   * 格式化附加数据
   */
  private formatData(data: Record<string, unknown>): string {
    try {
      const dataStr = JSON.stringify(data);
      return this.colorize(dataStr, '\x1b[90m');
    } catch {
      return '[Circular Data]';
    }
  }
  
  /**
   * 格式化上下文
   */
  private formatContext(context: Record<string, unknown>): string {
    try {
      const contextStr = JSON.stringify(context);
      return this.colorize(`Context: ${contextStr}`, '\x1b[90m');
    } catch {
      return '[Circular Context]';
    }
  }
  
  /**
   * 给文本添加颜色
   */
  private colorize(text: string, color: string): string {
    if (!this.showColors) {
      return text;
    }
    return `${color}${text}${RESET_COLOR}`;
  }
}

/**
 * 创建格式化器的工厂函数
 * @param format - 格式类型
 * @param options - 选项
 * @returns 格式化器实例
 */
export function createFormatter(
  format: 'json' | 'text' = 'text',
  options?: { showColors?: boolean },
): ILogFormatter {
  switch (format) {
    case 'json':
      return new JsonFormatter();
    case 'text':
      return new TextFormatter(options?.showColors);
    default:
      return new TextFormatter();
  }
}
