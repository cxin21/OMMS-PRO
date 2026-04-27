/**
 * StorageOptimizer - 存储优化器
 * 负责碎片检测、归档策略、存储优化
 *
 * @module dreaming-engine/storage-optimizer
 * @since v2.0.0
 */

import { createServiceLogger, type ILogger } from '../../../shared/logging';
import { TransactionCoordinator } from '../../memory/utils/transaction-manager';
import type { StorageMemoryService } from '../../memory/core/storage-memory-service';
import type {
  IPalaceStore,
  ISQLiteMetaStore,
  IGraphStore,
} from '../../../infrastructure/storage/core/types';
import type {
  FragmentationMetrics,
  ArchivalConfig,
  DefragmentationConfig,
} from '../types';
import { MemoryBlock, MemoryType, isProfileType } from '../../../core/types/memory';
import { config } from '../../../shared/config';

/**
 * 内部使用的归档配置类型，包含权重配置
 */
interface InternalArchivalConfig extends ArchivalConfig {
  importanceWeight: number;
  stalenessWeight: number;
  recallWeight: number;
}

/**
 * StorageOptimizer - 存储优化器
 */
export class StorageOptimizer {
  private readonly logger: ILogger;
  private archivalConfig: InternalArchivalConfig;
  private defragConfig: Required<DefragmentationConfig>;
  private lastDefragmentationAt?: number;

  constructor(
    private memoryService: StorageMemoryService,
    private palaceStore: IPalaceStore,
    private metaStore: ISQLiteMetaStore,
    private graphStore: IGraphStore,
    archivalConfig?: Partial<ArchivalConfig>,
    defragConfig?: Partial<DefragmentationConfig>
  ) {
    this.logger = createServiceLogger('StorageOptimizer');

    // 默认归档配置
    this.archivalConfig = {
      importanceThreshold: archivalConfig?.importanceThreshold ?? 2,
      stalenessDays: archivalConfig?.stalenessDays ?? 30,
      archiveBlock: archivalConfig?.archiveBlock ?? MemoryBlock.ARCHIVED,
      retentionDays: archivalConfig?.retentionDays ?? 90,
      archiveScoreThreshold: archivalConfig?.archiveScoreThreshold ?? 50,
      // 从配置读取评分权重，否则使用默认值
      importanceWeight: archivalConfig?.archiveScoreWeights?.importanceWeight ?? 40,
      stalenessWeight: archivalConfig?.archiveScoreWeights?.stalenessWeight ?? 35,
      recallWeight: archivalConfig?.archiveScoreWeights?.recallWeight ?? 25,
    };

    // 默认碎片整理配置
    this.defragConfig = {
      fragmentationThreshold: defragConfig?.fragmentationThreshold ?? 0.3,
      enableCompression: defragConfig?.enableCompression ?? true,
    };
  }

  /**
   * 计算碎片化指标
   *
   * @returns 碎片化指标
   */
  async calculateFragmentation(): Promise<FragmentationMetrics> {
    this.logger.debug('开始计算碎片化指标');

    try {
      // 1. 获取 Palace 碎片率
      const palaceStats = await this.palaceStore.getStats();
      const metaCount = await this.metaStore.count({ isLatestVersion: true });
      // 若 palace 文件数远多于元数据记录数（说明有遗留碎片文件），则碎片率高
      const expectedPalaceFiles = metaCount;
      const palaceFragmentation = expectedPalaceFiles > 0
        ? Math.min(Math.max((palaceStats.count - expectedPalaceFiles) / expectedPalaceFiles, 0), 1)
        : (palaceStats.count > 100 ? 0.2 : 0);

      // 2. 统计孤儿记忆数（无图谱关联）
      const orphanedMemories = await this.countOrphanedMemories();

      // 3. 统计陈旧记忆数（长期未访问）
      const staleMemories = await this.countStaleMemories();

      // 4. 估算图谱边密度（简化计算）
      const graphEdgeDensity = await this.estimateGraphEdgeDensity();

      const metrics: FragmentationMetrics = {
        palaceFragmentation,
        graphEdgeDensity,
        orphanedMemories,
        staleMemories,
        lastDefragmentationAt: this.lastDefragmentationAt,
      };

      this.logger.info('碎片化指标计算完成', metrics as unknown as Record<string, unknown>);
      return metrics;
    } catch (error) {
      this.logger.error('碎片化指标计算失败', {
        error: error instanceof Error ? error.message : error,
      });

      return {
        palaceFragmentation: 0,
        graphEdgeDensity: 0,
        orphanedMemories: 0,
        staleMemories: 0,
      };
    }
  }

  /**
   * 查找可归档记忆
   *
   * @param limit - 最大数量限制
   * @returns 可归档的记忆 ID 列表
   */
  async findArchivalCandidates(limit?: number): Promise<string[]> {
    this.logger.debug('开始查找可归档记忆');

    const candidates: string[] = [];
    const maxResults = limit ?? 100;

    try {
      // 查找低重要性的记忆
      const lowImportanceMemories = await this.metaStore.query({
        limit: maxResults,
        orderBy: 'importanceScore',
        orderDir: 'asc',
      });

      for (const memory of lowImportanceMemories) {
        // 排除 Profile 类型
        if (isProfileType(memory.type)) {
          continue;
        }

        // 检查是否满足归档条件
        const shouldArchive = await this.shouldArchive(memory);
        if (shouldArchive) {
          candidates.push(memory.uid);
        }
      }

      this.logger.info('可归档记忆查找完成', { candidateCount: candidates.length });
    } catch (error) {
      this.logger.error('可归档记忆查找失败', {
        error: error instanceof Error ? error.message : error,
      });
    }

    return candidates;
  }

  /**
   * 归档记忆
   *
   * 委托给 memoryService.archiveMemory 执行完整的归档流程：
   * - 迁移 palace 文件到 archived/ 目录
   * - 更新 metaStore 元数据
   * - 更新 vectorStore palaceRef
   * - 移除图谱关联
   *
   * @param memoryId - 记忆 ID
   * @returns 是否成功
   */
  async archiveMemory(memoryId: string): Promise<boolean> {
    this.logger.debug('归档记忆', { memoryId });

    try {
      // 获取记忆元数据检查是否存在
      const meta = await this.metaStore.getById(memoryId);
      if (!meta) {
        this.logger.warn('记忆不存在', { memoryId });
        return false;
      }

      // 检查是否已经归档
      const isArchived = meta.tags?.includes('archived') ?? false;
      if (isArchived) {
        this.logger.debug('记忆已经归档', { memoryId });
        return true;
      }

      // 委托给 memoryService 执行完整的归档流程（使用 TransactionManager）
      await this.memoryService.archiveMemory(memoryId);

      this.logger.info('记忆归档成功', { memoryId });
      return true;
    } catch (error) {
      this.logger.error('记忆归档失败', {
        memoryId,
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }

  /**
   * 批量归档记忆
   *
   * 注意：由于 archiveMemory 本身已经使用 TransactionManager 保证原子性，
   * 这里不再嵌套包装事务，而是逐个调用 archiveMemory。
   * 如果某个记忆归档失败，不影响其他记忆的归档操作。
   *
   * @param memoryIds - 记忆 ID 列表
   * @returns 成功归档的数量
   */
  async archiveMemories(memoryIds: string[]): Promise<number> {
    this.logger.debug('批量归档记忆', { count: memoryIds.length });

    if (memoryIds.length === 0) {
      return 0;
    }

    let successCount = 0;
    const failedIds: string[] = [];

    // 逐个调用 archiveMemory（每个 archiveMemory 内部已有事务保护）
    for (const memoryId of memoryIds) {
      try {
        // archiveMemory 是原子操作：内部使用 TransactionManager
        await this.memoryService.archiveMemory(memoryId);
        successCount++;
      } catch (error) {
        failedIds.push(memoryId);
        this.logger.warn('单个记忆归档失败，继续处理其他记忆', {
          memoryId,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    if (failedIds.length > 0) {
      this.logger.warn('批量归档完成，部分记忆归档失败', {
        total: memoryIds.length,
        success: successCount,
        failed: failedIds.length,
        failedIds,
      });
    } else {
      this.logger.info('批量归档完成', {
        total: memoryIds.length,
        success: successCount,
      });
    }

    return successCount;
  }

  /**
   * 执行碎片整理
   * 真实实现：清理孤儿文件、整理存储结构
   *
   * 注意：Palace 文件删除使用尽力而为模式
   * 孤儿文件删除本身是安全的（它们是垃圾文件）
   * 孤立版本文件删除也是安全的（元数据仍指向最新版本）
   *
   * @returns 整理结果
   */
  async defragment(): Promise<{
    filesMoved: number;
    spaceFreed: number;
    orphansRemoved: number;
  }> {
    this.logger.info('defragment 方法调用', { method: 'defragment' });

    const result = {
      filesMoved: 0,
      spaceFreed: 0,
      orphansRemoved: 0,
    };

    try {
      // 1. 检查碎片率是否超过阈值
      const metrics = await this.calculateFragmentation();

      if (metrics.palaceFragmentation < this.defragConfig.fragmentationThreshold) {
        this.logger.debug('碎片率未超过阈值，跳过整理', {
          method: 'defragment',
          current: metrics.palaceFragmentation,
          threshold: this.defragConfig.fragmentationThreshold,
        });
        return result;
      }

      // 收集所有待删除的文件和大小（用于统计）
      const filesToDelete: Array<{ palaceRef: string; size: number }> = [];

      // 2. 查找孤儿 Palace 文件（存在于文件系统但无对应元数据）
      const orphanPalaceRefs = await this.findOrphanedPalaceFiles();
      this.logger.info('defragment 发现孤儿Palace文件', { count: orphanPalaceRefs.length });

      // 批量获取文件大小（优化 N+1 查询）
      const orphanFilePaths = orphanPalaceRefs.map(ref => this.getPalaceFilePath(ref));
      const orphanFileSizes = await this.getFileSizes(orphanFilePaths);
      for (const palaceRef of orphanPalaceRefs) {
        const filePath = this.getPalaceFilePath(palaceRef);
        const size = orphanFileSizes.get(filePath) || 0;
        filesToDelete.push({ palaceRef, size });
      }

      // 3. 查找并清理孤立的版本文件（同一 versionGroup 的旧版本）
      const orphanedVersions = await this.findOrphanedVersionFiles();
      this.logger.info('defragment 发现孤立版本文件', { count: orphanedVersions.length });

      for (const { palaceRef, size } of orphanedVersions) {
        filesToDelete.push({ palaceRef, size });
      }

      // 4. 使用事务批量删除（尽力而为模式）
      // 注意：文件删除的 rollback 实际上无法恢复文件，但事务机制仍提供操作跟踪
      const txManager = TransactionCoordinator.getInstance().getTransactionManager();
      const tx = txManager.beginTransaction();

      for (const { palaceRef, size } of filesToDelete) {
        txManager.registerOperation(tx.id, {
          layer: 'palace',
          operation: 'delete',
          targetId: palaceRef,
          commit: async () => {
            await this.palaceStore.delete(palaceRef);
            result.spaceFreed += size;
            result.orphansRemoved++;
          },
          rollback: async () => {
            // 文件删除无法回滚，这是一个已知限制
            // 但事务机制仍然记录了操作，便于问题排查
            this.logger.warn('defragment 事务回滚：文件删除无法恢复', { palaceRef });
          },
        });
      }

      try {
        await txManager.commit(tx.id);
        this.logger.info('defragment 批量删除完成', {
          method: 'defragment',
          totalFiles: filesToDelete.length,
        });
      } catch (error) {
        this.logger.error('defragment 批量删除失败', {
          method: 'defragment',
          error: error instanceof Error ? error.message : error,
        });
        // 尽力而为：即使事务失败，也尝试继续处理
      }

      // 5. 统计压缩后的碎片率
      const newMetrics = await this.calculateFragmentation();
      this.logger.info('defragment 碎片整理完成', {
        method: 'defragment',
        orphansRemoved: result.orphansRemoved,
        spaceFreed: result.spaceFreed,
        newFragmentation: newMetrics.palaceFragmentation,
        previousFragmentation: metrics.palaceFragmentation,
      });

      this.lastDefragmentationAt = Date.now();
    } catch (error) {
      this.logger.error('defragment 碎片整理失败', {
        method: 'defragment',
        error: error instanceof Error ? error.message : error,
      });
    }

    return result;
  }

  /**
   * 查找孤儿的 Palace 文件（存在于文件系统但无对应元数据）
   * 使用批量查询优化 N+1 问题
   */
  private async findOrphanedPalaceFiles(): Promise<string[]> {
    this.logger.info('findOrphanedPalaceFiles 方法调用', { method: 'findOrphanedPalaceFiles' });

    try {
      // 获取所有 Palace 文件
      const allPalaceRefs = await this.palaceStore.getAllPalaceRefs();
      const orphans: string[] = [];

      // 解析所有 palaceRef 并收集 UID
      const parsedRefs: Array<{ palaceRef: string; uid: string }> = [];
      for (const palaceRef of allPalaceRefs) {
        const parsed = this.parsePalaceRef(palaceRef);
        if (!parsed) {
          this.logger.warn('findOrphanedPalaceFiles 无法解析 palaceRef', { method: 'findOrphanedPalaceFiles', palaceRef });
          continue;
        }
        parsedRefs.push({ palaceRef, uid: parsed.uid });
      }

      if (parsedRefs.length === 0) {
        return orphans;
      }

      // 批量查询所有 UID 对应的元数据（优化 N+1）
      const uids = parsedRefs.map(p => p.uid);
      const metas = await this.metaStore.getByIds(uids);
      const existingUids = new Set(metas.map(m => m.uid));

      // 检查哪些 palaceRef 没有对应的元数据
      for (const { palaceRef, uid } of parsedRefs) {
        if (!existingUids.has(uid)) {
          orphans.push(palaceRef);
        }
      }

      this.logger.info('findOrphanedPalaceFiles 方法返回', { method: 'findOrphanedPalaceFiles', orphansCount: orphans.length });
      return orphans;
    } catch (error) {
      this.logger.error('findOrphanedPalaceFiles 查找失败', { method: 'findOrphanedPalaceFiles', error });
      return [];
    }
  }

  /**
   * 查找孤立的版本文件（非最新版本的 palace 文件）
   * 使用批量查询优化 N+1 问题
   */
  private async findOrphanedVersionFiles(): Promise<Array<{ palaceRef: string; size: number }>> {
    this.logger.info('findOrphanedVersionFiles 方法调用', { method: 'findOrphanedVersionFiles' });

    try {
      // 获取所有 Palace 文件
      const allPalaceRefs = await this.palaceStore.getAllPalaceRefs();

      // 解析所有 palaceRef 并收集 UID
      const parsedRefs: Array<{ palaceRef: string; uid: string; version: number }> = [];
      for (const palaceRef of allPalaceRefs) {
        const parsed = this.parsePalaceRef(palaceRef);
        if (!parsed) continue;
        parsedRefs.push({ palaceRef, uid: parsed.uid, version: parsed.version });
      }

      if (parsedRefs.length === 0) {
        return [];
      }

      // 批量查询所有 UID 对应的元数据（优化 N+1）
      const uids = [...new Set(parsedRefs.map(p => p.uid))];
      const metas = await this.metaStore.getByIds(uids);
      const metaMap = new Map(metas.map(m => [m.uid, m]));

      // 第一遍：找出所有非最新版本的 palaceRef
      const orphanPalaceRefs: string[] = [];
      for (const { palaceRef, uid, version } of parsedRefs) {
        const meta = metaMap.get(uid);
        if (!meta || !meta.versionChain) continue;

        // 检查是否为最新版本
        const isLatest = meta.versionChain.some((v: any) => v.version === version && v.palaceRef === palaceRef);
        if (!isLatest) {
          orphanPalaceRefs.push(palaceRef);
        }
      }

      if (orphanPalaceRefs.length === 0) {
        return [];
      }

      // 第二遍：批量获取文件大小（优化 N+1 查询）
      const orphanFilePaths = orphanPalaceRefs.map(ref => this.getPalaceFilePath(ref));
      const orphanFileSizes = await this.getFileSizes(orphanFilePaths);

      const orphans: Array<{ palaceRef: string; size: number }> = [];
      for (const palaceRef of orphanPalaceRefs) {
        const filePath = this.getPalaceFilePath(palaceRef);
        const size = orphanFileSizes.get(filePath) || 0;
        orphans.push({ palaceRef, size });
      }

      this.logger.info('findOrphanedVersionFiles 方法返回', { method: 'findOrphanedVersionFiles', orphansCount: orphans.length });
      return orphans;
    } catch (error) {
      this.logger.error('findOrphanedVersionFiles 查找失败', { method: 'findOrphanedVersionFiles', error });
      return [];
    }
  }

  /**
   * 解析 palaceRef 获取位置信息
   */
  private parsePalaceRef(palaceRef: string): { wingId: string; hallId: string; roomId: string; uid: string; version: number } | null {
    // 格式: wingId/hallId/roomId/closet_uid_v{version}
    const parts = palaceRef.split('/');
    if (parts.length !== 4) return null;

    const [wingId, hallId, roomId, closetFile] = parts;
    const closetMatch = closetFile.match(/^closet_(.+)_v(\d+)$/);
    if (!closetMatch) return null;

    return {
      wingId,
      hallId,
      roomId,
      uid: closetMatch[1],
      version: parseInt(closetMatch[2], 10),
    };
  }

  /**
   * 获取 Palace 文件路径
   */
  private getPalaceFilePath(palaceRef: string): string {
    // 从 ConfigManager 读取 palaceStorePath，与 PalaceStore 保持一致
    const storageConfig = config.getConfigOrThrow<{ palaceStorePath: string }>('memoryService.storage');
    const palaceStorePath = storageConfig.palaceStorePath;
    return `${palaceStorePath}/${palaceRef}.json`;
  }

  /**
   * 获取文件大小
   */
  private async getFileSize(filePath: string): Promise<number> {
    try {
      const fs = await import('node:fs/promises');
      const stat = await fs.stat(filePath);
      return stat.size;
    } catch {
      return 0;
    }
  }

  /**
   * 批量获取文件大小（优化 N+1 查询）
   */
  private async getFileSizes(filePaths: string[]): Promise<Map<string, number>> {
    const sizes = new Map<string, number>();
    if (filePaths.length === 0) return sizes;

    try {
      const fs = await import('node:fs/promises');
      // 并行获取所有文件大小
      const results = await Promise.all(
        filePaths.map(async (filePath) => {
          try {
            const stat = await fs.stat(filePath);
            return { filePath, size: stat.size };
          } catch {
            return { filePath, size: 0 };
          }
        })
      );
      for (const { filePath, size } of results) {
        sizes.set(filePath, size);
      }
    } catch (error) {
      this.logger.warn('批量获取文件大小失败', { error });
    }

    return sizes;
  }

  /**
   * 估算图谱边密度
   */
  private async estimateGraphEdgeDensity(): Promise<number> {
    try {
      const stats = await this.graphStore.getStats();
      if (stats.nodeCount < 2) return 0;
      // 最大可能边数：n*(n-1)/2（无向图）
      const maxEdges = stats.nodeCount * (stats.nodeCount - 1) / 2;
      return Math.min(stats.edgeCount / maxEdges, 1.0);
    } catch (error) {
      this.logger.warn('图谱边密度估算失败', {
        error: error instanceof Error ? error.message : error,
      });
      return 0;
    }
  }

  /**
   * 统计孤儿记忆数量（使用批量图谱查询优化 N+1 问题）
   */
  private async countOrphanedMemories(): Promise<number> {
    try {
      const memories = await this.metaStore.query({ limit: 1000 });
      // Profile 类型不计入孤儿
      const nonProfileMemories = memories.filter(m => !isProfileType(m.type));

      if (nonProfileMemories.length === 0) {
        return 0;
      }

      // 批量查询所有记忆的关联（优化 N+1）
      const memoryIds = nonProfileMemories.map(m => m.uid);
      const relatedMap = await this.graphStore.findRelatedBatch(memoryIds, 1);

      let orphanCount = 0;
      for (const memory of nonProfileMemories) {
        const related = relatedMap.get(memory.uid) || [];
        if (related.length === 0) {
          orphanCount++;
        }
      }

      return orphanCount;
    } catch (error) {
      this.logger.warn('孤儿记忆统计失败', {
        error: error instanceof Error ? error.message : error,
      });
      return 0;
    }
  }

  /**
   * 统计陈旧记忆数量
   */
  private async countStaleMemories(): Promise<number> {
    try {
      const staleThreshold = Date.now() - (this.archivalConfig.stalenessDays * 24 * 60 * 60 * 1000);

      // 从 SQLite 查询陈旧记忆
      const memories = await this.metaStore.query({
        timeRange: {
          start: 0,
          end: staleThreshold,
        },
        limit: 1000,
      });

      // 只统计重要性低的
      const staleMemories = memories.filter(
        m => m.importanceScore < this.archivalConfig.importanceThreshold
      );

      return staleMemories.length;
    } catch (error) {
      this.logger.warn('陈旧记忆统计失败', {
        error: error instanceof Error ? error.message : error,
      });
      return 0;
    }
  }

  /**
   * 判断记忆是否应该归档
   * 使用综合评分机制，替代简单的阈值判断
   *
   * 注意：此方法已被 findArchivalCandidates 调用时过滤 Profile 类型
   * 但为防止直接调用，仍然检查 Profile 类型
   */
  private async shouldArchive(memory: {
    uid: string;
    type: MemoryType;
    importanceScore: number;
    lastRecalledAt?: number;
    recallCount: number;
  }): Promise<boolean> {
    // Profile 类型永不归档
    if (isProfileType(memory.type)) {
      return false;
    }

    // 计算综合归档分数 (0-100, 越高越应该归档)
    let archiveScore = 0;

    // 因素1: 重要性评分 - importance 越低得分越高
    const importanceFactor = Math.max(0, 10 - memory.importanceScore) / 10;
    archiveScore += importanceFactor * this.archivalConfig.importanceWeight;

    // 因素2: 陈旧度评分 - 超过 stalenessDays 的记忆得分越高
    if (memory.lastRecalledAt) {
      const daysSinceAccess = (Date.now() - memory.lastRecalledAt) / (24 * 60 * 60 * 1000);
      const stalenessFactor = Math.min(daysSinceAccess / (this.archivalConfig.stalenessDays * 2), 1);
      archiveScore += stalenessFactor * this.archivalConfig.stalenessWeight;
    } else {
      // 从未访问过的记忆，给予中等分数
      archiveScore += this.archivalConfig.stalenessWeight * 0.43; // 约等于原来的 15
    }

    // 因素3: 召回频率评分 - recallCount 越低得分越高
    const recallFactor = Math.max(0, 10 - memory.recallCount) / 10;
    archiveScore += recallFactor * this.archivalConfig.recallWeight;

    // 综合评分阈值：超过阈值则归档（可配置）
    const archiveThreshold = this.archivalConfig.archiveScoreThreshold;

    this.logger.debug('归档评分计算', {
      memoryId: memory.uid,
      importanceScore: memory.importanceScore,
      lastRecalledAt: memory.lastRecalledAt,
      recallCount: memory.recallCount,
      archiveScore,
      threshold: archiveThreshold,
      shouldArchive: archiveScore >= archiveThreshold,
    });

    return archiveScore >= archiveThreshold;
  }

  /**
   * 删除记忆（永久删除）
   *
   * @param memoryId - 记忆 ID
   * @returns 释放的空间大小
   */
  async deleteMemory(memoryId: string): Promise<number> {
    this.logger.debug('永久删除记忆', { memoryId });

    let freedSpace = 0;

    try {
      // 获取记忆内容大小
      const meta = await this.metaStore.getById(memoryId);
      if (meta) {
        freedSpace = meta.palace?.closetId ? 500 : 0; // 估算
      }

      // 从各个存储层删除
      await this.memoryService.delete(memoryId);

      this.logger.info('记忆删除成功', { memoryId, freedSpace });
    } catch (error) {
      this.logger.error('记忆删除失败', {
        memoryId,
        error: error instanceof Error ? error.message : error,
      });
    }

    return freedSpace;
  }

  /**
   * 更新配置
   */
  updateArchivalConfig(config: Partial<ArchivalConfig>): void {
    this.archivalConfig = { ...this.archivalConfig, ...config };
    this.logger.info('ArchivalConfig 已更新', this.archivalConfig as unknown as Record<string, unknown>);
  }

  /**
   * 更新碎片整理配置
   */
  updateDefragConfig(config: Partial<DefragmentationConfig>): void {
    this.defragConfig = { ...this.defragConfig, ...config };
    this.logger.info('DefragmentationConfig 已更新', this.defragConfig as unknown as Record<string, unknown>);
  }

  /**
   * 获取归档配置
   */
  getArchivalConfig(): ArchivalConfig {
    return { ...this.archivalConfig };
  }

  /**
   * 获取碎片整理配置
   */
  getDefragConfig(): DefragmentationConfig {
    return { ...this.defragConfig };
  }
}
