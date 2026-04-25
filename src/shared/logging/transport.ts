/**
 * 日志传输模块
 * 实现控制台、文件和多路传输
 * 
 * @module logging/transport
 */

import { createWriteStream, WriteStream, existsSync, renameSync, unlinkSync, statSync, mkdirSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { LogEntry, ILogTransport, ILogFormatter, RotationInfo } from './types';
import { TextFormatter } from './formatter';

/**
 * 解析文件大小字符串（如 "10MB" -> 10485760）
 */
function parseSize(sizeStr: string): number {
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)(KB|MB|GB)?$/i);
  if (!match) {
    return 10 * 1024 * 1024; // 默认 10MB
  }
  
  const value = parseFloat(match[1]);
  const unit = (match[2] || 'MB').toUpperCase();
  
  switch (unit) {
    case 'KB':
      return value * 1024;
    case 'MB':
      return value * 1024 * 1024;
    case 'GB':
      return value * 1024 * 1024 * 1024;
    default:
      return value;
  }
}

/**
 * 解析路径中的 ~ 符号
 */
function resolvePath(filePath: string): string {
  if (filePath.startsWith('~')) {
    return join(homedir(), filePath.slice(1));
  }
  return filePath;
}

/**
 * ConsoleTransport - 控制台传输
 * 
 * 将日志输出到控制台
 * 支持彩色输出（可配置）
 */
export class ConsoleTransport implements ILogTransport {
  private useColors: boolean;
  private formatter: ILogFormatter;
  
  /**
   * 创建控制台传输
   * @param useColors - 是否使用颜色（默认 true）
   * @param formatter - 格式化器（默认 TextFormatter）
   */
  constructor(useColors = true, formatter?: ILogFormatter) {
    this.useColors = useColors;
    this.formatter = formatter || new TextFormatter(useColors);
  }
  
  /**
   * 写入日志条目
   */
  write(entry: LogEntry): void {
    const output = this.formatter.format(entry);
    
    switch (entry.level) {
      case 'debug':
      case 'info':
        console.log(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      case 'error':
        console.error(output);
        break;
    }
  }
  
  /**
   * 关闭传输
   */
  close(): void {
    // 控制台不需要关闭
  }
}

/**
 * FileTransport - 文件传输
 * 
 * 将日志输出到文件
 * 支持日志轮转
 */
export class FileTransport implements ILogTransport {
  private filePath: string;
  private maxSize: number;
  private maxFiles: number;
  private currentSize: number;
  private stream: WriteStream | null = null;
  private formatter: ILogFormatter;
  private enableRotation: boolean;
  
  /**
   * 创建文件传输
   * @param config - 配置
   */
  constructor(config: {
    filePath: string;
    maxSize?: string;
    maxFiles?: number;
    enableRotation?: boolean;
    formatter?: ILogFormatter;
  }) {
    this.filePath = resolvePath(config.filePath);
    this.maxSize = config.maxSize ? parseSize(config.maxSize) : 10 * 1024 * 1024;
    this.maxFiles = config.maxFiles ?? 5;
    this.enableRotation = config.enableRotation ?? true;
    this.formatter = config.formatter || new TextFormatter(false);
    this.currentSize = 0;
    
    this.initialize();
  }
  
  /**
   * 初始化文件流
   */
  private initialize(): void {
    try {
      // 确保目录存在
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        // 目录不存在时需要创建
        mkdirSync(dir, { recursive: true });
      }
      
      // 获取当前文件大小
      if (existsSync(this.filePath)) {
        this.currentSize = statSync(this.filePath).size;
      }
      
      // 创建写入流
      this.stream = createWriteStream(this.filePath, { flags: 'a', encoding: 'utf-8' });
      
      this.stream.on('error', (error) => {
        console.error('FileTransport error:', error);
      });
    } catch (error) {
      console.error('Failed to initialize FileTransport:', error);
    }
  }
  
  /**
   * 写入日志条目
   */
  write(entry: LogEntry): void {
    if (!this.stream) {
      this.initialize();
      if (!this.stream) {
        return;
      }
    }
    
    const output = this.formatter.format(entry) + '\n';
    const bufferSize = Buffer.byteLength(output, 'utf-8');
    
    // 检查是否需要轮转
    if (this.enableRotation && this.currentSize + bufferSize > this.maxSize) {
      this.rotate();
    }
    
    // 写入文件
    this.stream.write(output, 'utf-8');
    this.currentSize += bufferSize;
  }
  
  /**
   * 轮转日志文件
   */
  private rotate(): void {
    if (!this.stream) {
      return;
    }
    
    // 关闭当前流
    this.stream.close();
    this.stream = null;
    
    try {
      // 轮转文件
      // omms.log.4 <- omms.log.3 <- ... <- omms.log.1 <- omms.log
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const oldFile = `${this.filePath}.${i}`;
        const newFile = `${this.filePath}.${i + 1}`;
        
        if (existsSync(oldFile)) {
          if (i === this.maxFiles - 1) {
            // 删除最旧的文件
            unlinkSync(oldFile);
          } else {
            // 重命名
            renameSync(oldFile, newFile);
          }
        }
      }
      
      // 重命名当前文件
      if (existsSync(this.filePath)) {
        renameSync(this.filePath, `${this.filePath}.1`);
      }
      
      // 重置大小
      this.currentSize = 0;
      
      // 重新创建流
      this.initialize();
    } catch (error) {
      console.error('Failed to rotate log file:', error);
      // 轮转失败，重新打开原文件
      this.initialize();
    }
  }
  
  /**
   * 获取轮转信息
   */
  getRotationInfo(): RotationInfo {
    const rotatedFiles: string[] = [];
    
    for (let i = 1; i <= this.maxFiles; i++) {
      const file = `${this.filePath}.${i}`;
      if (existsSync(file)) {
        rotatedFiles.push(file);
      }
    }
    
    return {
      currentSize: this.currentSize,
      maxSize: this.maxSize,
      shouldRotate: this.currentSize >= this.maxSize * 0.9, // 90% 时准备轮转
      rotatedFiles,
    };
  }
  
  /**
   * 关闭传输
   */
  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}

/**
 * MultiTransport - 多路传输
 * 
 * 将日志同时输出到多个传输目标
 */
export class MultiTransport implements ILogTransport {
  private transports: ILogTransport[];
  
  /**
   * 创建多路传输
   * @param transports - 传输列表
   */
  constructor(transports: ILogTransport[]) {
    this.transports = transports;
  }
  
  /**
   * 添加传输
   */
  addTransport(transport: ILogTransport): void {
    if (!this.transports.includes(transport)) {
      this.transports.push(transport);
    }
  }
  
  /**
   * 移除传输
   */
  removeTransport(transport: ILogTransport): void {
    const index = this.transports.indexOf(transport);
    if (index > -1) {
      this.transports.splice(index, 1);
      transport.close();
    }
  }
  
  /**
   * 写入日志条目
   */
  write(entry: LogEntry): void {
    for (const transport of this.transports) {
      try {
        transport.write(entry);
      } catch (error) {
        console.error('Error writing to transport:', error);
      }
    }
  }
  
  /**
   * 关闭所有传输
   */
  close(): void {
    for (const transport of this.transports) {
      transport.close();
    }
    this.transports = [];
  }
  
  /**
   * 获取所有传输
   */
  getTransports(): ILogTransport[] {
    return [...this.transports];
  }
}

/**
 * 创建传输的工厂函数
 */
export function createTransport(
  type: 'console' | 'file' | 'multi',
  config?: {
    filePath?: string;
    maxSize?: string;
    maxFiles?: number;
    useColors?: boolean;
    enableRotation?: boolean;
  },
): ILogTransport {
  switch (type) {
    case 'console':
      return new ConsoleTransport(config?.useColors);
    
    case 'file': {
      if (!config?.filePath) {
        throw new Error('FileTransport requires filePath');
      }
      return new FileTransport({
        filePath: config.filePath,
        maxSize: config.maxSize,
        maxFiles: config.maxFiles,
        enableRotation: config.enableRotation,
      });
    }
    
    case 'multi': {
      const transports: ILogTransport[] = [];
      
      if (config?.filePath) {
        transports.push(
          new FileTransport({
            filePath: config.filePath,
            maxSize: config.maxSize,
            maxFiles: config.maxFiles,
            enableRotation: config.enableRotation,
          }),
        );
      }
      
      transports.push(new ConsoleTransport(config?.useColors));
      
      return new MultiTransport(transports);
    }
    
    default:
      return new ConsoleTransport();
  }
}
