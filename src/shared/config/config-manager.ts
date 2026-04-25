/**
 * 配置管理器模块
 * 核心配置管理类，实现单例模式
 * 
 * @module config/config-manager
 */

import type { OMMSConfig } from '@core/types/config';
import type {
  IConfigManager,
  ConfigSource,
  ConfigChangeEvent,
  ConfigChangeListener,
  ValidationResult,
} from './types';
import { ConfigLoader } from './loader';
import { ConfigValidator } from './validator';
import { PathUtils } from './path-utils';
import { createLogger, type ILogger } from '@shared/logging';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

/**
 * ConfigManager - 配置管理器（单例模式）
 * 
 * 核心配置管理类，实现 IConfigManager 接口
 * 负责加载、验证、存储、更新配置
 */
export class ConfigManager implements IConfigManager {
  private static instance: ConfigManager;
  private config: OMMSConfig | null = null;
  private configPath: string = '';
  private loader: ConfigLoader;
  private validator: ConfigValidator;
  private listeners: ConfigChangeListener[] = [];
  private logger: ILogger;
  private initialized = false;
  // 配置历史记录最大条数，防止内存无限增长
  private static readonly MAX_HISTORY_SIZE = 1000;

  private configHistory: Array<{
    timestamp: string;
    source: ConfigSource;
    changes: Array<{ path: string; oldValue: unknown; newValue: unknown }>;
  }> = [];
  
  /**
   * 私有构造函数（单例模式）
   */
  private constructor() {
    this.loader = new ConfigLoader();
    this.validator = new ConfigValidator();
    this.logger = createLogger('config-manager');
  }
  
  /**
   * 获取单例实例
   */
  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }
  
  /**
   * 初始化配置管理器
   * 
   * 这是系统初始化时第一个调用的方法
   * 在这里会加载配置并初始化日志
   * 
   * @param configPath - 配置文件路径（可选）
   */
  async initialize(configPath?: string): Promise<void> {
    if (this.initialized) {
      this.logger.warn('ConfigManager already initialized');
      return;
    }
    
    this.configPath = configPath || '';
    
    // 1. 加载默认配置
    this.logger.info('Loading default configuration...');
    let config = this.loader.loadDefaults();
    
    // 2. 加载文件配置
    const fileConfigPath = configPath || this.getDefaultConfigPath();
    this.logger.info(`Loading configuration from ${fileConfigPath}...`);
    const fileConfig = await this.loader.loadFromFile(fileConfigPath);
    if (Object.keys(fileConfig).length > 0) {
      config = this.loader.mergeConfigs(config, fileConfig);
      this.logger.info('File configuration loaded', {
        keys: Object.keys(fileConfig),
      });
    } else {
      this.logger.info('No file configuration found, using defaults');
    }
    
    // 3. 加载环境变量配置
    this.logger.info('Loading environment variables...');
    const envConfig = this.loader.loadFromEnv();
    if (Object.keys(envConfig).length > 0) {
      config = this.loader.mergeConfigs(config, envConfig);
      this.logger.info('Environment configuration loaded', {
        keys: Object.keys(envConfig),
      });
    }
    
    // 4. 验证配置
    this.logger.info('Validating configuration...');
    const validationResult = this.validator.validate(config);
    
    if (!validationResult.valid) {
      const error = new Error(`Configuration validation failed: ${validationResult.errors.join(', ')}`);
      this.logger.error('Configuration validation failed', {
        errors: validationResult.errors,
        warnings: validationResult.warnings,
      });
      throw error;
    }
    
    if (validationResult.warnings.length > 0) {
      this.logger.warn('Configuration warnings', {
        warnings: validationResult.warnings,
      });
    }
    
    // 5. 保存配置
    this.config = config;
    
    // 6. ⭐ 初始化日志（使用配置中的 logging 配置）
    this.logger.info('Initializing logging service...');
    await this.initializeLogging();
    
    // 7. 记录初始化完成（现在可以使用正式日志了）
    this.logger.info(
      'ConfigManager initialized successfully',
      {
        configPath: fileConfigPath,
        hasFileConfig: Object.keys(fileConfig).length > 0,
        hasEnvConfig: Object.keys(envConfig).length > 0,
      },
    );
    
    this.initialized = true;
  }
  
  /**
   * 初始化日志服务
   * 
   * 使用配置中的 logging 配置初始化 Logging Service
   * 这是解决循环依赖的关键步骤
   */
  private async initializeLogging(): Promise<void> {
    try {
      // 动态导入 logging 模块（避免循环依赖）
      const { createLogger } = await import('@shared/logging/index.js');
      
      if (!this.config) {
        throw new Error('Configuration not loaded');
      }
      
      // 使用配置初始化日志
      const logger = createLogger('ConfigManager', {
        ...this.config.logging,
      });
      
      this.logger = logger;
      
      logger.debug('Logging service initialized', {
        level: this.config.logging.level,
        output: this.config.logging.output,
        filePath: this.config.logging.filePath,
      });
    } catch (error) {
      // 如果 logging 模块不可用，继续使用当前 logger
      this.logger.warn('Failed to initialize logging service, using default logger', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }
  
  /**
   * 获取配置
   * 
   * @param path - 配置路径（如 'palace.basePath'）
   * @returns 配置值
   */
  getConfig<T = unknown>(path?: string): T {
    if (!this.initialized) {
      throw new Error('ConfigManager not initialized');
    }

    if (!path) {
      return this.config as T;
    }

    return PathUtils.getByPath(this.config, path) as T;
  }

  /**
   * 获取配置（必须存在）
   * 如果 ConfigManager 未初始化或路径不存在则抛出错误
   *
   * @param path - 配置路径（如 'memoryService.forget'）
   * @returns 配置值
   */
  getConfigOrThrow<T = unknown>(path: string): T {
    if (!this.initialized || !this.config) {
      throw new Error(
        `ConfigManager not initialized. Call initialize() before accessing '${path}'. ` +
        `Services must not be constructed before config init.`
      );
    }

    const value = PathUtils.getByPath(this.config, path);
    if (value === undefined || value === null) {
      throw new Error(
        `Config path '${path}' not found in configuration. Ensure config.default.json contains this key.`
      );
    }
    return value as T;
  }

  /**
   * 更新配置
   * 
   * @param path - 配置路径
   * @param value - 新值
   * @param persist - 是否持久化（默认 true）
   */
  async updateConfig(path: string, value: unknown, persist = true): Promise<void> {
    if (!this.initialized) {
      throw new Error('ConfigManager not initialized');
    }
    
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }
    
    const oldValue = PathUtils.getByPath(this.config, path);
    
    // 验证新值
    const validation = this.validator.validatePath(path, value);
    if (!validation.valid) {
      const error = new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
      this.logger.error(
        'Configuration update validation failed',
        { path, value, errors: validation.errors },
      );
      throw error;
    }
    
    // 应用更新
    PathUtils.setByPath(this.config as unknown as Record<string, unknown>, path, value);
    
    // 记录变更
    const changeEvent: ConfigChangeEvent = {
      path,
      oldValue,
      newValue: value,
      source: 'runtime',
      timestamp: new Date().toISOString(),
    };
    
    // 添加到历史记录
    this.configHistory.push({
      timestamp: changeEvent.timestamp,
      source: 'runtime',
      changes: [{ path, oldValue, newValue: value }],
    });

    // 防止历史记录无限增长，超出最大限制时删除旧记录
    if (this.configHistory.length > ConfigManager.MAX_HISTORY_SIZE) {
      const removeCount = this.configHistory.length - ConfigManager.MAX_HISTORY_SIZE;
      this.configHistory.splice(0, removeCount);
      this.logger.debug('Trimmed old config history entries', { removeCount });
    }
    
    // 通知监听器
    this.notifyListeners(changeEvent);
    
    // 持久化
    if (persist) {
      await this.saveConfig();
    }
    
    this.logger.info(
      'Configuration updated',
      { path, value, persisted: persist },
    );
  }
  
  /**
   * 重置配置
   * 
   * @param path - 配置路径（不传则重置所有）
   */
  async resetConfig(path?: string): Promise<void> {
    if (!this.initialized) {
      throw new Error('ConfigManager not initialized');
    }
    
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }
    
    const defaultConfig = this.loader.loadDefaults();
    
    if (!path) {
      // 重置所有配置
      const oldConfig = this.config;
      this.config = defaultConfig;
      
      const changeEvent: ConfigChangeEvent = {
        path: '*',
        oldValue: oldConfig,
        newValue: defaultConfig,
        source: 'default',
        timestamp: new Date().toISOString(),
      };
      
      this.notifyListeners(changeEvent);
      await this.saveConfig();
      
      this.logger.info('Configuration reset to defaults');
    } else {
      // 重置特定路径
      const oldValue = PathUtils.getByPath(this.config, path);
      const newValue = PathUtils.getByPath(defaultConfig, path);
      
      PathUtils.setByPath(this.config as unknown as Record<string, unknown>, path, newValue);
      
      const changeEvent: ConfigChangeEvent = {
        path,
        oldValue,
        newValue,
        source: 'default',
        timestamp: new Date().toISOString(),
      };
      
      this.notifyListeners(changeEvent);
      await this.saveConfig();
      
      this.logger.info('Configuration path reset', { path, oldValue, newValue });
    }
  }
  
  /**
   * 验证配置
   */
  validateConfig(): ValidationResult {
    if (!this.initialized || !this.config) {
      return {
        valid: false,
        errors: ['Configuration not initialized'],
        warnings: [],
      };
    }
    
    return this.validator.validate(this.config);
  }
  
  /**
   * 监听配置变更
   */
  onConfigChange(listener: ConfigChangeListener): void {
    if (!this.listeners.includes(listener)) {
      this.listeners.push(listener);
    }
  }
  
  /**
   * 移除监听器
   */
  offConfigChange(listener: ConfigChangeListener): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }
  
  /**
   * 获取配置快照
   */
  getConfigSnapshot(): OMMSConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }
    
    // 返回深拷贝
    return JSON.parse(JSON.stringify(this.config));
  }
  
  /**
   * 导出配置到文件
   */
  async exportConfig(): Promise<void> {
    if (!this.initialized || !this.config) {
      throw new Error('Configuration not loaded');
    }
    
    await this.loader.saveToFile(this.config, this.configPath || undefined, {
      pretty: true,
      backup: true,
    });
    
    this.logger.info('Configuration exported', { path: this.configPath });
  }
  
  /**
   * 从文件导入配置
   */
  async importConfig(config: OMMSConfig): Promise<void> {
    if (!this.initialized) {
      throw new Error('ConfigManager not initialized');
    }
    
    // 验证新配置
    const validation = this.validator.validate(config);
    if (!validation.valid) {
      throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
    }
    
    const oldConfig = this.config;
    this.config = config;
    
    const changeEvent: ConfigChangeEvent = {
      path: '*',
      oldValue: oldConfig,
      newValue: config,
      source: 'file',
      timestamp: new Date().toISOString(),
    };
    
    this.notifyListeners(changeEvent);
    await this.saveConfig();
    
    this.logger.info('Configuration imported', { changes: Object.keys(config) });
  }
  
  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }
  
  /**
   * 获取日志器
   */
  private getLogger(): ILogger {
    return this.logger;
  }
  
  /**
   * 保存配置到文件
   */
  private async saveConfig(): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }
    
    try {
      await this.loader.saveToFile(this.config, this.configPath || undefined, {
        pretty: true,
        backup: true,
      });
    } catch (error) {
      this.logger.error('Failed to save configuration', { error });
      // 不抛出异常，避免影响正常使用
    }
  }
  
  /**
   * 通知监听器
   */
  private notifyListeners(event: ConfigChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error('Error in config change listener', { error, path: event.path });
      }
    }
  }
  
  /**
   * 获取默认配置文件路径
   * 优先从项目目录查找，没有则使用用户目录
   */
  private getDefaultConfigPath(): string {
    const projectConfigPath = join(process.cwd(), 'config.json');
    if (existsSync(projectConfigPath)) {
      return projectConfigPath;
    }
    return join(homedir(), '.omms', 'config.json');
  }
  
  /**
   * 获取配置历史记录
   */
  getConfigHistory(): typeof this.configHistory {
    return [...this.configHistory];
  }
  
  /**
   * 清除配置历史
   */
  clearConfigHistory(): void {
    this.configHistory = [];
  }
}
