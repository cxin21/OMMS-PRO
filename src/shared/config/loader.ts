/**
 * 配置加载器模块
 * 负责从不同源加载和合并配置
 * 
 * @module config/loader
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { OMMSConfig } from '@core/types/config';
import type { ConfigSource, LoadOptions, SaveOptions } from './types';
import { ObjectUtils } from '../utils/object';
import { FileUtils } from '../utils/file';
import { createLogger, type ILogger } from '../logging';

/**
 * 解析路径中的 ~ 符号
 */
function resolvePath(filePath: string): string {
  return FileUtils.expandTilde(filePath);
}

/**
 * ConfigLoader - 配置加载器
 * 
 * 负责从不同源加载配置并合并
 */
export class ConfigLoader {
  private readonly logger: ILogger;
  
  constructor() {
    this.logger = createLogger('config-loader');
  }
  /**
   * 从文件加载配置
   * 
   * @param filePath - 配置文件路径
   * @returns 配置对象，如果文件不存在则返回空对象
   */
  async loadFromFile(filePath?: string): Promise<Partial<OMMSConfig>> {
    const path = filePath ? resolvePath(filePath) : this.getDefaultConfigPath();
    
    if (!existsSync(path)) {
      return {};
    }
    
    try {
      const content = readFileSync(path, 'utf-8');
      const config = JSON.parse(content) as Partial<OMMSConfig>;
      
      // 基本验证
      if (typeof config !== 'object' || config === null) {
        this.logger.warn(`Invalid config file: ${path}`);
        return {};
      }
      
      return config;
    } catch (error) {
      this.logger.error(`Failed to load config from ${path}:`, error instanceof Error ? error : { error });
      return {};
    }
  }
  
  /**
   * 从环境变量加载配置
   * 
   * 支持的环境变量：
   * - OMMS_* 前缀的所有配置
   * 
   * @returns 配置对象
   */
  loadFromEnv(): Partial<OMMSConfig> {
    const config: Partial<OMMSConfig> = {};
    
    const setNestedValue = (obj: any, path: string[], value: any) => {
      let current = obj;
      for (let i = 0; i < path.length - 1; i++) {
        if (!current[path[i]]) {
          current[path[i]] = {};
        }
        current = current[path[i]];
      }
      current[path[path.length - 1]] = value;
    };

    const parseValue = (value: string): any => {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
      if (!isNaN(Number(value)) && value !== '') return Number(value);
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    };

    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('OMMS_') && value !== undefined) {
        const configKey = key.replace('OMMS_', '').toLowerCase();
        const path = configKey.split('_');
        setNestedValue(config, path, parseValue(value));
      }
    }
    
    return config;
  }
  
  /**
   * 加载默认配置
   * 从 config.default.json 文件加载（唯一默认配置源）
   *
   * @returns 默认配置对象
   * @throws 如果 config.default.json 不存在或解析失败
   */
  loadDefaults(): OMMSConfig {
    const defaultConfigPath = this.getDefaultConfigFilePath();

    if (!existsSync(defaultConfigPath)) {
      throw new Error(
        `config.default.json not found at ${defaultConfigPath}. ` +
        `This file is the single source of truth for all default configuration.`
      );
    }

    try {
      const content = readFileSync(defaultConfigPath, 'utf-8');
      const config = JSON.parse(content) as OMMSConfig;
      this.logger.debug(`Loaded default config from ${defaultConfigPath}`);
      return config;
    } catch (error) {
      throw new Error(`Failed to parse config.default.json at ${defaultConfigPath}: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * 获取默认配置文件路径（config.default.json）
   */
  private getDefaultConfigFilePath(): string {
    // 优先从项目目录查找
    const projectPath = join(process.cwd(), 'config.default.json');
    if (existsSync(projectPath)) {
      return projectPath;
    }
    // 回退到用户目录
    return join(homedir(), '.omms', 'config.default.json');
  }

  /**
   * 合并多个配置源
   * 
   * 优先级：env > file > default
   * 
   * @param configs - 配置数组
   * @returns 合并后的配置
   */
  mergeConfigs(...configs: Array<Partial<OMMSConfig>>): OMMSConfig {
    const validConfigs = configs.filter(c => c && typeof c === 'object') as Partial<OMMSConfig>[];
    
    if (validConfigs.length === 0) {
      return this.loadDefaults();
    }
    
    // 从默认配置开始合并
    const baseConfig = this.loadDefaults();
    const merged: any = ObjectUtils.merge(baseConfig as any, ...validConfigs);
    return merged as OMMSConfig;
  }
  
  /**
   * 保存配置到文件
   * 
   * @param config - 配置对象
   * @param filePath - 文件路径
   * @param options - 保存选项
   */
  async saveToFile(
    config: OMMSConfig,
    filePath?: string,
    options?: SaveOptions,
  ): Promise<void> {
    const path = filePath ? resolvePath(filePath) : this.getDefaultConfigPath();
    const pretty = options?.pretty ?? true;
    const backup = options?.backup ?? true;
    
    try {
      // 确保目录存在
      const dir = dirname(path);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      
      // 备份原文件
      if (backup && existsSync(path)) {
        const backupPath = `${path}.bak`;
        writeFileSync(backupPath, readFileSync(path, 'utf-8'), 'utf-8');
      }
      
      // 写入新配置
      const content = pretty
        ? JSON.stringify(config, null, 2)
        : JSON.stringify(config);
      
      writeFileSync(path, content, 'utf-8');
    } catch (error) {
      this.logger.error(`Failed to save config to ${path}:`, error instanceof Error ? error : { error });
      throw error;
    }
  }
  
  /**
   * 获取默认配置文件路径
   * 优先从项目目录查找，没有则使用用户目录
   * 
   * @returns 默认配置文件路径
   */
  private getDefaultConfigPath(): string {
    const projectConfigPath = join(process.cwd(), 'config.json');
    if (existsSync(projectConfigPath)) {
      return projectConfigPath;
    }
    return join(homedir(), '.omms', 'config.json');
  }
  
  /**
   * 检查配置文件是否存在
   * 
   * @param filePath - 文件路径
   * @returns 是否存在
   */
  configExists(filePath?: string): boolean {
    const path = filePath ? resolvePath(filePath) : this.getDefaultConfigPath();
    return existsSync(path);
  }
  
  /**
   * 创建默认配置文件
   * 
   * @param filePath - 文件路径
   * @returns 是否成功创建
   */
  async createDefaultConfig(filePath?: string): Promise<boolean> {
    const path = filePath ? resolvePath(filePath) : this.getDefaultConfigPath();
    
    if (this.configExists(path)) {
      return false;
    }
    
    try {
      await this.saveToFile(this.loadDefaults(), path, { pretty: true, backup: false });
      return true;
    } catch (error) {
      this.logger.error(`Failed to create default config:`, error instanceof Error ? error : { error });
      return false;
    }
  }
}
