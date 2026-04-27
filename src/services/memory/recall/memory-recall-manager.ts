/**
 * Memory Recall Manager - 记忆召回管理器
 * @module memory-service/memory-recall-manager
 *
 * 版本: v1.1.0
 * - 递进式作用域扩大（SESSION → AGENT → GLOBAL → OTHER_AGENTS）
 * - 多维度信息补全（Palace + Graph + VersionChain）
 * - 重要性过滤（importanceRatio >= minImportanceRatio）
 * - 只召回最新版本，返回时附带版本链
 * - 配置通过 ConfigManager 注入
 */

import { MemoryType, MemoryScope, MemoryBlock, MemoryMetadata, VersionInfo, MemoryLifecycleEvent } from '../../../core/types/memory';
import type {
  ICacheManager,
  IVectorStore,
  ISQLiteMetaStore,
  IPalaceStore,
  IGraphStore,
  MemoryMetaRecord,
  VectorSearchResult,
  GraphNodeRecord,
  GraphEdgeRecord,
  VectorSearchOptions,
  PalaceLocation,
} from '../../../infrastructure/storage/core/types';
import { createServiceLogger, wrapWithErrorBoundary } from '../../../shared/logging';
import { PalaceStore } from '../../../infrastructure/storage/stores/palace-store';
import type { ILogger } from '../../../shared/logging';
import { config } from '../../../shared/config';
import type { MemoryRecallConfig } from '../../../core/types/config';
import { TransactionManager } from '../utils/transaction-manager';
import { deriveBlock, shouldUpgradeScope } from '../utils/block-utils';
import { prescreenByAAAK } from '../search/aaak-prescreen';
import { rerankWithBM25 } from '../search/hybrid-search';
import { getReinforcementConfig, getRecallConfig } from '../utils/memory-config-utils';

// ============================================================
// 类型定义
// ============================================================

/**
 * 召回配置
 */
export interface RecallConfig {
  /** 最小召回记忆数（默认 3） */
  minMemories: number;
  /** 最大召回记忆数（默认 20） */
  maxMemories: number;
  /** 最小重要性评分比例（默认 0.6，即 60%） */
  minImportanceRatio: number;
  /** 作用域优先级，默认 [SESSION, AGENT, GLOBAL] */
  scopePriority: MemoryScope[];
  /** 启用向量搜索（默认 true） */
  enableVectorSearch: boolean;
  /** 启用关键词搜索（默认 false） */
  enableKeywordSearch: boolean;
  /** 向量权重（默认 0.7） */
  vectorWeight: number;
  /** 关键词权重（默认 0.3） */
  keywordWeight: number;
  /** 最小相似度（默认 0.5） */
  minSimilarity: number;
  /** 返回时包含版本链（默认 true） */
  includeVersionChain: boolean;
  /** 默认返回数量（默认 20） */
  defaultLimit: number;
  /** 最大返回数量（默认 100） */
  maxLimit: number;
  /** scopeScore 强化幅度（被其他Agent召回时，默认 0.6） */
  scopeBoost: number;
}

/**
 * 召回输入
 */
export interface RecallInput {
  /** 查询文本（可选；若省略则跳过向量搜索，仅按元数据过滤） */
  query?: string;
  /** 当前 Agent ID */
  currentAgentId: string;
  /** 当前会话 ID */
  currentSessionId: string;
  /** 记忆类型过滤 */
  type?: MemoryType;
  /** 记忆类型过滤（多选） */
  types?: MemoryType[];
  /** 标签过滤 */
  tags?: string[];
  /** 时间范围 */
  timeRange?: { start: number; end: number };
  /** 排序方式 */
  sortBy?: 'relevance' | 'time' | 'importance';
  /** 返回数量限制 */
  limit?: number;
  /** 偏移量 */
  offset?: number;
}

/**
 * 单条召回记忆（完整版）
 */
export interface RecallMemory {
  /** 唯一标识 */
  uid: string;
  /** 当前版本号 */
  version: number;
  /** 完整内容（从 Palace 获取） */
  content: string;
  /** 摘要 */
  summary: string;
  /** 记忆类型 */
  type: MemoryType;
  /** 创建者 Agent ID */
  agentId: string;
  /** 会话 ID */
  sessionId?: string;
  /** 原始重要性评分 (0-10) */
  importance: number;
  /** 相对于最高分的比例 (0-1) */
  importanceRatio: number;
  /** 作用域评分 (0-10) */
  scopeScore: number;
  /** 作用域 */
  scope: MemoryScope;
  /** 存储区块 */
  block: MemoryBlock;
  /** Palace 位置（含 palaceRef） */
  palace: {
    wingId: string;
    hallId: string;
    roomId: string;
    palaceRef: string;
  };
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 上次访问时间 */
  lastAccessedAt: number;
  /** 累计访问次数（别名：recallCount） */
  accessCount: number;
  /** 使用过的 Agent 列表 */
  usedByAgents: string[];
  /** 是否最新版本 */
  isLatestVersion: boolean;
  /** 版本链 */
  versionChain: VersionInfo[];
  /** Palace 引用（保留向后兼容） */
  palaceRef: string;
  /** 知识图谱关联 */
  relations?: {
    relatedMemories: Array<{
      uid: string;
      relation: string;
      weight: number;
    }>;
    entities: GraphNodeRecord[];
    edges: GraphEdgeRecord[];
  };
  /** 标签列表 */
  tags: string[];
  /** 召回次数 */
  recallCount: number;
  /** 生命周期 */
  lifecycle: {
    createdAt: number;
    events: MemoryLifecycleEvent[];
  };
  /** 元数据 */
  metadata: MemoryMetadata;
}

/**
 * 召回结果
 */
export interface RecallOutput {
  /** 召回的记忆列表 */
  memories: RecallMemory[];
  /** 总召回数 */
  totalFound: number;
  /** 作用域分布统计 */
  scopeDistribution: {
    session: number;
    agent: number;
    global: number;
    other: number;
  };
  /** 召回路径（调试用） */
  recallPath: Array<{
    scope: string;
    step: number;
    found: number;
    totalAfterStep: number;
  }>;
  /** 是否达到最小召回数 */
  meetsMinimum: boolean;
  /** 综合评分 */
  scores: {
    vector: number[];
    combined: number[];
  };
}

/**
 * 召回统计
 */
export interface RecallStats {
  totalMemories: number;
  byScope: Record<MemoryScope, number>;
  byType: Record<MemoryType, number>;
  averageImportance: number;
}

// ============================================================
// 默认配置
// 所有配置必须从 ConfigManager 读取，禁止硬编码
// ============================================================

/**
 * 获取召回配置的默认值（延迟初始化）
 * 仅在 ConfigManager 已初始化时调用
 */
function getDefaultRecallConfig(): RecallConfig | null {
  if (!config.isInitialized()) {
    return null;
  }

  try {
    const recallConfig = config.getConfigOrThrow<MemoryRecallConfig>('memoryService.recall');
    const reinforcementConfig = config.getConfigOrThrow<any>('memoryService.reinforcement');

    return {
      minMemories: 3,  // 非配置参数，保持默认值
      maxMemories: 20,  // 非配置参数，保持默认值
      minImportanceRatio: 0.6,  // 非配置参数，保持默认值
      scopePriority: [MemoryScope.SESSION, MemoryScope.AGENT, MemoryScope.GLOBAL],  // 固定顺序
      enableVectorSearch: recallConfig.enableVectorSearch ?? true,
      enableKeywordSearch: recallConfig.enableKeywordSearch ?? true,
      vectorWeight: recallConfig.vectorWeight ?? 0.7,
      keywordWeight: recallConfig.keywordWeight ?? 0.3,
      minSimilarity: recallConfig.minScore ?? 0.5,
      includeVersionChain: true,  // 固定值
      defaultLimit: recallConfig.defaultLimit ?? 20,
      maxLimit: recallConfig.maxLimit ?? 100,
      scopeBoost: reinforcementConfig?.scopeBoost ?? 0.6,
    };
  } catch {
    return null;
  }
}

// 临时默认值，在构造函数中会被正确配置替换
const DEFAULT_RECALL_CONFIG: RecallConfig = {
  minMemories: 3,
  maxMemories: 20,
  minImportanceRatio: 0.6,
  scopePriority: [MemoryScope.SESSION, MemoryScope.AGENT, MemoryScope.GLOBAL],
  enableVectorSearch: true,
  enableKeywordSearch: true,
  vectorWeight: 0.7,
  keywordWeight: 0.3,
  minSimilarity: 0.5,
  includeVersionChain: true,
  defaultLimit: 20,
  maxLimit: 100,
  scopeBoost: 0.6,
};

// ============================================================
// MemoryRecallManager
// ============================================================

/**
 * MemoryRecallManager
 * 负责递进式召回记忆
 */
export class MemoryRecallManager {
  private logger: ILogger;
  private config: RecallConfig;
  private reinforcementConfig!: {
    lowBoostThreshold: number;
    mediumBoostThreshold: number;
    highBoostThreshold: number;
    lowBoost: number;
    mediumBoost: number;
    highBoost: number;
    defaultBoost: number;
  };

  constructor(
    private vectorStore: IVectorStore,
    private metaStore: ISQLiteMetaStore,
    private palaceStore: IPalaceStore,
    private graphStore: IGraphStore,
    private cacheManager: ICacheManager,
    private embedder: (text: string) => Promise<number[]>,
    userConfig?: Partial<RecallConfig>
  ) {
    this.logger = createServiceLogger('MemoryRecallManager');

    // 如果传入了配置则使用，否则从 ConfigManager 获取
    if (userConfig && Object.keys(userConfig).length > 0) {
      this.config = { ...DEFAULT_RECALL_CONFIG, ...userConfig };
      this.logger.info('MemoryRecallManager using user-provided config', { config: this.config });
    } else {
      // 从 ConfigManager 获取配置（使用集中化的配置读取函数）
      this.config = { ...DEFAULT_RECALL_CONFIG };
      const recallConfig = getRecallConfig();
      const reinforcementConfig = getReinforcementConfig();

      this.config = {
        ...this.config,
        defaultLimit: recallConfig.defaultLimit,
        maxLimit: recallConfig.maxLimit,
        enableVectorSearch: recallConfig.enableVectorSearch,
        enableKeywordSearch: recallConfig.enableKeywordSearch,
        vectorWeight: recallConfig.vectorWeight,
        keywordWeight: recallConfig.keywordWeight,
        scopeBoost: reinforcementConfig.scopeBoost,
      };
      this.reinforcementConfig = {
        lowBoostThreshold: reinforcementConfig.lowBoostThreshold,
        mediumBoostThreshold: reinforcementConfig.mediumBoostThreshold,
        highBoostThreshold: reinforcementConfig.highBoostThreshold,
        lowBoost: reinforcementConfig.lowBoost,
        mediumBoost: reinforcementConfig.mediumBoost,
        highBoost: reinforcementConfig.highBoost,
        defaultBoost: reinforcementConfig.defaultBoost,
      };
      this.logger.info('MemoryRecallManager loaded config', { config: this.config });
    }

    // Note: wrapWithErrorBoundary is not applied to the recall method directly
    // to avoid recursive wrapping. Use wrapWithErrorBoundary at the call site instead.
    // this.recall = wrapWithErrorBoundary(this.logger, 'MemoryRecallManager.recall', this.recall.bind(this)) as any;
  }

  // 缓存预热 Promise 追踪（防止并发重复预热）
  private warmupPromises = new Map<string, Promise<void>>();

  /**
   * 执行递进式召回
   *
   * 召回优先级：
   * 1. 当前会话（SESSION + agentId + sessionId）
   * 2. 当前Agent（AGENT 或 SESSION + agentId，排除Step1）
   * 3. 全局（GLOBAL，排除Step1,2）
   * 4. 其他Agent（agentId != 当前Agent，排除Step1,2,3）
   */
  async recall(input: RecallInput): Promise<RecallOutput> {
    const result: RecallOutput = {
      memories: [],
      totalFound: 0,
      scopeDistribution: { session: 0, agent: 0, global: 0, other: 0 },
      recallPath: [],
      meetsMinimum: false,
      scores: { vector: [], combined: [] },
    };

    const limit = Math.min(input.limit ?? this.config.defaultLimit, this.config.maxLimit);
    const queryVector = input.query ? await this.embedder(input.query) : [];
    const recalledUids = new Set<string>();

    this.logger.info('Starting progressive recall', {
      query: input.query ? input.query.substring(0, 50) : '(no query)',
      agentId: input.currentAgentId,
      minMemories: this.config.minMemories,
    });

    // Step 1: 当前会话记忆
    const step1Found = await this.recallByScope({
      query: input.query, queryVector, scope: MemoryScope.SESSION,
      agentId: input.currentAgentId, sessionId: input.currentSessionId,
      currentAgentId: input.currentAgentId, excludeUids: [],
      type: input.type, types: input.types, tags: input.tags, timeRange: input.timeRange, limit,
    });
    for (const memory of step1Found.memories) {
      recalledUids.add(memory.uid);
      result.memories.push(memory);
      result.scopeDistribution.session++;
    }
    result.recallPath.push({ scope: 'CURRENT_SESSION', step: 1, found: step1Found.memories.length, totalAfterStep: result.memories.length });
    this.logger.info('Step 1 (session) completed', { found: step1Found.memories.length, total: result.memories.length });

    if (result.memories.length >= this.config.minMemories) {
      return this.finalizeResult(result, recalledUids, limit, input, input.currentAgentId);
    }

    // Step 2: 当前Agent记忆
    const step2aFound = await this.recallByScope({
      query: input.query, queryVector, scope: MemoryScope.AGENT,
      agentId: input.currentAgentId, currentAgentId: input.currentAgentId,
      excludeUids: Array.from(recalledUids),
      type: input.type, types: input.types, tags: input.tags, timeRange: input.timeRange, limit,
    });
    for (const memory of step2aFound.memories) {
      if (!recalledUids.has(memory.uid)) { recalledUids.add(memory.uid); result.memories.push(memory); result.scopeDistribution.agent++; }
    }
    const step2bFound = await this.recallByScope({
      query: input.query, queryVector, scope: MemoryScope.SESSION,
      agentId: input.currentAgentId, currentAgentId: input.currentAgentId,
      excludeUids: Array.from(recalledUids),
      type: input.type, types: input.types, tags: input.tags, timeRange: input.timeRange, limit,
    });
    for (const memory of step2bFound.memories) {
      if (!recalledUids.has(memory.uid)) { recalledUids.add(memory.uid); result.memories.push(memory); result.scopeDistribution.agent++; }
    }
    result.recallPath.push({ scope: 'CURRENT_AGENT', step: 2, found: step2aFound.memories.length + step2bFound.memories.length, totalAfterStep: result.memories.length });
    this.logger.info('Step 2 (agent) completed', { found: step2aFound.memories.length + step2bFound.memories.length, total: result.memories.length });

    if (result.memories.length >= this.config.minMemories) {
      return this.finalizeResult(result, recalledUids, limit, input, input.currentAgentId);
    }

    // Step 3: 全局记忆
    const step3Found = await this.recallByScope({
      query: input.query, queryVector, scope: MemoryScope.GLOBAL,
      currentAgentId: input.currentAgentId, excludeUids: Array.from(recalledUids),
      type: input.type, types: input.types, tags: input.tags, timeRange: input.timeRange, limit,
    });
    for (const memory of step3Found.memories) {
      if (!recalledUids.has(memory.uid)) { recalledUids.add(memory.uid); result.memories.push(memory); result.scopeDistribution.global++; }
    }
    result.recallPath.push({ scope: 'GLOBAL', step: 3, found: step3Found.memories.length, totalAfterStep: result.memories.length });
    this.logger.info('Step 3 (global) completed', { found: step3Found.memories.length, total: result.memories.length });

    if (result.memories.length >= this.config.minMemories) {
      return this.finalizeResult(result, recalledUids, limit, input, input.currentAgentId);
    }

    // Step 4: 其他Agent记忆
    const step4Found = await this.recallByScope({
      query: input.query, queryVector, agentIdNotEq: input.currentAgentId,
      currentAgentId: input.currentAgentId, excludeUids: Array.from(recalledUids),
      type: input.type, types: input.types, tags: input.tags, timeRange: input.timeRange, limit,
    });
    for (const memory of step4Found.memories) {
      if (!recalledUids.has(memory.uid)) { recalledUids.add(memory.uid); result.memories.push(memory); result.scopeDistribution.other++; }
    }
    result.recallPath.push({ scope: 'OTHER_AGENTS', step: 4, found: step4Found.memories.length, totalAfterStep: result.memories.length });
    this.logger.info('Step 4 (other agents) completed', { found: step4Found.memories.length, total: result.memories.length });

    return this.finalizeResult(result, recalledUids, limit, input, input.currentAgentId);
  }

  /**
   * 封装最终处理逻辑
   */
  private finalizeResult(
    result: RecallOutput,
    recalledUids: Set<string>,
    limit: number,
    input: RecallInput,
    currentAgentId: string
  ): RecallOutput {
    // 应用重要性过滤
    result.memories = this.filterByImportance(result.memories);

    // 排序
    result.memories = this.sortMemories(result.memories, input.sortBy ?? 'relevance');

    // 记录分页前的总数（用于返回 totalFound）
    const totalBeforePagination = result.memories.length;

    // 应用分页：先偏移，再限制数量
    if (input.offset !== undefined && input.offset > 0) {
      result.memories = result.memories.slice(input.offset);
    }
    if (result.memories.length > limit) {
      result.memories = result.memories.slice(0, limit);
    }

    // 更新统计
    // totalFound 应为分页前的总数，表示实际匹配的记忆总数
    result.totalFound = totalBeforePagination;
    result.meetsMinimum = result.memories.length >= this.config.minMemories;

    // 提取综合评分
    result.scores.combined = result.memories.map((m) => m.importanceRatio);
    result.scores.vector = result.memories.map((m) => m.importanceRatio);

    // 强化记忆评分（异步，不阻塞返回）
    // 注意：使用 Promise.then 确保不会阻塞返回，但会记录日志
    // 强化是"尽力而为"的，即使失败也不影响召回结果的正确性
    this.applyReinforcement(result.memories, currentAgentId)
      .catch(error => this.logger.warn('Reinforcement failed', { error: String(error) }));

    // 缓存预热：将召回结果写入 L1 Cache，减少下次召回延迟
    // 注意：这是 fire-and-forget，在 return 之前启动但不会 await
    // 这样下次召回同一记忆时可以命中缓存，但首次召回的本次延迟不会减少
    // 当前 L1 Cache 使用 LRU 驱逐策略，热门记忆会保留在缓存中
    this.warmupCache(result.memories)
      .catch(error => this.logger.warn('Cache warmup failed', { error: String(error) }));

    this.logger.info('Recall completed', {
      totalFound: result.totalFound,
      meetsMinimum: result.meetsMinimum,
      scopeDistribution: result.scopeDistribution,
      recallPath: result.recallPath,
    });

    return result;
  }

  /**
   * 根据 UID 批量获取记忆
   * 获取记忆时会更新 lastRecalledAt 和 recallCount（通过 updateRecallStats）
   */
  async getByIds(uids: string[]): Promise<RecallMemory[]> {
    if (uids.length === 0) {
      return [];
    }

    const now = Date.now();

    // 并行获取元数据和向量
    const [metas, vectors] = await Promise.all([
      this.metaStore.getByIds(uids),
      this.vectorStore.getByIds(uids),
    ]);

    if (metas.length === 0) {
      return [];
    }

    // 异步更新召回时间戳和召回次数（不阻塞返回）
    this.updateRecallStats(uids, now).catch(error =>
      this.logger.warn('Failed to update recall stats', { error: String(error) })
    );

    // 构建 UID -> meta 映射
    const metaMap = new Map(metas.map((m) => [m.uid, m]));

    // 补全信息：若向量缺失，则用 meta 信息构造 placeholder
    // 注意：缺失向量的记忆使用 importanceScore / 10 作为相似度代理，而非 1.0
    // 这是因为：1) 缺失向量说明可能是旧数据（维度修复前的数据）
    //           2) 使用 importance 作为代理可以避免错误地将缺失向量记忆排在有向量的记忆之前
    //           3) 重要性高的记忆更值得被召回，即使没有向量匹配
    const vectorMap = new Map(vectors.map((v) => [v.id, v]));
    const missingVectorCount = { value: 0 };
    const vectorResults: VectorSearchResult[] = metas.map((meta) => {
      const vec = vectorMap.get(meta.uid);
      if (vec) {
        return { id: vec.id, score: 1.0, metadata: vec.metadata };
      }
      // Vector not found (e.g. old data before dimension fix) – build a minimal result
      // Use importance-based score as proxy instead of 1.0 to avoid incorrect ranking
      missingVectorCount.value++;
      const importanceProxyScore = meta.importanceScore / 10;
      return {
        id: meta.uid,
        score: importanceProxyScore,
        metadata: {
          uid: meta.uid,
          agentId: meta.agentId,
          sessionId: meta.sessionId,
          scope: meta.scope,
          type: meta.type,
          importanceScore: meta.importanceScore,
          scopeScore: meta.scopeScore,
          tags: meta.tags,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          palaceRef: meta.currentPalaceRef,
          version: meta.versionChain?.[meta.versionChain.length - 1]?.version ?? 1,
          isLatestVersion: meta.isLatestVersion,
          summary: meta.versionChain?.[meta.versionChain.length - 1]?.summary,
        } as any,
      };
    });

    if (missingVectorCount.value > 0) {
      this.logger.warn('Missing vectors detected, using importance as proxy score', {
        missingCount: missingVectorCount.value,
        totalCount: metas.length,
      });
    }

    return this.enrichMemories(vectorResults, metas, '');
  }

  /**
   * 更新记忆的召回统计
   * 包括 lastRecalledAt 和 recallCount
   *
   * 注意：lastAccessedAt 是一个派生字段，在构建 Memory 对象时从 lastRecalledAt 派生。
   * 两者代表不同的语义：
   * - lastRecalledAt: 最后语义召回时间（用于遗忘/降级计算）
   * - lastAccessedAt: 最后访问时间（用于 UI 显示，实际上等于 lastRecalledAt）
   *
   * 为什么不分开维护？
   * 因为"访问"和"召回"在当前实现中是等价的 - 每次访问记忆都是通过召回流程。
   * 如果未来需要支持"访问但不计入召回"的场景，需要扩展 MemoryMetaRecord schema。
   */
  private async updateRecallStats(uids: string[], now: number): Promise<void> {
    try {
      const metas = await this.metaStore.getByIds(uids);
      const updatePromises = metas.map(meta => {
        const newRecallCount = (meta.recallCount || 0) + 1;
        return this.metaStore.update(meta.uid, {
          lastRecalledAt: now,
          recallCount: newRecallCount,
        });
      });
      await Promise.all(updatePromises);
      this.logger.debug('Updated recall stats', { count: uids.length });
    } catch (error) {
      this.logger.warn('Failed to update recall stats', { error: String(error) });
    }
  }

  /**
   * 根据 UID 获取单条记忆
   */
  async get(uid: string): Promise<RecallMemory | null> {
    const memories = await this.getByIds([uid]);
    return memories.length > 0 ? memories[0] : null;
  }

  /**
   * 查找相似记忆
   */
  async searchSimilar(content: string, limit?: number): Promise<RecallMemory[]> {
    const queryVector = await this.embedder(content);

    const results = await this.vectorStore.search({
      query: content,
      queryVector,
      limit: limit ?? this.config.defaultLimit,
      minScore: this.config.minSimilarity,
    });

    if (results.length === 0) {
      return [];
    }

    const uids = results.map((r) => r.id);
    const metas = await this.metaStore.getByIds(uids);

    return this.enrichMemories(results, metas, '');
  }

  /**
   * 获取召回统计
   */
  async getRecallStats(): Promise<RecallStats> {
    const stats = await this.metaStore.getStats();

    const metas = await this.metaStore.query({
      isLatestVersion: true,
      limit: 10000,
    });

    const byScope: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let totalImportance = 0;

    for (const meta of metas) {
      byScope[meta.scope] = (byScope[meta.scope] ?? 0) + 1;
      byType[meta.type] = (byType[meta.type] ?? 0) + 1;
      totalImportance += meta.importanceScore;
    }

    return {
      totalMemories: metas.length,
      byScope: byScope as Record<MemoryScope, number>,
      byType: byType as Record<MemoryType, number>,
      averageImportance: metas.length > 0 ? totalImportance / metas.length : 0,
    };
  }

  /**
   * 缓存预热：将召回的记忆写入 L1 Cache
   * 这样下次召回同一记忆时可以命中缓存，减少延迟
   * 使用 Promise 缓存确保相同记忆集合只执行一次预热
   */
  private async warmupCache(memories: RecallMemory[]): Promise<void> {
    if (memories.length === 0) {
      return;
    }

    // 生成唯一 key（基于记忆 UID 排序）
    const key = memories.map(m => m.uid).sort().join(',');

    // 如果已有相同记忆集合的预热在进行中，等待其完成
    if (this.warmupPromises.has(key)) {
      this.logger.debug('Cache warmup already in progress, waiting', { count: memories.length, key });
      return this.warmupPromises.get(key)!;
    }

    // 创建新的预热 Promise
    const promise = this.doWarmup(memories).finally(() => {
      this.warmupPromises.delete(key);
    });
    this.warmupPromises.set(key, promise);

    return promise;
  }

  /**
   * 执行实际的缓存预热
   */
  private async doWarmup(memories: RecallMemory[]): Promise<void> {
    try {
      // 构建 CacheEntry 格式的数据（包含 Memory 类型所需的所有字段）
      const cacheEntries = memories.map(memory => ({
        uid: memory.uid,
        version: memory.version,
        content: memory.content,
        summary: memory.summary,
        type: memory.type,
        agentId: memory.agentId,
        sessionId: memory.sessionId,
        importance: memory.importance,
        scopeScore: memory.scopeScore,
        scope: memory.scope,
        block: memory.block,
        palace: memory.palace,
        isLatestVersion: memory.isLatestVersion,
        versionChain: memory.versionChain,
        accessCount: memory.accessCount,
        recallCount: memory.recallCount,
        usedByAgents: memory.usedByAgents,
        tags: memory.tags,
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
        lastAccessedAt: memory.lastAccessedAt,
        metadata: memory.metadata ?? {},
        lifecycle: memory.lifecycle ?? { createdAt: memory.createdAt, events: [] },
      }));

      // 批量写入缓存
      await this.cacheManager.setMany(cacheEntries as any);

      this.logger.debug('Cache warmup completed', { count: memories.length });
    } catch (error) {
      this.logger.warn('Cache warmup failed, continuing without cache', { error: String(error) });
    }
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 按作用域召回
   */
  private async recallByScope(params: {
    query?: string;
    queryVector: number[];
    scope?: MemoryScope;
    agentId?: string;
    agentIdNotEq?: string;
    sessionId?: string;
    currentAgentId: string;
    excludeUids: string[];
    type?: MemoryType;
    types?: MemoryType[];
    tags?: string[];
    timeRange?: { start: number; end: number };
    limit: number;
  }): Promise<{ memories: RecallMemory[] }> {
    // 1. SQLite 过滤获取候选 UIDs
    const candidates = await this.metaStore.query({
      scope: params.scope,
      scopes: params.scope ? undefined : [MemoryScope.SESSION, MemoryScope.AGENT, MemoryScope.GLOBAL],
      agentId: params.agentId,
      agentIdNotEq: params.agentIdNotEq,
      sessionId: params.sessionId,
      types: params.types,
      type: params.type,
      tags: params.tags,
      timeRange: params.timeRange,
      isLatestVersion: true,
      limit: params.limit * 2,
      orderBy: 'importanceScore',
      orderDir: 'desc',
    });

    if (candidates.length === 0) {
      return { memories: [] };
    }

    // 2. 过滤已排除的 UID
    const filteredCandidates = candidates.filter(
      (c) => !params.excludeUids.includes(c.uid)
    );

    if (filteredCandidates.length === 0) {
      return { memories: [] };
    }

    // ============================================================
    // AAAK 预筛选：使用 AAAK 格式快速过滤和排序候选记忆
    // 在向量搜索之前进行，可以减少向量搜索的候选数量
    // ============================================================
    let prescreenedCandidateUids: string[];
    if (params.query && params.query.trim().length > 0) {
      try {
        // 使用 AAAK 预筛选对候选进行排序
        prescreenedCandidateUids = await prescreenByAAAK(
          params.query,
          filteredCandidates.map(c => c.uid),
          this.metaStore
        );
        this.logger.debug('AAAK prescreening applied', {
          originalCount: filteredCandidates.length,
          queryLength: params.query.length,
        });
      } catch (aaakError) {
        // AAAK 预筛选失败时，回退到使用原始候选列表
        this.logger.warn('AAAK prescreening failed, falling back to original candidates', {
          error: String(aaakError),
        });
        prescreenedCandidateUids = filteredCandidates.map(c => c.uid);
      }
    } else {
      // 无查询文本时，按重要性排序
      prescreenedCandidateUids = filteredCandidates
        .sort((a, b) => b.importanceScore - a.importanceScore)
        .map(c => c.uid);
    }

    // 3. 向量搜索（若无 queryVector，则直接将候选作为结果，按重要性返回）
    // 注意：当无 queryVector 时，这不是语义相似度搜索，而是按重要性排序
    // score 字段此时表示的是重要性比例 (importanceScore / 10)，不是真正的相似度
    if (!params.queryVector || params.queryVector.length === 0) {
      const importanceBasedResults: VectorSearchResult[] = filteredCandidates
        .sort((a, b) => b.importanceScore - a.importanceScore)
        .slice(0, params.limit)
        .map((c) => ({
          id: c.uid,
          score: c.importanceScore / 10, // 重要性比例，不是相似度
          metadata: {
            uid: c.uid,
            agentId: c.agentId,
            sessionId: c.sessionId,
            scope: c.scope,
            type: c.type,
            importanceScore: c.importanceScore,
            scopeScore: c.scopeScore,
            tags: c.tags,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
            palaceRef: c.currentPalaceRef,
            version: c.versionChain?.[c.versionChain.length - 1]?.version ?? 1,
            isLatestVersion: c.isLatestVersion,
            versionGroupId: c.versionGroupId,
            summary: c.versionChain?.[c.versionChain.length - 1]?.summary,
          } as any,
        }));
      const memories = await this.enrichMemories(importanceBasedResults, filteredCandidates, params.currentAgentId);
      return { memories };
    }
    const vectorResults = await this.vectorStore.search({
      query: params.query,
      queryVector: params.queryVector,
      limit: params.limit,
      minScore: this.config.minSimilarity,
      filters: {
        uids: prescreenedCandidateUids,
        agentId: params.agentId,
        scope: params.scope,
        type: params.type,
        scopes: params.scope ? undefined : [MemoryScope.SESSION, MemoryScope.AGENT, MemoryScope.GLOBAL],
      },
    });

    // 4. 过滤已召回的和嵌入失败的记忆
    // 嵌入失败的记忆使用零向量，相似度计算无意义，应排除
    const finalFiltered = vectorResults.filter(
      (r) => !params.excludeUids.includes(r.id) && !(r.metadata as any)?.embeddingFailed
    );

    if (finalFiltered.length === 0) {
      return { memories: [] };
    }

    // 5. BM25 重排序（使用混合搜索提升召回质量）
    if (params.query && params.query.trim().length > 0) {
      try {
        // 获取 palace 内容用于 BM25 评分
        const palaceRefs = finalFiltered.map(r => r.metadata.palaceRef);
        const contents = await this.palaceStore.retrieveMany(palaceRefs);

        // 构建 BM25 输入（使用相似度 1-distance 转换）
        const bm25Input = finalFiltered.map(r => ({
          uid: r.id,
          text: contents.get(r.metadata.palaceRef) || '',
          distance: 1 - r.score, // convert similarity to distance for BM25
          metadata: r.metadata as unknown as Record<string, unknown>,
        }));

        // 执行 BM25 重排序，使用配置的权重
        // 注意：HybridSearchConfig 中是 bm25Weight，对应配置中的 keywordWeight
        const reranked = rerankWithBM25(bm25Input, params.query, {
          vectorWeight: this.config.vectorWeight,
          bm25Weight: this.config.keywordWeight,
        });

        // 根据重排序结果调整 finalFiltered 的顺序
        const rerankedMap = new Map(reranked.map((r, i) => [r.uid, { rank: i, score: r.combinedScore }]));
        finalFiltered.sort((a, b) => {
          const aInfo = rerankedMap.get(a.id);
          const bInfo = rerankedMap.get(b.id);
          if (!aInfo || !bInfo) return 0;
          return aInfo.rank - bInfo.rank;
        });

        // 更新分数为 BM25 综合得分
        for (const r of finalFiltered) {
          const info = rerankedMap.get(r.id);
          if (info) {
            r.score = info.score;
          }
        }

        this.logger.debug('BM25 reranking applied', {
          queryLength: params.query.length,
          resultCount: finalFiltered.length,
        });
      } catch (bm25Error) {
        // BM25 重排序失败时，继续使用原始向量搜索结果
        this.logger.warn('BM25 reranking failed, using vector search results', {
          error: String(bm25Error),
        });
      }
    }

    // 6. 补全记忆信息
    const memories = await this.enrichMemories(finalFiltered, filteredCandidates, params.currentAgentId);

    return { memories };
  }

  /**
   * 补全记忆信息（包含 Palace + 知识图谱 + 版本链）
   */
  private async enrichMemories(
    vectorResults: VectorSearchResult[],
    candidates: MemoryMetaRecord[],
    currentAgentId: string
  ): Promise<RecallMemory[]> {
    if (vectorResults.length === 0) {
      return [];
    }

    // 1. 批量获取 Palace 内容
    const palaceRefs = vectorResults.map((r) => r.metadata.palaceRef);
    const contents = await this.palaceStore.retrieveMany(palaceRefs);

    // 2. 批量获取图谱关系（避免 N+1 查询）
    const uids = vectorResults.map((r) => r.id);
    const relationsMap = await this.getMemoryRelationsBatch(uids, currentAgentId);

    // 3. 查找最高重要性评分用于计算 ratio
    const maxImportance = Math.max(
      ...vectorResults.map((r) => r.metadata.importanceScore),
      1
    );

    // 4. 组装记忆
    const memories: RecallMemory[] = [];

    // 优化：用 Map 索引 candidates，避免 O(n²) 的 find 操作
    const candidatesMap = new Map(candidates.map((c) => [c.uid, c]));

    for (const result of vectorResults) {
      const meta = candidatesMap.get(result.id);
      if (!meta) continue;

      const content = contents.get(result.metadata.palaceRef) ?? '';

      // 5. 从批量结果中获取图谱关联
      const relations = relationsMap.get(result.id);

      // 6. 获取版本链
      const versionChain = this.config.includeVersionChain
        ? this.getVersionChain(meta)
        : [];

      // 7. 直接从 meta 获取 sessionId（不从 tags 提取）
      const sessionId = meta.sessionId;

      // 8. 派生 block 字段（根据 importance 计算）
      const block = deriveBlock(result.metadata.importanceScore);

      // 9. 组装 palace 对象
      const palace = {
        wingId: meta.palace.wingId,
        hallId: meta.palace.hallId,
        roomId: meta.palace.roomId,
        palaceRef: result.metadata.palaceRef,
      };

      // 10. 召回次数 / 访问次数
      const recallCount = meta.recallCount ?? 0;
      const lastAccessedAt = meta.lastRecalledAt ?? meta.updatedAt ?? meta.createdAt;

      // 11. 生命周期（最小实现：仅含创建事件）
      const lifecycle = {
        createdAt: result.metadata.createdAt,
        events: [
          {
            type: 'created' as const,
            timestamp: result.metadata.createdAt,
          },
        ],
      };

      memories.push({
        uid: result.id,
        version: result.metadata.version,
        content,
        summary: result.metadata.summary ?? content.substring(0, 200),
        type: result.metadata.type,
        importance: result.metadata.importanceScore,
        importanceRatio: result.metadata.importanceScore / maxImportance,
        scopeScore: result.metadata.scopeScore,
        scope: result.metadata.scope,
        block,
        palace,
        agentId: result.metadata.agentId,
        sessionId,
        createdAt: result.metadata.createdAt,
        updatedAt: meta.updatedAt,
        lastAccessedAt,
        accessCount: recallCount,
        usedByAgents: meta.usedByAgents ?? [result.metadata.agentId],
        isLatestVersion: result.metadata.isLatestVersion,
        versionChain,
        palaceRef: result.metadata.palaceRef,
        tags: result.metadata.tags ?? [],
        recallCount,
        lifecycle,
        metadata: {
          versionGroupId: result.metadata.versionGroupId,
          source: 'recalled',
          extractedAt: Date.now(),
        },
        relations,
      });
    }

    return memories;
  }

  /**
   * 批量获取记忆的知识图谱关联（避免 N+1 查询）
   */
  private async getMemoryRelationsBatch(
    uids: string[],
    _currentAgentId: string
  ): Promise<Map<string, RecallMemory['relations'] | undefined>> {
    const relationsMap = new Map<string, RecallMemory['relations'] | undefined>();

    if (uids.length === 0) {
      return relationsMap;
    }

    try {
      // 1. 批量获取所有记忆的相关记忆
      const allRelatedResults = await Promise.all(
        uids.map(uid => this.graphStore.findRelated(uid, 5))
      );

      // 2. 批量获取所有记忆的图谱边
      const allEdgesResults = await Promise.all(
        uids.map(uid => this.graphStore.getNodeEdges(uid))
      );

      // 3. 收集所有需要查询的节点 ID
      const allNodeIdsToQuery = new Set<string>();
      for (const edges of allEdgesResults) {
        for (const edge of edges) {
          allNodeIdsToQuery.add(edge.sourceId);
          allNodeIdsToQuery.add(edge.targetId);
        }
      }

      // 4. 批量获取所有实体（使用批量查询接口）
      const allEntitiesResults = new Map<string, GraphNodeRecord | null>();
      if (allNodeIdsToQuery.size > 0) {
        const uniqueNodeIds = Array.from(allNodeIdsToQuery);
        // 使用批量查询接口替代 N 个独立查询
        const entitiesMap = await this.graphStore.getEntitiesByIds(uniqueNodeIds);
        for (const [nodeId, entity] of entitiesMap) {
          allEntitiesResults.set(nodeId, entity);
        }
      }

      // 5. 组装每个记忆的关联关系
      for (let i = 0; i < uids.length; i++) {
        const uid = uids[i];
        const related = allRelatedResults[i];
        const edges = allEdgesResults[i];

        // 获取相关实体
        const entities: GraphNodeRecord[] = [];
        for (const edge of edges) {
          const nodeId = edge.sourceId === uid ? edge.targetId : edge.sourceId;
          const entity = allEntitiesResults.get(nodeId);
          if (entity) {
            entities.push(entity);
          }
        }

        relationsMap.set(uid, {
          relatedMemories: related.map((r) => ({
            uid: r.uid,
            relation: r.relation,
            weight: r.weight,
          })),
          entities,
          edges,
        });
      }
    } catch (error) {
      this.logger.warn('Failed to get memory relations batch', { uidCount: uids.length, error: String(error) });
      // 失败时返回空 Map，让每个记忆的 relations 为 undefined
      for (const uid of uids) {
        relationsMap.set(uid, undefined);
      }
    }

    return relationsMap;
  }

  /**
   * 获取版本链
   */
  private getVersionChain(meta: MemoryMetaRecord): VersionInfo[] {
    return meta.versionChain ?? [];
  }

  /**
   * 重要性过滤
   */
  private filterByImportance(memories: RecallMemory[]): RecallMemory[] {
    return memories.filter(
      (m) => m.importanceRatio >= this.config.minImportanceRatio
    );
  }

  /**
   * 排序
   */
  private sortMemories(
    memories: RecallMemory[],
    sortBy: 'relevance' | 'time' | 'importance'
  ): RecallMemory[] {
    const sorted = [...memories];

    switch (sortBy) {
      case 'importance':
        return sorted.sort((a, b) => b.importance - a.importance);
      case 'time':
        return sorted.sort((a, b) => b.createdAt - a.createdAt);
      case 'relevance':
      default:
        return sorted.sort((a, b) => b.importanceRatio - a.importanceRatio);
    }
  }

  /**
   * 强化记忆评分（仅更新分数，不触发作用域升级）
   *
   * 强化规则：
   * - importanceScore：每次召回 +0.3 ~ +0.5（根据当前值动态）
   * - scopeScore：被其他Agent召回时 +0.5
   * - recallCount：每次召回 +1
   *
   * 注意：作用域升级不在这里处理，统一通过 checkAndUpgradeScope() 或
   * degradationManager 的作用域升级逻辑来处理，避免双重升级逻辑。
   *
   * 重要性强化幅度：
   * - 低重要性 (0-3): +0.5
   * - 中重要性 (3-6): +0.3
   * - 高重要性 (6-10): +0.1
   */
  private async applyReinforcement(
    memories: RecallMemory[],
    currentAgentId: string
  ): Promise<void> {
    if (memories.length === 0) {
      return;
    }

    const now = Date.now();

    try {
      const updatePromises: Promise<void>[] = [];

      for (const memory of memories) {
        // 计算重要性强化幅度（传入上次召回时间用于时间衰减）
        const importanceBoost = this.calculateImportanceBoost(memory.importance, memory.lastAccessedAt);

        // 计算作用域强化幅度（仅当被其他Agent召回时）
        let scopeBoost = 0;
        if (memory.agentId !== currentAgentId) {
          scopeBoost = this.config.scopeBoost;
        }

        // 计算新的评分（不超过上限）
        const newImportance = Math.min(memory.importance + importanceBoost, 10);
        const newScopeScore = Math.min(memory.scopeScore + scopeBoost, 10);
        const newRecallCount = (memory.recallCount || 0) + 1;

        // 更新 usedByAgents（追加当前 agent，去重）
        const existingAgents = memory.usedByAgents ?? [memory.agentId];
        const newUsedByAgents = existingAgents.includes(currentAgentId)
          ? existingAgents
          : [...existingAgents, currentAgentId];

        // 只更新评分，不触发作用域升级
        // 作用域升级统一通过 checkAndUpgradeScope() 或 degradationManager 处理
        // 注意：同时更新 metaStore 和 vectorStore 的 importanceScore/scopeScore
        // 以确保向量搜索结果能反映强化后的重要性变化
        const metaUpdatePromise = this.metaStore
          .update(memory.uid, {
            importanceScore: newImportance,
            scopeScore: newScopeScore,
            lastRecalledAt: now,
            recallCount: newRecallCount,
            usedByAgents: newUsedByAgents,
          })
          .catch((error) => {
            this.logger.warn('Failed to apply reinforcement to metaStore', {
              uid: memory.uid,
              error: String(error),
            });
          });

        // 同时更新向量索引中的元数据，确保搜索能反映新的重要性评分
        const vectorUpdatePromise = this.vectorStore
          .updateMetadata(memory.uid, {
            importanceScore: newImportance,
            scopeScore: newScopeScore,
          })
          .catch((error) => {
            this.logger.warn('Failed to apply reinforcement to vectorStore', {
              uid: memory.uid,
              error: String(error),
            });
          });

        updatePromises.push(metaUpdatePromise, vectorUpdatePromise);
      }

      await Promise.all(updatePromises);

      this.logger.debug('Applied reinforcement to recalled memories', {
        count: memories.length,
        currentAgentId,
        timestamp: now,
      });
    } catch (error) {
      this.logger.warn('Batch reinforcement failed', { error: String(error) });
    }
  }

  /**
   * 检查是否应该升级作用域（供外部调用）
   * 升级条件（使用配置）：
   * - SESSION → AGENT: importance >= sessionToAgentImportance
   * - AGENT → GLOBAL: scopeScore >= agentToGlobalScopeScore 且 importance >= agentToGlobalImportance
   *
   * 注意：此方法只返回是否应该升级，不执行实际升级操作。
   * 实际升级统一通过 degradationManager.upgradeScope() 处理，避免双重升级逻辑。
   */
  shouldUpgradeScope(
    scope: MemoryScope,
    importance: number,
    scopeScore: number
  ): { shouldUpgrade: boolean; newScope?: MemoryScope } {
    return shouldUpgradeScope(scope, importance, scopeScore);
  }

  /**
   * @deprecated 已废弃。请使用 StorageMemoryService.checkAndUpgradeScope() 或
   *             degradationManager.upgradeScope() 进行作用域升级。
   *             此方法不再执行实际升级操作，仅保留用于向后兼容。
   */
  private async updateAndUpgradeScope(
    _uid: string,
    _currentScope: MemoryScope,
    _newScope: MemoryScope,
    _agentId: string,
    _sessionId: string | undefined,
    _newImportance: number,
    _newScopeScore: number,
    _newRecallCount: number,
    _now: number,
    _currentAgentId: string,
    _newUsedByAgents?: string[]
  ): Promise<void> {
    // 此方法已废弃，作用域升级统一由 degradationManager 处理
    this.logger.warn('updateAndUpgradeScope is deprecated, use degradationManager.upgradeScope instead');
  }

  /**
   * 计算 Wing ID
   */
  private calculateWingId(scope: MemoryScope, agentId: string, sessionId?: string): string {
    switch (scope) {
      case MemoryScope.SESSION:
        return `session_${sessionId || 'default'}`;
      case MemoryScope.AGENT:
        return `agent_${agentId}`;
      case MemoryScope.GLOBAL:
        return 'global';
    }
  }

  /**
   * 计算重要性强化幅度
   * 根据当前重要性值和距上次召回的时间，动态计算强化幅度
   *
   * 时间衰减规则：
   * - 距上次召回 < 1 小时：全额强化
   * - 距上次召回 1-24 小时：衰减 50%
   * - 距上次召回 > 24 小时：衰减 80%
   */
  private calculateImportanceBoost(currentImportance: number, lastRecalledAt?: number): number {
    // 使用配置的强化阈值和增幅值
    const config = this.reinforcementConfig;
    let boost: number;
    if (currentImportance < config.lowBoostThreshold) {
      boost = config.lowBoost; // 低重要性记忆更容易被强化
    } else if (currentImportance < config.mediumBoostThreshold) {
      boost = config.mediumBoost; // 中重要性记忆
    } else if (currentImportance < config.highBoostThreshold) {
      boost = config.highBoost; // 高重要性记忆已经很强，只需小幅强化
    } else {
      boost = config.defaultBoost; // 极高重要性记忆维持稳定
    }

    // 时间衰减
    if (lastRecalledAt) {
      const hoursSinceLastRecall = (Date.now() - lastRecalledAt) / (1000 * 60 * 60);
      // 限制最大计算小时数为 48，避免极端情况下产生负数
      const cappedHours = Math.min(hoursSinceLastRecall, 48);
      if (cappedHours > 24) {
        // 超过 24 小时未召回，衰减 80%
        boost = boost * 0.2;
      } else if (cappedHours > 1) {
        // 1-24 小时之间，线性衰减到 50%
        const decayRate = 0.5 - (cappedHours - 1) * (0.5 / 23);
        boost = boost * Math.max(0.2, decayRate);
      }
      // < 1 小时，全额强化
    }

    return boost;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<RecallConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('Config updated', this.config as unknown as Record<string, unknown>);
  }

  /**
   * 获取配置
   */
  getConfig(): RecallConfig {
    return { ...this.config };
  }
}
