/**
 * 日志传输模块
 * 实现控制台、文件和多路传输
 *
 * @module logging/transport
 */
import type { LogEntry, ILogTransport, ILogFormatter, RotationInfo } from './types';
/**
 * ConsoleTransport - 控制台传输
 *
 * 将日志输出到控制台
 * 支持彩色输出（可配置）
 */
export declare class ConsoleTransport implements ILogTransport {
    private useColors;
    private formatter;
    /**
     * 创建控制台传输
     * @param useColors - 是否使用颜色（默认 true）
     * @param formatter - 格式化器（默认 TextFormatter）
     */
    constructor(useColors?: boolean, formatter?: ILogFormatter);
    /**
     * 写入日志条目
     */
    write(entry: LogEntry): void;
    /**
     * 关闭传输
     */
    close(): void;
}
/**
 * FileTransport - 文件传输
 *
 * 将日志输出到文件
 * 支持日志轮转
 */
export declare class FileTransport implements ILogTransport {
    private filePath;
    private maxSize;
    private maxFiles;
    private currentSize;
    private stream;
    private formatter;
    private enableRotation;
    /**
     * 创建文件传输
     * @param config - 配置
     */
    constructor(config: {
        filePath: string;
        maxSize?: string | number;
        maxFiles?: number;
        enableRotation?: boolean;
        formatter?: ILogFormatter;
    });
    /**
     * 初始化文件流
     */
    private initialize;
    /**
     * 写入日志条目
     */
    write(entry: LogEntry): void;
    /**
     * 轮转日志文件
     */
    private rotate;
    /**
     * 获取轮转信息
     */
    getRotationInfo(): RotationInfo;
    /**
     * 关闭传输
     */
    close(): void;
}
/**
 * MultiTransport - 多路传输
 *
 * 将日志同时输出到多个传输目标
 */
export declare class MultiTransport implements ILogTransport {
    private transports;
    /**
     * 创建多路传输
     * @param transports - 传输列表
     */
    constructor(transports: ILogTransport[]);
    /**
     * 添加传输
     */
    addTransport(transport: ILogTransport): void;
    /**
     * 移除传输
     */
    removeTransport(transport: ILogTransport): void;
    /**
     * 写入日志条目
     */
    write(entry: LogEntry): void;
    /**
     * 关闭所有传输
     */
    close(): void;
    /**
     * 获取所有传输
     */
    getTransports(): ILogTransport[];
}
/**
 * 创建传输的工厂函数
 */
export declare function createTransport(type: 'console' | 'file' | 'multi', config?: {
    filePath?: string;
    maxSize?: string | number;
    maxFiles?: number;
    useColors?: boolean;
    enableRotation?: boolean;
}): ILogTransport;
