/**
 * 统一服务日志工厂
 * 为各核心服务提供一致的日志配置和创建方式
 *
 * @module logging/service-logger
 */
import { createLogger } from './context';
/**
 * 服务日志配置映射
 * 每个服务的专用日志文件路径
 */
const SERVICE_LOG_CONFIGS = {
    MemoryCaptureService: { filePath: 'logs/memory-capture.log' },
    MemoryRecallManager: { filePath: 'logs/memory-recall.log' },
    DreamingManager: { filePath: 'logs/dreaming.log' },
    LLMExtractor: { filePath: 'logs/llm-extractor.log' },
    ProfileManager: { filePath: 'logs/profile.log' },
};
/**
 * 基础日志配置（所有服务共享）
 */
const BASE_SERVICE_CONFIG = {
    level: 'info',
    output: 'both',
    enableConsole: true,
    enableFile: true,
    enableRotation: true,
    maxFileSize: '50MB',
    maxFiles: 10,
};
/**
 * 创建服务日志器
 *
 * 统一的服务日志创建函数，自动应用：
 * - 一致的日志级别（info）
 * - 文件 + 控制台双输出
 * - 日志轮转（50MB x 10 文件）
 * - 服务专用日志文件
 *
 * @param serviceName - 服务名称
 * @param overrides - 可选的配置覆盖
 * @returns ILogger 实例
 *
 * @example
 * ```typescript
 * const logger = createServiceLogger('MemoryCaptureService');
 * logger.info('Capture started', { agentId: 'claude-code' });
 *
 * // 覆盖默认配置（如调试时临时开启 debug 级别）
 * const debugLogger = createServiceLogger('MemoryCaptureService', { level: 'debug' });
 * ```
 */
export function createServiceLogger(serviceName, overrides) {
    const serviceConfig = SERVICE_LOG_CONFIGS[serviceName];
    const config = {
        ...BASE_SERVICE_CONFIG,
        ...(serviceConfig || {}),
        ...overrides,
    };
    return createLogger(serviceName, config);
}
/**
 * 注册新的服务日志配置
 *
 * @param serviceName - 服务名称
 * @param filePath - 日志文件路径
 */
export function registerServiceLogConfig(serviceName, filePath) {
    SERVICE_LOG_CONFIGS[serviceName] = { filePath };
}
