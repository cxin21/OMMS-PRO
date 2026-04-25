/**
 * Plugins Module - OMMS 插件系统
 *
 * 统一管理 OMMS 的扩展插件
 *
 * @module presentation/plugins
 */

// 基础接口
export type {
  IPlugin,
  PluginManifest,
  ConfigField,
  HookDefinition,
  ToolDefinition,
} from './base/plugin';
export {
  PluginState,
  PluginType,
  HookEvent,
  PluginError,
} from './base/plugin';

// 插件注册表
export { PluginRegistry, type IPluginRegistry } from './plugin-registry';

// Claude 插件
export { ClaudePlugin, type ClaudePluginConfig } from './claude/claude-plugin';

import { PluginRegistry } from './plugin-registry';
import { ClaudePlugin } from './claude/claude-plugin';
import { config } from '../../shared/config';

/**
 * 默认插件注册表实例
 */
let defaultRegistry: PluginRegistry | null = null;

/**
 * 获取默认插件注册表
 */
export function getPluginRegistry(): PluginRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new PluginRegistry();

    // 注册内置插件
    const claudePlugin = new ClaudePlugin();
    defaultRegistry.register(claudePlugin);
  }
  return defaultRegistry;
}

/**
 * 初始化所有插件
 */
export async function initializePlugins(): Promise<void> {
  const registry = getPluginRegistry();
  await registry.initializeAll();
}

/**
 * 获取 Claude 插件
 */
export function getClaudePlugin(): ClaudePlugin {
  const registry = getPluginRegistry();
  const plugin = registry.get('omms-pro-claude-plugin');
  if (!plugin || !(plugin instanceof ClaudePlugin)) {
    throw new Error('Claude plugin not found');
  }
  return plugin;
}

/**
 * 获取插件状态
 */
export function getPluginsStatus(): ReturnType<PluginRegistry['getStatus']> {
  return getPluginRegistry().getStatus();
}
