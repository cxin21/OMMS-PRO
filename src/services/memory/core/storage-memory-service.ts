/**
 * Storage Memory Service - 基于新存储架构的记忆服务
 * @module memory-service/storage-memory-service
 *
 * 版本: v2.1.0
 * - 移除 scoringManager 依赖，评分由调用方提供或使用 LLM 直接评分
 * - store 方法需要调用方传入预计算的评分
 */

import type { Memory, MemoryInput, MemoryUpdate, RecallOptions } from '../../../core/types/memory';
import type { ForgetReport } from '../types';
import { MemoryScope, MemoryType, MemoryBlock } from '../../../core/types/memory';
import type {
  ICacheManager,
  IVectorStore,
  ISQLiteMetaStore,
  IPalaceStore,
  IGraphStore,
} from '../../../infrastructure/storage/core/types';
import { MemoryStoreManager } from '../store/memory-store-manager';
import { MemoryRecallManager, RecallOutput, RecallMemory } from '../recall/memory-recall-manager';
import { MemoryDegradationManager } from '../degradation/memory-degradation-manager';
import { createLogger, ILogger } from '../../../shared/logging';
import type { LLMScoringResult, ILLMExtractor } from '../llm/llm-extractor';
import { config } from '../../../shared/config';
import type { StorageService } from '../../../infrastructure/storage/stores/storage-service';
import { MemoryAccessControl, type AccessLevel, type AccessDecision } from '../../../infrastructure/security/memory-access-control';
import { IndexUpdateStrategy, type IndexUpdateTask, type IndexPriority } from '../../../infrastructure/indexing/index-update-strategy';
import { RecallStrategy, type RecallContext, type RecallResult as StrategyRecallResult } from '../../../core/domain/memory/recall-strategy';
import { deriveBlock, shouldUpgradeScope } from '../utils/block-utils';

/**
 * StorageMemoryService
 * 基于新存储架构的记忆服务
 * 使用 Cache + VectorDB + SQLite + Palace + Graph 分层存储
 */
export class StorageMemoryService {
  private logger: ILogger;
  private configManager: {
    enableCache: boolean;
    enableVector: boolean;
    enableGraph: boolean;
    enableAccessControl: boolean;
    enableRecallStrategy: boolean;
    enableIndexUpdate: boolean;
  };

  private storeManager: MemoryStoreManager;
  private recallManager: MemoryRecallManager;
  private degradationManager: MemoryDegradationManager;
  private storageService?: StorageService;

  // New integrated components
  private accessControl?: MemoryAccessControl;
  private indexUpdateStrategy?: IndexUpdateStrategy;
  private recallStrategy?: RecallStrategy;

  constructor(
    stores: {
      cache: ICacheManager;
      vectorStore: IVectorStore;
      metaStore: ISQLiteMetaStore;
      palaceStore: IPalaceStore;
      graphStore: IGraphStore;
    },
    embedder: (text: string) => Promise<number[]>,
    llmExtractor?: ILLMExtractor,
    configManager?: {
      enableCache?: boolean;
      enableVector?: boolean;
      enableGraph?: boolean;
      enableAccessControl?: boolean;
      enableRecallStrategy?: boolean;
      enableIndexUpdate?: boolean;
    },
    storageService?: StorageService
  ) {
    this.logger = createLogger('StorageMemoryService');
    this.configManager = {
      enableCache: configManager?.enableCache ?? true,
      enableVector: configManager?.enableVector ?? true,
      enableGraph: configManager?.enableGraph ?? true,
      enableAccessControl: configManager?.enableAccessControl ?? false,
      enableRecallStrategy: configManager?.enableRecallStrategy ?? false,
      enableIndexUpdate: configManager?.enableIndexUpdate ?? false,
    };

    // Initialize store manager
    this.storeManager = new MemoryStoreManager(
      stores.cache,
      stores.vectorStore,
      stores.metaStore,
      stores.palaceStore,
      stores.graphStore,
      embedder,
      undefined, // versionManager
      llmExtractor
    );

    // Initialize recall manager
    this.recallManager = new MemoryRecallManager(
      stores.vectorStore,
      stores.metaStore,
      stores.palaceStore,
      stores.graphStore,
      stores.cache,
      embedder
    );

    // Initialize degradation manager
    this.degradationManager = new MemoryDegradationManager(
      stores.cache,
      stores.vectorStore,
      stores.metaStore,
      stores.palaceStore,
      stores.graphStore
    );

    // Initialize MemoryAccessControl if enabled
    if (this.configManager.enableAccessControl) {
      const accessControlConfig = (config.getConfig('memoryService.accessControl') as any) || {};
      this.accessControl = new MemoryAccessControl({
        defaultAccessLevel: accessControlConfig.defaultAccessLevel ?? 'read',
        auditEnabled: accessControlConfig.auditEnabled ?? true,
        policyCacheSize: accessControlConfig.policyCacheSize ?? 1000,
      });
      this.logger.info('MemoryAccessControl initialized');
    } else {
      this.logger.warn('MemoryAccessControl is DISABLED - all memory access is allowed by default. Set memoryService.enableAccessControl=true for production deployments.');
    }

    // Initialize IndexUpdateStrategy if enabled
    if (this.configManager.enableIndexUpdate) {
      const indexUpdateConfig = (config.getConfig('memoryService.indexUpdate') as any) || {};
      this.indexUpdateStrategy = new IndexUpdateStrategy({
        mode: indexUpdateConfig.mode ?? 'batch',
        batchSize: indexUpdateConfig.batchSize ?? 100,
        batchDelayMs: indexUpdateConfig.batchDelayMs ?? 5000,
        maxPendingTasks: indexUpdateConfig.maxPendingTasks ?? 10000,
        highPriorityThreshold: indexUpdateConfig.highPriorityThreshold ?? 0.8,
        scheduledIntervalMs: indexUpdateConfig.scheduledIntervalMs ?? 60000,
        maxRetries: indexUpdateConfig.maxRetries ?? 3,
      });
      this.logger.info('IndexUpdateStrategy initialized');
    }

    // Initialize RecallStrategy if enabled
    if (this.configManager.enableRecallStrategy) {
      const recallStrategyConfig = (config.getConfig('memoryService.recallStrategy') as any) || {};
      this.recallStrategy = new RecallStrategy({
        timeDecayFactor: recallStrategyConfig.timeDecayFactor ?? 0.5,
        diversityWeight: recallStrategyConfig.diversityWeight ?? 0.2,
        contextWeight: recallStrategyConfig.contextWeight ?? 0.3,
        feedbackWeight: recallStrategyConfig.feedbackWeight ?? 0.2,
        maxResults: recallStrategyConfig.maxResults ?? 20,
        minDiversityScore: recallStrategyConfig.minDiversityScore ?? 0.3,
        feedbackDecayMs: recallStrategyConfig.feedbackDecayMs ?? 86400000,
      });
      this.logger.info('RecallStrategy initialized');
    }

    // If StorageService is provided, use it for unified access
    if (storageService) {
      this.storageService = storageService;
    }

    this.logger.info('StorageMemoryService initialized', this.configManager);
  }

  /**
   * 设置 LLM Extractor（用于生成摘要和评分）
   */
  setLLMExtractor(extractor: ILLMExtractor): void {
    this.storeManager.setLLMExtractor(extractor);
    this.logger.info('LLM Extractor configManagerured for StorageMemoryService');
  }

  // Getters for stores (used by listMemories)
  get metaStore(): ISQLiteMetaStore {
    return (this.storeManager as any).metaStore;
  }

  get vectorStore(): IVectorStore {
    return (this.recallManager as any).vectorStore;
  }

  get palaceStore(): IPalaceStore {
    return (this.recallManager as any).palaceStore;
  }

  /**
   * 获取 StoreManager（用于 MemoryCaptureService）
   */
  getStoreManager(): MemoryStoreManager {
    return this.storeManager;
  }

  /**
   * 存储记忆
   * @param input 记忆输入
   * @param scores 预计算的重要性评分和作用域评分
   */
  async store(input: MemoryInput, scores?: { importance: number; scopeScore: number }): Promise<Memory> {
    this.logger.info('store 方法调用', {
      method: 'store',
      input: { type: input.type, contentLength: input.content?.length ?? 0 },
      scores,
    });

    // 如果没有提供评分，使用 metadata 中的评分
    // 注意：不允许使用硬编码默认值，必须从 metadata 或 ConfigManager 获取
    const finalScores = scores ?? {
      importance: (input.metadata?.['importance'] as number),
      scopeScore: (input.metadata?.['scopeScore'] as number)
    };

    // 验证评分存在
    if (finalScores.importance === undefined || finalScores.scopeScore === undefined) {
      throw new Error('StorageMemoryService: importance and scopeScore are required. Provide via scores parameter or input.metadata.');
    }

    // 检查写权限
    if (this.accessControl) {
      const agentId = input.metadata?.agentId as string || 'default-agent';
      const accessCheck = await this.accessControl.canAccessMemory(
        agentId,
        { agentId, scope: MemoryScope.SESSION, type: input.type, tags: input.metadata?.tags as string[] || [] },
        'write'
      );
      if (!accessCheck.allowed) {
        throw new Error(`Access denied: ${accessCheck.reason}`);
      }
    }

    // 同步写长期存储（Write-Through 策略，保证数据不丢失）
    const memory = await this.storeManager.store(input as any, finalScores);

    // 提交索引更新任务
    if (this.indexUpdateStrategy) {
      await this.indexUpdateStrategy.submitTask({
        id: `idx_${Date.now()}_${memory.uid}`,
        memoryId: memory.uid,
        operation: 'add',
        priority: 'normal',
      });
    }

    this.logger.info('store 方法返回', {
      method: 'store',
      memoryId: memory.uid,
      importance: memory.importance,
      scopeScore: memory.scopeScore,
    });

    return memory;
  }

  /**
   * 召回记忆
   */
  async recall(options: RecallOptions): Promise<RecallOutput> {
    this.logger.info('recall 方法调用', {
      method: 'recall',
      options: {
        query: options.query?.substring(0, 100),
        agentId: options.agentId,
        sessionId: options.sessionId,
        limit: options.limit,
      },
    });

    // 获取默认 agentId（优先从 options 获取，否则从 ConfigManager）
    let defaultAgentId = 'default-agent';
    let defaultSessionId = 'default-session';
    try {
      if (config.isInitialized()) {
        // 从 memoryService.agentId 获取配置
        defaultAgentId = config.getConfig('memoryService.agentId') as string;
      }
    } catch {
      // ConfigManager 未初始化，使用默认值
    }

    const result = await this.recallManager.recall({
      query: options.query,
      currentAgentId: options.agentId || defaultAgentId,
      currentSessionId: options.sessionId || defaultSessionId,
      types: options.types,
      tags: options.tags,
      timeRange: options.timeRange ? { start: options.timeRange.from, end: options.timeRange.to } : undefined,
      limit: options.limit || 10,
    });

    this.logger.info('recall 方法返回', {
      method: 'recall',
      memoriesReturned: result.memories.length,
      totalFound: result.totalFound,
    });

    return result;
  }

  /**
   * 获取单条记忆
   */
  async get(memoryId: string): Promise<RecallMemory | null> {
    this.logger.info('get 方法调用', { method: 'get', memoryId });

    const result = await this.recallManager.get(memoryId);

    this.logger.info('get 方法返回', {
      method: 'get',
      memoryId,
      found: result !== null,
      importance: result?.importance,
      scope: result?.scope,
    });

    return result;
  }

  /**
   * 列出记忆（不带召回语义，不更新访问统计）
   * 用于管理页面浏览记忆列表
   */
  async listMemories(options?: {
    limit?: number;
    offset?: number;
    types?: MemoryType[];
    scopes?: MemoryScope[];
    blocks?: string[];
    orderBy?: 'createdAt' | 'updatedAt' | 'importanceScore';
    orderDir?: 'asc' | 'desc';
  }): Promise<{ memories: Memory[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    // 构建查询选项
    const queryOptions: {
      types?: MemoryType[];
      scopes?: MemoryScope[];
      limit: number;
      offset: number;
      orderBy?: 'createdAt' | 'updatedAt' | 'importanceScore' | 'scopeScore';
      orderDir?: 'asc' | 'desc';
      isLatestVersion: boolean;
    } = {
      types: options?.types,
      scopes: options?.scopes,
      limit: limit + offset,
      offset: 0,
      orderBy: options?.orderBy,
      orderDir: options?.orderDir,
      isLatestVersion: true,
    };

    // 查询元数据
    const metas = await this.metaStore.query(queryOptions);

    // 获取总数（不带offset/limit）
    const total = await this.metaStore.count({
      types: options?.types,
      scopes: options?.scopes,
      isLatestVersion: true,
    } as any);

    // 分页
    const paginatedMetas = metas.slice(offset, offset + limit);

    if (paginatedMetas.length === 0) {
      return { memories: [], total };
    }

    // 获取向量（用于 summary）
    const uids = paginatedMetas.map(m => m.uid);
    const vectors = await this.vectorStore.getByIds(uids);

    // 构建 vector map
    const vectorMap = new Map(vectors.map(v => [v.id, v]));

    // 批量获取 palace 内容
    const palaceRefs = paginatedMetas.map(m => m.currentPalaceRef);
    const contentsMap = await this.palaceStore.retrieveMany(palaceRefs);

    // 组装完整记忆
    const memories: Memory[] = paginatedMetas.map(meta => {
      const vector = vectorMap.get(meta.uid);
      const content = contentsMap.get(meta.currentPalaceRef) ?? '';

      // 派生 block（与 enrichMemories 保持一致）
      const block = deriveBlock(meta.importanceScore);

      // 获取摘要（优先从 vector metadata 的 summary，否则从版本链）
      const summary = vector?.metadata.summary
        ?? meta.versionChain?.[meta.versionChain.length - 1]?.summary
        ?? content.substring(0, 200);

      // 访问统计
      const recallCount = meta.recallCount ?? 0;
      const lastAccessedAt = meta.lastRecalledAt ?? meta.updatedAt ?? meta.createdAt;

      // 生命周期
      const lifecycle = {
        createdAt: meta.createdAt,
        events: [
          { type: 'created' as const, timestamp: meta.createdAt },
        ],
      };

      // 构造 metadata
      const metadata: Record<string, unknown> = {
        versionGroupId: meta.versionGroupId,
        source: 'list',
        extractedAt: Date.now(),
      };

      return {
        uid: meta.uid,
        version: meta.version,
        content,
        summary,
        type: meta.type,
        agentId: meta.agentId,
        importance: meta.importanceScore,
        scopeScore: meta.scopeScore,
        scope: meta.scope,
        block,
        palace: meta.palace,
        versionChain: meta.versionChain ?? [],
        isLatestVersion: meta.isLatestVersion,
        accessCount: recallCount,
        recallCount,
        lastAccessedAt,
        usedByAgents: meta.usedByAgents ?? [],
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        metadata,
        tags: meta.tags ?? [],
        lifecycle,
      };
    });

    return { memories, total };
  }

  /**
   * 根据 importance 派生 MemoryBlock
   * 使用配置管理模块的 blockThresholds
   */
  private deriveBlock(importance: number): MemoryBlock {
    return deriveBlock(importance);
  }

  /**
   * 更新记忆
   * 如果更新了 content，会创建新版本
   */
  async update(memoryId: string, update: MemoryUpdate): Promise<RecallMemory | null> {
    const now = Date.now();

    // 如果更新了 content，需要创建新版本
    if (update.content) {
      this.logger.info('Content updated, creating new version', { memoryId });

      // 获取现有记忆用于生成摘要
      const existingMemory = await this.recallManager.get(memoryId);
      if (!existingMemory) {
        throw new Error(`Memory not found: ${memoryId}`);
      }

      // 生成新摘要：优先使用显式提供的摘要，否则截取内容
      const newSummary = update.summary || update.content.substring(0, 200);

      // 获取版本管理器
      const versionManager = this.storeManager.getVersionManager();

      // 创建新版本
      const versionResult = await versionManager.createVersion(
        memoryId,
        update.content,
        newSummary,
        {
          importance: update.importance ?? existingMemory.importance,
          scopeScore: update.scopeScore ?? existingMemory.scopeScore,
        },
        {
          createdAt: now,
          updatedAt: now,
          originalSize: update.content.length,
          compressed: false,
          encrypted: false,
        }
      );

      this.logger.info('New version created', {
        memoryId,
        newVersion: versionResult.version,
        newMemoryId: versionResult.newMemoryId,
      });

      // 提交索引更新任务
      if (this.indexUpdateStrategy) {
        await this.indexUpdateStrategy.submitTask({
          id: `idx_${Date.now()}_${memoryId}`,
          memoryId,
          operation: 'update',
          priority: 'normal',
        });
      }

      // 更新其他元数据（importance, scopeScore, scope, tags）
      if (update.importance !== undefined || update.scopeScore !== undefined || update.scope !== undefined || update.tags !== undefined) {
        await this.storeManager.update(memoryId, {
          importanceScore: update.importance,
          scopeScore: update.scopeScore,
          scope: update.scope,
          tags: update.tags,
        });
      }

      return this.recallManager.get(memoryId);
    }

    // 如果只是更新元数据（不需要创建版本）
    await this.storeManager.update(memoryId, {
      importanceScore: update.importance,
      scopeScore: update.scopeScore,
      scope: update.scope,
      block: update.block,
      tags: update.tags,
    });

    // 提交索引更新任务
    if (this.indexUpdateStrategy) {
      await this.indexUpdateStrategy.submitTask({
        id: `idx_${Date.now()}_${memoryId}`,
        memoryId,
        operation: 'update',
        priority: 'low',
      });
    }

    return this.recallManager.get(memoryId);
  }

  /**
   * 删除记忆
   */
  async delete(memoryId: string): Promise<void> {
    this.logger.info('delete 方法调用', { method: 'delete', memoryId });

    // 提交索引删除任务
    if (this.indexUpdateStrategy) {
      await this.indexUpdateStrategy.submitTask({
        id: `idx_${Date.now()}_${memoryId}`,
        memoryId,
        operation: 'delete',
        priority: 'high',
      });
    }

    await this.storeManager.delete(memoryId);

    this.logger.info('delete 方法返回', { method: 'delete', memoryId });
  }

  /**
   * 强化记忆
   */
  async reinforce(memoryId: string, boostAmount?: number): Promise<RecallMemory | null> {
    this.logger.info('reinforce 方法调用', { method: 'reinforce', memoryId, boostAmount });

    const memory = await this.get(memoryId);
    if (!memory) {
      this.logger.warn('reinforce 方法返回 - 记忆不存在', { method: 'reinforce', memoryId });
      return null;
    }

    // Calculate new scores
    const importanceBoost = boostAmount ?? this.calculateBoost(memory.importance);
    const newImportance = Math.min(10, memory.importance + importanceBoost);
    const newScopeScore = Math.min(10, memory.scopeScore + importanceBoost * 0.5);

    await this.storeManager.update(memoryId, {
      importanceScore: newImportance,
      scopeScore: newScopeScore,
    });

    const result = await this.get(memoryId);

    this.logger.info('reinforce 方法返回', {
      method: 'reinforce',
      memoryId,
      previousImportance: memory.importance,
      newImportance: result?.importance,
    });

    return result;
  }

  /**
   * 计算强化幅度
   * 根据配置：
   * - currentImportance < lowBoostThreshold (3) → lowBoost (0.5)
   * - currentImportance < mediumBoostThreshold (6) → mediumBoost (0.3)
   * - currentImportance < highBoostThreshold (7) → highBoost (0.1)
   * - currentImportance >= highBoostThreshold (7) → defaultBoost (0.2)
   */
  private calculateBoost(currentImportance: number): number {
    if (!config.isInitialized()) {
      throw new Error('StorageMemoryService: ConfigManager not initialized. Cannot calculate boost.');
    }

    // 优先从 memoryService.reinforcement 读取（新版配置路径）
    // 回退到 memoryService.reinforce（兼容旧版）
    const reinforceConfig = (config.getConfig('memoryService.reinforcement') as any)
      || (config.getConfig('memoryService.reinforce') as any);

    if (!reinforceConfig) {
      throw new Error('StorageMemoryService: reinforcement configManager not found in ConfigManager.');
    }

    const lowThreshold = reinforceConfig.lowBoostThreshold;
    const mediumThreshold = reinforceConfig.mediumBoostThreshold;
    const highThreshold = reinforceConfig.highBoostThreshold;
    const lowBoost = reinforceConfig.lowBoost;
    const mediumBoost = reinforceConfig.mediumBoost;
    const highBoost = reinforceConfig.highBoost;
    const defaultBoost = reinforceConfig.defaultBoost;

    if (currentImportance < lowThreshold) return lowBoost;
    if (currentImportance < mediumThreshold) return mediumBoost;
    if (currentImportance < highThreshold) return highBoost;
    return defaultBoost;
  }

  /**
   * 强化记忆（批量）
   */
  async reinforceBatch(memoryIds: string[]): Promise<void> {
    this.logger.info('reinforceBatch 方法调用', { method: 'reinforceBatch', count: memoryIds.length });

    for (const id of memoryIds) {
      await this.reinforce(id);
    }

    this.logger.info('reinforceBatch 方法返回', { method: 'reinforceBatch', processed: memoryIds.length });
  }

  /**
   * 检查并执行作用域升级
   */
  async checkAndUpgradeScope(memoryId: string): Promise<boolean> {
    const memory = await this.get(memoryId);
    if (!memory) return false;

    const shouldUpgrade = this.shouldUpgrade(memory);

    if (shouldUpgrade) {
      const newScope = memory.scope === MemoryScope.SESSION
        ? MemoryScope.AGENT
        : MemoryScope.GLOBAL;

      // 使用 degradationManager.upgradeScope 以正确迁移 palace 文件
      await this.degradationManager.upgradeScope(memoryId, newScope);

      this.logger.info('Memory scope upgraded', {
        memoryId,
        from: memory.scope,
        to: newScope,
      });

      return true;
    }

    return false;
  }

  /**
   * 判断是否应该升级作用域（双评分升级算法）
   *
   * 升级规则（基于双评分）：
   * - SESSION → AGENT: importance >= sessionUpgradeRecallThreshold (默认5)
   * - AGENT → GLOBAL: scopeScore >= upgradeScopeScoreMax (默认10) AND importance >= agentUpgradeRecallThreshold (默认10)
   *
   * 注意: recallCount 和 usedByAgents 在 RecallMemory 中不可用，使用基于 importance/scopeScore 的双评分规则
   */
  private shouldUpgrade(memory: RecallMemory): boolean {
    if (!config.isInitialized()) {
      throw new Error('StorageMemoryService: ConfigManager not initialized. Cannot check scope upgrade.');
    }

    // 从 scopeDegradation 配置读取升级阈值
    const scopeConfig = config.getConfig('memoryService.scopeDegradation') as any;
    if (!scopeConfig) {
      throw new Error('StorageMemoryService: memoryService.scopeDegradation not found in ConfigManager.');
    }

    const sessionThreshold = scopeConfig.sessionUpgradeRecallThreshold;
    const scopeScoreThreshold = scopeConfig.upgradeScopeScoreMax;
    const agentThreshold = scopeConfig.agentUpgradeRecallThreshold;

    if (memory.scope === MemoryScope.SESSION && memory.importance >= sessionThreshold) {
      return true;
    }
    if (memory.scope === MemoryScope.AGENT &&
        memory.scopeScore >= scopeScoreThreshold &&
        memory.importance >= agentThreshold) {
      return true;
    }

    return false;
  }

  // ============================================================
  // 遗忘与降级管理
  // ============================================================

  /**
   * 启动定时遗忘检查
   */
  startDegradationTimer(): void {
    this.logger.info('startDegradationTimer 方法调用', { method: 'startDegradationTimer' });
    this.degradationManager.startDegradationTimer();
    this.logger.info('startDegradationTimer 方法返回', { method: 'startDegradationTimer' });
  }

  /**
   * 停止定时遗忘检查
   */
  stopDegradationTimer(): void {
    this.logger.info('stopDegradationTimer 方法调用', { method: 'stopDegradationTimer' });
    this.degradationManager.stopDegradationTimer();
    this.logger.info('stopDegradationTimer 方法返回', { method: 'stopDegradationTimer' });
  }

  /**
   * 执行遗忘周期
   */
  async runForgettingCycle(): Promise<ForgetReport> {
    this.logger.info('runForgettingCycle 方法调用', { method: 'runForgettingCycle' });

    const result = await this.degradationManager.runForgettingCycle();

    this.logger.info('runForgettingCycle 方法返回', {
      method: 'runForgettingCycle',
      archivedCount: result.archivedCount,
      deletedCount: result.deletedCount,
    });

    return result;
  }

  /**
   * 执行作用域降级周期
   */
  async runScopeDegradationCycle(): Promise<{
    scannedCount: number;
    downgradedCount: number;
    upgradedCount: number;
    downgradedIds: string[];
    upgradedIds: string[];
    executedAt: number;
  }> {
    this.logger.info('runScopeDegradationCycle 方法调用', { method: 'runScopeDegradationCycle' });

    const result = await this.degradationManager.runScopeDegradationCycle();

    this.logger.info('runScopeDegradationCycle 方法返回', {
      method: 'runScopeDegradationCycle',
      scannedCount: result.scannedCount,
      downgradedCount: result.downgradedCount,
      upgradedCount: result.upgradedCount,
    });

    return result;
  }

  /**
   * 归档记忆
   */
  async archiveMemory(memoryId: string): Promise<void> {
    this.logger.info('archiveMemory 方法调用', { method: 'archiveMemory', memoryId });
    await this.degradationManager.archiveMemory(memoryId);
    this.logger.info('archiveMemory 方法返回', { method: 'archiveMemory', memoryId });
  }

  /**
   * 恢复记忆（从归档状态）
   */
  async restoreMemory(memoryId: string): Promise<void> {
    this.logger.info('restoreMemory 方法调用', { method: 'restoreMemory', memoryId });
    await this.degradationManager.restoreMemory(memoryId);
    this.logger.info('restoreMemory 方法返回', { method: 'restoreMemory', memoryId });
  }

  /**
   * 归纳整理记忆（创建新版本，保留原始版本链）
   *
   * 与 update() 的区别：
   * - update() 用于普通更新，可能创建新版本
   * - consolidate() 专门用于归纳整理，保证版本化语义
   *   - 新版本继承原始 UID
   *   - 旧版本获得新 UID，isLatestVersion=false
   *   - 标签合并（原始标签 + 新标签，去重）
   *   - 记录归纳洞察到 metadata
   *
   * @param memoryId 目标记忆 ID
   * @param data 归纳后的数据
   * @param options 可选参数
   * @returns 归纳结果
   */
  async consolidate(
    memoryId: string,
    data: {
      content: string
      summary: string
      tags: string[]
      importance: number
      scopeScore: number
    },
    options?: {
      archiveSourceIds?: string[]
      insights?: string[]
      sourceIds?: string[]
    }
  ): Promise<{
    success: boolean
    newVersionId?: string
    oldMemoryId?: string
    version?: number
    archivedCount: number
    errors: string[]
  }> {
    this.logger.info('consolidate 方法调用', { method: 'consolidate', memoryId });

    const now = Date.now();
    const result: {
      success: boolean
      newVersionId?: string
      oldMemoryId?: string
      version?: number
      archivedCount: number
      errors: string[]
    } = {
      success: false,
      archivedCount: 0,
      errors: [],
    };

    try {
      // 1. 获取现有记忆
      const existingMemory = await this.get(memoryId);
      if (!existingMemory) {
        throw new Error(`Memory not found: ${memoryId}`);
      }

      // 2. 获取版本管理器
      const versionManager = this.storeManager.getVersionManager();

      // 3. 创建新版本
      const versionResult = await versionManager.createVersion(
        memoryId,
        data.content,
        data.summary,
        {
          importance: data.importance,
          scopeScore: data.scopeScore,
        },
        {
          createdAt: now,
          updatedAt: now,
          originalSize: data.content.length,
          compressed: false,
          encrypted: false,
        }
      );

      result.newVersionId = versionResult.newMemoryId;
      result.oldMemoryId = versionResult.oldMemoryId;
      result.version = versionResult.version;

      // 4. 更新标签（合并原始标签 + 新标签）
      const mergedTags = this.mergeTags(existingMemory.tags, data.tags);
      await this.storeManager.update(memoryId, {
        tags: mergedTags,
      });

      // 5. 归档关联的记忆
      if (options?.archiveSourceIds && options.archiveSourceIds.length > 0) {
        for (const sourceId of options.archiveSourceIds) {
          try {
            await this.archiveMemory(sourceId);
            result.archivedCount++;
          } catch (error) {
            result.errors.push(`Failed to archive ${sourceId}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      result.success = true;
      this.logger.info('consolidate 方法返回', {
        method: 'consolidate',
        memoryId,
        newVersionId: result.newVersionId,
        oldMemoryId: result.oldMemoryId,
        archivedCount: result.archivedCount,
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push(errorMsg);
      this.logger.error('consolidate 方法失败', { method: 'consolidate', memoryId, error: errorMsg });
    }

    return result;
  }

  /**
   * 合并标签（去重 + 保留原始）
   */
  private mergeTags(originalTags: string[], newTags: string[]): string[] {
    const tagSet = new Set<string>(originalTags);
    for (const tag of newTags) {
      tagSet.add(tag);
    }
    return Array.from(tagSet).slice(0, 10); // 最多10个标签
  }

  /**
   * 永久删除记忆
   */
  async deleteMemory(memoryId: string): Promise<void> {
    this.logger.info('deleteMemory 方法调用', { method: 'deleteMemory', memoryId });

    // 提交索引删除任务
    if (this.indexUpdateStrategy) {
      await this.indexUpdateStrategy.submitTask({
        id: `idx_${Date.now()}_${memoryId}`,
        memoryId,
        operation: 'delete',
        priority: 'high',
      });
    }

    await this.degradationManager.deleteMemory(memoryId);
    this.logger.info('deleteMemory 方法返回', { method: 'deleteMemory', memoryId });
  }

  /**
   * 获取遗忘统计
   */
  async getDegradationStats(): Promise<{
    totalMemories: number;
    archivedMemories: number;
    deletedMemories: number;
    scopeDistribution: { session: number; agent: number; global: number };
    avgImportance: number;
    avgLastRecalledAt: number;
  }> {
    this.logger.info('getDegradationStats 方法调用', { method: 'getDegradationStats' });

    const result = await this.degradationManager.getDegradationStats();

    this.logger.info('getDegradationStats 方法返回', {
      method: 'getDegradationStats',
      totalMemories: result.totalMemories,
      archivedMemories: result.archivedMemories,
    });

    return result;
  }

  /**
   * 获取记忆类型与评分统计
   * 供 /api/system/stats 使用，避免路由层访问私有字段
   */
  async getMemoryStats(): Promise<{
    memoriesByType: Record<string, number>;
    avgScopeScore: number;
  }> {
    const metaStats = await this.storeManager.getMetaStats();
    return {
      memoriesByType: metaStats.byType,
      avgScopeScore: metaStats.avgScopeScore,
    };
  }

  /**
   * 获取存储管理器统计（供 API 调用）
   */
  async getStoreManagerStats(): Promise<{
    avgScopeScore: number;
    byType: Record<string, number>;
  }> {
    const metaStats = await this.storeManager.getMetaStats();
    return {
      avgScopeScore: metaStats.avgScopeScore,
      byType: metaStats.byType,
    };
  }

  /**
   * 获取降级管理器（用于高级配置）
   */
  getDegradationManager(): MemoryDegradationManager {
    return this.degradationManager;
  }

  /**
   * 获取访问控制器
   */
  getAccessControl(): MemoryAccessControl | undefined {
    return this.accessControl;
  }

  /**
   * 获取索引更新策略
   */
  getIndexUpdateStrategy(): IndexUpdateStrategy | undefined {
    return this.indexUpdateStrategy;
  }

  /**
   * 获取召回策略
   */
  getRecallStrategy(): RecallStrategy | undefined {
    return this.recallStrategy;
  }

  /**
   * 检查记忆访问权限
   */
  async checkMemoryAccess(
    agentId: string,
    memory: { agentId: string; scope: MemoryScope; type: MemoryType; tags: string[] },
    action: 'read' | 'write' | 'delete' = 'read'
  ): Promise<AccessDecision> {
    if (!this.accessControl) {
      return { allowed: true, reason: 'Access control not enabled' };
    }
    return this.accessControl.canAccessMemory(agentId, memory, action);
  }

  /**
   * 添加访问策略
   */
  async addAccessPolicy(policy: {
    subjectId: string;
    targetId: string;
    permissions: string[];
    priority?: number;
    effect?: 'allow' | 'deny';
  }): Promise<void> {
    if (!this.accessControl) {
      this.logger.warn('Access control not enabled, policy not added');
      return;
    }
    await this.accessControl.addPolicy({
      id: '',
      name: `policy_${Date.now()}`,
      priority: policy.priority ?? 0,
      principals: [{ type: 'agent', id: policy.subjectId }],
      conditions: [],
      effect: policy.effect ?? 'allow',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  /**
   * 提交索引更新任务
   */
  async submitIndexUpdate(
    memoryId: string,
    operation: 'add' | 'update' | 'delete',
    priority: IndexPriority = 'normal'
  ): Promise<void> {
    if (!this.indexUpdateStrategy) {
      return;
    }
    await this.indexUpdateStrategy.submitTask({
      id: `idx_${Date.now()}_${memoryId}`,
      memoryId,
      operation,
      priority,
    });
  }

  /**
   * 刷新索引
   */
  async flushIndex(): Promise<void> {
    if (!this.indexUpdateStrategy) {
      return;
    }
    await this.indexUpdateStrategy.flush();
  }

  /**
   * 添加召回反馈（用于 RecallStrategy）
   */
  async addRecallFeedback(
    memoryId: string,
    agentId: string,
    action: 'recall' | 'dismiss' | 'refine' | 'use'
  ): Promise<void> {
    if (!this.recallStrategy) {
      return;
    }
    this.recallStrategy.addFeedback({ memoryId, agentId, timestamp: Date.now(), action });
  }

  /**
   * 使用 RecallStrategy 增强召回结果
   */
  async enhancedRecall(
    memories: Array<{ uid: string; content: string; summary: string; type: MemoryType; agentId: string; importance: number; scopeScore: number; scope: MemoryScope; tags: string[]; createdAt: number; updatedAt: number }>,
    context: { agentId: string; sessionId?: string; query?: string; scope?: MemoryScope; type?: MemoryType }
  ): Promise<StrategyRecallResult[]> {
    if (!this.recallStrategy) {
      return [];
    }
    const recallContext: RecallContext = {
      agentId: context.agentId,
      sessionId: context.sessionId,
      currentTime: Date.now(),
      query: context.query,
      scope: context.scope,
      type: context.type,
    };
    return this.recallStrategy.calculateScoresBatch(memories as any, recallContext);
  }
}
