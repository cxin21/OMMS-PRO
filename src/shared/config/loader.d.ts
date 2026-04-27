/**
 * 配置加载器模块
 * 负责从不同源加载和合并配置
 *
 * @module config/loader
 */
import type { OMMSConfig } from '@core/types/config';
import type { SaveOptions } from './types';
/**
 * ConfigLoader - 配置加载器
 *
 * 负责从不同源加载配置并合并
 */
export declare class ConfigLoader {
    private readonly logger;
    constructor();
    /**
     * 从文件加载配置
     *
     * @param filePath - 配置文件路径
     * @returns 配置对象，如果文件不存在则返回空对象
     */
    loadFromFile(filePath?: string): Promise<Partial<OMMSConfig>>;
    /**
     * 从环境变量加载配置
     *
     * 支持的环境变量：
     * - OMMS_* 前缀的所有配置
     *
     * @returns 配置对象
     */
    loadFromEnv(): Partial<OMMSConfig>;
    /**
     * 加载默认配置
     * 从 config.default.json 文件加载（唯一默认配置源）
     *
     * @returns 默认配置对象
     * @throws 如果 config.default.json 不存在或解析失败
     */
    loadDefaults(): OMMSConfig;
    /**
     * 获取默认配置文件路径（config.default.json）
     */
    private getDefaultConfigFilePath;
    /**
     * 合并多个配置源
     *
     * 优先级：env > file > default
     *
     * @param configs - 配置数组
     * @returns 合并后的配置
     */
    mergeConfigs(...configs: Array<Partial<OMMSConfig>>): OMMSConfig;
    /**
     * 保存配置到文件
     *
     * @param config - 配置对象
     * @param filePath - 文件路径
     * @param options - 保存选项
     */
    saveToFile(config: OMMSConfig, filePath?: string, options?: SaveOptions): Promise<void>;
    /**
     * 获取默认配置文件路径
     * 优先从项目目录查找，没有则使用用户目录
     *
     * @returns 默认配置文件路径
     */
    private getDefaultConfigPath;
    /**
     * 检查配置文件是否存在
     *
     * @param filePath - 文件路径
     * @returns 是否存在
     */
    configExists(filePath?: string): boolean;
    /**
     * 创建默认配置文件
     *
     * @param filePath - 文件路径
     * @returns 是否成功创建
     */
    createDefaultConfig(filePath?: string): Promise<boolean>;
}
