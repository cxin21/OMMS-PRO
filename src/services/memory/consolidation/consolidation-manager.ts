/**
 * Consolidation Manager - 记忆巩固管理器
 * @module memory-service/consolidation-manager
 *
 * 版本: v1.1.0
 * - 模拟人类睡眠期间的记忆巩固
 * - 配置通过 ConfigManager 注入
 */

import { createLogger, type ILogger } from '../../../shared/logging';
import { IDGenerator } from '../../../shared/utils/id-generator';
import { PromptLoader } from '../../../shared/prompts';
import type { StorageMemoryService } from '../core/storage-memory-service';
import type {
  IGraphStore,
  IPalaceStore,
  ISQLiteMetaStore,
  IVectorStore,
  IEpisodeStore,
  EpisodeRecord,
  MemoryMetaRecord,
} from '../../../infrastructure/storage/core/types';
import { MemoryType } from '../../../core/types/memory';
import type { RecallMemory } from '../recall/memory-recall-manager';
import type { SentimentResult } from '../analysis/sentiment-analyzer';
import { SentimentAnalyzer } from '../analysis/sentiment-analyzer';
import type { ILLMExtractor } from '../llm/llm-extractor';
import { config } from '../../../shared/config';
import type { MemoryConsolidationConfig } from '../../../core/types/config';

// Keep local interface for backward compatibility
export type ConsolidationConfig = MemoryConsolidationConfig;

// Profile types that should never be forgotten or merged
const PROFILE_TYPES: MemoryType[] = [MemoryType.IDENTITY, MemoryType.PERSONA, MemoryType.PREFERENCE];

export interface ConsolidationTask {
  uid: string;
  memoryUid: string;
  action: 'compress' | 'link' | 'snapshot' | 'merge';
  priority: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

export interface ConsolidationResult {
  consolidatedCount: number;
  compressedCount: number;
  linkedCount: number;
  snapshotCount: number;
  mergedCount: number;
  newRelationsCount: number;
  storageFreed: number;
  duration: number;
  errors: string[];
}

interface SimilarMemoryGroup {
  uids: string[];
  representativeUid: string;
  similarity: number;
}

// ============================================================================
// ConsolidationManager
// ============================================================================

export class ConsolidationManager {
  private logger: ILogger;
  private config: MemoryConsolidationConfig;
  private sentimentAnalyzer: SentimentAnalyzer;
  private promptLoader = PromptLoader.getInstance();
  private isRunning: boolean = false;
  private schedulerTimer?: NodeJS.Timeout;
  private lastConsolidationAt: number | null = null;
  private llmExtractor?: ILLMExtractor;

  constructor(
    private memoryService: StorageMemoryService,
    private graphStore: IGraphStore,
    private palaceStore: IPalaceStore,
    private metaStore: ISQLiteMetaStore,
    private vectorStore: IVectorStore,
    private episodeStore: IEpisodeStore,
    userConfig?: Partial<MemoryConsolidationConfig>,
    llmExtractor?: ILLMExtractor
  ) {
    this.logger = createLogger('ConsolidationManager');

    // 如果传入了配置则使用，否则从 ConfigManager 获取
    if (userConfig && Object.keys(userConfig).length > 0) {
      this.config = { ...userConfig } as MemoryConsolidationConfig;
      this.logger.info('ConsolidationManager using user-provided config', { config: this.config });
    } else {
      // 默认配置（与 config.default.json 一致）
      this.config = {
        enabled: true,
        scheduleHour: 3,
        maxMemoriesPerCycle: 50,
        minRecallCount: 3,
        actions: { compress: true, link: true, snapshot: true, merge: true },
        llmCompression: { enabled: true, temperature: 0.3, maxTokens: 500 },
        merge: { similarityThreshold: 0.85, maxGroupSize: 5 },
      };
      if (config.isInitialized()) {
        const consolidationConfig = config.getConfig('memoryService.consolidation') as MemoryConsolidationConfig;
        if (consolidationConfig) {
          this.config = consolidationConfig;
        }
      }
      this.logger.info('ConsolidationManager loaded config', { config: this.config });
    }

    this.sentimentAnalyzer = new SentimentAnalyzer();
    this.llmExtractor = llmExtractor;

    this.logger.info('ConsolidationManager initialized', {
      scheduleHour: this.config.scheduleHour,
      maxMemoriesPerCycle: this.config.maxMemoriesPerCycle,
    });
  }

  /**
   * 设置 LLM 提取器
   */
  setLLMExtractor(extractor: ILLMExtractor): void {
    this.llmExtractor = extractor;
    this.logger.info('LLM Extractor set', { provider: extractor.constructor.name });
  }

  // ============================================================
  // 公共接口
  // ============================================================

  /**
   * 执行一次巩固周期
   */
  async runConsolidationCycle(): Promise<ConsolidationResult> {
    if (this.isRunning) {
      this.logger.warn('Consolidation already running, skip');
      return {
        consolidatedCount: 0,
        compressedCount: 0,
        linkedCount: 0,
        snapshotCount: 0,
        mergedCount: 0,
        newRelationsCount: 0,
        storageFreed: 0,
        duration: 0,
        errors: ['Already running'],
      };
    }

    this.isRunning = true;
    const startTime = Date.now();

    const result: ConsolidationResult = {
      consolidatedCount: 0,
      compressedCount: 0,
      linkedCount: 0,
      snapshotCount: 0,
      mergedCount: 0,
      newRelationsCount: 0,
      storageFreed: 0,
      duration: 0,
      errors: [],
    };

    try {
      this.logger.info('Starting consolidation cycle');

      // Step 1: 选取候选记忆
      const candidates = await this.selectCandidates();
      this.logger.info('Selected candidates', { count: candidates.length });

      if (candidates.length === 0) {
        this.logger.info('No candidates for consolidation');
        return result;
      }

      // Step 2: 执行合并（如果启用）- 合并先于其他操作
      if (this.config.actions.merge) {
        const mergeResult = await this.executeMerge(candidates);
        result.mergedCount = mergeResult.mergedCount;
        result.storageFreed += mergeResult.storageFreed;

        // 更新候选列表（合并后可能需要重新获取）
        const mergedUids = new Set(mergeResult.mergedGroups.flatMap(g => g.uids));
        const remainingCandidates = candidates.filter(c => !mergedUids.has(c.uid));
        candidates.length = 0;
        candidates.push(...remainingCandidates);
      }

      // Step 3: 执行压缩
      if (this.config.actions.compress) {
        for (const memory of candidates) {
          try {
            const compressed = await this.executeCompress(memory);
            if (compressed) {
              result.compressedCount++;
            }
          } catch (error) {
            result.errors.push(`Compress ${memory.uid}: ${error}`);
          }
        }
      }

      // Step 4: 执行链接
      if (this.config.actions.link) {
        for (const memory of candidates) {
          try {
            const linkCount = await this.executeLink(memory);
            result.linkedCount += linkCount;
            result.newRelationsCount += linkCount;
          } catch (error) {
            result.errors.push(`Link ${memory.uid}: ${error}`);
          }
        }
      }

      // Step 5: 执行快照
      if (this.config.actions.snapshot) {
        for (const memory of candidates) {
          try {
            const snapshotCreated = await this.executeSnapshot(memory);
            if (snapshotCreated) {
              result.snapshotCount++;
            }
          } catch (error) {
            result.errors.push(`Snapshot ${memory.uid}: ${error}`);
          }
        }
      }

      result.consolidatedCount = candidates.length;
      result.duration = Date.now() - startTime;
      this.lastConsolidationAt = Date.now();

      this.logger.info('Consolidation cycle completed', {
        consolidated: result.consolidatedCount,
        compressed: result.compressedCount,
        linked: result.linkedCount,
        snapshot: result.snapshotCount,
        merged: result.mergedCount,
        duration: result.duration,
      });

    } catch (error) {
      result.errors.push(`Cycle error: ${error}`);
      this.logger.error('Consolidation cycle failed', { error });
    } finally {
      this.isRunning = false;
    }

    return result;
  }

  /**
   * 启动定时调度器
   */
  startScheduler(): void {
    this.scheduleNextRun();
    this.logger.info('Consolidation scheduler started', {
      scheduleHour: this.config.scheduleHour,
    });
  }

  /**
   * 停止调度器
   */
  stopScheduler(): void {
    if (this.schedulerTimer) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = undefined;
    }
    this.logger.info('Consolidation scheduler stopped');
  }

  /**
   * 获取最后巩固时间
   */
  getLastConsolidationAt(): number | null {
    return this.lastConsolidationAt;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ConsolidationConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('ConsolidationManager config updated', this.config as unknown as Record<string, unknown>);
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 选取候选记忆
   */
  private async selectCandidates(): Promise<MemoryMetaRecord[]> {
    // 从 metaStore 查询所有记忆
    const memories = await this.metaStore.query({
      isLatestVersion: true,
      limit: 10000,
    });

    // 过滤并按召回次数排序
    const candidates = memories
      .filter(m => {
        // 排除 Profile 类型
        if (PROFILE_TYPES.includes(m.type as MemoryType)) {
          return false;
        }
        // 召回次数阈值
        if ((m.recallCount || 0) < this.config.minRecallCount) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (b.recallCount || 0) - (a.recallCount || 0))
      .slice(0, this.config.maxMemoriesPerCycle);

    return candidates;
  }

  /**
   * 执行记忆合并
   */
  private async executeMerge(memories: MemoryMetaRecord[]): Promise<{
    mergedCount: number;
    storageFreed: number;
    mergedGroups: SimilarMemoryGroup[];
  }> {
    const result = {
      mergedCount: 0,
      storageFreed: 0,
      mergedGroups: [] as SimilarMemoryGroup[],
    };

    if (memories.length < 2) {
      return result;
    }

    // 获取所有候选的向量
    const vectors = await this.vectorStore.getByIds(memories.map(m => m.uid));
    const vectorMap = new Map(vectors.map(v => [v.id, v.vector]));

    const processed = new Set<string>();

    for (let i = 0; i < memories.length; i++) {
      const memory1 = memories[i];
      if (processed.has(memory1.uid)) continue;

      const vector1 = vectorMap.get(memory1.uid);
      if (!vector1) continue;

      const group: string[] = [memory1.uid];
      let totalSavings = 0;

      // 找所有相似的记忆
      for (let j = i + 1; j < memories.length; j++) {
        const memory2 = memories[j];
        if (processed.has(memory2.uid)) continue;

        const vector2 = vectorMap.get(memory2.uid);
        if (!vector2) continue;

        const similarity = this.cosineSimilarity(vector1, vector2);
        if (similarity >= this.config.merge.similarityThreshold) {
          group.push(memory2.uid);
          processed.add(memory2.uid);
          totalSavings += memory2.updatedAt || 0; // 粗略估算释放空间
        }
      }

      // 如果形成了一组
      if (group.length > 1 && group.length <= this.config.merge.maxGroupSize) {
        processed.add(memory1.uid);

        // 保留最新的，合并其他的
        const sortedGroup = group.map(uid => memories.find(m => m.uid === uid)!).sort(
          (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
        );

        const representative = sortedGroup[0];
        const toMerge = sortedGroup.slice(1);

        // 执行合并
        await this.mergeMemories(representative, toMerge);

        result.mergedCount += toMerge.length;
        result.mergedGroups.push({
          uids: group,
          representativeUid: representative.uid,
          similarity: this.config.merge.similarityThreshold,
        });
      }
    }

    return result;
  }

  /**
   * 合并多个记忆到一个代表
   */
  private async mergeMemories(representative: MemoryMetaRecord, toMerge: MemoryMetaRecord[]): Promise<void> {
    this.logger.debug('Merging memories', {
      representative: representative.uid,
      count: toMerge.length,
    });

    for (const memory of toMerge) {
      try {
        // 1. 获取被合并记忆的内容
        const content = await this.palaceStore.retrieve(memory.currentPalaceRef);

        // 2. 将被合并记忆的关联添加到图谱（指向代表）
        const relatedMemories = await this.graphStore.findRelated(memory.uid, 10);
        for (const related of relatedMemories) {
          await this.graphStore.addRelation(
            related.uid,
            representative.uid,
            'merged_into',
            related.weight
          );
        }

        // 3. 更新代表记忆的重要性（取最大值）
        const newImportance = Math.max(representative.importanceScore, memory.importanceScore);
        await this.metaStore.update(representative.uid, {
          importanceScore: newImportance,
        });

        // 4. 标记被合并记忆为归档（不删除，保留历史）
        await this.metaStore.update(memory.uid, {
          tags: [...(memory.tags || []), 'merged', `merged_into:${representative.uid}`],
        });

        // 5. 删除被合并记忆的向量
        await this.vectorStore.delete(memory.uid);

        // 6. 从 Episode 中移除被合并记忆
        const episodeIds = await this.findEpisodesContaining(memory.uid);
        for (const episodeId of episodeIds) {
          await this.episodeStore.removeMemory(episodeId, memory.uid);
        }

        this.logger.debug('Memory merged', {
          from: memory.uid,
          to: representative.uid,
        });
      } catch (error) {
        this.logger.warn('Failed to merge memory', {
          memory: memory.uid,
          error: String(error),
        });
      }
    }
  }

  /**
   * 查找包含指定记忆的情景
   */
  private async findEpisodesContaining(memoryUid: string): Promise<string[]> {
    // 遍历所有 Episode 检查是否包含该记忆
    const episodes = await this.episodeStore.getRecent(1000);
    if (episodes.length === 0) return [];

    // 使用批量查询优化 N+1 查询
    const episodeIds = episodes.map(e => e.uid);
    const memoryMap = await this.episodeStore.getMemoriesBatch(episodeIds);

    // 收集包含目标记忆的 Episode
    const containing: string[] = [];
    for (const episodeId of episodeIds) {
      const memoryUids = memoryMap.get(episodeId) || [];
      if (memoryUids.includes(memoryUid)) {
        containing.push(episodeId);
      }
    }

    return containing;
  }

  /**
   * 执行压缩动作
   */
  private async executeCompress(memory: MemoryMetaRecord): Promise<boolean> {
    if (!this.config.llmCompression.enabled) {
      return false;
    }

    // 获取记忆内容
    const content = await this.palaceStore.retrieve(memory.currentPalaceRef);
    if (!content) return false;

    // 生成压缩摘要（这里简化处理，实际应该调用 LLM）
    const compressedSummary = await this.generateCompressedSummary(content, memory.type);

    if (compressedSummary) {
      // 更新记忆摘要（作为新版本的一部分）
      this.logger.debug('Memory compressed', {
        uid: memory.uid,
        originalLength: content.length,
        summaryLength: compressedSummary.length,
      });

      // 注意：不直接修改原记忆，而是在下次更新时使用新摘要
      // 这里只是记录压缩结果
      return true;
    }

    return false;
  }

  /**
   * 生成压缩摘要
   * 使用 LLM 生成高层次的抽象摘要
   *
   * @param content 记忆内容
   * @param type 记忆类型
   * @returns 压缩后的摘要，如果内容太短则返回 null
   */
  private async generateCompressedSummary(content: string, type: MemoryType): Promise<string | null> {
    if (content.length < 100) {
      return null;
    }

    this.logger.debug('generateCompressedSummary called', { type, contentLength: content.length });

    // 如果配置了 LLM Extractor，使用它生成压缩摘要
    if (this.llmExtractor) {
      try {
        const prompt = this.promptLoader.render('prompts/memory-compression.md', {
          memoryType: type,
          content,
        });

        const response = await (this.llmExtractor as any).callLLM?.(prompt) ||
                         await this.llmExtractor.generateSummary(content);

        const summary = `[${type}] ${response}`.trim();

        this.logger.info('generateCompressedSummary completed', {
          contentLength: content.length,
          summaryLength: summary.length
        });

        return summary;
      } catch (error) {
        this.logger.warn('LLM compression failed, falling back to simple compression', {
          error: String(error)
        });
      }
    }

    // Fallback: 简单压缩
    const prefix = `[${type}] `;
    const compressed = prefix + content.slice(0, 95);

    this.logger.debug('generateCompressedSummary (fallback)', {
      contentLength: content.length,
      summaryLength: compressed.length
    });

    return compressed;
  }

  /**
   * 执行链接动作
   */
  private async executeLink(memory: MemoryMetaRecord): Promise<number> {
    let newRelations = 0;

    // 1. 提取记忆中的实体（简化处理）
    const entities = await this.extractEntities(memory);

    // 2. 查询现有图谱中的相关实体
    for (const entity of entities) {
      const related = await this.graphStore.queryByEntity(entity);
      for (const relatedUid of related) {
        if (relatedUid !== memory.uid) {
          // 检查是否已存在关联
          const existingEdges = await this.graphStore.getNodeEdges(memory.uid);
          const hasExisting = existingEdges.some(e =>
            e.targetId === relatedUid && e.relation === 'semantically_related'
          );

          if (!hasExisting) {
            await this.graphStore.addRelation(
              memory.uid,
              relatedUid,
              'semantically_related',
              0.5
            );
            newRelations++;
          }
        }
      }
    }

    return newRelations;
  }

  /**
   * 提取记忆中的实体
   * 使用 LLM 提取命名实体，如果不可用则从标签和类型提取
   *
   * @param memory 记忆元数据
   * @returns 提取的实体列表
   */
  private async extractEntities(memory: MemoryMetaRecord): Promise<string[]> {
    this.logger.debug('extractEntities called', { uid: memory.uid, type: memory.type });

    // 如果有 LLM Extractor，尝试使用它
    if (this.llmExtractor) {
      try {
        const content = await this.palaceStore.retrieve(memory.currentPalaceRef);
        if (content) {
          const prompt = this.promptLoader.render('prompts/consolidation-entity-extraction.md', {
            content: content.slice(0, 500),
          });

          const response = await (this.llmExtractor as any).callLLM?.(prompt) || '';
          const entities = response.split('\n').map((e: string) => e.trim()).filter((e: string) => e.length > 0);

          if (entities.length > 0) {
            this.logger.info('extractEntities completed', {
              uid: memory.uid,
              entityCount: entities.length
            });
            return entities;
          }
        }
      } catch (error) {
        this.logger.warn('LLM entity extraction failed, using fallback', {
          uid: memory.uid,
          error: String(error)
        });
      }
    }

    // Fallback: 从标签和类型提取
    const entities: string[] = [];
    entities.push(`type:${memory.type}`);
    if (memory.tags) {
      entities.push(...memory.tags);
    }
    entities.push(`agent:${memory.agentId}`);

    this.logger.debug('extractEntities (fallback)', {
      uid: memory.uid,
      entityCount: entities.length
    });

    return entities;
  }

  /**
   * 执行快照动作
   */
  private async executeSnapshot(memory: MemoryMetaRecord): Promise<boolean> {
    // 1. 获取情感上下文
    const content = await this.palaceStore.retrieve(memory.currentPalaceRef);
    if (!content) return false;

    const sentiment = await this.sentimentAnalyzer.analyze(content);

    // 2. 获取关联记忆
    const relatedMemories = await this.graphStore.findRelated(memory.uid, 5);

    // 3. 获取情景上下文
    let episodeContext = '';
    if (memory.sessionId) {
      const episodes = await this.episodeStore.getByLocation(`session_${memory.sessionId}`);
      if (episodes.length > 0) {
        episodeContext = episodes[0].name;
      }
    }

    // 4. 构建快照
    const snapshot = {
      originalMemoryUid: memory.uid,
      timestamp: Date.now(),
      abstraction: content.slice(0, 200),
      relatedMemoryUids: relatedMemories.map(r => r.uid),
      emotionalContext: sentiment.emotions,
      episodeContext,
      confidence: Math.min(1.0, (memory.importanceScore / 10) + 0.1),
    };

    // 5. 存储快照（作为特殊的 palace 记录）
    const snapshotRef = `snapshot_${memory.uid}_${Date.now()}.json`;
    await this.palaceStore.store(
      snapshotRef,
      JSON.stringify(snapshot, null, 2),
      {
        uid: memory.uid,
        version: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        originalSize: content.length,
        compressed: true,
        encrypted: false,
      }
    );

    this.logger.debug('Snapshot created', {
      memory: memory.uid,
      snapshotRef,
    });

    return true;
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

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  /**
   * 调度下一次运行
   */
  private scheduleNextRun(): void {
    const now = new Date();
    const target = new Date(now);
    target.setHours(this.config.scheduleHour, 0, 0, 0);

    if (target <= now) {
      target.setDate(target.getDate() + 1);
    }

    const msUntilTarget = target.getTime() - now.getTime();

    this.schedulerTimer = setTimeout(async () => {
      await this.runConsolidationCycle();
      this.scheduleNextRun(); // 调度下一次
    }, msUntilTarget);
  }
}
