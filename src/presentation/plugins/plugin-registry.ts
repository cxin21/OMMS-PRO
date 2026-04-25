/**
 * Plugin Registry - 插件注册表
 *
 * 统一管理所有 OMMS 插件
 *
 * @module presentation/plugins
 */

import { createLogger, type ILogger } from '../../shared/logging';
import {
  IPlugin,
  PluginManifest,
  PluginState,
  PluginType,
  PluginError,
} from './base/plugin';

/**
 * 插件注册表接口
 */
export interface IPluginRegistry {
  /** 注册插件 */
  register(plugin: IPlugin): void;

  /** 注销插件 */
  unregister(pluginId: string): void;

  /** 获取插件 */
  get(pluginId: string): IPlugin | undefined;

  /** 获取所有插件 */
  getAll(): IPlugin[];

  /** 获取指定类型的插件 */
  getByType(type: PluginType): IPlugin[];

  /** 启用插件 */
  enable(pluginId: string): Promise<void>;

  /** 禁用插件 */
  disable(pluginId: string): Promise<void>;

  /** 初始化所有插件 */
  initializeAll(): Promise<void>;
}

/**
 * 插件注册表
 */
export class PluginRegistry implements IPluginRegistry {
  private logger: ILogger;
  private plugins: Map<string, IPlugin> = new Map();
  private initialized: boolean = false;

  constructor() {
    this.logger = createLogger('plugin-registry');
  }

  /**
   * 注册插件
   */
  register(plugin: IPlugin): void {
    const manifest = plugin.getManifest();

    if (this.plugins.has(manifest.id)) {
      throw new PluginError(`Plugin ${manifest.id} already registered`, manifest.id);
    }

    this.plugins.set(manifest.id, plugin);
    this.logger.info('Plugin registered', {
      id: manifest.id,
      name: manifest.name,
      type: manifest.type,
    });
  }

  /**
   * 注销插件
   */
  unregister(pluginId: string): void {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new PluginError(`Plugin ${pluginId} not found`, pluginId);
    }

    this.plugins.delete(pluginId);
    this.logger.info('Plugin unregistered', { pluginId });
  }

  /**
   * 获取插件
   */
  get(pluginId: string): IPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * 获取所有插件
   */
  getAll(): IPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 获取指定类型的插件
   */
  getByType(type: PluginType): IPlugin[] {
    return this.getAll().filter(p => p.getManifest().type === type);
  }

  /**
   * 启用插件
   */
  async enable(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new PluginError(`Plugin ${pluginId} not found`, pluginId);
    }

    const state = plugin.getState();
    if (state === PluginState.ENABLED) {
      this.logger.debug('Plugin already enabled', { pluginId });
      return;
    }

    if (state !== PluginState.INSTALLED && state !== PluginState.DISABLED) {
      throw new PluginError(
        `Cannot enable plugin in state: ${state}`,
        pluginId
      );
    }

    await plugin.enable();
    this.logger.info('Plugin enabled', { pluginId });
  }

  /**
   * 禁用插件
   */
  async disable(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new PluginError(`Plugin ${pluginId} not found`, pluginId);
    }

    const state = plugin.getState();
    if (state === PluginState.DISABLED) {
      this.logger.debug('Plugin already disabled', { pluginId });
      return;
    }

    if (state !== PluginState.ENABLED) {
      throw new PluginError(
        `Cannot disable plugin in state: ${state}`,
        pluginId
      );
    }

    await plugin.disable();
    this.logger.info('Plugin disabled', { pluginId });
  }

  /**
   * 初始化所有已安装的插件
   */
  async initializeAll(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('Plugin registry already initialized');
      return;
    }

    this.logger.info('Initializing all plugins...');

    for (const plugin of this.plugins.values()) {
      try {
        await plugin.initialize();
        this.logger.debug('Plugin initialized', {
          id: plugin.getManifest().id,
        });
      } catch (error) {
        this.logger.error('Failed to initialize plugin', {
          id: plugin.getManifest().id,
          error: String(error),
        });
      }
    }

    this.initialized = true;
    this.logger.info('All plugins initialized', {
      count: this.plugins.size,
    });
  }

  /**
   * 获取插件状态概览
   */
  getStatus(): {
    total: number;
    byType: Record<string, number>;
    byState: Record<string, number>;
  } {
    const byType: Record<string, number> = {};
    const byState: Record<string, number> = {};

    for (const plugin of this.plugins.values()) {
      const manifest = plugin.getManifest();
      const state = plugin.getState();

      byType[manifest.type] = (byType[manifest.type] || 0) + 1;
      byState[state] = (byState[state] || 0) + 1;
    }

    return {
      total: this.plugins.size,
      byType,
      byState,
    };
  }
}
