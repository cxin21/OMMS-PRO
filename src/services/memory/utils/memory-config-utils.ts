/**
 * Memory Service Configuration Utils - 记忆服务配置工具
 *
 * @module memory-service/memory-config-utils
 *
 * v2.1.0
 * - 统一管理所有记忆服务配置的读取
 * - 消除硬编码默认值，所有配置必须来自 ConfigManager
 * - 消除 as any 类型断言
 */

import { config } from '../../../shared/config';
import type { MemoryStoreConfig, MemoryRecallConfig, MemoryDegradationConfig, ReinforcementConfig } from '../../../core/types/config';


/**
 * 获取 extraction timeout 配置
 * 必须从 memoryService.capture.extractionTimeout 读取
 * 如果配置未初始化，抛出错误
 */
export function getExtractionTimeout(): number {
  if (!config.isInitialized()) {
    throw new Error('ConfigManager not initialized. Cannot read memoryService.capture.extractionTimeout.');
  }
  const captureConfig = config.getConfig<{ extractionTimeout?: number }>('memoryService.capture');
  const timeout = captureConfig?.extractionTimeout;
  if (timeout === undefined) {
    throw new Error('memoryService.capture.extractionTimeout is not configured');
  }
  return timeout;
}

/**
 * 获取强化配置
 * 必须从 memoryService.reinforcement 读取
 * 如果配置未初始化或缺少必需字段，抛出错误
 */
export function getReinforcementConfig(): {
  lowBoostThreshold: number;
  mediumBoostThreshold: number;
  highBoostThreshold: number;
  lowBoost: number;
  mediumBoost: number;
  highBoost: number;
  defaultBoost: number;
  maxImportance: number;
  scopeBoost: number;
  cooldownMs: number;
} {
  if (!config.isInitialized()) {
    throw new Error('ConfigManager not initialized. Cannot read memoryService.reinforcement.');
  }
  const reinforcement = config.getConfigOrThrow<{
    lowBoostThreshold: number;
    mediumBoostThreshold: number;
    highBoostThreshold: number;
    lowBoost: number;
    mediumBoost: number;
    highBoost: number;
    defaultBoost: number;
    maxImportance: number;
    scopeBoost: number;
    cooldownMs: number;
  }>('memoryService.reinforcement');
  return reinforcement;
}

/**
 * 获取降级配置
 * 必须从 memoryService.degradation 读取
 * 如果配置未初始化，抛出错误
 */
export function getDegradationConfig(): {
  decayRate: number;
  importanceWeight: number;
  scopeWeight: number;
  deleteThreshold: number;
  archiveThreshold: number;
  protectLevel: number;
  archivedDecayMultiplier: number;
} {
  if (!config.isInitialized()) {
    throw new Error('ConfigManager not initialized. Cannot read memoryService.degradation.');
  }
  const degradation = config.getConfigOrThrow<{
    decayRate: number;
    importanceWeight: number;
    scopeWeight: number;
    deleteThreshold: number;
    archiveThreshold: number;
    protectLevel: number;
    archivedDecayMultiplier: number;
  }>('memoryService.degradation');
  return degradation;
}

/**
 * 获取作用域降级配置
 * 必须从 memoryService.scopeDegradation 读取
 * 如果配置未初始化，抛出错误
 */
export function getScopeDegradationConfig(): {
  sessionToAgentDays: number;
  agentToGlobalDays: number;
  globalToAgentDays: number;
  sessionUpgradeRecallThreshold: number;
  agentUpgradeRecallThreshold: number;
  upgradeScopeScoreMax: number;
} {
  if (!config.isInitialized()) {
    throw new Error('ConfigManager not initialized. Cannot read memoryService.scopeDegradation.');
  }
  const scopeDegradation = config.getConfigOrThrow<{
    sessionToAgentDays: number;
    agentToGlobalDays: number;
    globalToAgentDays: number;
    sessionUpgradeRecallThreshold: number;
    agentUpgradeRecallThreshold: number;
    upgradeScopeScoreMax: number;
  }>('memoryService.scopeDegradation');
  return scopeDegradation;
}

/**
 * 获取召回配置
 * 必须从 memoryService.recall 读取
 * 如果配置未初始化，抛出错误
 */
export function getRecallConfig(): {
  defaultLimit: number;
  maxLimit: number;
  enableVectorSearch: boolean;
  enableKeywordSearch: boolean;
  vectorWeight: number;
  keywordWeight: number;
  minScore: number;
  minMemories: number;
  maxMemories: number;
  minImportanceRatio: number;
  bm25K1: number;
  bm25B: number;
} {
  if (!config.isInitialized()) {
    throw new Error('ConfigManager not initialized. Cannot read memoryService.recall.');
  }
  const recallConfig = config.getConfigOrThrow<MemoryRecallConfig & {
    minMemories?: number;
    maxMemories?: number;
    minImportanceRatio?: number;
    bm25K1?: number;
    bm25B?: number;
  }>('memoryService.recall');
  return {
    defaultLimit: recallConfig.defaultLimit,
    maxLimit: recallConfig.maxLimit,
    enableVectorSearch: recallConfig.enableVectorSearch,
    enableKeywordSearch: recallConfig.enableKeywordSearch,
    vectorWeight: recallConfig.vectorWeight,
    keywordWeight: recallConfig.keywordWeight,
    minScore: recallConfig.minScore,
    minMemories: recallConfig.minMemories ?? 3,
    maxMemories: recallConfig.maxMemories ?? 20,
    minImportanceRatio: recallConfig.minImportanceRatio ?? 0.6,
    bm25K1: recallConfig.bm25K1 ?? 1.5,
    bm25B: recallConfig.bm25B ?? 0.75,
  };
}

/**
 * 获取 AAAK 预筛选配置
 * 必须从 memoryService.aaak 读取
 */
export function getAAAKConfig(): { enabled: boolean; minScore: number } {
  if (!config.isInitialized()) {
    throw new Error('ConfigManager not initialized. Cannot read memoryService.aaak.');
  }
  const aaakConfig = config.getConfig<{ enabled?: boolean; minScore?: number }>('memoryService.aaak');
  return {
    enabled: aaakConfig?.enabled ?? true,
    minScore: aaakConfig?.minScore ?? 0,
  };
}

/**
 * 获取降级时 importance 衰减系数
 * 必须从 memoryService.store.scopeDegradationDecayRate 读取
 * 如果配置未初始化，抛出错误
 */
export function getDegradationImportanceDecayRate(): number {
  if (!config.isInitialized()) {
    throw new Error('ConfigManager not initialized. Cannot read memoryService.store.scopeDegradationDecayRate.');
  }
  const storeConfig = config.getConfigOrThrow<{ scopeDegradationDecayRate: number }>('memoryService.store');
  return storeConfig.scopeDegradationDecayRate;
}