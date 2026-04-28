/**
 * Dreaming Engine 类型定义
 *
 * 本文件定义了 Dreaming Engine 使用的所有核心类型和接口
 * v2.0.0 重构: 从"梦境生成"转变为"记忆整理服务"
 *
 * @module dreaming-engine/types
 * @since 0.1.0
 * @since 2.0.0 完全重构，新增整理类型和报告
 */

import type { LogLevel } from '../../shared/logging/types';
import { MemoryBlock, MemoryScope, MemoryType } from '../../types/memory';

/**
 * 整理类型枚举 (v2.0.0)
 */
export enum OrganizationType {
  CONSOLIDATION = 'consolidation',     // 记忆合并 (相似记忆去重)
  REORGANIZATION = 'reorganization',   // 图谱重构 (重建关联)
  ARCHIVAL = 'archival',             // 归档清理 (低价值记忆归档)
  DEFRAGMENTATION = 'defragmentation', // 碎片整理 (存储优化)
  ALL = 'all',                        // 全量整理
}

/**
 * 整理任务状态
 */
export enum OrganizationStatus {
  PENDING = 'pending',      // 等待执行
  RUNNING = 'running',      // 正在执行
  COMPLETED = 'completed',  // 已完成
  FAILED = 'failed',        // 执行失败
}

/**
 * 整理阶段状态
 */
export enum OrganizationPhase {
  SCAN = 'scan',       // 扫描阶段
  ANALYZE = 'analyze', // 分析阶段
  EXECUTE = 'execute', // 执行阶段
}

// ============================================================
// 旧类型保留 (兼容或待删除)
// ============================================================

/**
 * 梦境类型枚举 (旧版，保留兼容)
 * @deprecated v2.0.0 请使用 OrganizationType
 */
export enum DreamType {
  CONSOLIDATION = 'consolidation',  // 巩固梦境（强化日间记忆）
  INTEGRATION = 'integration',      // 整合梦境（建立新关联）
  EXPLORATION = 'exploration',      // 探索梦境（模拟未来场景）
  CLEANSING = 'cleansing',          // 清理梦境（处理负面情绪）
}

/**
 * 梦境情感基调 (旧版)
 * @deprecated v2.0.0 不再使用
 */
export enum DreamEmotionalTone {
  POSITIVE = 'positive',
  NEGATIVE = 'negative',
  NEUTRAL = 'neutral',
  MIXED = 'mixed',
}

/**
 * 梦境状态 (旧版)
 * @deprecated v2.0.0 请使用 OrganizationStatus
 */
export enum DreamStatus {
  PENDING = 'pending',      // 等待执行
  EXECUTING = 'executing',  // 正在执行
  COMPLETED = 'completed',  // 已完成
  FAILED = 'failed',        // 执行失败
}

/**
 * 主题信息（来自 Knowledge Graph）
 */
export interface Theme {
  /** 主题 ID */
  id: string;
  /** 主题名称 */
  name: string;
  /** 主题描述 */
  description: string;
  /** 相关实体列表 */
  relatedEntities: string[];
  /** 主题强度 (0-1) */
  strength: number;
  /** 元数据 */
  metadata: {
    keywords: string[];
    sourceWingIds: string[];
  };
}

// ============================================================
// v2.0.0 新类型定义
// ============================================================

/**
 * 相似记忆组 (v2.0.0)
 */
export interface SimilarMemoryGroup {
  /** 保留的记忆 ID */
  primaryMemory: string;
  /** 被合并的记忆 ID 列表 */
  mergedMemories: string[];
  /** 相似度 (0-1) */
  similarity: number;
  /** 合并原因 */
  reason: string;
  /** 预估节省空间 (bytes) */
  potentialSavings: number;
}

/**
 * 碎片化指标 (v2.0.0)
 */
export interface FragmentationMetrics {
  /** Palace 碎片率 (0-1) */
  palaceFragmentation: number;
  /** 图谱边密度 (0-1) */
  graphEdgeDensity: number;
  /** 孤儿记忆数 (无关联) */
  orphanedMemories: number;
  /** 陈旧记忆数 (长期未访问) */
  staleMemories: number;
  /** 上次碎片整理时间 */
  lastDefragmentationAt?: number;
}

/**
 * 整理阶段结果 (v2.0.0)
 */
export interface PhaseResult {
  /** 扫描的记忆数 */
  scannedCount: number;
  /** 候选记忆数 */
  candidateCount: number;
  /** 分析的记忆数 */
  analyzedCount: number;
  /** 发现的问题数 */
  foundIssues: number;
  /** 执行的耗时 (ms) */
  duration: number;
}

/**
 * 整理任务 (v2.0.0)
 */
export interface ConsolidationTask {
  type: 'consolidation';
  groups: SimilarMemoryGroup[];
}

export interface ReorganizationTask {
  type: 'reorganization';
  brokenRelations: Array<{
    from: string;
    to: string;
    reason: string;
  }>;
  orphanedNodes: string[];
}

export interface ArchivalTask {
  type: 'archival';
  candidates: string[];
  reason: Record<string, string>;
}

export interface DefragmentationTask {
  type: 'defragmentation';
  palaceRefs: string[];
  estimatedSavings: number;
}

export type OrganizationTask =
  | ConsolidationTask
  | ReorganizationTask
  | ArchivalTask
  | DefragmentationTask;

/**
 * 整理报告 (v2.0.0)
 */
export interface OrganizationReport {
  /** 整理报告 ID */
  id: string;
  /** 整理类型 */
  type: OrganizationType;
  /** 整理状态 */
  status: OrganizationStatus;

  /** 执行阶段 */
  phases: {
    scan: PhaseResult;
    analyze: PhaseResult;
    execute: PhaseResult;
  };

  /** 结果统计 */
  memoriesMerged: number;
  memoriesArchived: number;
  memoriesDeleted: number;
  relationsRebuilt: number;
  storageFreed: number;  // bytes

  /** 日期维度归纳整理结果 (dream Phase 3 extension) */
  consolidationProcessedCount?: number;
  consolidationGroupsFormed?: number;
  consolidationNewVersions?: number;
  consolidationArchivedOldVersions?: number;

  /** 执行时间 */
  executedAt: number;
  totalDuration: number;  // ms
}

/**
 * 整理输入选项 (v2.0.0)
 */
export interface OrganizationInput {
  /** 整理类型，不指定则自动选择 */
  type?: OrganizationType;
  /** 强制执行，忽略阈值检查 */
  force?: boolean;
  /** 限制处理数量 */
  limit?: number;
}

// ============================================================
// 配置接口 (v2.0.0)
// ============================================================

/**
 * 整理调度配置 (v2.0.0)
 */
export interface DreamingSchedulerConfig {
  /** 是否启用自动调度 */
  autoOrganize: boolean;
  /** 触发间隔 (ms), 默认 6 小时 */
  organizeInterval: number;
  /** 触发归档的记忆总数阈值 */
  memoryThreshold: number;
  /** 触发碎片整理的碎片率阈值 */
  fragmentationThreshold: number;
  /** 触发归档的陈旧天数阈值 */
  stalenessDays: number;
  /** 每轮最多处理记忆数 */
  maxMemoriesPerCycle: number;
  /** 每轮最多重建关联数 */
  maxRelationsPerCycle: number;
}

/**
 * 合并整理配置 (v2.0.0)
 */
export interface ConsolidationConfig {
  /** 相似度阈值, 默认 0.85 */
  similarityThreshold: number;
  /** 最大合并组大小, 默认 5 */
  maxGroupSize: number;
  /** 最大标签数, 默认 10 (v2.1.0) */
  maxTagsPerMemory: number;
  /** 是否保留最新版本 */
  preserveNewest: boolean;
  /** 内容差异大时是否创建版本 */
  createNewVersion: boolean;
  /** 主题相似度阈值, 默认 0.5 */
  topicSimilarityThreshold: number;
  /** LLM 语义检查阈值, 默认 0.5 */
  semanticCheckThreshold: number;
  /** 向量搜索返回数量, 默认 20 */
  vectorSearchLimit: number;
  /** 第一级筛选阈值, 默认 0.7 */
  candidateThreshold: number;
}

/**
 * 图谱重构配置 (v2.0.0)
 */
export interface ReorganizationConfig {
  /** 最小边权重, 默认 0.3 */
  minEdgeWeight: number;
  /** 目标边密度, 默认 0.5 */
  densityTarget: number;
  /** 孤儿节点判定阈值 */
  orphanThreshold: number;
  /** 每轮最大新建关联数 */
  maxNewRelationsPerCycle: number;
  /** 新建关联的最小相似度阈值, 默认 0.7 */
  minNewRelationSimilarity: number;
}

/**
 * 归档评分权重配置
 */
export interface ArchiveScoreWeights {
  /** 重要性权重, 默认 40 */
  importanceWeight: number;
  /** 陈旧度权重, 默认 35 */
  stalenessWeight: number;
  /** 召回频率权重, 默认 25 */
  recallWeight: number;
}

/**
 * 归档清理配置 (v2.0.0)
 */
export interface ArchivalConfig {
  /** 归档重要性阈值, 默认 2 */
  importanceThreshold: number;
  /** 陈旧天数阈值, 默认 30 */
  stalenessDays: number;
  /** 归档区块 */
  archiveBlock: MemoryBlock;
  /** 保留天数, 默认 90 */
  retentionDays: number;
  /** 综合评分阈值 (0-100), 默认 50 */
  archiveScoreThreshold: number;
  /** 评分权重配置 (v2.1.0) */
  archiveScoreWeights?: ArchiveScoreWeights;
}

/**
 * 碎片整理配置 (v2.0.0)
 */
export interface DefragmentationConfig {
  /** 碎片率阈值, 超过则整理 */
  fragmentationThreshold: number;
  /** 是否启用自动压缩 */
  enableCompression: boolean;
}

// ============================================================
// 旧类型定义 (保留兼容)
// ============================================================

/**
 * 梦境信息
 * @deprecated v2.0.0 建议使用 OrganizationReport
 */
export interface Dream {
  /** 梦境 ID */
  id: string;
  /** 梦境类型 */
  type: DreamType;
  /** 梦境主题 */
  theme: string;
  /** 梦境叙事（详细描述） */
  narrative: string;
  /** 相关记忆 ID 列表 */
  relatedMemories: string[];
  /** 梦境强度 (0-1) */
  intensity: number;
  /** 情感基调 */
  emotionalTone: DreamEmotionalTone;
  /** 梦境状态 */
  status: DreamStatus;
  /** 创建时间 */
  createdAt: number;
  /** 执行时间 */
  executedAt?: number;
  /** 是否已应用巩固 */
  consolidationApplied: boolean;
  /** 元数据 */
  metadata: {
    /** 使用的主题列表 */
    themes: Theme[];
    /** 涉及的实体 ID 列表 */
    entities: string[];
    /** 新建立的关系 */
    newRelations: Array<{
      fromEntity: string;
      toEntity: string;
      relationType: string;
      strength: number;
    }>;
    /** 洞察列表 */
    insights: string[];
    /** 使用的 LLM 模型 */
    llmModel?: string;
    /** 生成耗时（毫秒） */
    generationDuration?: number;
  };
}

/**
 * 梦境输入
 */
export interface DreamInput {
  /** 梦境类型 */
  type?: DreamType;
  /** 主题（可选，不传则自动选择） */
  theme?: string;
  /** 相关记忆 ID 列表（可选） */
  relatedMemories?: string[];
  /** 情感基调偏好 */
  emotionalTone?: DreamEmotionalTone;
}

/**
 * 梦境生成选项
 */
export interface DreamGenerationOptions {
  /** 梦境类型 */
  type?: DreamType;
  /** 主题列表 */
  themes?: Theme[];
  /** 最大叙事长度 */
  maxLength?: number;
  /** 情感基调偏好 */
  emotionalTone?: DreamEmotionalTone;
  /** 是否使用 LLM 增强 */
  useLLM?: boolean;
}

/**
 * 梦境分析结果
 */
export interface DreamAnalysis {
  /** 梦境 ID */
  dreamId: string;
  /** 提取的主题列表 */
  themes: string[];
  /** 关键实体列表 */
  keyEntities: string[];
  /** 情感分析 */
  emotionalAnalysis: {
    /** 情感基调 */
    tone: DreamEmotionalTone;
    /** 情感强度 (0-1) */
    intensity: number;
    /** 情感关键词 */
    keywords: string[];
  };
  /** 记忆连接 */
  memoryConnections: Array<{
    /** 记忆 ID */
    memoryId: string;
    /** 连接强度 (0-1) */
    strength: number;
    /** 连接类型 */
    type: string;
  }>;
  /** 新的洞察 */
  newInsights: string[];
  /** 推荐操作 */
  recommendations: string[];
}

/**
 * 记忆巩固报告
 */
export interface ConsolidationReport {
  /** 梦境 ID */
  dreamId: string;
  /** 巩固的记忆列表 */
  consolidatedMemories: Array<{
    /** 记忆 ID */
    memoryId: string;
    /** 旧的重要性评分 */
    oldImportance: number;
    /** 新的重要性评分 */
    newImportance: number;
    /** 是否被提升 */
    boosted: boolean;
    /** 提升幅度 */
    boostAmount: number;
  }>;
  /** 新建立的关系数量 */
  newRelations: number;
  /** 升级的记忆数量 */
  upgradedMemories: number;
  /** 应用时间 */
  appliedAt: number;
}

/**
 * 梦境模式
 */
export interface DreamPattern {
  /** 模式 ID */
  id: string;
  /** 模式类型 */
  type: string;
  /** 出现频率 */
  frequency: number;
  /** 相关主题 */
  themes: string[];
  /** 相关实体 */
  entities: string[];
  /** 平均强度 */
  avgIntensity: number;
  /** 最后出现时间 */
  lastOccurrence: number;
}

/**
 * 梦境统计信息
 */
export interface DreamingStats {
  /** 梦境总数 */
  totalDreams: number;
  /** 按类型统计 */
  dreamsByType: Record<DreamType, number>;
  /** 按状态统计 */
  dreamsByStatus: Record<DreamStatus, number>;
  /** 平均梦境强度 */
  avgIntensity: number;
  /** 巩固应用次数 */
  consolidationsApplied: number;
  /** 记忆提升总数 */
  totalMemoriesBoosted: number;
  /** 关系建立总数 */
  totalRelationsCreated: number;
  /** 最后梦境时间 */
  lastDreamAt: number;
  /** 今日梦境数量 */
  dreamsToday: number;
}

/**
 * 梦境调度配置
 */
export interface DreamSchedulingConfig {
  /** 是否启用自动调度 */
  autoSchedule: boolean;
  /** 梦境触发间隔（毫秒） */
  dreamInterval: number;
  /** 每日最大梦境数量 */
  maxDreamsPerDay: number;
  /** 记忆阈值：触发梦境所需的最少新记忆数 */
  memoryThreshold: number;
}

/**
 * 梦境生成配置
 */
export interface DreamGenerationConfig {
  /** 使用的 LLM Provider */
  llmProvider: string;
  /** 生成模型配置 */
  model: string;
  /** 梦境最大长度（字符数） */
  maxLength: number;
  /** 梦境类型权重 */
  typeWeights: {
    consolidation: number;
    integration: number;
    exploration: number;
    cleansing: number;
  };
}

/**
 * 记忆巩固配置
 */
export interface MemoryConsolidationConfig {
  /** 是否启用自动巩固 */
  autoConsolidate: boolean;
  /** 巩固强度系数 (0-1) */
  strengthFactor: number;
  /** 最小重要性提升 */
  minImportanceBoost: number;
  /** 最大重要性提升 */
  maxImportanceBoost: number;
  /** 轻度巩固阈值：最小召回次数 */
  lightConsolidationMinRecallCount: number;
  /** 轻度巩固阈值：最小重要性 */
  lightConsolidationMinImportance: number;
  /** 深度巩固阈值：最小召回次数 */
  deepConsolidationMinRecallCount: number;
  /** 深度巩固阈值：最小重要性 */
  deepConsolidationMinImportance: number;
  /** 深度巩固阈值：最小作用域评分 */
  deepConsolidationMinScopeScore: number;
}

/**
 * 主题提取配置
 */
export interface ThemeExtractionConfig {
  /** 最小主题强度 */
  minThemeStrength: number;
  /** 最大主题数量 */
  maxThemes: number;
  /** 是否使用 LLM 增强 */
  useLLMEnhancement: boolean;
}

/**
 * 梦境存储配置
 */
export interface DreamStorageConfig {
  /** 梦境数据库路径 */
  databasePath: string;
  /** 梦境保留天数 */
  retentionDays: number;
}

/**
 * 性能配置
 */
export interface PerformanceConfig {
  /** 启用缓存 */
  enableCache: boolean;
  /** 缓存 TTL（毫秒） */
  cacheTTL: number;
  /** 缓存大小 */
  cacheSize: number;
}

/**
 * 梦境引擎配置 (v2.0.0)
 *
 * 旧版配置保留兼容，新配置使用 DreamingSchedulerConfig 等
 * @deprecated v2.0.0 建议拆分到各组件独立配置
 */
export interface DreamingEngineConfig {
  /** 调度配置 (v2.0.0) */
  scheduler: DreamingSchedulerConfig;
  /** 合并整理配置 (v2.0.0) */
  consolidation: ConsolidationConfig;
  /** 图谱重构配置 (v2.0.0) */
  reorganization: ReorganizationConfig;
  /** 归档清理配置 (v2.0.0) */
  archival: ArchivalConfig;
  /** 碎片整理配置 (v2.0.0) */
  defragmentation: DefragmentationConfig;

  /** @deprecated v2.0.0 旧配置 */
  generation?: DreamGenerationConfig;
  /** @deprecated v2.0.0 旧配置 */
  themeExtraction?: ThemeExtractionConfig;
  /** 存储配置 */
  storage?: DreamStorageConfig;
  /** 性能配置 */
  performance?: PerformanceConfig;
  /** 日志配置 */
  logging?: {
    /** 日志级别 */
    level: LogLevel;
    /** 日志目录 */
    directory: string;
  };
  /** 主动学习配置 (v2.0.0) */
  activeLearning?: ActiveLearningConfig;
}

/**
 * 梦境执行结果
 */
export interface DreamExecutionResult {
  /** 是否成功 */
  success: boolean;
  /** 梦境 ID */
  dreamId: string;
  /** 执行耗时（毫秒） */
  duration: number;
  /** 巩固报告（如果已应用） */
  consolidationReport?: ConsolidationReport;
  /** 错误信息（如果失败） */
  error?: string;
}

/**
 * 梦境报告（设计文档要求的输出类型）
 */
export interface DreamingReport {
  /** 梦境 ID */
  dreamId: string;
  /** 梦境类型 */
  type: DreamType;
  /** 主题 */
  theme: string;
  /** 叙事 */
  narrative: string;
  /** 三阶段执行结果 */
  phases: {
    /** Light Phase 结果 */
    light: {
      processedMemories: string[];
      lightweightConsolidated: number;
      duration: number;
    };
    /** Deep Phase 结果 */
    deep: {
      deepConsolidated: string[];
      upgradedMemories: string[];
      newRelations: number;
      duration: number;
    };
    /** REM Phase 结果 */
    rem: {
      extractedThemes: Theme[];
      generatedInsights: string[];
      createdRelations: number;
      duration: number;
    };
  };
  /** 总体强化记忆数量 */
  totalMemoriesBoosted: number;
  /** 新建立的关系数量 */
  totalRelationsCreated: number;
  /** 执行时间 */
  executedAt: number;
  /** 总耗时 */
  totalDuration: number;
}

/**
 * 梦境历史记录项
 */
export interface DreamHistoryEntry {
  /** 梦境 ID */
  dreamId: string;
  /** 梦境类型 */
  type: DreamType;
  /** 主题 */
  theme: string;
  /** 强度 */
  intensity: number;
  /** 创建时间 */
  createdAt: number;
  /** 执行时间 */
  executedAt: number;
  /** 是否已巩固 */
  consolidated: boolean;
}

/**
 * 注意：默认配置已统一移至 src/types/config.ts 的 DEFAULT_OMMS_CONFIG.dreamingEngine
 */

// ============================================================
// Active Learning 类型 (v2.1.0)
// ============================================================

/**
 * 记忆模式类型
 */
export enum MemoryPatternType {
  TEMPORAL = 'temporal',     // 时间模式：同一时间段创建的记忆
  SEMANTIC = 'semantic',       // 语义模式：标签共现
  SPATIAL = 'spatial',        // 空间模式：同一 Palace 位置
  RELATIONAL = 'relational',  // 关系模式：图谱关联
}

/**
 * 记忆模式
 */
export interface MemoryPattern {
  /** 模式 ID */
  id: string;
  /** 模式类型 */
  type: MemoryPatternType;
  /** 模式描述 */
  description: string;
  /** 相关记忆 ID 列表 */
  memoryIds: string[];
  /** 置信度 (0-1) */
  confidence: number;
  /** 发现时间 */
  discoveredAt: number;
}

/**
 * 薄弱环节严重程度
 */
export enum WeakAreaSeverity {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

/**
 * 薄弱环节
 */
export interface WeakArea {
  /** 薄弱环节 ID */
  id: string;
  /** 相关作用域 */
  scope: MemoryScope;
  /** 相关记忆类型（可选） */
  type?: MemoryType;
  /** 薄弱环节描述 */
  description: string;
  /** 严重程度 */
  severity: WeakAreaSeverity;
  /** 建议操作列表 */
  suggestedActions: string[];
  /** 识别时间 */
  identifiedAt: number;
}

/**
 * Active Learning 配置
 */
export interface ActiveLearningConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 最大模式数量 */
  maxPatterns: number;
  /** 最大薄弱环节数量 */
  maxWeakAreas: number;
  /** 模式发现置信度阈值 */
  patternConfidenceThreshold: number;
  /** 薄弱环节识别阈值配置 */
  weakAreaThresholds: {
    /** 作用域记忆数量下限 */
    minScopeMemoryCount: number;
    /** 低重要性记忆比例阈值 */
    lowImportanceRatioThreshold: number;
  };
  /** 高价值记忆重要性阈值 (用于模式发现) */
  highValueImportanceThreshold: number;
  /** 低价值记忆重要性阈值 (用于模式发现) */
  lowValueImportanceThreshold: number;
}

/**
 * Active Learning 结果
 */
export interface ActiveLearningResult {
  /** 发现的模式 */
  patterns: MemoryPattern[];
  /** 识别的薄弱环节 */
  weakAreas: WeakArea[];
  /** 分析的记忆数量 */
  analyzedCount: number;
  /** 执行时间 */
  duration: number;
}
