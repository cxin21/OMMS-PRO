/**
 * 配置管理器模块
 * 核心配置管理类，实现单例模式
 *
 * @module config/config-manager
 */
import type { OMMSConfig } from '@core/types/config';
import type { IConfigManager, ConfigChangeListener, ValidationResult } from './types';
/**
 * ConfigManager - 配置管理器（单例模式）
 *
 * 核心配置管理类，实现 IConfigManager 接口
 * 负责加载、验证、存储、更新配置
 */
export declare class ConfigManager implements IConfigManager {
    private static instance;
    private config;
    private configPath;
    private loader;
    private validator;
    private listeners;
    private logger;
    private initialized;
    private static readonly MAX_HISTORY_SIZE;
    private configHistory;
    /**
     * 私有构造函数（单例模式）
     */
    private constructor();
    /**
     * 获取单例实例
     */
    static getInstance(): ConfigManager;
    /**
     * 初始化配置管理器
     *
     * 这是系统初始化时第一个调用的方法
     * 在这里会加载配置并初始化日志
     *
     * @param configPath - 配置文件路径（可选）
     */
    initialize(configPath?: string): Promise<void>;
    /**
     * 初始化日志服务
     *
     * 使用配置中的 logging 配置初始化 Logging Service
     * 这是解决循环依赖的关键步骤
     */
    private initializeLogging;
    /**
     * 获取配置
     *
     * @param path - 配置路径（如 'palace.basePath'）
     * @returns 配置值
     */
    getConfig<T = unknown>(path?: string): T;
    /**
     * 获取配置（必须存在）
     * 如果 ConfigManager 未初始化或路径不存在则抛出错误
     *
     * @param path - 配置路径（如 'memoryService.forget'）
     * @returns 配置值
     */
    getConfigOrThrow<T = unknown>(path: string): T;
    /**
     * 更新配置
     *
     * @param path - 配置路径
     * @param value - 新值
     * @param persist - 是否持久化（默认 true）
     */
    updateConfig(path: string, value: unknown, persist?: boolean): Promise<void>;
    /**
     * 重置配置
     *
     * @param path - 配置路径（不传则重置所有）
     */
    resetConfig(path?: string): Promise<void>;
    /**
     * 验证配置
     */
    validateConfig(): ValidationResult;
    /**
     * 监听配置变更
     */
    onConfigChange(listener: ConfigChangeListener): void;
    /**
     * 移除监听器
     */
    offConfigChange(listener: ConfigChangeListener): void;
    /**
     * 获取配置快照
     */
    getConfigSnapshot(): OMMSConfig;
    /**
     * 导出配置到文件
     */
    exportConfig(): Promise<void>;
    /**
     * 从文件导入配置
     */
    importConfig(config: OMMSConfig): Promise<void>;
    /**
     * 检查是否已初始化
     */
    isInitialized(): boolean;
    /**
     * 获取日志器
     */
    private getLogger;
    /**
     * 保存配置到文件
     */
    private saveConfig;
    /**
     * 通知监听器
     */
    private notifyListeners;
    /**
     * 获取默认配置文件路径
     * 优先从项目目录查找，没有则使用用户目录
     */
    private getDefaultConfigPath;
    /**
     * 获取配置历史记录
     */
    getConfigHistory(): typeof this.configHistory;
    /**
     * 清除配置历史
     */
    clearConfigHistory(): void;
}
