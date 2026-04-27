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

const FALLBACK_THRESHOLDS: ScopeUpgradeThresholds = {
  sessionToAgentImportance: 5,
  agentToGlobalScopeScore: 10,
  agentToGlobalImportance: 7,
};

export function getScopeUpgradeThresholds(): ScopeUpgradeThresholds {
  if (!config.isInitialized()) {
    // ConfigManager 未初始化，返回安全的默认值（不会导致误触发）
    return FALLBACK_THRESHOLDS;
  }

  try {
    // 统一从 memoryService.scopeDegradation 读取所有升级阈值
    const scopeConfig = config.getConfigOrThrow<{
      sessionUpgradeRecallThreshold: number;
      upgradeScopeScoreMax: number;
      agentToGlobalImportance?: number; // 新增：可选字段，用于 AGENT→GLOBAL 的 importance 阈值
    }>('memoryService.scopeDegradation');

    return {
      sessionToAgentImportance: scopeConfig.sessionUpgradeRecallThreshold,
      agentToGlobalScopeScore: scopeConfig.upgradeScopeScoreMax,
      // 优先从 scopeDegradation 读取，如果不存在则回退到 store.scopeUpgradeThresholds
      agentToGlobalImportance: scopeConfig.agentToGlobalImportance ?? FALLBACK_THRESHOLDS.agentToGlobalImportance,
    };
  } catch (error) {
    // 配置读取失败，返回安全的默认值
    return FALLBACK_THRESHOLDS;
  }
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
  // 默认阈值配置（当 ConfigManager 未初始化时使用）
  const DEFAULT_THRESHOLDS = {
    coreMinImportance: 7,
    sessionMinImportance: 4,
    workingMinImportance: 2,
    archivedMinImportance: 1,
  };

  let thresholds = DEFAULT_THRESHOLDS;

  if (config.isInitialized()) {
    try {
      const storeConfig = config.getConfigOrThrow<{
        blockThresholds: {
          coreMinImportance: number;
          sessionMinImportance: number;
          workingMinImportance: number;
          archivedMinImportance: number;
        };
      }>('memoryService.store');

      thresholds = storeConfig.blockThresholds;
    } catch {
      // 配置读取失败，使用默认阈值
    }
  }

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
