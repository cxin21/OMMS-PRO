/**
 * 核心日志器模块
 * 实现 Logger 类，提供完整的日志记录功能
 *
 * @module logging/logger
 */
import { ConsoleTransport, FileTransport } from './transport';
import { createFormatter } from './formatter';
/**
 * 日志级别数值映射（用于比较）
 */
const LEVEL_VALUES = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
/**
 * Logger - 核心日志器类
 *
 * 实现 ILogger 接口，提供完整的日志记录功能
 * 支持多传输、格式化、上下文继承、日志轮转
 */
export class Logger {
    module;
    config;
    context;
    transports;
    formatter;
    stats;
    /**
     * 创建日志器实例
     *
     * @param module - 模块名称
     * @param config - 日志配置
     * @param parentContext - 父上下文（用于子日志器继承）
     */
    constructor(module, config, parentContext) {
        this.module = module;
        this.config = config;
        this.context = parentContext ? { ...parentContext } : {};
        this.stats = this.createInitialStats();
        // 创建格式化器
        this.formatter = createFormatter(config.format, {
            showColors: config.useColors,
        });
        // 创建传输
        this.transports = this.createTransports();
    }
    /**
     * 创建初始统计信息
     */
    createInitialStats() {
        return {
            totalEntries: 0,
            byLevel: { debug: 0, info: 0, warn: 0, error: 0 },
            byModule: {},
            fileWrites: 0,
            consoleWrites: 0,
            rotationCount: 0,
        };
    }
    /**
     * 创建传输列表
     */
    createTransports() {
        const transports = [];
        // 控制台传输
        if (this.config.enableConsole || this.config.output === 'console' || this.config.output === 'both') {
            transports.push(new ConsoleTransport(this.config.useColors, this.formatter));
        }
        // 文件传输
        if (this.config.enableFile || this.config.output === 'file' || this.config.output === 'both') {
            if (this.config.filePath) {
                transports.push(new FileTransport({
                    filePath: this.config.filePath,
                    maxSize: this.config.maxFileSize,
                    maxFiles: this.config.maxFiles,
                    enableRotation: this.config.enableRotation,
                    formatter: this.formatter,
                }));
            }
        }
        return transports;
    }
    /**
     * 记录 debug 级别日志
     */
    debug(message, data) {
        this.log('debug', message, undefined, data);
    }
    /**
     * 记录 info 级别日志
     */
    info(message, data) {
        this.log('info', message, undefined, data);
    }
    /**
     * 记录 warn 级别日志
     */
    warn(message, data) {
        this.log('warn', message, undefined, data);
    }
    /**
     * 记录 error 级别日志
     */
    error(message, errorOrData, data) {
        if (errorOrData instanceof Error) {
            this.log('error', message, errorOrData, data);
        }
        else {
            this.log('error', message, undefined, errorOrData);
        }
    }
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
    child(module, context) {
        const fullModule = `${this.module}/${module}`;
        const mergedContext = context ? { ...this.context, ...context } : this.context;
        return new Logger(fullModule, this.config, mergedContext);
    }
    /**
     * 设置上下文
     */
    setContext(context) {
        this.context = { ...this.context, ...context };
    }
    /**
     * 清除上下文
     */
    clearContext() {
        this.context = {};
    }
    /**
     * 获取统计信息
     */
    getStats() {
        return { ...this.stats };
    }
    /**
     * 内部日志方法
     *
     * @param level - 日志级别
     * @param message - 日志消息
     * @param error - 错误对象
     * @param data - 附加数据
     */
    log(level, message, error, data) {
        // 检查日志级别
        if (!this.shouldLog(level)) {
            return;
        }
        // 创建日志条目
        const entry = this.createEntry(level, message, error, data);
        // 写入传输
        this.writeToTransports(entry);
        // 更新统计
        this.updateStats(level);
    }
    /**
     * 检查是否应该记录该级别的日志
     */
    shouldLog(level) {
        const configLevel = LEVEL_VALUES[this.config.level];
        const entryLevel = LEVEL_VALUES[level];
        return entryLevel >= configLevel;
    }
    /**
     * 创建日志条目
     */
    createEntry(level, message, error, data) {
        return {
            timestamp: new Date().toISOString(),
            level,
            module: this.module,
            message,
            data,
            context: Object.keys(this.context).length > 0 ? { ...this.context } : undefined,
            error,
        };
    }
    /**
     * 写入传输
     */
    writeToTransports(entry) {
        for (const transport of this.transports) {
            try {
                transport.write(entry);
            }
            catch (error) {
                console.error('Error writing to transport:', error);
            }
        }
    }
    /**
     * 更新统计信息
     */
    updateStats(level) {
        this.stats.totalEntries++;
        this.stats.byLevel[level]++;
        if (!this.stats.byModule[this.module]) {
            this.stats.byModule[this.module] = 0;
        }
        this.stats.byModule[this.module]++;
    }
    /**
     * 关闭日志器
     */
    close() {
        for (const transport of this.transports) {
            transport.close();
        }
    }
}
/**
 * 异步日志器（支持队列缓冲）
 */
export class AsyncLogger extends Logger {
    queue = [];
    flushInterval = null;
    maxQueueSize;
    constructor(module, config, parentContext, maxQueueSize = 100) {
        super(module, config, parentContext);
        this.maxQueueSize = maxQueueSize;
        this.startFlushInterval();
    }
    /**
     * 启动定时刷新
     */
    startFlushInterval() {
        // 日志刷新间隔，默认 1000ms，必须从配置读取
        const flushIntervalMs = this.config.flushIntervalMs ?? 1000;
        this.flushInterval = setInterval(() => {
            this.flush();
        }, flushIntervalMs);
    }
    /**
     * 重写日志方法，加入队列
     */
    log(level, message, error, data) {
        if (!this.shouldLog(level)) {
            return;
        }
        const entry = this.createEntry(level, message, error, data);
        this.queue.push(entry);
        // 队列满了立即刷新
        if (this.queue.length >= this.maxQueueSize) {
            this.flush();
        }
    }
    /**
     * 刷新队列
     */
    flush() {
        if (this.queue.length === 0) {
            return;
        }
        const entries = [...this.queue];
        this.queue = [];
        for (const entry of entries) {
            this.writeToTransports(entry);
        }
    }
    /**
     * 关闭日志器
     */
    close() {
        this.flush();
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }
        super.close();
    }
}
