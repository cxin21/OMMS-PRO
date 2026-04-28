/**
 * DreamingManager - 记忆整理管理器
 * Dreaming Engine v2.0.0 核心入口
 *
 * 统一入口，编排三阶段整理流程:
 * - Phase 1: SCAN (扫描)
 * - Phase 2: ANALYZE (分析)
 * - Phase 3: EXECUTE (执行)
 *
 * @module dreaming-engine/dreaming-manager
 * @since v2.0.0
 */

import { createServiceLogger, type ILogger } from '../../shared/logging';
import { ObjectUtils } from '../../shared/utils/object';
import { IDGenerator } from '../../shared/utils/id-generator';
import type { StorageMemoryService } from '../memory/core/storage-memory-service';
import type { ILLMExtractor } from '../memory/llm/llm-extractor';
import type {
  IGraphStore,
  IPalaceStore,
  ISQLiteMetaStore,
  IVectorStore,
} from '../../infrastructure/storage/core/types';
import type {
  OrganizationInput,
  OrganizationReport,
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
import {
  OrganizationType,
  OrganizationStatus,
  MemoryPatternType,
  WeakAreaSeverity,
} from './types';
import { MemoryMerger } from './consolidation/memory-merger';
import { GraphReorganizer } from './graph/graph-reorganizer';
import { StorageOptimizer } from './storage/storage-optimizer';
import { DreamStorage } from './storage/dream-storage';
import { config } from '../../shared/config';
import { ConfigLoader } from '../../shared/config/loader';
import type { DreamingEngineConfig as DefaultDreamingEngineConfig } from '../../core/types/config';
import { MemoryScope, MemoryType } from '../../types/memory';

/**
 * 扫描阶段结果
 */
interface ScanResult {
  metrics: FragmentationMetrics;
  scannedCount: number;
  candidates: string[];
}

/**
 * 分析阶段结果
 */
interface AnalyzeResult {
  similarGroups: SimilarMemoryGroup[];
  brokenRelations: Array<{ from: string; to: string; reason: string }>;
  archivalCandidates: string[];
  orphanedNodes: string[];
  foundIssues: number;
}

/**
 * 执行阶段结果
 */
interface ExecuteResult {
  memoriesMerged: number;
  memoriesArchived: number;
  memoriesDeleted: number;
  relationsRebuilt: number;
  storageFreed: number;
  // Consolidation results (date-based memory consolidation)
  consolidationProcessedCount?: number;
  consolidationGroupsFormed?: number;
  consolidationNewVersions?: number;
  consolidationArchivedOldVersions?: number;
}

/**
 * 归纳整理结果
 */
interface ConsolidationResult {
  processedCount: number;      // 处理了多少条记忆
  groupsFormed: number;       // 形成多少组
  newVersionsCreated: number; // 新生成多少个版本
  archivedOldVersions: number; // 归档了多少旧版本
  errors: string[];            // 错误信息
}

/**
 * 归纳整理输入
 */
interface ConsolidationInput {
  /** 目标日期，默认今日 */
  date?: string;
  /** 最小分组大小，默认2 */
  minGroupSize?: number;
  /** 话题相似度阈值，默认0.7 */
  similarityThreshold?: number;
  /** 最大处理条数，默认100 */
  limit?: number;
}

/**
 * DreamingManager - 记忆整理管理器
 */
export class DreamingManager {
  private readonly logger: ILogger;
  private readonly config: DreamingEngineConfig;
  private readonly storage: DreamStorage;

  private memoryMerger!: MemoryMerger;
  private graphReorganizer!: GraphReorganizer;
  private storageOptimizer!: StorageOptimizer;

  private schedulerTimer?: NodeJS.Timeout;
  private initialized: boolean = false;

  // Active Learning 状态
  private discoveredPatterns: MemoryPattern[] = [];
  private identifiedWeakAreas: WeakArea[] = [];

  constructor(
    private memoryService: StorageMemoryService,
    private graphStore: IGraphStore,
    private palaceStore: IPalaceStore,
    private metaStore: ISQLiteMetaStore,
    private vectorStore: IVectorStore,
    userConfig?: Partial<DreamingEngineConfig>,
    private llmExtractor?: ILLMExtractor
  ) {
    this.logger = createServiceLogger('DreamingManager');

    // 合并配置：优先级 ConfigManager > userConfig > defaults
    const defaults = new ConfigLoader().loadDefaults();
    const defaultConfig = ObjectUtils.deepClone<DefaultDreamingEngineConfig>(defaults.dreamingEngine);

    if (userConfig && Object.keys(userConfig).length > 0) {
      // userConfig 提供的部分覆盖 defaults
      this.config = { ...defaultConfig, ...userConfig };
    } else {
      // 优先从 ConfigManager 读取配置，否则使用 defaults
      try {
        if (config.isInitialized()) {
          this.config = ObjectUtils.deepClone<DreamingEngineConfig>(config.getConfig('dreamingEngine'));
        } else {
          this.config = defaultConfig;
        }
      } catch {
        // ConfigManager 未初始化，使用默认配置
        this.config = defaultConfig;
      }
    }

    // 初始化存储
    // 注意：DreamStorage 需要 { dbPath?: string } 配置，但 DreamingEngineConfig 不包含 dbPath
    // 所以传空对象，让 DreamStorage 从 ConfigManager 读取 dbPath
    this.storage = new DreamStorage({});
  }

  /**
   * 获取 Active Learning 配置（从 dreamingEngine.activeLearning 读取）
   */
  private getActiveLearningConfig(): Required<ActiveLearningConfig> {
    const activeLearning = this.config?.activeLearning;
    if (!activeLearning) {
      throw new Error('DreamingManager: dreamingEngine.activeLearning configuration is required');
    }
    return {
      enabled: activeLearning.enabled ?? true,
      maxPatterns: activeLearning.maxPatterns ?? 100,
      maxWeakAreas: activeLearning.maxWeakAreas ?? 50,
      patternConfidenceThreshold: activeLearning.patternConfidenceThreshold ?? 0.5,
      weakAreaThresholds: {
        minScopeMemoryCount: activeLearning.weakAreaThresholds?.minScopeMemoryCount ?? 5,
        lowImportanceRatioThreshold: activeLearning.weakAreaThresholds?.lowImportanceRatioThreshold ?? 0.5,
      },
      highValueImportanceThreshold: activeLearning.highValueImportanceThreshold ?? 7,
      lowValueImportanceThreshold: activeLearning.lowValueImportanceThreshold ?? 3,
    };
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('DreamingManager 已经初始化');
      return;
    }

    this.logger.info('开始初始化 DreamingManager v2.0.0');

    // 初始化各组件
    this.memoryMerger = new MemoryMerger(
      this.memoryService,
      this.vectorStore,
      this.metaStore,
      this.config.consolidation,
      this.llmExtractor
    );

    this.graphReorganizer = new GraphReorganizer(
      this.graphStore,
      this.vectorStore,
      this.metaStore,
      this.config.reorganization
    );

    this.storageOptimizer = new StorageOptimizer(
      this.memoryService,
      this.palaceStore,
      this.metaStore,
      this.graphStore,
      this.config.archival,
      this.config.defragmentation
    );

    // 启动自动调度
    if (this.config.scheduler.autoOrganize) {
      this.startScheduler();
    }

    this.initialized = true;
    this.logger.info('DreamingManager 初始化完成');
  }

  /**
   * 关闭
   */
  async shutdown(): Promise<void> {
    this.logger.info('开始关闭 DreamingManager');
    this.stopScheduler();
    this.initialized = false;
    this.logger.info('DreamingManager 已关闭');
  }

  /**
   * 设置 LLM 提取器（在 initialize() 之后调用）
   * 用于在系统启动后注入 LLM 能力，支持记忆合并等高级功能
   */
  setLLMExtractor(extractor: ILLMExtractor): void {
    this.llmExtractor = extractor;
    // 重新初始化 MemoryMerger 以注入 LLM 提取器
    if (this.initialized) {
      this.memoryMerger = new MemoryMerger(
        this.memoryService,
        this.vectorStore,
        this.metaStore,
        this.config.consolidation,
        this.llmExtractor
      );
      this.logger.info('DreamingManager LLM Extractor 已更新');
    }
  }

  /**
   * 检查初始化状态
   */
  private checkInitialized(): void {
    if (!this.initialized) {
      throw new Error('DreamingManager 未初始化');
    }
  }

  // ============================================================
  // 主入口
  // ============================================================

  /**
   * 记忆整理主入口 - 编排三阶段流程
   *
   * 注意：此方法捕获错误后返回 FAILED 报告（不抛出异常），
   * 因此不使用 @withErrorBoundary 装饰器，而是保留内部 try-catch 记录错误。
   *
   * @param input - 可选的整理输入
   * @returns OrganizationReport 整理报告
   */
  async dream(input?: OrganizationInput): Promise<OrganizationReport> {
    this.checkInitialized();

    const reportId = IDGenerator.generate('org');
    const startTime = Date.now();

    this.logger.info('Starting memory organization', { reportId, type: input?.type ?? 'ALL' });

    const report: OrganizationReport = {
      id: reportId,
      type: input?.type ?? OrganizationType.ALL,
      status: OrganizationStatus.RUNNING,
      phases: {
        scan: { scannedCount: 0, candidateCount: 0, analyzedCount: 0, foundIssues: 0, duration: 0 },
        analyze: { scannedCount: 0, candidateCount: 0, analyzedCount: 0, foundIssues: 0, duration: 0 },
        execute: { scannedCount: 0, candidateCount: 0, analyzedCount: 0, foundIssues: 0, duration: 0 },
      },
      memoriesMerged: 0,
      memoriesArchived: 0,
      memoriesDeleted: 0,
      relationsRebuilt: 0,
      storageFreed: 0,
      executedAt: Date.now(),
      totalDuration: 0,
    };

    try {
      // Phase 1: SCAN
      const phase1Timer = this.logger.startTimer('dreaming.phase1.scan');
      const scanResult = await this.phase1Scan();
      phase1Timer.end();
      report.phases.scan = {
        scannedCount: scanResult.scannedCount,
        candidateCount: scanResult.candidates.length,
        analyzedCount: 0,
        foundIssues: 0,
        duration: Date.now() - startTime,
      };

      // Phase 2: ANALYZE
      const phase2Timer = this.logger.startTimer('dreaming.phase2.analyze');
      const analyzeStart = Date.now();
      const analyzeResult = await this.phase2Analyze(scanResult.candidates, input);
      phase2Timer.end();
      report.phases.analyze = {
        scannedCount: scanResult.scannedCount,
        candidateCount: scanResult.candidates.length,
        analyzedCount: analyzeResult.foundIssues,
        foundIssues: analyzeResult.foundIssues,
        duration: Date.now() - analyzeStart,
      };

      // Phase 3: EXECUTE
      const phase3Timer = this.logger.startTimer('dreaming.phase3.execute');
      const executeStart = Date.now();
      const executeResult = await this.phase3Execute(analyzeResult, input);
      phase3Timer.end();
      report.phases.execute = {
        scannedCount: scanResult.scannedCount,
        candidateCount: scanResult.candidates.length,
        analyzedCount: analyzeResult.foundIssues,
        foundIssues: executeResult.memoriesMerged + executeResult.memoriesArchived,
        duration: Date.now() - executeStart,
      };

      report.memoriesMerged = executeResult.memoriesMerged;
      report.memoriesArchived = executeResult.memoriesArchived;
      report.memoriesDeleted = executeResult.memoriesDeleted;
      report.relationsRebuilt = executeResult.relationsRebuilt;
      report.storageFreed = executeResult.storageFreed;

      // Include consolidation results in report
      report.consolidationProcessedCount = executeResult.consolidationProcessedCount;
      report.consolidationGroupsFormed = executeResult.consolidationGroupsFormed;
      report.consolidationNewVersions = executeResult.consolidationNewVersions;
      report.consolidationArchivedOldVersions = executeResult.consolidationArchivedOldVersions;

      report.status = OrganizationStatus.COMPLETED;
      report.totalDuration = Date.now() - startTime;

      this.logger.info('Memory organization completed', {
        reportId,
        memoriesMerged: report.memoriesMerged,
        memoriesArchived: report.memoriesArchived,
        memoriesDeleted: report.memoriesDeleted,
        relationsRebuilt: report.relationsRebuilt,
        storageFreed: report.storageFreed,
        consolidationProcessedCount: report.consolidationProcessedCount,
        consolidationGroupsFormed: report.consolidationGroupsFormed,
        consolidationNewVersions: report.consolidationNewVersions,
        consolidationArchivedOldVersions: report.consolidationArchivedOldVersions,
        totalDuration: report.totalDuration,
      });

      await this.storage.saveReport(report);

    } catch (error) {
      report.status = OrganizationStatus.FAILED;
      report.totalDuration = Date.now() - startTime;

      this.logger.error('Memory organization failed', error instanceof Error ? error : new Error(String(error)), {
        reportId,
      });
    }

    return report;
  }

  // ============================================================
  // 记忆归纳整理 (Consolidation)
  // ============================================================

  /**
   * 记忆归纳整理
   *
   * 模拟人类睡眠时的记忆整理过程
   * - 获取指定日期的记忆
   * - 按话题分组（使用向量相似度）
   * - 对每组记忆进行 LLM 归纳整理（保留完整性，仅提炼要点）
   * - 创建新版本来存储归纳结果
   *
   * @param input 归纳整理输入
   * @returns 归纳整理结果
   */
  async consolidateMemories(input?: ConsolidationInput): Promise<ConsolidationResult> {
    this.checkInitialized();

    const startTime = Date.now();
    const today = input?.date ?? new Date().toISOString().split('T')[0];
    const minGroupSize = input?.minGroupSize ?? 2;

    // 从配置获取相似度阈值，优先级：input > config
    let similarityThreshold: number;
    if (input?.similarityThreshold !== undefined) {
      similarityThreshold = input.similarityThreshold;
    } else {
      // 默认 similarityThreshold=0.85（来自 config.default.json）
      let resolvedThreshold = 0.85;
      if (config.isInitialized()) {
        const consolidationConfig = config.getConfig<{ similarityThreshold?: number }>('dreamingEngine.consolidation');
        if (consolidationConfig?.similarityThreshold) {
          resolvedThreshold = consolidationConfig.similarityThreshold;
        }
      }
      similarityThreshold = resolvedThreshold;
    }

    const limit = input?.limit ?? 100;

    this.logger.info('开始记忆归纳整理', {
      date: today,
      minGroupSize,
      similarityThreshold,
      limit,
    });

    const result: ConsolidationResult = {
      processedCount: 0,
      groupsFormed: 0,
      newVersionsCreated: 0,
      archivedOldVersions: 0,
      errors: [],
    };

    // 检查 LLM 是否可用
    if (!this.llmExtractor) {
      const errorMsg = 'LLM Extractor is required for memory consolidation';
      this.logger.error(errorMsg);
      result.errors.push(errorMsg);
      return result;
    }

    try {
      // Step 1: 获取指定日期的记忆
      const todayMemories = await this.getMemoriesByDate(today, limit);
      if (todayMemories.length === 0) {
        this.logger.info('指定日期没有记忆', { date: today });
        return result;
      }

      this.logger.debug('获取到当日记忆', {
        date: today,
        memoryCount: todayMemories.length,
      });

      // Step 2: 按话题分组
      const groups = await this.groupMemoriesByTopic(todayMemories, similarityThreshold);
      result.groupsFormed = groups.length;
      result.processedCount = todayMemories.length;

      this.logger.debug('记忆分组完成', {
        groupCount: groups.length,
        groups: groups.map(g => ({
          primaryMemory: g.primaryMemory,
          memberCount: g.mergedMemories.length + 1,
        })),
      });

      // Step 3: 对每组进行归纳整理
      for (const group of groups) {
        if (group.mergedMemories.length + 1 < minGroupSize) {
          this.logger.debug('跳过分组，成员数少于最小要求', {
            groupSize: group.mergedMemories.length + 1,
            minRequired: minGroupSize,
          });
          continue;
        }

        try {
          const consolidationResult = await this.consolidateGroup(group);
          if (consolidationResult.success) {
            result.newVersionsCreated++;
            result.archivedOldVersions += consolidationResult.archivedCount;
          } else if (consolidationResult.error) {
            result.errors.push(consolidationResult.error);
          }
        } catch (error) {
          const errorMsg = `归纳分组失败 ${group.primaryMemory}: ${error instanceof Error ? error.message : error}`;
          result.errors.push(errorMsg);
        }
      }

      this.logger.info('记忆归纳整理完成', {
        date: today,
        processedCount: result.processedCount,
        groupsFormed: result.groupsFormed,
        newVersionsCreated: result.newVersionsCreated,
        archivedOldVersions: result.archivedOldVersions,
        duration: Date.now() - startTime,
      });

    } catch (error) {
      const errorMsg = `记忆归纳整理失败: ${error instanceof Error ? error.message : error}`;
      this.logger.error('记忆归纳整理失败', error instanceof Error ? error : new Error(String(error)), {
        date: today,
      });
      result.errors.push(errorMsg);
    }

    return result;
  }

  /**
   * 获取指定日期的记忆
   * 注意: SQLiteMetaStore.query 不支持时间范围过滤，需要先查询足够多的记忆再过滤
   */
  private async getMemoriesByDate(date: string, limit: number): Promise<Array<{ uid: string; content: string; type: string; tags: string[] }>> {
    try {
      // 从 metaStore 获取指定日期范围的记忆
      // date 格式: YYYY-MM-DD
      const targetDate = new Date(date);
      const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0, 0).getTime();
      const endOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999).getTime();

      // 使用较高的 limit 值确保能获取到目标日期的记忆
      // 因为 SQLite 不支持时间范围过滤，我们需要先查询足够多的记忆再过滤
      const queryLimit = Math.max(limit, 1000);
      const memories = await this.metaStore.query({
        isLatestVersion: true,
        limit: queryLimit,
      });

      this.logger.debug('getMemoriesByDate 查询结果', {
        date,
        totalMemories: memories.length,
        startOfDay,
        endOfDay,
        sampleCreatedAt: memories[0]?.createdAt,
      });

      // 过滤出指定日期创建的记录
      const filtered = memories.filter(m => {
        const createdAtMs = typeof m.createdAt === 'number' ? m.createdAt : new Date(m.createdAt as Date).getTime();
        return createdAtMs >= startOfDay && createdAtMs <= endOfDay;
      });

      this.logger.debug('getMemoriesByDate 过滤结果', {
        date,
        filteredCount: filtered.length,
      });

      // 限制返回数量
      return filtered.slice(0, limit).map(m => ({
        uid: m.uid,
        content: '',
        type: m.type,
        tags: m.tags || [],
      }));
    } catch (error) {
      throw new Error(`获取指定日期记忆失败 (${date}): ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * 将记忆按话题分组
   */
  private async groupMemoriesByTopic(
    memories: Array<{ uid: string; content: string; type: string; tags: string[] }>,
    similarityThreshold: number
  ): Promise<SimilarMemoryGroup[]> {
    const groups: SimilarMemoryGroup[] = [];
    const processed = new Set<string>();

    // 获取所有记忆的内容和向量
    const memoryContents = await this.getMemoryContents(memories.map(m => m.uid));
    const memoryVectors = await this.getMemoryVectors(memories.map(m => m.uid));

    this.logger.debug('groupMemoriesByTopic 开始分组', {
      totalMemories: memories.length,
      vectorsFound: memoryVectors.size,
      contentsFound: memoryContents.size,
    });

    // 如果没有足够的向量，回退到基于标签的分组
    const vectorsAvailable = memoryVectors.size >= 2;

    if (!vectorsAvailable) {
      this.logger.debug('向量不足，使用基于标签的分组策略');
      return this.groupMemoriesByTags(memories, memoryContents);
    }

    // 基于向量的相似度分组
    for (const memory of memories) {
      if (processed.has(memory.uid)) continue;

      const vector = memoryVectors.get(memory.uid);
      if (!vector) continue;

      const similarMemories: string[] = [];
      let maxSimilarity = 0;

      // 查找相似的记忆
      for (const otherMemory of memories) {
        if (otherMemory.uid === memory.uid || processed.has(otherMemory.uid)) continue;

        const otherVector = memoryVectors.get(otherMemory.uid);
        if (!otherVector) continue;

        const similarity = this.cosineSimilarity(vector, otherVector);
        if (similarity >= similarityThreshold) {
          similarMemories.push(otherMemory.uid);
          maxSimilarity = Math.max(maxSimilarity, similarity);
          processed.add(otherMemory.uid);
        }
      }

      // 如果有相似记忆，形成一组
      if (similarMemories.length > 0) {
        processed.add(memory.uid);
        groups.push({
          primaryMemory: memory.uid,
          mergedMemories: similarMemories,
          similarity: maxSimilarity,
          reason: '话题相似',
          potentialSavings: similarMemories.length * 500,
        });
      }
    }

    return groups;
  }

  /**
   * 基于标签的记忆分组（向量不可用时的备选方案）
   */
  private groupMemoriesByTags(
    memories: Array<{ uid: string; content: string; type: string; tags: string[] }>,
    memoryContents: Map<string, string>
  ): SimilarMemoryGroup[] {
    const groups: SimilarMemoryGroup[] = [];
    const processed = new Set<string>();

    // 按标签分组
    const tagGroups = new Map<string, string[]>();
    for (const memory of memories) {
      const tags = memory.tags || [];
      for (const tag of tags) {
        if (!tagGroups.has(tag)) {
          tagGroups.set(tag, []);
        }
        tagGroups.get(tag)!.push(memory.uid);
      }
    }

    this.logger.debug('groupMemoriesByTags 标签分组结果', {
      tagCount: tagGroups.size,
      tags: Array.from(tagGroups.keys()),
    });

    // 找出有多个记忆的标签组
    for (const [tag, memoryIds] of tagGroups) {
      if (memoryIds.length < 2) continue;

      // 检查是否所有成员都未处理
      const unprocessed = memoryIds.filter(id => !processed.has(id));
      if (unprocessed.length < 2) continue;

      // 形成一组
      const primaryMemory = unprocessed[0];
      const mergedMemories = unprocessed.slice(1);

      for (const id of unprocessed) {
        processed.add(id);
      }

      groups.push({
        primaryMemory,
        mergedMemories,
        similarity: 0.8, // 假设标签相同的相似度为 0.8
        reason: `标签相同: ${tag}`,
        potentialSavings: mergedMemories.length * 500,
      });
    }

    this.logger.debug('groupMemoriesByTags 最终分组', {
      groupsFormed: groups.length,
      groups: groups.map(g => ({
        primary: g.primaryMemory.substring(0, 8),
        members: g.mergedMemories.length,
        reason: g.reason,
      })),
    });

    return groups;
  }

  /**
   * 获取记忆内容
   */
  private async getMemoryContents(memoryIds: string[]): Promise<Map<string, string>> {
    const contents = new Map<string, string>();

    for (const uid of memoryIds) {
      try {
        const memory = await this.memoryService.get(uid);
        if (memory) {
          contents.set(uid, memory.content || '');
        }
      } catch (error) {
        this.logger.warn('获取记忆内容失败', { uid, error });
      }
    }

    return contents;
  }

  /**
   * 获取记忆向量
   */
  private async getMemoryVectors(memoryIds: string[]): Promise<Map<string, number[]>> {
    const vectors = new Map<string, number[]>();

    for (const uid of memoryIds) {
      try {
        const vector = await this.vectorStore.getById(uid);
        if (vector) {
          vectors.set(uid, vector.vector);
        }
      } catch (error) {
        this.logger.warn('获取记忆向量失败', { uid, error });
      }
    }

    return vectors;
  }

  /**
   * 对一组记忆进行归纳整理
   */
  private async consolidateGroup(group: SimilarMemoryGroup): Promise<{
    success: boolean;
    archivedCount: number;
    error?: string;
  }> {
    const { primaryMemory, mergedMemories } = group;

    // 获取所有记忆的内容
    const allContents: string[] = [];
    const allIds: string[] = [primaryMemory, ...mergedMemories];

    for (const uid of allIds) {
      try {
        const memory = await this.memoryService.get(uid);
        if (memory) {
          allContents.push(memory.content || '');
        }
      } catch (error) {
        this.logger.warn('获取记忆内容失败', { uid });
      }
    }

    if (allContents.length < 2) {
      return { success: false, archivedCount: 0, error: '记忆内容不足' };
    }

    // 调用 LLM 进行归纳整理
    try {
      if (!this.llmExtractor) {
        return { success: false, archivedCount: 0, error: 'LLM Extractor not available' };
      }
      const consolidated = await this.llmExtractor.consolidateMemories(allContents);

      this.logger.debug('LLM 归纳完成', {
        primaryMemory,
        originalCount: allContents.length,
        consolidatedLength: consolidated.content.length,
      });

      // 使用 MemoryMerger 的方式更新主记忆（复用现有事务机制）
      // 注意：这里复用 mergeGroup 的事务机制，但使用 consolidateMemories 的结果
      // 需要先给 MemoryMerger 添加 consolidateGroup 方法，或者在这里直接处理

      // 直接调用 memoryService 创建新版本
      // 由于我们需要保留原始版本链，采用类似 MemoryMerger.mergeGroup 的方式

      // 生成正确的摘要和评分（与记忆捕获一样的处理方式）
      // 注意：必须始终调用 generateSummary 来生成短摘要（不超过50字符）
      // 因为 consolidateMemories 返回的 summary 可能是 fallback 的截断内容
      const summary = await this.llmExtractor.generateSummary(consolidated.content);
      const scores = await this.llmExtractor.generateScores(consolidated.content);

      this.logger.debug('归纳整理 - LLM 生成结果', {
        primaryMemory,
        summaryLength: summary.length,
        summary: summary.substring(0, 50),
        importance: scores.importance,
        scopeScore: scores.scopeScore,
        confidence: scores.confidence,
      });

      // 使用新的 consolidate() 方法创建新版本
      // - 新版本继承原始 UID
      // - 旧版本获得新 UID，isLatestVersion=false
      // - 标签合并（原始标签 + LLM 关键词）
      // - 归档 mergedMemories 中的记忆
      const existingMemory = await this.memoryService.get(primaryMemory);
      const originalTags = existingMemory?.tags || [];
      const mergedTags = this.mergeTags(originalTags, consolidated.keywords || []);

      const consolidateResult = await this.memoryService.consolidate(
        primaryMemory,
        {
          content: consolidated.content,
          summary: summary,
          tags: mergedTags,
          importance: scores.importance,
          scopeScore: scores.scopeScore,
        },
        {
          archiveSourceIds: mergedMemories,
          insights: consolidated.insights,
          sourceIds: allIds,
        }
      );

      this.logger.debug('归纳整理结果', {
        primaryMemory,
        summary: summary.substring(0, 100),
        keywords: consolidated.keywords,
        insights: consolidated.insights,
        importance: scores.importance,
        scopeScore: scores.scopeScore,
        newVersionId: consolidateResult.newVersionId,
        archivedCount: consolidateResult.archivedCount,
      });

      this.logger.info('归纳整理完成', {
        primaryMemory,
        consolidatedContentLength: consolidated.content.length,
        archivedCount: consolidateResult.archivedCount,
      });

      return { success: true, archivedCount: consolidateResult.archivedCount };

    } catch (error) {
      const errorMsg = `LLM 归纳失败: ${error instanceof Error ? error.message : error}`;
      return { success: false, archivedCount: 0, error: errorMsg };
    }
  }

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 合并标签（去重 + 保留原始）
   * 使用配置的最大标签数限制，默认为 10
   */
  private mergeTags(originalTags: string[], newTags: string[]): string[] {
    const maxTags = this.config.consolidation?.maxTagsPerMemory ?? 10;
    const tagSet = new Set<string>(originalTags);
    for (const tag of newTags) {
      tagSet.add(tag);
    }
    return Array.from(tagSet).slice(0, maxTags);
  }

  // ============================================================
  // Phase 1: SCAN
  // ============================================================

  /**
   * Phase 1: 扫描
   *
   * 扫描所有记忆，计算碎片化指标，决定是否需要整理
   */
  private async phase1Scan(): Promise<ScanResult> {
    const startTime = Date.now();

    this.logger.debug('Phase 1: SCAN starting');

    // 1. Calculate fragmentation metrics
    const metrics = await this.storageOptimizer.calculateFragmentation();
    this.logger.debug('Fragmentation metrics calculated', {
      palaceFragmentation: metrics.palaceFragmentation,
      graphEdgeDensity: metrics.graphEdgeDensity,
      orphanedMemories: metrics.orphanedMemories,
      staleMemories: metrics.staleMemories,
    });

    // 2. Get candidate memories to process
    const candidates = await this.findCandidates();
    this.logger.debug('Candidates found', { count: candidates.length });

    const result: ScanResult = {
      metrics,
      scannedCount: candidates.length,
      candidates,
    };

    this.logger.debug('Phase 1: SCAN completed', {
      scannedCount: result.scannedCount,
      candidateCount: result.candidates.length,
      duration: Date.now() - startTime,
    });

    return result;
  }

  /**
   * 查找候选记忆
   */
  private async findCandidates(): Promise<string[]> {
    try {
      // 从 SQLite 获取候选记忆
      const memories = await this.metaStore.query({
        isLatestVersion: true,
        limit: this.config.scheduler.maxMemoriesPerCycle,
      });

      return memories.map(m => m.uid);
    } catch (error) {
      this.logger.warn('查找候选记忆失败', {
        error: error instanceof Error ? error.message : error,
      });
      return [];
    }
  }

  // ============================================================
  // Phase 2: ANALYZE
  // ============================================================

  /**
   * Phase 2: 分析
   *
   * 分析候选记忆，生成处理任务列表
   * 使用并行执行优化性能
   */
  private async phase2Analyze(
    candidates: string[],
    input?: OrganizationInput
  ): Promise<AnalyzeResult> {
    const startTime = Date.now();

    this.logger.debug('Phase 2: ANALYZE starting', { candidateCount: candidates.length });

    const result: AnalyzeResult = {
      similarGroups: [],
      brokenRelations: [],
      archivalCandidates: [],
      orphanedNodes: [],
      foundIssues: 0,
    };

    // Determine organization type based on input
    const orgType = input?.type ?? OrganizationType.ALL;
    this.logger.debug('Organization type determined', { orgType });

    // Execute analysis in parallel
    const analysisPromises: Promise<void>[] = [];

    // 1. Memory consolidation analysis
    if (orgType === OrganizationType.CONSOLIDATION || orgType === OrganizationType.ALL) {
      this.logger.debug('Adding consolidation analysis task');
      analysisPromises.push(
        this.memoryMerger.findSimilarGroups(candidates).then(groups => {
          this.logger.debug('Similar groups found', { count: groups.length });
          result.similarGroups = groups;
        })
      );
    }

    // 2. Graph reorganization analysis (has dependency, execute serially)
    if (orgType === OrganizationType.REORGANIZATION || orgType === OrganizationType.ALL) {
      this.logger.debug('Adding reorganization analysis task');
      analysisPromises.push(
        (async () => {
          this.logger.debug('Finding orphaned nodes');
          const orphaned = await this.graphReorganizer.findOrphanedNodes();
          this.logger.debug('Orphaned nodes found', { count: orphaned.length });
          result.orphanedNodes = orphaned.map(o => o.nodeId);

          this.logger.debug('Analyzing gaps in graph');
          result.brokenRelations = await this.graphReorganizer.analyzeGaps();
          this.logger.debug('Broken relations found', { count: result.brokenRelations.length });
        })()
      );
    }

    // 3. Archival cleanup analysis
    if (orgType === OrganizationType.ARCHIVAL || orgType === OrganizationType.ALL) {
      this.logger.debug('Adding archival analysis task');
      const limit = input?.limit ?? this.config.scheduler.maxMemoriesPerCycle;
      analysisPromises.push(
        this.storageOptimizer.findArchivalCandidates(limit).then(candidates => {
          this.logger.debug('Archival candidates found', { count: candidates.length });
          result.archivalCandidates = candidates;
        })
      );
    }

    // Wait for all analysis to complete
    this.logger.debug('Waiting for all analysis tasks to complete');
    await Promise.all(analysisPromises);
    this.logger.debug('All analysis tasks completed');

    // Calculate total issues found
    result.foundIssues =
      result.similarGroups.length +
      result.brokenRelations.length +
      result.archivalCandidates.length +
      result.orphanedNodes.length;
    this.logger.debug('Total issues calculated', {
      similarGroups: result.similarGroups.length,
      brokenRelations: result.brokenRelations.length,
      archivalCandidates: result.archivalCandidates.length,
      orphanedNodes: result.orphanedNodes.length,
      totalFoundIssues: result.foundIssues,
    });

    this.logger.debug('Phase 2: ANALYZE completed', {
      similarGroups: result.similarGroups.length,
      brokenRelations: result.brokenRelations.length,
      archivalCandidates: result.archivalCandidates.length,
      orphanedNodes: result.orphanedNodes.length,
      foundIssues: result.foundIssues,
      duration: Date.now() - startTime,
    });

    return result;
  }

  // ============================================================
  // Phase 3: EXECUTE
  // ============================================================

  /**
   * Phase 3: 执行
   *
   * 执行分析阶段生成的任务
   * 使用并行执行优化性能：合并、关联重建、归档可以并行执行
   */
  private async phase3Execute(
    analyzeResult: AnalyzeResult,
    input?: OrganizationInput
  ): Promise<ExecuteResult> {
    const startTime = Date.now();

    this.logger.debug('Phase 3: EXECUTE starting');

    const result: ExecuteResult = {
      memoriesMerged: 0,
      memoriesArchived: 0,
      memoriesDeleted: 0,
      relationsRebuilt: 0,
      storageFreed: 0,
    };

    const limit = input?.limit ?? this.config.scheduler.maxMemoriesPerCycle;
    const maxRelations = this.config.scheduler.maxRelationsPerCycle;

    this.logger.debug('Execute parameters', { limit, maxRelations });

    // Execute independent operations in parallel with error handling
    // Each operation catches its own errors to avoid failing the entire batch
    this.logger.debug('Starting parallel execution with error handling');

    // 1. Execute memory merge (parallel with error handling)
    this.logger.debug('Starting memory merge operation');
    const mergePromise = (async () => {
      try {
        const groups = analyzeResult.similarGroups.slice(0, limit);
        this.logger.debug('Merge groups prepared', { groupCount: groups.length });

        const mergeResults = await Promise.all(
          groups.map(group => this.memoryMerger.mergeGroup(group).catch(err => {
            this.logger.warn('mergeGroup failed for group', { error: String(err), group: group.primaryMemory });
            return { mergedCount: 0, storageFreed: 0, errors: [String(err)] };
          }))
        );

        const mergedCount = mergeResults.reduce((sum, r) => sum + (r.mergedCount || 0), 0);
        const storageFreed = mergeResults.reduce((sum, r) => sum + (r.storageFreed || 0), 0);
        this.logger.debug('Merge operation completed', { mergedCount, storageFreed });

        return { mergedCount, storageFreed };
      } catch (err) {
        this.logger.error('Memory merge operation failed', { error: String(err) });
        return { mergedCount: 0, storageFreed: 0 };
      }
    })();

    // 2. Rebuild graph relations (parallel with error handling)
    this.logger.debug('Starting graph rebuild operation');
    const rebuildPromise = (async () => {
      try {
        let rebuiltCount = 0;
        const relations = analyzeResult.brokenRelations.slice(0, maxRelations);
        this.logger.debug('Relations to rebuild', { count: relations.length });

        // Execute rebuildRelation serially (each relation needs separate processing)
        for (const relation of relations) {
          try {
            const success = await this.graphReorganizer.rebuildRelation(relation);
            if (success) {
              rebuiltCount++;
            }
          } catch (err) {
            this.logger.warn('rebuildRelation failed for relation', {
              error: String(err),
              from: relation.from,
              to: relation.to
            });
          }
        }
        this.logger.debug('Rebuild operation completed', { rebuiltCount });

        return rebuiltCount;
      } catch (err) {
        this.logger.error('Graph rebuild operation failed', { error: String(err) });
        return 0;
      }
    })();

    // 3. Archive memories (parallel with error handling)
    this.logger.debug('Starting memory archive operation');
    const archivePromise = (async () => {
      try {
        return await this.storageOptimizer.archiveMemories(
          analyzeResult.archivalCandidates.slice(0, limit)
        );
      } catch (err) {
        this.logger.error('Archive operation failed', { error: String(err) });
        return 0;
      }
    })();

    // Wait for all parallel tasks to complete
    // Use safe version that doesn't fail completely if one task fails
    let mergeResult = { mergedCount: 0, storageFreed: 0 };
    let rebuiltCount = 0;
    let archivedCount = 0;

    this.logger.debug('Waiting for parallel tasks to complete');
    try {
      const results = await Promise.allSettled([mergePromise, rebuildPromise, archivePromise]);

      if (results[0].status === 'fulfilled') {
        mergeResult = results[0].value;
      }
      if (results[1].status === 'fulfilled') {
        rebuiltCount = results[1].value;
      }
      if (results[2].status === 'fulfilled') {
        archivedCount = results[2].value;
      }

      // Log any rejected promises
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          this.logger.warn(`Parallel task ${index} rejected`, { reason: result.reason });
        }
      });
    } catch (err) {
      this.logger.error('Unexpected error waiting for parallel tasks', { error: String(err) });
    }

    this.logger.debug('All parallel tasks completed', {
      mergeResult,
      rebuiltCount,
      archivedCount,
    });

    // Update results
    result.memoriesMerged = mergeResult.mergedCount;
    result.storageFreed = mergeResult.storageFreed;
    result.relationsRebuilt = rebuiltCount;
    result.memoriesArchived = archivedCount;

    // Supplement new relations (execute after all other operations)
    this.logger.debug('Supplementing new relations');
    const newRelations = await this.graphReorganizer.supplementRelations(
      maxRelations - result.relationsRebuilt
    );
    result.relationsRebuilt += newRelations;
    this.logger.debug('New relations supplemented', { newRelations, totalRelationsRebuilt: result.relationsRebuilt });

    // Execute date-based memory consolidation (Phase 3 extension)
    // Only execute if LLM extractor is available to avoid wasted cycles
    // This consolidates today's memories using LLM if available
    if (this.llmExtractor) {
      const consolidationStart = Date.now();
      const consolidationResult = await this.consolidateMemories();
      result.consolidationProcessedCount = consolidationResult.processedCount;
      result.consolidationGroupsFormed = consolidationResult.groupsFormed;
      result.consolidationNewVersions = consolidationResult.newVersionsCreated;
      result.consolidationArchivedOldVersions = consolidationResult.archivedOldVersions;
      this.logger.debug('Daily consolidation completed', {
        processedCount: consolidationResult.processedCount,
        groupsFormed: consolidationResult.groupsFormed,
        newVersionsCreated: consolidationResult.newVersionsCreated,
        archivedOldVersions: consolidationResult.archivedOldVersions,
        duration: Date.now() - consolidationStart,
      });
    } else {
      this.logger.debug('Daily consolidation skipped - no LLM extractor available');
    }

    this.logger.debug('Phase 3: EXECUTE completed', {
      memoriesMerged: result.memoriesMerged,
      memoriesArchived: result.memoriesArchived,
      memoriesDeleted: result.memoriesDeleted,
      relationsRebuilt: result.relationsRebuilt,
      storageFreed: result.storageFreed,
      duration: Date.now() - startTime,
    });

    return result;
  }

  // ============================================================
  // 调度器
  // ============================================================

  /**
   * 启动调度器
   */
  startScheduler(): void {
    if (this.schedulerTimer) {
      this.logger.warn('调度器已经在运行');
      return;
    }

    this.logger.info('启动记忆整理调度器', {
      interval: this.config.scheduler.organizeInterval,
    });

    this.scheduleNext();
  }

  /**
   * 停止调度器
   */
  stopScheduler(): void {
    if (this.schedulerTimer) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = undefined;
      this.logger.info('记忆整理调度器已停止');
    }
  }

  /**
   * 调度下一次整理
   */
  private async scheduleNext(): Promise<void> {
    if (!this.config.scheduler.autoOrganize) {
      return;
    }

    try {
      // 检查是否满足触发条件
      const shouldRun = await this.shouldTriggerOrganization();

      if (shouldRun) {
        this.logger.info('触发条件满足，执行记忆整理');
        await this.dream();
      } else {
        this.logger.debug('触发条件不满足，跳过本次整理');
      }
    } catch (error) {
      this.logger.warn('调度执行失败，将在下次调度时重试', {
        error: error instanceof Error ? error.message : error,
      });
    }

    // 调度下一次
    this.schedulerTimer = setTimeout(
      () => this.scheduleNext(),
      this.config.scheduler.organizeInterval
    );
  }

  /**
   * 检查是否应该触发整理
   */
  private async shouldTriggerOrganization(): Promise<boolean> {
    try {
      // 检查碎片化指标
      const metrics = await this.storageOptimizer.calculateFragmentation();

      // 检查是否需要碎片整理
      if (metrics.palaceFragmentation >= this.config.scheduler.fragmentationThreshold) {
        return true;
      }

      // 检查是否需要归档
      if (metrics.staleMemories >= this.config.scheduler.memoryThreshold / 10) {
        this.logger.debug('Trigger: staleMemories exceeds threshold', {
          staleMemories: metrics.staleMemories,
          threshold: this.config.scheduler.memoryThreshold / 10,
        });
        return true;
      }

      // 检查孤儿节点
      if (metrics.orphanedMemories >= this.config.scheduler.memoryThreshold / 5) {
        this.logger.debug('Trigger: orphanedMemories exceeds threshold', {
          orphanedMemories: metrics.orphanedMemories,
          threshold: this.config.scheduler.memoryThreshold / 5,
        });
        return true;
      }

      return false;
    } catch (error) {
      this.logger.warn('触发条件检查失败', {
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }

  // ============================================================
  // 统计和状态
  // ============================================================

  /**
   * 获取整理统计
   */
  async getStats(): Promise<{
    totalReports: number;
    lastReportAt?: number;
    avgDuration: number;
  }> {
    const reports = await this.storage.getAllReports();

    return {
      totalReports: reports.length,
      lastReportAt: reports.length > 0 ? reports[reports.length - 1].executedAt : undefined,
      avgDuration: reports.length > 0
        ? reports.reduce((sum: number, r: OrganizationReport) => sum + r.totalDuration, 0) / reports.length
        : 0,
    };
  }

  /**
   * 获取碎片化指标
   */
  async getFragmentationMetrics(): Promise<FragmentationMetrics> {
    return this.storageOptimizer.calculateFragmentation();
  }

  /**
   * 更新调度配置
   */
  updateSchedulerConfig(config: Partial<DreamingSchedulerConfig>): void {
    this.logger.debug('Updating scheduler config', { newConfig: config });
    this.config.scheduler = { ...this.config.scheduler, ...config };
    this.logger.info('Scheduler config updated', {
      autoOrganize: this.config.scheduler.autoOrganize,
      organizeInterval: this.config.scheduler.organizeInterval,
      fragmentationThreshold: this.config.scheduler.fragmentationThreshold,
      memoryThreshold: this.config.scheduler.memoryThreshold,
      maxMemoriesPerCycle: this.config.scheduler.maxMemoriesPerCycle,
      maxRelationsPerCycle: this.config.scheduler.maxRelationsPerCycle,
    });
  }

  /**
   * Update consolidation config
   */
  updateConsolidationConfig(config: Partial<ConsolidationConfig>): void {
    this.logger.debug('Updating consolidation config', { newConfig: config });
    this.config.consolidation = { ...this.config.consolidation, ...config };
    this.memoryMerger?.updateConfig(config);
    this.logger.info('Consolidation config updated', {
      similarityThreshold: this.config.consolidation.similarityThreshold,
      maxGroupSize: this.config.consolidation.maxGroupSize,
      preserveNewest: this.config.consolidation.preserveNewest,
      createNewVersion: this.config.consolidation.createNewVersion,
    });
  }

  /**
   * Update reorganization config
   */
  updateReorganizationConfig(config: Partial<ReorganizationConfig>): void {
    this.logger.debug('Updating reorganization config', { newConfig: config });
    this.config.reorganization = { ...this.config.reorganization, ...config };
    this.graphReorganizer?.updateConfig(config);
    this.logger.info('Reorganization config updated', {
      minEdgeWeight: this.config.reorganization.minEdgeWeight,
      densityTarget: this.config.reorganization.densityTarget,
      orphanThreshold: this.config.reorganization.orphanThreshold,
      maxNewRelationsPerCycle: this.config.reorganization.maxNewRelationsPerCycle,
    });
  }

  /**
   * Update archival config
   */
  updateArchivalConfig(config: Partial<ArchivalConfig>): void {
    this.logger.debug('Updating archival config', { newConfig: config });
    this.config.archival = { ...this.config.archival, ...config };
    this.storageOptimizer?.updateArchivalConfig(config);
    this.logger.info('Archival config updated', {
      importanceThreshold: this.config.archival.importanceThreshold,
      stalenessDays: this.config.archival.stalenessDays,
      retentionDays: this.config.archival.retentionDays,
      archiveBlock: this.config.archival.archiveBlock,
    });
  }

  /**
   * 获取所有整理报告历史
   */
  async getAllReports(): Promise<OrganizationReport[]> {
    return this.storage.getAllReports();
  }

  /**
   * 获取当前配置
   */
  getConfig(): DreamingEngineConfig {
    return this.config;
  }

  /**
   * 获取调度配置
   */
  getSchedulerConfig(): DreamingSchedulerConfig {
    return this.config.scheduler;
  }

  /**
   * 获取合并配置
   */
  getConsolidationConfig(): ConsolidationConfig {
    return this.config.consolidation;
  }

  /**
   * 获取图谱重构配置
   */
  getReorganizationConfig(): ReorganizationConfig {
    return this.config.reorganization;
  }

  /**
   * 获取归档配置
   */
  getArchivalConfig(): ArchivalConfig {
    return this.config.archival;
  }

  // ============================================================
  // Active Learning - 主动学习
  // ============================================================

  /**
   * 执行主动学习
   * 发现记忆模式和识别薄弱环节
   *
   * @param limit - 最大分析记忆数量
   * @returns Active Learning 结果
   */
  async performActiveLearning(limit: number = 500): Promise<ActiveLearningResult> {
    this.checkInitialized();
    const startTime = Date.now();

    this.logger.info('performActiveLearning 方法调用', { method: 'performActiveLearning', limit });

    const result: ActiveLearningResult = {
      patterns: [],
      weakAreas: [],
      analyzedCount: 0,
      duration: 0,
    };

    try {
      // 1. 获取记忆用于分析
      const memories = await this.metaStore.query({
        isLatestVersion: true,
        limit,
      });

      result.analyzedCount = memories.length;

      // 2. 发现模式
      const patterns = await this.discoverPatterns(memories);
      result.patterns = patterns;

      // 3. 识别薄弱环节
      const weakAreas = await this.identifyWeakAreas(memories);
      result.weakAreas = weakAreas;

      // 4. 更新存储的模式和薄弱环节
      this.discoveredPatterns.push(...patterns);
      this.identifiedWeakAreas.push(...weakAreas);

      // 限制存储数量
      const activeLearningConfig = this.getActiveLearningConfig();
      if (this.discoveredPatterns.length > activeLearningConfig.maxPatterns) {
        this.discoveredPatterns = this.discoveredPatterns.slice(-activeLearningConfig.maxPatterns);
      }
      if (this.identifiedWeakAreas.length > activeLearningConfig.maxWeakAreas) {
        this.identifiedWeakAreas = this.identifiedWeakAreas.slice(-activeLearningConfig.maxWeakAreas);
      }

      result.duration = Date.now() - startTime;

      this.logger.info('performActiveLearning 方法返回', {
        method: 'performActiveLearning',
        patternsFound: patterns.length,
        weakAreasFound: weakAreas.length,
        duration: result.duration,
      });
    } catch (error) {
      this.logger.error('performActiveLearning 失败', error instanceof Error ? error : new Error(String(error)));
    }

    return result;
  }

  /**
   * 发现记忆模式
   *
   * @param memories - 记忆列表
   * @returns 发现的模式列表
   */
  private async discoverPatterns(memories: any[]): Promise<MemoryPattern[]> {
    const patterns: MemoryPattern[] = [];

    // 1. 时间模式：查找同一时间段创建的记忆
    const temporalPatterns = this.findTemporalPatterns(memories);
    patterns.push(...temporalPatterns);

    // 2. 语义模式：查找标签共现的记忆
    const semanticPatterns = this.findSemanticPatterns(memories);
    patterns.push(...semanticPatterns);

    // 3. 重要性模式：查找重要性相似的记忆群
    const importancePatterns = this.findImportancePatterns(memories);
    patterns.push(...importancePatterns);

    return patterns;
  }

  /**
   * 查找时间模式
   */
  private findTemporalPatterns(memories: any[]): MemoryPattern[] {
    const patterns: MemoryPattern[] = [];

    // 按小时分组
    const hourGroups = new Map<number, string[]>();
    for (const memory of memories) {
      const hour = new Date(memory.createdAt).getHours();
      if (!hourGroups.has(hour)) {
        hourGroups.set(hour, []);
      }
      hourGroups.get(hour)!.push(memory.uid);
    }

    // 识别高峰时段（记忆数量超过平均2倍且至少3个记忆）
    const avgPerHour = memories.length / 24;
    for (const [hour, memoryIds] of hourGroups) {
      if (memoryIds.length > avgPerHour * 2 && memoryIds.length >= 3) {
        patterns.push({
          id: IDGenerator.generate('pattern'),
          type: MemoryPatternType.TEMPORAL,
          description: `高峰记忆创建时段：${hour}:00 - ${hour + 1}:00`,
          memoryIds,
          confidence: Math.min(memoryIds.length / 20, 1),
          discoveredAt: Date.now(),
        });
      }
    }

    // 按天分组
    const dayGroups = new Map<string, string[]>();
    for (const memory of memories) {
      const day = new Date(memory.createdAt).toISOString().split('T')[0];
      if (!dayGroups.has(day)) {
        dayGroups.set(day, []);
      }
      dayGroups.get(day)!.push(memory.uid);
    }

    // 识别高峰日
    const avgPerDay = memories.length / 30; // 假设30天周期
    for (const [day, memoryIds] of dayGroups) {
      if (memoryIds.length > avgPerDay * 2 && memoryIds.length >= 5) {
        patterns.push({
          id: IDGenerator.generate('pattern'),
          type: MemoryPatternType.TEMPORAL,
          description: `高峰记忆创建日：${day}`,
          memoryIds,
          confidence: Math.min(memoryIds.length / 50, 1),
          discoveredAt: Date.now(),
        });
      }
    }

    return patterns;
  }

  /**
   * 查找语义模式（基于标签共现）
   */
  private findSemanticPatterns(memories: any[]): MemoryPattern[] {
    const patterns: MemoryPattern[] = [];

    // 标签共现统计
    const tagCooccurrence = new Map<string, Map<string, number>>();

    for (const memory of memories) {
      const tags = memory.tags || [];
      for (const tag1 of tags) {
        if (!tagCooccurrence.has(tag1)) {
          tagCooccurrence.set(tag1, new Map());
        }
        for (const tag2 of tags) {
          if (tag1 !== tag2) {
            const count = (tagCooccurrence.get(tag1)!.get(tag2) || 0) + 1;
            tagCooccurrence.get(tag1)!.set(tag2, count);
          }
        }
      }
    }

    // 查找强关联标签（共现次数 >= 3）
    const threshold = this.getActiveLearningConfig().patternConfidenceThreshold;
    for (const [tag1, coocMap] of tagCooccurrence) {
      for (const [tag2, count] of coocMap) {
        if (count >= 3) {
          const associatedMemories = memories
            .filter(m => (m.tags || []).includes(tag1) && (m.tags || []).includes(tag2))
            .map(m => m.uid);

          const confidence = Math.min(count / 20, 1);
          if (confidence >= threshold) {
            patterns.push({
              id: IDGenerator.generate('pattern'),
              type: MemoryPatternType.SEMANTIC,
              description: `标签 "${tag1}" 和 "${tag2}" 经常一起出现`,
              memoryIds: associatedMemories,
              confidence,
              discoveredAt: Date.now(),
            });
          }
        }
      }
    }

    return patterns;
  }

  /**
   * 查找重要性模式
   */
  private findImportancePatterns(memories: any[]): MemoryPattern[] {
    const patterns: MemoryPattern[] = [];
    const highThreshold = this.getActiveLearningConfig().highValueImportanceThreshold;
    const lowThreshold = this.getActiveLearningConfig().lowValueImportanceThreshold;

    // 查找重要性相似的高价值记忆群（重要性 >= highThreshold）
    const highValueMemories = memories.filter(m => (m.importanceScore || 0) >= highThreshold);
    if (highValueMemories.length >= 3) {
      patterns.push({
        id: IDGenerator.generate('pattern'),
        type: MemoryPatternType.SEMANTIC,
        description: `高价值记忆群（重要性 >= ${highThreshold}）`,
        memoryIds: highValueMemories.map(m => m.uid),
        confidence: Math.min(highValueMemories.length / 50, 1),
        discoveredAt: Date.now(),
      });
    }

    // 查找低价值记忆群（重要性 < lowThreshold）
    const lowValueMemories = memories.filter(m => (m.importanceScore || 0) < lowThreshold);
    if (lowValueMemories.length >= 5) {
      patterns.push({
        id: IDGenerator.generate('pattern'),
        type: MemoryPatternType.SEMANTIC,
        description: `低价值记忆群（重要性 < ${lowThreshold}），建议进行归档清理`,
        memoryIds: lowValueMemories.map(m => m.uid),
        confidence: Math.min(lowValueMemories.length / 100, 1),
        discoveredAt: Date.now(),
      });
    }

    return patterns;
  }

  /**
   * 识别薄弱环节
   *
   * @param memories - 记忆列表
   * @returns 薄弱环节列表
   */
  private async identifyWeakAreas(memories: any[]): Promise<WeakArea[]> {
    const weakAreas: WeakArea[] = [];
    const thresholds = this.getActiveLearningConfig().weakAreaThresholds;

    // 1. 按 scope 统计记忆分布
    const scopeCounts = new Map<MemoryScope, number>();
    for (const memory of memories) {
      const scope = memory.scope as MemoryScope;
      scopeCounts.set(scope, (scopeCounts.get(scope) || 0) + 1);
    }

    // 检查作用域缺失
    const allScopes: MemoryScope[] = [MemoryScope.GLOBAL, MemoryScope.AGENT, MemoryScope.SESSION];
    for (const scope of allScopes) {
      const count = scopeCounts.get(scope) || 0;
      if (count === 0) {
        weakAreas.push({
          id: IDGenerator.generate('weakarea'),
          scope,
          description: `${scope} 作用域没有任何记忆`,
          severity: scope === MemoryScope.GLOBAL ? WeakAreaSeverity.HIGH : WeakAreaSeverity.MEDIUM,
          suggestedActions: [`在 ${scope} 作用域创建更多记忆`],
          identifiedAt: Date.now(),
        });
      } else if (count < thresholds.minScopeMemoryCount) {
        weakAreas.push({
          id: IDGenerator.generate('weakarea'),
          scope,
          description: `${scope} 作用域记忆数量过少（${count}）`,
          severity: WeakAreaSeverity.LOW,
          suggestedActions: [`考虑在 ${scope} 作用域添加更多记忆`],
          identifiedAt: Date.now(),
        });
      }
    }

    // 2. 检查低重要性记忆比例
    const lowImportanceMemories = memories.filter(m => (m.importanceScore || 0) < 3);
    const lowImportanceRatio = memories.length > 0 ? lowImportanceMemories.length / memories.length : 0;
    if (lowImportanceRatio > thresholds.lowImportanceRatioThreshold) {
      weakAreas.push({
        id: IDGenerator.generate('weakarea'),
        scope: MemoryScope.GLOBAL,
        description: `低重要性记忆比例过高（${(lowImportanceRatio * 100).toFixed(1)}%）`,
        severity: WeakAreaSeverity.MEDIUM,
        suggestedActions: ['考虑归档清理低重要性记忆', '审核重要性评分策略'],
        identifiedAt: Date.now(),
      });
    }

    // 3. 按类型统计缺失
    const typeCounts = new Map<MemoryType, number>();
    for (const memory of memories) {
      const type = memory.type as MemoryType;
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    }

    const importantTypes: MemoryType[] = [
      MemoryType.FACT,
      MemoryType.DECISION,
      MemoryType.ERROR,
      MemoryType.LEARNING,
    ];

    for (const type of importantTypes) {
      const count = typeCounts.get(type) || 0;
      if (count === 0) {
        weakAreas.push({
          id: IDGenerator.generate('weakarea'),
          scope: MemoryScope.GLOBAL,
          type,
          description: `系统中缺少 ${type} 类型的记忆`,
          severity: type === MemoryType.ERROR || type === MemoryType.DECISION
            ? WeakAreaSeverity.MEDIUM
            : WeakAreaSeverity.LOW,
          suggestedActions: [`添加更多 ${type} 类型的记忆`],
          identifiedAt: Date.now(),
        });
      }
    }

    // 4. 检查孤儿记忆（无图谱关联）
    try {
      const orphanedCount = await this.graphReorganizer.findOrphanedNodes();
      if (orphanedCount.length > 10) {
        weakAreas.push({
          id: IDGenerator.generate('weakarea'),
          scope: MemoryScope.GLOBAL,
          description: `存在大量孤儿记忆（${orphanedCount.length}个），图谱关联不足`,
          severity: WeakAreaSeverity.MEDIUM,
          suggestedActions: ['运行图谱重构整理', '为孤立记忆添加标签和关联'],
          identifiedAt: Date.now(),
        });
      }
    } catch (error) {
      this.logger.warn('检查孤儿记忆失败', { error });
    }

    // 5. 检查陈旧记忆
    // 使用 archival.stalenessDays 配置的阈值，而非硬编码 30 天
    const stalenessMs = (this.config.archival?.stalenessDays ?? 30) * 24 * 60 * 60 * 1000;
    const staleThreshold = Date.now() - stalenessMs;
    const staleMemories = memories.filter(m =>
      m.lastRecalledAt && m.lastRecalledAt < staleThreshold
    );
    if (staleMemories.length > memories.length * 0.3) {
      weakAreas.push({
        id: IDGenerator.generate('weakarea'),
        scope: MemoryScope.GLOBAL,
        description: `存在大量长期未访问的记忆（${staleMemories.length}个）`,
        severity: WeakAreaSeverity.LOW,
        suggestedActions: ['运行遗忘周期整理', '考虑归档或强化这些记忆'],
        identifiedAt: Date.now(),
      });
    }

    return weakAreas;
  }

  /**
   * 获取已发现的模式
   */
  getDiscoveredPatterns(): MemoryPattern[] {
    return [...this.discoveredPatterns];
  }

  /**
   * 获取已识别的薄弱环节
   */
  getIdentifiedWeakAreas(): WeakArea[] {
    return [...this.identifiedWeakAreas];
  }

  /**
   * 清除 Active Learning 数据
   */
  clearActiveLearningData(): void {
    this.discoveredPatterns = [];
    this.identifiedWeakAreas = [];
    this.logger.info('Active Learning 数据已清除');
  }

  // ============================================================
  // 增量图谱更新 (P3)
  // ============================================================

  /**
   * 执行增量图谱更新
   *
   * 定期调用此方法可以补充新关联、清理弱关联
   * 应该在梦境整理调度中定期执行
   *
   * @param options - 配置选项
   * @returns 更新结果
   */
  async performIncrementalGraphUpdate(options?: {
    maxNewRelations?: number;
    orphanedMemoryLimit?: number;
    cleanupWeakEdges?: boolean;
  }): Promise<{
    newRelations: number;
    orphanedProcessed: number;
    weakEdgesCleaned: number;
    orphanedMemories: number;
    duration: number;
  }> {
    this.checkInitialized();
    const startTime = Date.now();

    const maxNewRelations = options?.maxNewRelations ?? this.config.reorganization.maxNewRelationsPerCycle;
    const orphanedMemoryLimit = options?.orphanedMemoryLimit ?? 100;
    const cleanupWeakEdges = options?.cleanupWeakEdges ?? false;

    const result = {
      newRelations: 0,
      orphanedProcessed: 0,
      weakEdgesCleaned: 0,
      orphanedMemories: 0,
      duration: 0 as number,
    };

    this.logger.info('开始增量图谱更新', {
      maxNewRelations,
      orphanedMemoryLimit,
      cleanupWeakEdges,
    });

    try {
      // 1. 补充新关联（基于向量相似度）
      result.newRelations = await this.graphReorganizer.supplementRelations(maxNewRelations);
      this.logger.info('增量图谱更新：补充新关联完成', { newRelations: result.newRelations });

      // 2. 查找并处理孤儿记忆
      const orphanedNodes = await this.graphReorganizer.findOrphanedNodes();
      result.orphanedMemories = orphanedNodes.length;
      this.logger.info('增量图谱更新：发现孤儿记忆', { orphanedCount: orphanedNodes.length });

      // 3. 尝试为孤儿记忆建立关联（通过向量相似度搜索相关记忆）
      for (let i = 0; i < Math.min(orphanedNodes.length, orphanedMemoryLimit); i++) {
        const orphaned = orphanedNodes[i];
        try {
          // 使用向量搜索找到相似的已有记忆
          const memory = await this.memoryService.get(orphaned.nodeId);
          if (memory) {
            // 尝试通过向量搜索找到相关记忆并建立关联
            const relatedResult = await this.tryConnectOrphanedMemory(memory);
            if (relatedResult.connected) {
              result.orphanedProcessed++;
            }
          }
        } catch (error) {
          this.logger.warn('处理孤儿记忆失败', {
            memoryId: orphaned.nodeId,
            error: String(error),
          });
        }
      }

      // 4. 清理弱关联边（可选）
      if (cleanupWeakEdges) {
        result.weakEdgesCleaned = await this.graphReorganizer.cleanupWeakEdges();
        this.logger.info('增量图谱更新：清理弱关联完成', { weakEdgesCleaned: result.weakEdgesCleaned });
      }

      result.duration = Date.now() - startTime;
      this.logger.info('增量图谱更新完成', result);
    } catch (error) {
      this.logger.error('增量图谱更新失败', error instanceof Error ? error : new Error(String(error)));
      result.duration = Date.now() - startTime;
    }

    return result;
  }

  /**
   * 尝试为孤儿记忆建立关联
   *
   * 通过向量相似度搜索找到最相似的记忆，然后建立关联
   */
  private async tryConnectOrphanedMemory(
    memory: { uid: string; content: string; tags: string[] }
  ): Promise<{ connected: boolean; relatedMemoryId?: string }> {
    try {
      // 尝试从向量存储中获取该记忆的向量
      const vector = await this.vectorStore.getById(memory.uid);
      if (!vector) {
        this.logger.debug('孤儿记忆无向量，跳过', { memoryId: memory.uid });
        return { connected: false };
      }

      // 使用向量搜索找相似记忆
      const searchResults = await this.vectorStore.search({
        queryVector: vector.vector,
        limit: 5,
        minScore: 0.5, // 使用较低阈值以增加连接机会
      });

      // 过滤掉自己，找到最相似的相关记忆
      const candidates = searchResults.filter(r => r.id !== memory.uid);
      if (candidates.length === 0) {
        return { connected: false };
      }

      // 找到第一个可以作为关联的记忆
      for (const candidate of candidates) {
        try {
          // 建立关联
          await this.graphStore.addRelation(
            memory.uid,
            candidate.id,
            'discovered_related',
            candidate.score
          );
          this.logger.info('为孤儿记忆建立关联', {
            orphanedMemory: memory.uid,
            relatedMemory: candidate.id,
            weight: candidate.score,
          });
          return { connected: true, relatedMemoryId: candidate.id };
        } catch (error) {
          // 如果关联已存在或其他错误，继续尝试下一个
          this.logger.debug('建立关联失败', {
            from: memory.uid,
            to: candidate.id,
            error: String(error),
          });
        }
      }

      return { connected: false };
    } catch (error) {
      this.logger.warn('尝试连接孤儿记忆失败', {
        memoryId: memory.uid,
        error: String(error),
      });
      return { connected: false };
    }
  }

  /**
   * 获取图谱统计
   *
   * @returns 图谱统计信息
   */
  async getGraphStats(): Promise<{
    nodeCount: number;
    edgeCount: number;
    entityCount: number;
    edgeDensity: number;
    orphanedCount: number;
  }> {
    const stats = await this.graphStore.getStats();
    const orphanedNodes = await this.graphReorganizer.findOrphanedNodes();
    const edgeDensity = await this.graphReorganizer.calculateEdgeDensity();

    return {
      nodeCount: stats.nodeCount,
      edgeCount: stats.edgeCount,
      entityCount: stats.entityCount,
      edgeDensity,
      orphanedCount: orphanedNodes.length,
    };
  }
}
