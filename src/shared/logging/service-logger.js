/**
 * 统一服务日志工厂
 * 为各核心服务提供一致的日志配置和创建方式
 *
 * @module logging/service-logger
 */
import { createLogger } from './context';
import { config } from '../config';
/**
 * 服务日志配置映射（默认值）
 * 每个服务的专用日志文件路径
 */
const DEFAULT_SERVICE_LOG_CONFIGS = {
    // Memory Services
    StorageMemoryService: { filePath: 'logs/memory-service.log' },
    MemoryStoreManager: { filePath: 'logs/memory-store.log' },
    MemoryVersionManager: { filePath: 'logs/memory-version.log' },
    MemoryRecallManager: { filePath: 'logs/memory-recall.log' },
    MemoryDegradationManager: { filePath: 'logs/memory-degradation.log' },
    MemoryCaptureService: { filePath: 'logs/memory-capture.log' },
    ConsolidationManager: { filePath: 'logs/consolidation.log' },
    // Profile Services
    ProfileManager: { filePath: 'logs/profile.log' },
    PersonaBuilder: { filePath: 'logs/profile.log' },
    PreferenceInferer: { filePath: 'logs/profile.log' },
    InteractionRecorder: { filePath: 'logs/profile.log' },
    TagManager: { filePath: 'logs/profile.log' },
    // Dreaming Services
    DreamingManager: { filePath: 'logs/dreaming.log' },
    MemoryMerger: { filePath: 'logs/dreaming.log' },
    GraphReorganizer: { filePath: 'logs/dreaming.log' },
    StorageOptimizer: { filePath: 'logs/dreaming.log' },
    DreamStorage: { filePath: 'logs/dreaming.log' },
    // Other Services
    LLMExtractor: { filePath: 'logs/llm-extractor.log' },
    HybridSearch: { filePath: 'logs/memory-recall.log' },
};
/**
 * 服务日志配置映射（运行时可配置）
 */
const SERVICE_LOG_CONFIGS = { ...DEFAULT_SERVICE_LOG_CONFIGS };
/**
 * 从配置初始化服务日志配置
 * 允许通过配置文件覆盖默认的日志路径
 */
function initializeServiceLogConfigs() {
    try {
        const serviceLogsConfig = config.getConfig('logging.services');
        if (serviceLogsConfig) {
            for (const [serviceName, filePath] of Object.entries(serviceLogsConfig)) {
                if (typeof filePath === 'string') {
                    SERVICE_LOG_CONFIGS[serviceName] = { filePath };
                }
            }
        }
    }
    catch {
        // 配置未初始化或不存在，使用默认配置
    }
}
// 尝试在模块加载时初始化配置（但不会阻塞）
initializeServiceLogConfigs();
/**
 * 基础日志配置（所有服务共享）
 * 注意：level 默认值是 'info'，实际级别从 ConfigManager 读取
 */
const BASE_SERVICE_CONFIG = {
    output: 'both',
    enableConsole: true,
    enableFile: true,
    enableRotation: true,
    maxFileSize: '50MB',
    maxFiles: 10,
};
/**
 * 获取日志级别配置
 * 从 ConfigManager 读取 logging.level，默认为 'info'
 */
function getLogLevel() {
    try {
        if (config.isInitialized()) {
            const loggingConfig = config.getConfig('logging');
            if (loggingConfig?.level) {
                return loggingConfig.level;
            }
        }
    }
    catch {
        // 配置读取失败，使用默认值
    }
    return 'info';
}
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
        level: getLogLevel(), // 从 ConfigManager 读取日志级别
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
/**
 * 刷新服务日志配置
 * 重新从 ConfigManager 读取 logging.services 配置
 * 用于配置更新后刷新日志设置
 *
 * @returns 是否成功刷新
 */
export function refreshServiceLogConfigs() {
    try {
        if (!config.isInitialized()) {
            return false;
        }
        initializeServiceLogConfigs();
        return true;
    }
    catch {
        return false;
    }
}
/**
 * 获取当前日志级别
 * 动态获取当前配置，不使用缓存
 *
 * @returns 当前日志级别
 */
export function getCurrentLogLevel() {
    return getLogLevel();
}
