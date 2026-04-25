/**
 * Dreaming Engine 模块 (v2.1.0)
 *
 * 记忆整理服务 - 后台记忆维护任务系统
 *
 * 核心功能:
 * - 记忆合并 (Consolidation): 相似记忆去重
 * - 图谱重构 (Reorganization): 重建记忆间关联
 * - 归档清理 (Archival): 低价值记忆归档
 * - 碎片整理 (Defragmentation): Palace 存储优化
 * - 主动学习 (Active Learning): 模式发现与薄弱环节识别
 *
 * @module dreaming-engine
 * @since 0.1.0
 * @since 2.0.0 完全重构，从"梦境生成"转变为"记忆整理"
 * @since 2.1.0 新增 Active Learning 功能
 */

// 主管理器
export { DreamingManager } from './dreaming-manager';

// 核心组件
export { MemoryMerger } from './consolidation/memory-merger';
export { GraphReorganizer } from './graph/graph-reorganizer';
export { StorageOptimizer } from './storage/storage-optimizer';

// v2.0.0 类型导出
export type {
  OrganizationReport,
  OrganizationInput,
  OrganizationTask,
  SimilarMemoryGroup,
  FragmentationMetrics,
  PhaseResult,
  DreamingEngineConfig,
  DreamingSchedulerConfig,
  ConsolidationConfig,
  ReorganizationConfig,
  ArchivalConfig,
  DefragmentationConfig,
  ActiveLearningConfig,
  ActiveLearningResult,
  MemoryPattern,
  WeakArea,
} from './types';

// v2.0.0 枚举导出
export {
  OrganizationType,
  OrganizationStatus,
  OrganizationPhase,
  MemoryPatternType,
  WeakAreaSeverity,
} from './types';

// 默认配置已移至统一配置: DEFAULT_OMMS_CONFIG.dreamingEngine
