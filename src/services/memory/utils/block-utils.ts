/**
 * Block Utils - 记忆区块工具
 *
 * @module memory-service/block-utils
 *
 * v2.0.0
 * - 提供统一的 deriveBlock 函数
 * - 提供统一的作用域升级阈值获取函数
 * - 解决 deriveBlock 和作用域升级阈值在多个模块中重复实现的问题
 * - v2.1.0: 所有配置必须从 ConfigManager 读取，禁止硬编码默认值
 */

import { config } from '../../../shared/config';
import { MemoryBlock, MemoryScope } from '../../../core/types/memory';
import type { MemoryStoreConfig } from '../../../core/types/config';

/**
 * 获取作用域升级阈值
 * 统一从 memoryService.scopeDegradation 读取，所有模块必须使用此函数
 * 以确保升级逻辑的一致性
 */
export function getScopeUpgradeThresholds(): {
  sessionToAgentImportance: number;
  agentToGlobalScopeScore: number;
  agentToGlobalImportance: number;
} {
  // 默认阈值（与 config.default.json 一致）
  const defaults = {
    sessionToAgentImportance: 5,
    agentToGlobalScopeScore: 10,
    agentToGlobalImportance: 10,
  };

  if (!config.isInitialized()) {
    return defaults;
  }

  // 统一从 scopeDegradation 读取
  const scopeConfig = config.getConfig('memoryService.scopeDegradation') as any;
  if (scopeConfig) {
    return {
      sessionToAgentImportance: scopeConfig.sessionUpgradeRecallThreshold ?? defaults.sessionToAgentImportance,
      agentToGlobalScopeScore: scopeConfig.upgradeScopeScoreMax ?? defaults.agentToGlobalScopeScore,
      agentToGlobalImportance: scopeConfig.agentUpgradeRecallThreshold ?? defaults.agentToGlobalImportance,
    };
  }

  // 兼容旧版配置：如果 scopeDegradation 不存在，尝试从 store.scopeUpgradeThresholds 读取
  const storeConfig = config.getConfig('memoryService.store') as Partial<MemoryStoreConfig> | undefined;
  if (storeConfig?.scopeUpgradeThresholds) {
    const storeThresholds = storeConfig.scopeUpgradeThresholds;
    return {
      sessionToAgentImportance: storeThresholds.sessionToAgentImportance ?? defaults.sessionToAgentImportance,
      agentToGlobalScopeScore: storeThresholds.agentToGlobalScopeScore ?? defaults.agentToGlobalScopeScore,
      agentToGlobalImportance: storeThresholds.agentToGlobalImportance ?? defaults.agentToGlobalImportance,
    };
  }

  return defaults;
}

/**
 * 判断是否应该升级作用域
 *
 * @param currentScope - 当前作用域
 * @param importance - 重要性评分
 * @param scopeScore - 作用域评分
 * @returns 是否应该升级以及目标作用域
 */
export function shouldUpgradeScope(
  currentScope: MemoryScope,
  importance: number,
  scopeScore: number
): { shouldUpgrade: boolean; newScope?: MemoryScope } {
  const thresholds = getScopeUpgradeThresholds();

  if (currentScope === MemoryScope.SESSION && importance >= thresholds.sessionToAgentImportance) {
    return { shouldUpgrade: true, newScope: MemoryScope.AGENT };
  }

  if (currentScope === MemoryScope.AGENT &&
      scopeScore >= thresholds.agentToGlobalScopeScore &&
      importance >= thresholds.agentToGlobalImportance) {
    return { shouldUpgrade: true, newScope: MemoryScope.GLOBAL };
  }

  return { shouldUpgrade: false };
}

/**
 * 根据 importance 派生 MemoryBlock
 *
 * @param importance - 重要性评分
 * @returns MemoryBlock
 *
 * @example
 * const block = deriveBlock(8); // => MemoryBlock.CORE
 * const block = deriveBlock(5); // => MemoryBlock.SESSION
 * const block = deriveBlock(3); // => MemoryBlock.WORKING
 * const block = deriveBlock(1); // => MemoryBlock.ARCHIVED
 */
export function deriveBlock(importance: number): MemoryBlock {
  // 默认阈值（与 config.default.json 一致）
  let coreMinImportance = 7;
  let sessionMinImportance = 4;
  let workingMinImportance = 2;
  let archivedMinImportance = 1;

  if (config.isInitialized()) {
    const storeConfig = config.getConfig('memoryService.store') as Partial<MemoryStoreConfig> | undefined;
    if (storeConfig?.blockThresholds) {
      coreMinImportance = storeConfig.blockThresholds.coreMinImportance ?? coreMinImportance;
      sessionMinImportance = storeConfig.blockThresholds.sessionMinImportance ?? sessionMinImportance;
      workingMinImportance = storeConfig.blockThresholds.workingMinImportance ?? workingMinImportance;
      archivedMinImportance = storeConfig.blockThresholds.archivedMinImportance ?? archivedMinImportance;
    }
  }

  if (importance >= coreMinImportance) {
    return MemoryBlock.CORE;
  }
  if (importance >= sessionMinImportance) {
    return MemoryBlock.SESSION;
  }
  if (importance >= workingMinImportance) {
    return MemoryBlock.WORKING;
  }
  if (importance >= archivedMinImportance) {
    return MemoryBlock.ARCHIVED;
  }
  return MemoryBlock.DELETED;
}
