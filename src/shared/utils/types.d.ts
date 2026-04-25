/**
 * Utils 模块类型定义
 * 定义所有工具函数的类型和接口
 *
 * @module utils/types
 * @since 0.1.0
 */
/**
 * ID 生成策略
 */
export type IDStrategy = 'uuid' | 'ulid' | 'snowflake' | 'timestamp';
/**
 * ID 生成器配置
 */
export interface IDGeneratorConfig {
    /** 默认生成策略 */
    defaultStrategy: IDStrategy;
    /** Snowflake 节点 ID (0-1023) */
    nodeId?: number;
    /** 前缀 */
    prefix?: string;
}
/**
 * 时间格式化选项
 */
export interface TimeFormatOptions {
    /** 时区 */
    timezone?: string;
    /** 格式模板 */
    format?: string;
    /** 是否使用相对时间 */
    relative?: boolean;
}
/**
 * 字符串截断选项
 */
export interface TruncateOptions {
    /** 最大长度 */
    maxLength: number;
    /** 后缀 */
    suffix?: string;
    /** 是否按单词截断 */
    byWord?: boolean;
}
/**
 * 对象路径访问选项
 */
export interface PathOptions {
    /** 默认值 */
    defaultValue?: unknown;
    /** 是否抛出异常 */
    throwIfMissing?: boolean;
}
/**
 * 重试配置
 */
export interface RetryConfig {
    /** 最大重试次数 */
    maxRetries: number;
    /** 基础延迟 (毫秒) */
    baseDelay: number;
    /** 最大延迟 (毫秒) */
    maxDelay: number;
    /** 退避因子 */
    factor: number;
}
/**
 * 重试选项
 */
export interface RetryOptions extends Partial<RetryConfig> {
    /** 是否应该重试 */
    shouldRetry?: (error: Error) => boolean;
    /** 重试回调 */
    onRetry?: (error: Error, attempt: number) => void;
}
/**
 * 批处理配置
 */
export interface BatchConfig {
    /** 并发数 */
    concurrency: number;
    /** 是否遇到错误停止 */
    stopOnError: boolean;
    /** 分块大小 */
    chunkSize: number;
}
/**
 * 批处理选项
 */
export interface BatchOptions extends Partial<BatchConfig> {
    /** 进度回调 */
    onProgress?: (completed: number, total: number, result?: unknown) => void;
    /** 错误回调 */
    onError?: (error: Error, index: number) => void;
}
/**
 * 加密算法类型
 */
export type CryptoAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512';
/**
 * 加密选项
 */
export interface CryptoOptions {
    /** 算法 */
    algorithm?: CryptoAlgorithm;
    /** 密钥 (用于 HMAC) */
    key?: string;
    /** 输出编码 */
    encoding?: 'hex' | 'base64';
    /** 输入编码 (用于 Buffer.from) */
    inputEncoding?: string;
    /** 输出编码 (用于 Buffer.toString) */
    outputEncoding?: string;
}
/**
 * 文件路径解析结果
 */
export interface ParsedPath {
    /** 根目录 */
    root: string;
    /** 目录 */
    dir: string;
    /** 文件名 */
    base: string;
    /** 扩展名 */
    ext: string;
    /** 文件名 (不含扩展名) */
    name: string;
}
/**
 * 文件大小单位
 */
export type FileSizeUnit = 'B' | 'KB' | 'MB' | 'GB' | 'TB' | 'PB';
/**
 * 文件大小格式化选项
 */
export interface FileSizeOptions {
    /** 小数位数 */
    decimals?: number;
    /** 单位 */
    unit?: FileSizeUnit;
    /** 是否使用二进制单位 (KiB, MiB) */
    binary?: boolean;
}
/**
 * 随机数生成选项
 */
export interface RandomOptions {
    /** 最小值 */
    min: number;
    /** 最大值 */
    max: number;
    /** 是否整数 */
    integer?: boolean;
}
/**
 * 加权随机项
 */
export interface WeightedItem<T> {
    /** 值 */
    value: T;
    /** 权重 */
    weight: number;
}
/**
 * 深拷贝选项
 */
export interface CloneOptions {
    /** 是否循环引用 */
    circular?: boolean;
    /** 自定义克隆函数 */
    customClone?: (value: unknown) => unknown | undefined;
}
/**
 * 深比较选项
 */
export interface CompareOptions {
    /** 是否严格比较 */
    strict?: boolean;
    /** 忽略的键 */
    ignoreKeys?: string[];
}
/**
 * 数组分块选项
 */
export interface ChunkOptions {
    /** 分块大小 */
    size: number;
    /** 是否填充最后一块 */
    fill?: boolean;
    /** 填充值 */
    fillValue?: unknown;
}
/**
 * 字符串哈希选项
 */
export interface StringHashOptions {
    /** 算法 */
    algorithm?: 'md5' | 'sha1' | 'sha256';
    /** 输出编码 */
    encoding?: 'hex' | 'base64';
}
/**
 * 文本清理选项
 */
export interface CleanTextOptions {
    /** 是否移除多余空白 */
    removeExtraWhitespace?: boolean;
    /** 是否移除控制字符 */
    removeControlChars?: boolean;
    /** 是否标准化引号 */
    normalizeQuotes?: boolean;
    /** 是否标准化破折号 */
    normalizeDashes?: boolean;
}
/**
 * 工具函数结果包装
 */
export interface Result<T, E = Error> {
    /** 是否成功 */
    success: boolean;
    /** 数据 (成功时) */
    data?: T;
    /** 错误 (失败时) */
    error?: E;
}
/**
 * 进度追踪器
 */
export interface ProgressTracker {
    /** 总数 */
    total: number;
    /** 已完成 */
    completed: number;
    /** 失败数 */
    failed: number;
    /** 进度百分比 */
    percentage: number;
    /** 是否完成 */
    isComplete: boolean;
}
/**
 * 延迟选项
 */
export interface DelayOptions {
    /** 是否可中断 */
    interruptible?: boolean;
    /** 中断信号 */
    signal?: AbortSignal;
}
/**
 * 超时选项
 */
export interface TimeoutOptions {
    /** 超时时间 (毫秒) */
    timeout: number;
    /** 超时错误消息 */
    message?: string;
    /** 是否抛出异常 */
    throwOnError?: boolean;
}
/**
 * 缓存选项
 */
export interface CacheOptions {
    /** 缓存键 */
    key?: string;
    /** 缓存时间 (毫秒) */
    ttl?: number;
    /** 是否检查参数 */
    checkArgs?: boolean;
}
/**
 * 函数防抖选项
 */
export interface DebounceOptions {
    /** 延迟时间 (毫秒) */
    delay: number;
    /** 是否立即执行 */
    immediate?: boolean;
}
/**
 * 函数节流选项
 */
export interface ThrottleOptions {
    /** 间隔时间 (毫秒) */
    interval: number;
    /** 是否立即执行 */
    immediate?: boolean;
}
/**
 * 工具模块配置
 */
export interface UtilsConfig {
    /** ID 生成器配置 */
    idGenerator: IDGeneratorConfig;
    /** 时间配置 */
    time: TimeFormatOptions;
    /** 重试配置 */
    retry: RetryConfig;
    /** 批处理配置 */
    batch: BatchConfig;
    /** 加密配置 */
    crypto: CryptoOptions;
    /** 缓存配置 */
    cache: CacheOptions;
}
/**
 * 默认配置
 */
export declare const DEFAULT_UTILS_CONFIG: UtilsConfig;
