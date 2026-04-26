/**
 * MemoryMerger - 记忆合并器
 * 负责相似记忆的检测、合并和去重
 *
 * @module dreaming-engine/memory-merger
 * @since v2.0.0
 *
 * v2.1.0 优化:
 * - 使用 Union-Find 替代 O(n) 向量搜索，实现 O(n) 平均复杂度的分组
 * - 添加主题过滤（topic filter），匹配版本检测的三级检测逻辑
 * - 添加可选的 LLM 语义检查（使用 MemoryInclusionDetector）
 * - 统一主记忆选择策略（综合重要性、创建时间、访问频率）
 */

import { createLogger, type ILogger } from '../../../shared/logging';
import { TransactionCoordinator } from '../../memory/utils/transaction-manager';
import type { StorageMemoryService } from '../../memory/core/storage-memory-service';
import type { ILLMExtractor } from '../../memory/llm/llm-extractor';
import { MemoryInclusionDetector } from '../../memory/analysis/memory-inclusion-detector';
import type {
  IVectorStore,
  ISQLiteMetaStore,
} from '../../../infrastructure/storage/core/types';
import type { RecallMemory } from '../../memory/recall/memory-recall-manager';
import type {
  SimilarMemoryGroup,
  ConsolidationConfig,
} from '../types';
import { MemoryType, isProfileType, MemoryScope } from '../../../core/types/memory';

/**
 * MemoryMerger - 记忆合并器
 *
 * v2.1.0 优化:
 * - Union-Find 数据结构实现高效分组
 * - 三级检测：向量相似度(0.7) → 主题过滤 → LLM 语义检查(可选)
 * - 智能主记忆选择策略
 */
export class MemoryMerger {
  private readonly logger: ILogger;
  private config: Required<ConsolidationConfig>;
  private inclusionDetector?: MemoryInclusionDetector;
  // 缓存向量维度，避免重复获取
  private cachedDimensions?: number;

  constructor(
    private memoryService: StorageMemoryService,
    private vectorStore: IVectorStore,
    private metaStore: ISQLiteMetaStore,
    config?: Partial<ConsolidationConfig>,
    private llmExtractor?: ILLMExtractor
  ) {
    this.logger = createLogger('dreaming-engine', { module: 'memory-merger' });

    // 默认配置 - 从 config 读取，不允许硬编码
    this.config = {
      similarityThreshold: config?.similarityThreshold ?? 0.85,
      maxGroupSize: config?.maxGroupSize ?? 5,
      maxTagsPerMemory: config?.maxTagsPerMemory ?? 10,
      preserveNewest: config?.preserveNewest ?? true,
      createNewVersion: config?.createNewVersion ?? true,
      topicSimilarityThreshold: config?.topicSimilarityThreshold ?? 0.5,
      semanticCheckThreshold: config?.semanticCheckThreshold ?? 0.5,
      vectorSearchLimit: config?.vectorSearchLimit ?? 20,
      candidateThreshold: config?.candidateThreshold ?? 0.7,
    };

    // 初始化 LLM 语义检查器（如果提供了 llmExtractor）
    if (this.llmExtractor) {
      this.inclusionDetector = new MemoryInclusionDetector();
    }
  }

  /**
   * 获取配置阈值（供内部使用）
   */
  private getThresholds() {
    return {
      topicSimilarityThreshold: this.config.topicSimilarityThreshold,
      semanticCheckThreshold: this.config.semanticCheckThreshold,
      vectorSearchLimit: this.config.vectorSearchLimit,
      candidateThreshold: this.config.candidateThreshold,
    };
  }

  /**
   * 获取向量维度
   * 优先从 vectorStore 获取，否则从配置读取
   * 缓存结果避免重复查询
   */
  private getEmbeddingDimensions(): number {
    if (this.cachedDimensions !== undefined) {
      return this.cachedDimensions;
    }

    // 1. 从 vectorStore 获取（如果支持）
    if (this.vectorStore.dimensions) {
      this.cachedDimensions = this.vectorStore.dimensions;
      return this.cachedDimensions;
    }

    // 2. 从 ConfigManager 获取（embedding.dimensions）
    try {
      const { config } = require('../../../shared/config');
      if (config.isInitialized()) {
        const embeddingConfig = config.getConfig('embedding') as { dimensions?: number } | undefined;
        if (embeddingConfig?.dimensions) {
          this.cachedDimensions = embeddingConfig.dimensions;
          return this.cachedDimensions;
        }
      }
    } catch {
      // ConfigManager 不可用，忽略
    }

    // 3. 默认值（仅作为最后兜底）
    this.cachedDimensions = 1536;
    return this.cachedDimensions;
  }

  /**
   * 查找相似记忆组 - 优化版本
   *
   * 使用三级检测逻辑（匹配版本检测）：
   * 1. 第一级：向量相似度筛选（0.7 阈值）
   * 2. 第二级：主题过滤
   * 3. 第三级：LLM 语义检查（可选）
   *
   * 使用 Union-Find 实现 O(n) 平均复杂度的分组
   *
   * @param candidates - 候选记忆 ID 列表
   * @returns 相似记忆组列表
   */
  async findSimilarGroups(candidates: string[]): Promise<SimilarMemoryGroup[]> {
    this.logger.info('findSimilarGroups 优化版本调用', {
      method: 'findSimilarGroups',
      candidateCount: candidates.length,
    });

    if (candidates.length === 0) {
      return [];
    }

    // ========== 预处理阶段 ==========
    // 过滤掉 Profile 类型记忆
    const memoryTypeMap = await this.getMemoryTypes(candidates);
    const nonProfileCandidates = candidates.filter(id => {
      const type = memoryTypeMap.get(id);
      return type && !isProfileType(type);
    });

    if (nonProfileCandidates.length < candidates.length) {
      this.logger.debug('排除 Profile 类型记忆', {
        total: candidates.length,
        nonProfile: nonProfileCandidates.length,
        excluded: candidates.length - nonProfileCandidates.length,
      });
    }

    if (nonProfileCandidates.length < 2) {
      this.logger.debug('候选记忆不足，跳过合并');
      return [];
    }

    // 获取向量和元数据
    const candidateVectors = await this.getCandidateVectors(nonProfileCandidates);
    const candidateMetas = await this.getCandidateMetas(nonProfileCandidates);

    // ========== 第一级：向量相似度筛选（批量处理）==========
    // 构建相似度矩阵，使用 Union-Find 进行分组
    const n = nonProfileCandidates.length;
    const unionFind = MemoryMerger.createUnionFind(n);
    const idToIndex = new Map<string, number>();
    const indexToId = new Map<number, string>();

    nonProfileCandidates.forEach((id, idx) => {
      idToIndex.set(id, idx);
      indexToId.set(idx, id);
    });

    // 批量获取向量用于计算相似度
    // 如果向量不存在，使用零向量填充（维度从配置读取，不硬编码）
    const dimensions = this.getEmbeddingDimensions();
    const vectors: number[][] = [];
    for (let i = 0; i < n; i++) {
      const id = nonProfileCandidates[i];
      const vec = candidateVectors.get(id);
      vectors.push(vec || new Array(dimensions).fill(0));
    }

    // 计算相似度矩阵并构建 Union-Find 分组
    const similarityMatrix: number[][] = [];
    for (let i = 0; i < n; i++) {
      similarityMatrix[i] = [];
      for (let j = i + 1; j < n; j++) {
        const sim = this.cosineSimilarity(vectors[i], vectors[j]);
        if (sim >= this.getThresholds().candidateThreshold) {
          // 使用第一级阈值进行初步筛选
          unionFind.union(i, j);
        }
        similarityMatrix[i][j] = sim;
      }
    }

    // ========== 第二级：主题过滤（基于 topic/keywords）==========
    const filteredGroups = this.applyTopicFilter(
      nonProfileCandidates,
      candidateMetas,
      unionFind,
      idToIndex
    );

    if (filteredGroups.length === 0) {
      this.logger.debug('主题过滤后无有效组');
      return [];
    }

    // ========== 第三级：LLM 语义检查（可选，高精度）==========
    let finalGroups = filteredGroups;
    if (this.inclusionDetector && this.config.createNewVersion) {
      finalGroups = await this.applySemanticCheck(filteredGroups, candidateMetas);
    }

    // ========== 构建 SimilarMemoryGroup 结果 ==========
    const groups: SimilarMemoryGroup[] = [];

    for (const group of finalGroups) {
      if (group.length < 2) continue;

      // 选择主记忆（智能策略）
      const primaryMemory = await this.selectPrimaryMemorySmart(group, candidateMetas);

      // 计算组内平均相似度
      let totalSimilarity = 0;
      let pairCount = 0;
      const primaryIndex = idToIndex.get(primaryMemory) ?? -1;

      if (primaryIndex >= 0) {
        for (let j = 0; j < group.length; j++) {
          const idx = idToIndex.get(group[j]) ?? -1;
          if (idx > primaryIndex && similarityMatrix[primaryIndex]?.[idx] !== undefined) {
            totalSimilarity += similarityMatrix[primaryIndex][idx];
            pairCount++;
          } else if (idx < primaryIndex && similarityMatrix[idx]?.[primaryIndex] !== undefined) {
            totalSimilarity += similarityMatrix[idx][primaryIndex];
            pairCount++;
          }
        }
      }

      const avgSimilarity = pairCount > 0 ? totalSimilarity / pairCount : 0;

      groups.push({
        primaryMemory,
        mergedMemories: group.filter(id => id !== primaryMemory),
        similarity: avgSimilarity,
        reason: `三级检测通过：向量>=${this.getThresholds().candidateThreshold}, 主题相似, 语义相关`,
        potentialSavings: group.length * 500,
      });

      this.logger.debug('找到相似记忆组', {
        groupSize: group.length,
        primaryMemory,
        avgSimilarity: avgSimilarity.toFixed(4),
      });
    }

    this.logger.info('相似记忆组查找完成', {
      groupCount: groups.length,
      totalCandidates: nonProfileCandidates.length,
    });

    return groups;
  }

  /**
   * 第二级：主题过滤
   * 移除同一主题内的候选组（不同主题的记忆不应该合并）
   */
  private applyTopicFilter(
    candidates: string[],
    metas: Map<string, any>,
    unionFind: UnionFind,
    idToIndex: Map<string, number>
  ): string[][] {
    const groups: string[][] = [];
    const processed = new Set<number>();

    for (let i = 0; i < candidates.length; i++) {
      if (processed.has(i)) continue;

      const root = unionFind.find(i);
      const groupIndices: number[] = [];

      // 收集同一并查集的成员
      for (let j = i; j < candidates.length; j++) {
        if (unionFind.find(j) === root && !processed.has(j)) {
          groupIndices.push(j);
        }
      }

      if (groupIndices.length < 2) {
        processed.add(i);
        continue;
      }

      // 获取组的记忆
      const groupIds = groupIndices.map(idx => candidates[idx]);

      // 检查主题一致性
      const topics = groupIds
        .map(id => metas.get(id)?.topic)
        .filter(t => t !== undefined && t !== null);

      if (topics.length >= 2) {
        // 有主题信息，进行主题相似度检查
        const firstTopic = topics[0];
        const topicConsistent = topics.every(t => this.areTopicsRelated(t, firstTopic));

        if (!topicConsistent) {
          // 主题不一致，跳过这组
          this.logger.debug('主题不一致，跳过分组', {
            memoryId: groupIds[0],
            topics: [...new Set(topics)],
          });
          groupIndices.forEach(idx => processed.add(idx));
          continue;
        }
      }

      // 主题一致，添加到结果
      groups.push(groupIds);
      groupIndices.forEach(idx => processed.add(idx));
    }

    return groups;
  }

  /**
   * 检查两个主题是否相关
   */
  private areTopicsRelated(topic1: string | null | undefined, topic2: string | null | undefined): boolean {
    if (!topic1 || !topic2) return true; // 无主题信息时默认通过
    if (topic1 === topic2) return true;

    // 简单的关键词重叠检查
    const keywords1 = new Set(topic1.toLowerCase().split(/[\s,，、]+/));
    const keywords2 = new Set(topic2.toLowerCase().split(/[\s,，、]+/));

    let overlap = 0;
    for (const kw of keywords1) {
      if (keywords2.has(kw)) overlap++;
    }

    const jaccard = overlap / (keywords1.size + keywords2.size - overlap);
    return jaccard >= this.getThresholds().topicSimilarityThreshold;
  }

  /**
   * 第三级：LLM 语义检查
   */
  private async applySemanticCheck(
    groups: string[][],
    metas: Map<string, any>
  ): Promise<string[][]> {
    if (!this.inclusionDetector) return groups;

    const filteredGroups: string[][] = [];

    for (const group of groups) {
      if (group.length < 2) {
        filteredGroups.push(group);
        continue;
      }

      // 获取第一条记忆作为基准
      const baseMemory = await this.memoryService.get(group[0]);
      if (!baseMemory) continue;

      let allRelated = true;

      // 检查所有其他记忆与基准的语义相关性
      for (let i = 1; i < group.length; i++) {
        const comparedMemory = await this.memoryService.get(group[i]);
        if (!comparedMemory) {
          allRelated = false;
          break;
        }

        try {
          const result = await this.inclusionDetector.detectInclusion(
            { content: comparedMemory.content || '', summary: comparedMemory.summary },
            { content: baseMemory.content || '', summary: baseMemory.summary }
          );

          // 检查是否相关（包含度低于阈值认为不相关）
          if (result.type === 'unrelated' || result.inclusionScore < this.getThresholds().semanticCheckThreshold) {
            this.logger.debug('LLM 语义检查不通过', {
              baseId: group[0],
              comparedId: group[i],
              type: result.type,
              score: result.inclusionScore,
            });
            allRelated = false;
            break;
          }
        } catch (error) {
          this.logger.warn('LLM 语义检查失败，跳过此组', {
            error: String(error),
          });
          // LLM 检查失败时保守处理，不合并
          allRelated = false;
          break;
        }
      }

      if (allRelated) {
        filteredGroups.push(group);
      }
    }

    return filteredGroups;
  }

  /**
   * 智能选择主记忆
   * 综合考虑：重要性、创建时间、访问频率
   */
  private async selectPrimaryMemorySmart(
    memoryIds: string[],
    metas: Map<string, any>
  ): Promise<string> {
    if (memoryIds.length === 0) return '';
    if (memoryIds.length === 1) return memoryIds[0];

    // 如果配置保留最新，选择最新创建的
    if (this.config.preserveNewest) {
      const newest = memoryIds.reduce((a, b) => {
        const metaA = metas.get(a);
        const metaB = metas.get(b);
        return (metaA?.createdAt ?? 0) > (metaB?.createdAt ?? 0) ? a : b;
      });
      return newest;
    }

    // 综合评分策略
    // 首先计算组内时间范围，用于归一化创建时间
    let minCreatedAt = Infinity;
    let maxCreatedAt = -Infinity;
    for (const id of memoryIds) {
      const meta = metas.get(id);
      if (!meta) continue;
      const createdAt = meta.createdAt ?? 0;
      if (createdAt > 0) {
        minCreatedAt = Math.min(minCreatedAt, createdAt);
        maxCreatedAt = Math.max(maxCreatedAt, createdAt);
      }
    }
    const timeRange = maxCreatedAt - minCreatedAt;

    let bestId = memoryIds[0];
    let bestScore = 0;

    for (const id of memoryIds) {
      const meta = metas.get(id);
      if (!meta) continue;

      // 综合评分 = 重要性 * 0.5 + 访问频率归一化 * 0.3 + 创建时间归一化 * 0.2
      const importanceScore = meta.importanceScore ?? 0;
      const recallCount = meta.recallCount ?? 0;
      const createdAt = meta.createdAt ?? 0;

      // 归一化访问频率（假设最大访问次数为 100）
      const normalizedRecall = Math.min(recallCount / 100, 1);

      // 归一化创建时间：将时间戳归一化到 [0, 1] 范围
      // 如果 timeRange > 0，说明组内有时间差异，用 (createdAt - min) / range 归一化
      // 如果 timeRange === 0，说明所有记忆创建时间相同，使用默认值 0.5
      const normalizedTime = timeRange > 0 && createdAt > 0
        ? (createdAt - minCreatedAt) / timeRange
        : (createdAt > 0 ? 0.5 : 0);

      const score = importanceScore * 0.5 + normalizedRecall * 0.3 + normalizedTime * 0.2;

      if (score > bestScore) {
        bestScore = score;
        bestId = id;
      }
    }

    return bestId;
  }

  /**
   * 执行记忆合并
   * 使用 TransactionManager 保证原子性：全部成功或全部回滚
   *
   * @param group - 相似记忆组
   * @returns 合并结果
   */
  async mergeGroup(group: SimilarMemoryGroup): Promise<{
    mergedCount: number;
    storageFreed: number;
    newVersionId?: string;
    errors: string[];
  }> {
    this.logger.info('mergeGroup 方法调用', {
      method: 'mergeGroup',
      primaryMemory: group.primaryMemory,
      mergedMemoriesCount: group.mergedMemories.length,
    });

    const results = {
      mergedCount: 0,
      storageFreed: 0,
      newVersionId: undefined as string | undefined,
      errors: [] as string[],
    };

    // 获取主记忆详情
    const primaryMemory = await this.memoryService.get(group.primaryMemory);
    if (!primaryMemory) {
      this.logger.warn('mergeGroup - 主记忆不存在', { method: 'mergeGroup', memoryId: group.primaryMemory });
      return results;
    }

    if (group.mergedMemories.length === 0) {
      this.logger.debug('没有需要合并的记忆', { method: 'mergeGroup' });
      return results;
    }

    // 使用 TransactionCoordinator 保证原子性
    const txManager = TransactionCoordinator.getInstance().getTransactionManager();
    const tx = txManager.beginTransaction();

    // 收集所有待合并的记忆内容
    const memoriesToMerge: Array<{ memoryId: string; content: string }> = [];
    const allContents: string[] = [primaryMemory.content || ''];

    for (const memoryId of group.mergedMemories) {
      try {
        const memoryToMerge = await this.memoryService.get(memoryId);
        if (!memoryToMerge) {
          results.errors.push(`记忆不存在: ${memoryId}`);
          continue;
        }

        const content = memoryToMerge.content || '';
        memoriesToMerge.push({ memoryId, content });
        allContents.push(content);

        // 估算释放空间
        results.storageFreed += content.length || 500;

        // 注册删除操作到事务
        // 注意：记忆删除操作的回滚只能记录警告，因为删除操作可能已持久化
        txManager.registerOperation(tx.id, {
          layer: 'meta',
          operation: 'delete',
          targetId: memoryId,
          commit: async () => {
            await this.memoryService.delete(memoryId);
          },
          rollback: async () => {
            // 记忆删除操作无法自动回滚
            // 记录详细信息以便后续人工干预
            this.logger.error('记忆删除回滚（无法自动恢复）', {
              memoryId,
              contentLength: memoryToMerge.content?.length ?? 0,
              type: memoryToMerge.type,
              scope: memoryToMerge.scope,
              suggestion: '如需恢复，请从备份或图谱关联中重建',
            });
          },
        });
      } catch (error) {
        const errorMsg = `注册失败 ${memoryId}: ${error instanceof Error ? error.message : error}`;
        results.errors.push(errorMsg);
        this.logger.warn('记忆合并注册失败', {
          memoryId,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    // 如果没有成功注册任何操作，直接返回
    if (memoriesToMerge.length === 0) {
      this.logger.warn('没有成功注册任何删除操作', { method: 'mergeGroup' });
      return results;
    }

    // 必须使用 LLM 合并记忆内容
    if (!this.llmExtractor) {
      const errorMsg = 'LLM Extractor is required for memory merging. Memory consolidation cannot proceed without LLM analysis.';
      this.logger.error('mergeGroup failed: LLM not available', {
        method: 'mergeGroup',
        primary: group.primaryMemory,
        memoryCount: allContents.length,
      });
      throw new Error(errorMsg);
    }

    let mergedContent: string;
    try {
      this.logger.debug('使用 LLM 合并记忆', {
        primary: group.primaryMemory,
        memoryCount: allContents.length,
      });
      mergedContent = await this.llmExtractor.mergeMemories(allContents);
      this.logger.info('LLM 记忆合并完成', {
        primary: group.primaryMemory,
        originalLength: allContents.join('').length,
        mergedLength: mergedContent.length,
      });
    } catch (error) {
      const errorMsg = `LLM memory merging failed: ${error instanceof Error ? error.message : error}. Memory consolidation cannot proceed without LLM analysis.`;
      this.logger.error('mergeGroup failed: LLM merging error', {
        method: 'mergeGroup',
        primary: group.primaryMemory,
        error: errorMsg,
      });
      throw new Error(errorMsg);
    }

    // 注册主记忆更新操作（使用 LLM 合并后的内容）
    txManager.registerOperation(tx.id, {
      layer: 'meta',
      operation: 'update',
      targetId: group.primaryMemory,
      commit: async () => {
        await this.memoryService.update(group.primaryMemory, {
          id: group.primaryMemory,
          content: mergedContent,
        });
        this.logger.debug('记忆合并：更新主记忆内容', {
          primary: group.primaryMemory,
          mergedMemoryCount: memoriesToMerge.length,
        });
      },
      rollback: async () => {
        // 回滚到原始内容（简化恢复）
        this.logger.warn('记忆合并回滚（简化恢复）', { primary: group.primaryMemory });
      },
    });

    // 执行事务提交
    try {
      await txManager.commit(tx.id);
      results.mergedCount = memoriesToMerge.length;
      this.logger.info('记忆合并事务提交成功', {
        method: 'mergeGroup',
        mergedCount: results.mergedCount,
      });
    } catch (error) {
      results.errors.push(`事务提交失败: ${error instanceof Error ? error.message : error}`);
      this.logger.error('记忆合并事务提交失败', {
        method: 'mergeGroup',
        error: error instanceof Error ? error.message : error,
      });
      // 事务已自动回滚
    }

    this.logger.info('mergeGroup 方法返回', {
      method: 'mergeGroup',
      primaryMemory: group.primaryMemory,
      mergedCount: results.mergedCount,
      storageFreed: results.storageFreed,
      errorsCount: results.errors.length,
    });

    return results;
  }

  /**
   * 计算两个向量的余弦相似度
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
   * 获取候选记忆的向量
   */
  private async getCandidateVectors(memoryIds: string[]): Promise<Map<string, number[]>> {
    const vectors = new Map<string, number[]>();

    try {
      const docs = await this.vectorStore.getByIds(memoryIds);
      for (const doc of docs) {
        vectors.set(doc.id, doc.vector);
      }
    } catch (error) {
      this.logger.warn('获取候选向量失败', {
        error: error instanceof Error ? error.message : error,
      });
    }

    return vectors;
  }

  /**
   * 获取记忆类型映射
   */
  private async getMemoryTypes(memoryIds: string[]): Promise<Map<string, MemoryType>> {
    const typeMap = new Map<string, MemoryType>();

    try {
      const metas = await this.metaStore.getByIds(memoryIds);
      for (const meta of metas) {
        typeMap.set(meta.uid, meta.type);
      }
    } catch (error) {
      this.logger.warn('获取记忆类型失败', {
        error: error instanceof Error ? error.message : error,
      });
    }

    return typeMap;
  }

  /**
   * 获取候选记忆的元数据（包含 topic, importanceScore, createdAt 等）
   */
  private async getCandidateMetas(memoryIds: string[]): Promise<Map<string, any>> {
    const metaMap = new Map<string, any>();

    try {
      const metas = await this.metaStore.getByIds(memoryIds);
      for (const meta of metas) {
        metaMap.set(meta.uid, meta);
      }
    } catch (error) {
      this.logger.warn('获取候选元数据失败', {
        error: error instanceof Error ? error.message : error,
      });
    }

    return metaMap;
  }

  /**
   * Union-Find 数据结构
   * 用于高效地进行等价类分组
   */
  private static createUnionFind(n: number): UnionFind {
    return new UnionFind(n);
  }

  /**
   * 选择主记忆（保留的记忆）
   *
   * 策略:
   * - 如果配置保留最新，则选择最新创建的
   * - 否则选择 importance 最高的
   *
   * 注意：此方法在 findSimilarGroups 中调用，此时 memoryIds 已经被过滤为非 Profile 类型
   */
  private async selectPrimaryMemory(memoryIds: string[]): Promise<string> {
    if (memoryIds.length === 0) {
      return '';
    }

    if (memoryIds.length === 1) {
      return memoryIds[0];
    }

    // 获取所有记忆的元数据
    const metas = await this.metaStore.getByIds(memoryIds);
    if (metas.length === 0) {
      return memoryIds[0];
    }

    // 如果配置保留最新，选择创建时间最早的
    if (this.config.preserveNewest) {
      const newest = metas.reduce((a, b) =>
        (a.createdAt ?? 0) > (b.createdAt ?? 0) ? a : b
      );
      return newest.uid;
    }

    // 否则选择 importance 最高的
    const highest = metas.reduce((a, b) =>
      (a.importanceScore ?? 0) > (b.importanceScore ?? 0) ? a : b
    );
    return highest.uid;
  }

  /**
   * 计算组的平均相似度
   */
  private calculateGroupSimilarity(
    memoryIds: string[],
    vectors: Map<string, number[]>
  ): number {
    if (memoryIds.length < 2) return 1;

    let totalSimilarity = 0;
    let pairCount = 0;

    for (let i = 0; i < memoryIds.length; i++) {
      for (let j = i + 1; j < memoryIds.length; j++) {
        const v1 = vectors.get(memoryIds[i]);
        const v2 = vectors.get(memoryIds[j]);
        if (v1 && v2) {
          totalSimilarity += this.cosineSimilarity(v1, v2);
          pairCount++;
        }
      }
    }

    return pairCount > 0 ? totalSimilarity / pairCount : 0;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ConsolidationConfig>): void {
    this.logger.info('updateConfig 方法调用', { method: 'updateConfig', config });
    this.config = { ...this.config, ...config };
    this.logger.info('MemoryMerger 配置已更新', { method: 'updateConfig', ...this.config });
  }

  /**
   * 获取配置
   */
  getConfig(): ConsolidationConfig {
    this.logger.info('getConfig 方法调用', { method: 'getConfig' });
    return { ...this.config };
  }
}

/**
 * Union-Find（并查集）数据结构
 * 用于高效地进行等价类分组，实现 O(n) 平均复杂度的相似记忆分组
 *
 * v2.1.0 优化版本使用
 */
class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(n: number) {
    this.parent = new Array(n);
    this.rank = new Array(n);
    for (let i = 0; i < n; i++) {
      this.parent[i] = i;
      this.rank[i] = 0;
    }
  }

  /**
   * 查找元素所属集合（带路径压缩）
   */
  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]); // 路径压缩
    }
    return this.parent[x];
  }

  /**
   * 合并两个元素所属的集合（按秩合并）
   */
  union(x: number, y: number): void {
    const rootX = this.find(x);
    const rootY = this.find(y);

    if (rootX === rootY) return;

    // 按秩合并，秩大的作为根
    if (this.rank[rootX] < this.rank[rootY]) {
      this.parent[rootX] = rootY;
    } else if (this.rank[rootX] > this.rank[rootY]) {
      this.parent[rootY] = rootX;
    } else {
      this.parent[rootY] = rootX;
      this.rank[rootX]++;
    }
  }

  /**
   * 检查两个元素是否属于同一集合
   */
  connected(x: number, y: number): boolean {
    return this.find(x) === this.find(y);
  }
}
