/**
 * Config Manager 类型定义
 * 定义配置管理的所有类型和接口
 *
 * @module config/types
 */
import type { OMMSConfig, LogLevel, LLMProvider } from '@core/types/config';
/**
 * 日志级别
 * @deprecated 已从 config.ts 导入
 */
export type DeprecatedLoggingLevel = LogLevel;
/**
 * LLM 提供商
 * @deprecated 已从 config.ts 导入
 */
export type DeprecatedLLMProvider = LLMProvider;
/**
 * 元数据增强提供商
 * @deprecated 此类型已移除
 */
export type DeprecatedMetadataEnrichmentProvider = string;
/**
 * 配置源类型
 *
 * default - 默认配置
 * file - 文件配置
 * env - 环境变量配置
 * runtime - 运行时配置
 */
export type ConfigSource = 'default' | 'file' | 'env' | 'runtime';
/**
 * 配置项定义
 *
 * 包含配置值、来源和状态信息
 */
export interface ConfigItem<T = unknown> {
    value: T;
    source: ConfigSource;
    isDefault: boolean;
    isModified: boolean;
}
/**
 * 配置验证规则
 *
 * 用于验证配置项的有效性
 */
export interface ValidationRule<T = unknown> {
    name: string;
    validate: (value: T, config: unknown) => boolean;
    message: string;
    required?: boolean;
}
/**
 * 配置验证结果
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}
/**
 * 配置变更事件
 *
 * 当配置发生变化时触发
 */
export interface ConfigChangeEvent {
    path: string;
    oldValue: unknown;
    newValue: unknown;
    source: ConfigSource;
    timestamp: string;
}
/**
 * 配置监听器函数
 */
export type ConfigChangeListener = (event: ConfigChangeEvent) => void;
/**
 * 配置管理器接口
 *
 * 所有配置管理器必须实现的接口
 */
export interface IConfigManager {
    /**
     * 初始化配置管理器
     * @param configPath - 配置文件路径
     */
    initialize(configPath?: string): Promise<void>;
    /**
     * 获取配置
     * @param path - 配置路径（如 'palace.basePath'）
     */
    getConfig<T = unknown>(path?: string): T;
    /**
     * 获取配置（必须存在）
     * 如果 ConfigManager 未初始化或路径不存在则抛出错误
     * @param path - 配置路径
     */
    getConfigOrThrow<T = unknown>(path: string): T;
    /**
     * 更新配置
     * @param path - 配置路径
     * @param value - 新值
     * @param persist - 是否持久化
     */
    updateConfig(path: string, value: unknown, persist?: boolean): Promise<void>;
    /**
     * 重置配置
     * @param path - 配置路径（不传则重置所有）
     */
    resetConfig(path?: string): Promise<void>;
    /**
     * 验证配置
     */
    validateConfig(): ValidationResult;
    /**
     * 监听配置变更
     * @param listener - 监听器函数
     */
    onConfigChange(listener: ConfigChangeListener): void;
    /**
     * 移除监听器
     * @param listener - 监听器函数
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
     * @param config - 配置对象
     */
    importConfig(config: OMMSConfig): Promise<void>;
    /**
     * 检查是否已初始化
     */
    isInitialized(): boolean;
}
/**
 * 配置加载选项
 */
export interface LoadOptions {
    /** 是否使用默认配置 */
    useDefaults?: boolean;
    /** 是否加载文件配置 */
    loadFile?: boolean;
    /** 是否加载环境变量 */
    loadEnv?: boolean;
    /** 是否验证配置 */
    validate?: boolean;
}
/**
 * 配置保存选项
 */
export interface SaveOptions {
    /** 是否格式化 JSON */
    pretty?: boolean;
    /** 是否备份原文件 */
    backup?: boolean;
}
/**
 * 配置路径元数据
 */
export interface ConfigPathMetadata {
    /** 完整路径数组 */
    pathArray: string[];
    /** 父路径 */
    parentPath: string;
    /** 键名 */
    key: string;
    /** 是否是根路径 */
    isRoot: boolean;
}
