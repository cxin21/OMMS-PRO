/**
 * Config Layer - 配置层统一导出
 *
 * 提供：
 * - ConfigPaths: 配置路径常量
 * - ConfigDefaults: 配置默认值常量
 * - config: 配置管理器单例
 */

import { config } from '../shared/config';
import { ConfigPaths } from './paths';
import { ConfigDefaults, Defaults, MemoryDefaults, LLMDefaults, EmbeddingDefaults, StreamingDefaults, ONE_DAY_MS, ONE_HOUR_MS } from './defaults';
import type { IConfigManager } from '../shared/config/types';

// 重新导出配置管理器单例
export { config };

// 重新导出路径常量
export { ConfigPaths };
export type { ConfigPath, MemoryConfigPath } from './paths';

// 重新导出默认值常量
export { ConfigDefaults, Defaults, MemoryDefaults, LLMDefaults, EmbeddingDefaults, StreamingDefaults, ONE_DAY_MS, ONE_HOUR_MS };
export type { DefaultKey } from './defaults';

/**
 * 安全获取配置值（带默认值）
 */
export function getConfig<T>(path: string, defaultValue?: T): T | undefined {
  const value = config.getConfig<T>(path);
  return value ?? defaultValue;
}

/**
 * 安全获取配置值（不存在则抛错）
 */
export function getConfigOrThrow<T>(path: string): T {
  return config.getConfigOrThrow<T>(path);
}

/**
 * 检查配置是否已初始化
 */
export function isConfigInitialized(): boolean {
  return config.isInitialized();
}

/**
 * 获取配置管理器实例
 */
export function getConfigManager(): IConfigManager {
  return config;
}
