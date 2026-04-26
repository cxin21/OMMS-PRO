/**
 * 日志格式化模块
 * 实现 JSON 和 Text 两种格式化器
 *
 * @module logging/formatter
 */
import type { LogEntry, ILogFormatter } from './types';
/**
 * JsonFormatter - JSON 格式化器
 *
 * 将日志条目格式化为 JSON 字符串
 * 适用于日志分析系统（如 ELK、Splunk）
 */
export declare class JsonFormatter implements ILogFormatter {
    /**
     * 格式化日志条目
     * @param entry - 日志条目
     * @returns JSON 格式的字符串
     */
    format(entry: LogEntry): string;
    /**
     * 清理数据，确保可以序列化
     * @param data - 要清理的数据
     * @returns 清理后的数据
     */
    private sanitize;
}
/**
 * TextFormatter - 文本格式化器
 *
 * 将日志条目格式化为人类可读的文本
 * 适用于开发调试和人工查看
 */
export declare class TextFormatter implements ILogFormatter {
    private showColors;
    /**
     * 创建文本格式化器
     * @param showColors - 是否显示颜色（默认 true）
     */
    constructor(showColors?: boolean);
    /**
     * 格式化日志条目
     * @param entry - 日志条目
     * @returns 格式化后的文本字符串
     */
    format(entry: LogEntry): string;
    /**
     * 格式化时间戳
     */
    private formatTimestamp;
    /**
     * 格式化日志级别
     */
    private formatLevel;
    /**
     * 格式化模块名
     */
    private formatModule;
    /**
     * 格式化消息
     */
    private formatMessage;
    /**
     * 格式化错误（含堆栈）
     */
    private formatError;
    /**
     * 格式化堆栈（来自 data.stack）
     */
    private formatStack;
    /**
     * 格式化 cause 链
     */
    private formatCauseChain;
    /**
     * 格式化附加数据
     */
    private formatData;
    /**
     * 格式化上下文
     */
    private formatContext;
    /**
     * 给文本添加颜色
     */
    private colorize;
}
/**
 * 创建格式化器的工厂函数
 * @param format - 格式类型
 * @param options - 选项
 * @returns 格式化器实例
 */
export declare function createFormatter(format?: 'json' | 'text', options?: {
    showColors?: boolean;
}): ILogFormatter;
