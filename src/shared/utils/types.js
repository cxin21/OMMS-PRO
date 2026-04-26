/**
 * Utils 模块类型定义
 * 定义所有工具函数的类型和接口
 *
 * @module utils/types
 * @since 0.1.0
 */
/**
 * 默认配置
 */
export const DEFAULT_UTILS_CONFIG = {
    idGenerator: {
        defaultStrategy: 'ulid',
        nodeId: 1,
    },
    time: {
        timezone: 'Asia/Shanghai',
        format: 'YYYY-MM-DD HH:mm:ss',
    },
    retry: {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        factor: 2,
    },
    batch: {
        concurrency: 5,
        stopOnError: false,
        chunkSize: 100,
    },
    crypto: {
        algorithm: 'sha256',
        encoding: 'hex',
    },
    cache: {
        ttl: 300000, // 5 分钟
        checkArgs: true,
    },
};
