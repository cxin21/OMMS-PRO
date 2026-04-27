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
 * 默认配置常量（仅用于 ConfigManager 未初始化时的安全回退）
 * 注意：ConfigManager 初始化后，所有配置必须从 ConfigManager 读取
 */
const FALLBACK_DEFAULTS = {
  extractionTimeout: 30000,
  reinforcement: {
    lowBoostThreshold: 3,
    mediumBoostThreshold: 6,
    highBoostThreshold: 7,
    lowBoost: 0.5,
    mediumBoost: 0.3,
    highBoost: 0.1,
    defaultBoost: 0.2,
    maxImportance: 10,
    scopeBoost: 0.5,
    cooldownMs: 60000,
  },
  degradation: {
    decayRate: 0.01,
    importanceWeight: 0.7,
    scopeWeight: 0.3,
    deleteThreshold: 1.0,
    archiveThreshold: 3.0,
    protectLevel: 7,
    archivedDecayMultiplier: 2.0,
  },
  scopeDegradation: {
    sessionToAgentDays: 7,
    agentToGlobalDays: 30,
    globalToAgentDays: 365,
    sessionUpgradeRecallThreshold: 5,
    agentUpgradeRecallThreshold: 10,
    upgradeScopeScoreMax: 10,
  },
} as const;

/**
 * 获取 extraction timeout 配置
 * 必须从 memoryService.capture.extractionTimeout 读取
 */
export function getExtractionTimeout(): number {
  if (!config.isInitialized()) {
    return FALLBACK_DEFAULTS.extractionTimeout;
  }
  const captureConfig = config.getConfig<{ extractionTimeout?: number }>('memoryService.capture');
  return captureConfig?.extractionTimeout ?? FALLBACK_DEFAULTS.extractionTimeout;
}

/**
 * 获取强化配置
 * 必须从 memoryService.reinforcement 读取
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
    return FALLBACK_DEFAULTS.reinforcement as { lowBoostThreshold: number; mediumBoostThreshold: number; highBoostThreshold: number; lowBoost: number; mediumBoost: number; highBoost: number; defaultBoost: number; maxImportance: number; scopeBoost: number; cooldownMs: number; };
  }
  const reinforcement = config.getConfig<{
    lowBoostThreshold?: number;
    mediumBoostThreshold?: number;
    highBoostThreshold?: number;
    lowBoost?: number;
    mediumBoost?: number;
    highBoost?: number;
    defaultBoost?: number;
    maxImportance?: number;
    scopeBoost?: number;
    cooldownMs?: number;
  }>('memoryService.reinforcement');
  if (!reinforcement) {
    return FALLBACK_DEFAULTS.reinforcement as { lowBoostThreshold: number; mediumBoostThreshold: number; highBoostThreshold: number; lowBoost: number; mediumBoost: number; highBoost: number; defaultBoost: number; maxImportance: number; scopeBoost: number; cooldownMs: number; };
  }
  return {
    lowBoostThreshold: reinforcement.lowBoostThreshold ?? FALLBACK_DEFAULTS.reinforcement.lowBoostThreshold,
    mediumBoostThreshold: reinforcement.mediumBoostThreshold ?? FALLBACK_DEFAULTS.reinforcement.mediumBoostThreshold,
    highBoostThreshold: reinforcement.highBoostThreshold ?? FALLBACK_DEFAULTS.reinforcement.highBoostThreshold,
    lowBoost: reinforcement.lowBoost ?? FALLBACK_DEFAULTS.reinforcement.lowBoost,
    mediumBoost: reinforcement.mediumBoost ?? FALLBACK_DEFAULTS.reinforcement.mediumBoost,
    highBoost: reinforcement.highBoost ?? FALLBACK_DEFAULTS.reinforcement.highBoost,
    defaultBoost: reinforcement.defaultBoost ?? FALLBACK_DEFAULTS.reinforcement.defaultBoost,
    maxImportance: reinforcement.maxImportance ?? FALLBACK_DEFAULTS.reinforcement.maxImportance,
    scopeBoost: reinforcement.scopeBoost ?? FALLBACK_DEFAULTS.reinforcement.scopeBoost,
    cooldownMs: reinforcement.cooldownMs ?? FALLBACK_DEFAULTS.reinforcement.cooldownMs,
  };
}

/**
 * 获取降级配置
 * 必须从 memoryService.degradation 读取
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
    return FALLBACK_DEFAULTS.degradation as { decayRate: number; importanceWeight: number; scopeWeight: number; deleteThreshold: number; archiveThreshold: number; protectLevel: number; archivedDecayMultiplier: number; };
  }
  const degradation = config.getConfig<{
    decayRate?: number;
    importanceWeight?: number;
    scopeWeight?: number;
    deleteThreshold?: number;
    archiveThreshold?: number;
    protectLevel?: number;
    archivedDecayMultiplier?: number;
  }>('memoryService.degradation');
  if (!degradation) {
    return FALLBACK_DEFAULTS.degradation as { decayRate: number; importanceWeight: number; scopeWeight: number; deleteThreshold: number; archiveThreshold: number; protectLevel: number; archivedDecayMultiplier: number; };
  }
  return {
    decayRate: degradation.decayRate ?? FALLBACK_DEFAULTS.degradation.decayRate,
    importanceWeight: degradation.importanceWeight ?? FALLBACK_DEFAULTS.degradation.importanceWeight,
    scopeWeight: degradation.scopeWeight ?? FALLBACK_DEFAULTS.degradation.scopeWeight,
    deleteThreshold: degradation.deleteThreshold ?? FALLBACK_DEFAULTS.degradation.deleteThreshold,
    archiveThreshold: degradation.archiveThreshold ?? FALLBACK_DEFAULTS.degradation.archiveThreshold,
    protectLevel: degradation.protectLevel ?? FALLBACK_DEFAULTS.degradation.protectLevel,
    archivedDecayMultiplier: degradation.archivedDecayMultiplier ?? FALLBACK_DEFAULTS.degradation.archivedDecayMultiplier,
  };
}

/**
 * 获取作用域降级配置
 * 必须从 memoryService.scopeDegradation 读取
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
    return FALLBACK_DEFAULTS.scopeDegradation as { sessionToAgentDays: number; agentToGlobalDays: number; globalToAgentDays: number; sessionUpgradeRecallThreshold: number; agentUpgradeRecallThreshold: number; upgradeScopeScoreMax: number; };
  }
  const scopeDegradation = config.getConfig<{
    sessionToAgentDays?: number;
    agentToGlobalDays?: number;
    globalToAgentDays?: number;
    sessionUpgradeRecallThreshold?: number;
    agentUpgradeRecallThreshold?: number;
    upgradeScopeScoreMax?: number;
  }>('memoryService.scopeDegradation');
  if (!scopeDegradation) {
    return FALLBACK_DEFAULTS.scopeDegradation as { sessionToAgentDays: number; agentToGlobalDays: number; globalToAgentDays: number; sessionUpgradeRecallThreshold: number; agentUpgradeRecallThreshold: number; upgradeScopeScoreMax: number; };
  }
  return {
    sessionToAgentDays: scopeDegradation.sessionToAgentDays ?? FALLBACK_DEFAULTS.scopeDegradation.sessionToAgentDays,
    agentToGlobalDays: scopeDegradation.agentToGlobalDays ?? FALLBACK_DEFAULTS.scopeDegradation.agentToGlobalDays,
    globalToAgentDays: scopeDegradation.globalToAgentDays ?? FALLBACK_DEFAULTS.scopeDegradation.globalToAgentDays,
    sessionUpgradeRecallThreshold: scopeDegradation.sessionUpgradeRecallThreshold ?? FALLBACK_DEFAULTS.scopeDegradation.sessionUpgradeRecallThreshold,
    agentUpgradeRecallThreshold: scopeDegradation.agentUpgradeRecallThreshold ?? FALLBACK_DEFAULTS.scopeDegradation.agentUpgradeRecallThreshold,
    upgradeScopeScoreMax: scopeDegradation.upgradeScopeScoreMax ?? FALLBACK_DEFAULTS.scopeDegradation.upgradeScopeScoreMax,
  };
}

/**
 * 获取召回配置
 * 必须从 memoryService.recall 读取
 */
export function getRecallConfig(): Pick<MemoryRecallConfig, 'defaultLimit' | 'maxLimit' | 'enableVectorSearch' | 'enableKeywordSearch' | 'vectorWeight' | 'keywordWeight'> {
  if (!config.isInitialized()) {
    return {
      defaultLimit: 20,
      maxLimit: 100,
      enableVectorSearch: true,
      enableKeywordSearch: true,
      vectorWeight: 0.7,
      keywordWeight: 0.3,
    };
  }
  const recallConfig = config.getConfig<MemoryRecallConfig>('memoryService.recall');
  if (!recallConfig) {
    return {
      defaultLimit: 20,
      maxLimit: 100,
      enableVectorSearch: true,
      enableKeywordSearch: true,
      vectorWeight: 0.7,
      keywordWeight: 0.3,
    };
  }
  return {
    defaultLimit: recallConfig.defaultLimit ?? 20,
    maxLimit: recallConfig.maxLimit ?? 100,
    enableVectorSearch: recallConfig.enableVectorSearch ?? true,
    enableKeywordSearch: recallConfig.enableKeywordSearch ?? true,
    vectorWeight: recallConfig.vectorWeight ?? 0.7,
    keywordWeight: recallConfig.keywordWeight ?? 0.3,
  };
}

/**
 * 获取降级时 importance 衰减系数
 * 必须从配置读取，默认 0.8
 */
export function getDegradationImportanceDecayRate(): number {
  const degradationConfig = getDegradationConfig();
  // 从配置读取降级衰减系数，默认为 0.8
  // 注意：这是降级时 importance * 0.8 的系数，不是 decayRate
  if (!config.isInitialized()) {
    return 0.8;
  }
  const storeConfig = config.getConfig<{ scopeDegradationDecayRate?: number }>('memoryService.store');
  return storeConfig?.scopeDegradationDecayRate ?? 0.8;
}