/**
 * Block Utils - 记忆区块工具
 *
 * @module memory-service/block-utils
 *
 * v2.1.0
 * - 提供统一的 deriveBlock 函数
 * - 提供统一的作用域升级阈值获取函数
 * - 解决 deriveBlock 和作用域升级阈值在多个模块中重复实现的问题
 * - v2.2.0: 所有配置必须从 memory-config-utils 读取，禁止硬编码默认值
 */

import { config } from '../../../shared/config';
import { MemoryBlock, MemoryScope } from '../../../core/types/memory';
import type { MemoryStoreConfig } from '../../../core/types/config';

/**
 * 获取作用域升级阈值
 * 统一从 memoryService.scopeDegradation 读取，所有模块必须使用此函数
 * 以确保升级逻辑的一致性
 *
 * 注意：所有升级阈值集中配置在 memoryService.scopeDegradation 下
 */
export interface ScopeUpgradeThresholds {
  sessionToAgentImportance: number;
  agentToGlobalScopeScore: number;
  agentToGlobalImportance: number;
}

export function getScopeUpgradeThresholds(): ScopeUpgradeThresholds {
  if (!config.isInitialized()) {
    throw new Error('ConfigManager not initialized. Cannot read memoryService.scopeDegradation for scope upgrade thresholds.');
  }

  const scopeConfig = config.getConfigOrThrow<{
    sessionUpgradeRecallThreshold: number;
    upgradeScopeScoreMax: number;
    agentToGlobalImportance?: number;
  }>('memoryService.scopeDegradation');

  return {
    sessionToAgentImportance: scopeConfig.sessionUpgradeRecallThreshold,
    agentToGlobalScopeScore: scopeConfig.upgradeScopeScoreMax,
    agentToGlobalImportance: scopeConfig.agentToGlobalImportance ?? 7,
  };
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
  if (!config.isInitialized()) {
    throw new Error('ConfigManager not initialized. Cannot read memoryService.store.blockThresholds.');
  }

  const storeConfig = config.getConfigOrThrow<{
    blockThresholds: {
      coreMinImportance: number;
      sessionMinImportance: number;
      workingMinImportance: number;
      archivedMinImportance: number;
    };
  }>('memoryService.store');

  const thresholds = storeConfig.blockThresholds;

  if (importance >= thresholds.coreMinImportance) {
    return MemoryBlock.CORE;
  }
  if (importance >= thresholds.sessionMinImportance) {
    return MemoryBlock.SESSION;
  }
  if (importance >= thresholds.workingMinImportance) {
    return MemoryBlock.WORKING;
  }
  if (importance >= thresholds.archivedMinImportance) {
    return MemoryBlock.ARCHIVED;
  }
  return MemoryBlock.DELETED;
}
