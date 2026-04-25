/**
 * GraphReorganizer - 图谱重构器
 * 负责图谱关联分析、断开连接修复、节点优化
 *
 * @module dreaming-engine/graph-reorganizer
 * @since v2.0.0
 */

import { createLogger, type ILogger } from '../../../shared/logging';
import { TransactionCoordinator } from '../../memory/utils/transaction-manager';
import type {
  IGraphStore,
  IVectorStore,
  ISQLiteMetaStore,
  RelatedMemoryResult,
} from '../../../infrastructure/storage/core/types';
import type {
  ReorganizationConfig,
} from '../types';
import { MemoryType, PROFILE_TYPES, isProfileType } from '../../../core/types/memory';

/**
 * 图谱缺口分析结果
 */
interface GraphGap {
  from: string;
  to: string;
  reason: string;
  suggestedRelation?: string;
}

/**
 * 孤儿节点分析结果
 */
interface OrphanedNode {
  nodeId: string;
  entity: string;
  reason: string;
  suggestedConnections: string[];
}

/**
 * GraphReorganizer - 图谱重构器
 */
export class GraphReorganizer {
  private readonly logger: ILogger;
  private config: Required<ReorganizationConfig>;

  constructor(
    private graphStore: IGraphStore,
    private vectorStore: IVectorStore,
    private metaStore: ISQLiteMetaStore,
    config?: Partial<ReorganizationConfig>
  ) {
    this.logger = createLogger('dreaming-engine', { module: 'graph-reorganizer' });

    // 默认配置
    this.config = {
      minEdgeWeight: config?.minEdgeWeight ?? 0.3,
      densityTarget: config?.densityTarget ?? 0.5,
      orphanThreshold: config?.orphanThreshold ?? 0.2,
      maxNewRelationsPerCycle: config?.maxNewRelationsPerCycle ?? 30,
      minNewRelationSimilarity: config?.minNewRelationSimilarity ?? 0.7,
    };
  }

  /**
   * 分析图谱缺口（查找孤立记忆节点）
   * 使用批量查询优化 N+1 问题
   *
   * @returns 断开关联的列表
   */
  async analyzeGaps(): Promise<GraphGap[]> {
    this.logger.info('analyzeGaps 方法调用', { method: 'analyzeGaps' });

    const gaps: GraphGap[] = [];

    try {
      const memories = await this.metaStore.query({ isLatestVersion: true, limit: 200 });
      const nonProfileMemories = memories.filter(m => !isProfileType(m.type));

      if (nonProfileMemories.length === 0) {
        return gaps;
      }

      // 批量查询所有记忆的关联
      const memoryIds = nonProfileMemories.map(m => m.uid);
      const relatedMap = await this.graphStore.findRelatedBatch(memoryIds, 1);

      for (const memory of nonProfileMemories) {
        const related = relatedMap.get(memory.uid) || [];
        if (related.length === 0) {
          gaps.push({
            from: memory.uid,
            to: '',
            reason: '该记忆在图谱中无任何关联',
          });
        }
      }

      this.logger.info('analyzeGaps 方法返回', { method: 'analyzeGaps', gapCount: gaps.length });
    } catch (error) {
      this.logger.error('analyzeGaps 方法失败', {
        method: 'analyzeGaps',
        error: error instanceof Error ? error.message : error,
      });
    }

    return gaps;
  }

  /**
   * 查找孤儿节点
   *
   * 注意：Profile 类型（IDENTITY/PREFERENCE/PERSONA）不参与孤儿检测
   * 因为 Profile 类型可能故意没有图谱关联
   *
   * 使用批量查询优化 N+1 问题
   *
   * @returns 孤儿节点列表
   */
  async findOrphanedNodes(): Promise<OrphanedNode[]> {
    this.logger.info('findOrphanedNodes 方法调用', { method: 'findOrphanedNodes' });

    const orphaned: OrphanedNode[] = [];

    try {
      // 从 SQLite 获取所有记忆
      const memories = await this.metaStore.query({
        limit: 1000,
      });

      // 过滤掉 Profile 类型
      const nonProfileMemories = memories.filter(m => !isProfileType(m.type));

      if (nonProfileMemories.length === 0) {
        return orphaned;
      }

      // 批量查询所有记忆的关联（优化 N+1）
      const memoryIds = nonProfileMemories.map(m => m.uid);
      const relatedMap = await this.graphStore.findRelatedBatch(memoryIds, 5);

      for (const memory of nonProfileMemories) {
        // 查询每个记忆在图谱中的关联
        const related = relatedMap.get(memory.uid) || [];

        // 如果没有关联或关联很弱，标记为孤儿
        if (related.length === 0) {
          orphaned.push({
            nodeId: memory.uid,
            entity: `memory_${memory.uid}`,
            reason: '无图谱关联',
            suggestedConnections: [],
          });
        }
      }

      this.logger.info('findOrphanedNodes 方法返回', { method: 'findOrphanedNodes', orphanedCount: orphaned.length });
    } catch (error) {
      this.logger.error('findOrphanedNodes 方法失败', {
        method: 'findOrphanedNodes',
        error: error instanceof Error ? error.message : error,
      });
    }

    return orphaned;
  }

  /**
   * 重建关联
   * 使用 TransactionManager 保证原子性
   *
   * @param relation - 要重建的关联
   * @returns 是否成功
   */
  async rebuildRelation(relation: { from: string; to: string }): Promise<boolean> {
    this.logger.info('rebuildRelation 方法调用', { method: 'rebuildRelation', relation });

    const txManager = TransactionCoordinator.getInstance().getTransactionManager();
    const tx = txManager.beginTransaction();

    txManager.registerOperation(tx.id, {
      layer: 'graph',
      operation: 'insert',
      targetId: `${relation.from}_${relation.to}`,
      commit: async () => {
        await this.graphStore.addRelation(
          relation.from,
          relation.to,
          'related',
          this.config.minEdgeWeight
        );
      },
      rollback: async () => {
        // 回滚：删除刚刚添加的边
        await this.graphStore.removeRelation(relation.from, relation.to, 'related');
        this.logger.debug('rebuildRelation 回滚：删除已添加的边', {
          from: relation.from,
          to: relation.to,
        });
      },
    });

    try {
      await txManager.commit(tx.id);
      this.logger.info('rebuildRelation 方法返回', { method: 'rebuildRelation', success: true, relation });
      return true;
    } catch (error) {
      this.logger.warn('rebuildRelation 方法失败', {
        method: 'rebuildRelation',
        relation,
        error: error instanceof Error ? error.message : error,
      });
      // 事务已自动回滚
      return false;
    }
  }

  /**
   * 补充新关联（基于向量相似度）
   * 使用事务管理器确保添加关联的原子性
   *
   * @param limit - 最大补充数量
   * @returns 新建立的关联数
   */
  async supplementRelations(limit?: number): Promise<number> {
    const maxRelations = limit ?? this.config.maxNewRelationsPerCycle;
    this.logger.info('supplementRelations 方法调用', { method: 'supplementRelations', maxRelations });

    let createdCount = 0;

    try {
      // 1. 获取所有最新版本的记忆（排除 Profile 类型）
      const allMemories = await this.metaStore.query({
        isLatestVersion: true,
        limit: 100,
      });

      // 过滤掉 Profile 类型
      const memories = allMemories.filter(m => !isProfileType(m.type));

      if (memories.length < 2) {
        this.logger.debug('记忆数量不足，跳过关联补充');
        return 0;
      }

      // 2. 获取向量
      const vectors = await this.getMemoryVectors(memories.map(m => m.uid));
      if (vectors.size < 2) {
        return 0;
      }

      // 3. 批量查询所有记忆的已有关联（优化 N+1）
      const memoryIds = memories.map(m => m.uid);
      const allRelatedMap = await this.graphStore.findRelatedBatch(memoryIds, 10);

      // 4. 收集要建立的新关联（使用向量搜索替代 O(n²) 两两比较）
      const newRelations: Array<{ from: string; to: string; weight: number }> = [];

      for (const memory1 of memories) {
        const vector1 = vectors.get(memory1.uid);
        if (!vector1) continue;

        // 使用向量搜索找相似记忆（替代 O(n²) 两两比较）
        // 注意：使用 0.7 作为新关系创建的相似度阈值，比 minEdgeWeight (0.3) 高
        // 这样可以避免创建低质量的关联，同时留有足够的缓冲区
        const searchResults = await this.vectorStore.search({
          queryVector: vector1,
          limit: 20,
          minScore: this.config.minNewRelationSimilarity,
        });

        // 过滤结果：只保留在候选列表中、相似度高但没有已有关联的记忆
        const existing = allRelatedMap.get(memory1.uid) || [];
        for (const result of searchResults) {
          // 检查是否已达到限制
          if (newRelations.length >= maxRelations) break;

          // 检查是否在候选列表中
          const memory2 = memories.find(m => m.uid === result.id);
          if (!memory2) continue;

          // 检查是否已存在关联
          const hasConnection = existing.some(r => r.uid === result.id);
          if (hasConnection) continue;

          // 避免重复添加（from -> to 和 to -> from）
          const alreadyAdded = newRelations.some(
            r => (r.from === memory1.uid && r.to === result.id) ||
                 (r.from === result.id && r.to === memory1.uid)
          );
          if (alreadyAdded) continue;

          newRelations.push({
            from: memory1.uid,
            to: result.id,
            weight: result.score,
          });
        }
      }

      // 4. 使用事务批量添加关联
      if (newRelations.length > 0) {
        const txManager = TransactionCoordinator.getInstance().getTransactionManager();
        const tx = txManager.beginTransaction();

        for (const relation of newRelations) {
          txManager.registerOperation(tx.id, {
            layer: 'graph',
            operation: 'insert',
            targetId: `${relation.from}_${relation.to}`,
            commit: async () => {
              await this.graphStore.addRelation(
                relation.from,
                relation.to,
                'semantically_related',
                relation.weight
              );
            },
            rollback: async () => {
              // 回滚：删除刚刚添加的边
              // 图谱边删除不影响其他数据，这是正确的回滚方式
              await this.graphStore.removeRelation(relation.from, relation.to, 'semantically_related');
              this.logger.debug('supplementRelations 回滚：删除已添加的边', {
                from: relation.from,
                to: relation.to,
              });
            },
          });
        }

        try {
          await txManager.commit(tx.id);
          createdCount = newRelations.length;

          this.logger.debug('批量建立新关联', { count: newRelations.length });
        } catch (error) {
          this.logger.error('批量建立关联事务失败', {
            error: error instanceof Error ? error.message : error,
          });
          // 继续执行，不阻塞流程
        }
      }

      this.logger.info('关联补充完成', { createdCount });
    } catch (error) {
      this.logger.error('关联补充失败', {
        error: error instanceof Error ? error.message : error,
      });
    }

    return createdCount;
  }

  /**
   * 清理弱关联边
   * 使用事务管理器确保删除操作的原子性
   *
   * @returns 清理的边数
   */
  async cleanupWeakEdges(): Promise<number> {
    this.logger.debug('开始清理弱关联边');

    let cleanedCount = 0;

    try {
      // 查询所有 'related' 类型的边（最常见的语义关联类型）
      const edges = await this.graphStore.queryByRelation('related', 500);

      // 收集要删除的弱边
      const weakEdges = edges.filter(edge => edge.weight < this.config.minEdgeWeight);

      if (weakEdges.length === 0) {
        return 0;
      }

      // 使用事务批量删除
      const txManager = TransactionCoordinator.getInstance().getTransactionManager();
      const tx = txManager.beginTransaction();

      for (const edge of weakEdges) {
        txManager.registerOperation(tx.id, {
          layer: 'graph',
          operation: 'delete',
          targetId: `${edge.sourceId}_${edge.targetId}`,
          commit: async () => {
            await this.graphStore.removeRelation(edge.sourceId, edge.targetId, edge.relation);
          },
          rollback: async () => {
            // 回滚：重新添加被删除的边，恢复原始权重
            await this.graphStore.addRelation(edge.sourceId, edge.targetId, edge.relation, edge.weight);
            this.logger.debug('cleanupWeakEdges 回滚：恢复被删除的边', {
              sourceId: edge.sourceId,
              targetId: edge.targetId,
              relation: edge.relation,
              weight: edge.weight,
            });
          },
        });
      }

      try {
        await txManager.commit(tx.id);
        cleanedCount = weakEdges.length;

        this.logger.debug('批量清理弱关联边', { count: weakEdges.length });
      } catch (error) {
        this.logger.error('批量清理弱关联边事务失败', {
          error: error instanceof Error ? error.message : error,
        });
      }

      this.logger.info('弱关联边清理完成', { cleanedCount });
    } catch (error) {
      this.logger.error('弱关联边清理失败', {
        error: error instanceof Error ? error.message : error,
      });
    }

    return cleanedCount;
  }

  /**
   * 计算图谱边密度
   *
   * @returns 边密度 (0-1)
   */
  async calculateEdgeDensity(): Promise<number> {
    try {
      const stats = await this.graphStore.getStats();

      // 密度 = 实际边数 / 可能的最大边数
      // 假设节点数为 n，可能的最大边数为 n*(n-1)/2
      const nodeCount = stats.nodeCount;
      if (nodeCount < 2) return 0;

      const maxEdges = (nodeCount * (nodeCount - 1)) / 2;
      const density = stats.edgeCount / maxEdges;

      return density;
    } catch (error) {
      this.logger.warn('边密度计算失败', {
        error: error instanceof Error ? error.message : error,
      });
      return 0;
    }
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
   * 获取记忆向量
   */
  private async getMemoryVectors(memoryIds: string[]): Promise<Map<string, number[]>> {
    const vectors = new Map<string, number[]>();

    try {
      const docs = await this.vectorStore.getByIds(memoryIds);
      for (const doc of docs) {
        vectors.set(doc.id, doc.vector);
      }
    } catch (error) {
      this.logger.warn('获取记忆向量失败', {
        error: error instanceof Error ? error.message : error,
      });
    }

    return vectors;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ReorganizationConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('GraphReorganizer 配置已更新', this.config);
  }

  /**
   * 获取配置
   */
  getConfig(): ReorganizationConfig {
    return { ...this.config };
  }
}
