/**
 * Memory Version Manager - 记忆版本管理
 * @module memory-service/memory-version-manager
 *
 * 版本: v2.1.0
 * - UID 互换机制：新版本继承旧 UID，旧版本获得新 UID
 * - 向量相似度 >= 90% 判定为新版本
 * - 版本链管理，支持回滚
 * - 旧版本清理（保留 maxVersions 个）
 * - Palace 层级化存储
 */

import { Memory, MemoryType, MemoryScope, MemoryBlock, VersionInfo, PROFILE_TYPES } from '../../../core/types/memory';
import type {
  ICacheManager,
  IVectorStore,
  ISQLiteMetaStore,
  IPalaceStore,
  IGraphStore,
  MemoryMetaRecord,
  VectorDocument,
  VectorSearchOptions,
  GraphNodeRecord,
  GraphEdgeRecord,
  PalaceLocation,
} from '../../../infrastructure/storage/core/types';
import { PalaceStore } from '../../../infrastructure/storage/stores/palace-store';
import { IDGenerator } from '../../../shared/utils/id-generator';
import { StringUtils } from '../../../shared/utils/string';
import { createLogger } from '../../../shared/logging';
import { TransactionManager } from '../utils/transaction-manager';
import type { ILogger } from '../../../shared/logging';
import { config } from '../../../shared/config';
import type { MemoryStoreConfig } from '../../../core/types/config';
import { deriveBlock, getScopeUpgradeThresholds, shouldUpgradeScope } from '../utils/block-utils';

/**
 * 版本管理器配置
 */
export interface MemoryVersionConfig {
  similarityThreshold: number;  // 余弦相似度阈值（BGE-M3: 近义句约 0.88~0.97，0.85 可覆盖改写/补充场景）
  maxVersions: number;           // 最多保留版本数
  enableVersioning: boolean;      // 是否启用版本管理
}

/**
 * 获取版本管理配置
 * 优先从 ConfigManager 读取，否则抛出错误
 */
function getVersionConfig(): MemoryVersionConfig {
  // 默认配置（与 config.default.json 一致）
  const defaults: MemoryVersionConfig = {
    similarityThreshold: 0.9,
    maxVersions: 5,
    enableVersioning: true,
  };

  if (!config.isInitialized()) {
    return defaults;
  }
  const versionConfig = config.getConfig('memoryService.version') as Partial<MemoryVersionConfig> | undefined;
  if (!versionConfig) {
    return defaults;
  }
  return {
    similarityThreshold: versionConfig.similarityThreshold ?? defaults.similarityThreshold,
    maxVersions: versionConfig.maxVersions ?? defaults.maxVersions,
    enableVersioning: versionConfig.enableVersioning ?? defaults.enableVersioning,
  };
}

/**
 * 版本检测结果
 */
export interface VersionDetectionResult {
  isNewVersion: boolean;       // 是否是新版本
  existingMemoryId: string | null;  // 匹配的已有记忆 UID
  similarity: number;           // 相似度
  shouldReplace: boolean;       // 是否应该替换
}

/**
 * 版本创建结果
 */
export interface VersionCreateResult {
  success: boolean;
  newMemoryId: string;         // 新记忆 UID（新版本继承旧 UID）
  oldMemoryId: string;         // 旧记忆 UID（旧版本获得新 UID）
  version: number;              // 新版本号
  palaceRef: string;            // palace_{uid}_v{version}
  newScope: MemoryScope;        // 新版本的作用域（由 determineScope 计算）
}

/**
 * 回滚结果
 */
export interface RollbackResult {
  success: boolean;
  targetVersion: number;       // 回滚到的版本
  currentMemoryId: string;      // 回滚后的当前版本 UID
  previousMemoryId: string;    // 替换为旧版的 UID
}

/**
 * MemoryVersionManager
 * 负责记忆的版本化管理
 */
export class MemoryVersionManager {
  private logger: ILogger;
  private config: MemoryVersionConfig;

  private cache: ICacheManager;
  private vectorStore: IVectorStore;
  private metaStore: ISQLiteMetaStore;
  private palaceStore: IPalaceStore;
  private graphStore: IGraphStore;
  private embedder: (text: string) => Promise<number[]>;

  constructor(
    cache: ICacheManager,
    vectorStore: IVectorStore,
    metaStore: ISQLiteMetaStore,
    palaceStore: IPalaceStore,
    graphStore: IGraphStore,
    embedder: (text: string) => Promise<number[]>,
    userConfig?: Partial<MemoryVersionConfig>
  ) {
    try {
      const versionConfig = getVersionConfig();
      this.config = userConfig ? { ...versionConfig, ...userConfig } : versionConfig;
    } catch {
      // ConfigManager not initialized, use defaults (与 config.json 一致)
      this.config = {
        similarityThreshold: 0.9,
        maxVersions: 5,  // 与 config.json memoryService.version.maxVersions 一致
        enableVersioning: true,
        ...userConfig,
      };
    }
    this.logger = createLogger('MemoryVersionManager');
    this.logger.info('MemoryVersionManager initialized', { config: this.config });

    this.cache = cache;
    this.vectorStore = vectorStore;
    this.metaStore = metaStore;
    this.palaceStore = palaceStore;
    this.graphStore = graphStore;
    this.embedder = embedder;
  }

  /**
   * 检测是否为新版本
   * 通过向量相似度判定 >= 90% 则认为是对已有记忆的更新
   *
   * 注意：Profile 类型（IDENTITY/PREFERENCE/PERSONA）总是创建新记忆，不做版本检测
   * 因为 Profile 类型具有高度个性化，应该保留完整的更新历史
   */
  async detectVersion(
    content: string,
    options: {
      agentId?: string;
      type?: MemoryType;
      scope?: MemoryScope;
      minImportance?: number;
    } = {}
  ): Promise<VersionDetectionResult> {
    if (!this.config.enableVersioning) {
      return { isNewVersion: false, existingMemoryId: null, similarity: 0, shouldReplace: false };
    }

    // Profile 类型总是创建新记忆，不做版本检测
    if (options.type && (PROFILE_TYPES as readonly MemoryType[]).includes(options.type)) {
      this.logger.debug('Profile type detected, skipping version detection', { type: options.type });
      return { isNewVersion: false, existingMemoryId: null, similarity: 0, shouldReplace: false };
    }

    try {
      // 生成新内容的向量
      const queryVector = await this.embedder(content);

      // 搜索相似记忆
      const searchOptions: VectorSearchOptions = {
        query: content,
        queryVector,
        limit: 5,
        minScore: this.config.similarityThreshold,
      };

      // 添加过滤条件
      // 注意：移除 type 过滤，允许跨类型检测版本关系
      // 如果 B 包含 A（内容相似），即使类型不同也应合并
      if (options.agentId) {
        searchOptions.filters = { ...searchOptions.filters, agentId: options.agentId };
      }
      // 不再按 type 过滤：版本检测应基于内容相似度，而非类型
      // 如果需要按类型区分版本链，应在 createVersion 时处理
      if (options.scope) {
        searchOptions.filters = { ...searchOptions.filters, scope: options.scope };
      }

      const results = await this.vectorStore.search(searchOptions);

      // 过滤：只和最新版本比较，避免和旧版本重复检测
      const latestResults = results.filter(r => r.metadata.isLatestVersion === true);

      this.logger.debug('Version detection search results', {
        query: content.substring(0, 50),
        type: options.type,
        agentId: options.agentId,
        totalResults: results.length,
        latestResultsCount: latestResults.length,
        latestResultUids: latestResults.map(r => r.metadata.uid).join(', ').substring(0, 100),
        threshold: this.config.similarityThreshold,
        topScore: latestResults[0]?.score?.toFixed(4),
      });

      if (latestResults.length > 0) {
        const topMatch = latestResults[0];
        return {
          isNewVersion: true,
          existingMemoryId: topMatch.metadata.uid,
          similarity: topMatch.score,
          shouldReplace: topMatch.score >= this.config.similarityThreshold,
        };
      }

      return { isNewVersion: false, existingMemoryId: null, similarity: 0, shouldReplace: false };
    } catch (error) {
      this.logger.error('Version detection failed', { error });
      return { isNewVersion: false, existingMemoryId: null, similarity: 0, shouldReplace: false };
    }
  }

  /**
   * 查找候选记忆（两级检测第一级）
   *
   * 使用较低阈值(0.7)快速筛选可能的候选记忆，
   * 后续由调用方决定是否需要进行 LLM 语义检测
   *
   * @param content 新记忆内容
   * @param options 查询选项
   * @returns 候选记忆列表（相似度 >= 0.7）
   */
  async findCandidates(
    content: string,
    options: {
      agentId?: string;
      type?: MemoryType;
      scope?: MemoryScope;
      topic?: string;
      minScore?: number;
      limit?: number;
    } = {}
  ): Promise<Array<{ memoryId: string; score: number }>> {
    const minScore = options.minScore ?? 0.7;
    const limit = options.limit ?? 10;

    try {
      // 生成新内容的向量
      const queryVector = await this.embedder(content);

      // 搜索相似记忆（使用较低阈值）
      const searchOptions: VectorSearchOptions = {
        query: content,
        queryVector,
        limit,
        minScore,
      };

      // 添加过滤条件
      if (options.agentId) {
        searchOptions.filters = { ...searchOptions.filters, agentId: options.agentId };
      }
      if (options.type) {
        searchOptions.filters = { ...searchOptions.filters, type: options.type };
      }
      if (options.scope) {
        searchOptions.filters = { ...searchOptions.filters, scope: options.scope };
      }

      const results = await this.vectorStore.search(searchOptions);

      // 过滤：只和最新版本比较
      const latestResults = results.filter(r => r.metadata.isLatestVersion === true);

      this.logger.debug('findCandidates results', {
        query: content.substring(0, 50),
        minScore,
        totalResults: latestResults.length,
        topScore: latestResults[0]?.score?.toFixed(4),
      });

      return latestResults.map(r => ({
        memoryId: r.metadata.uid,
        score: r.score,
      }));
    } catch (error) {
      this.logger.error('findCandidates failed', { error });
      return [];
    }
  }

  /**
   * 创建新版本
   *
   * 流程：
   * 1. 新版本生成新 UID_B，新 palace_B
   * 2. 旧版本（UID_A）的 UID 与新版本 UID 互换
   * 3. 新版本继承 UID_A，旧版本获得 UID_B
   *
   * 结果：
   * - 新版本：uid=UID_A, palace=新 palace, isLatest=true
   * - 旧版本：uid=UID_B, palace=旧 palace, isLatest=false
   */
  async createVersion(
    existingMemoryId: string,
    newContent: string,
    newSummary: string,
    newScores: { importance: number; scopeScore: number },
    newPalaceMetadata: { createdAt: number; updatedAt: number; originalSize: number; compressed: boolean; encrypted: boolean },
    txManager?: TransactionManager,
    similarity?: number
  ): Promise<VersionCreateResult> {
    const now = Date.now();

    // ============================================================
    // ORPHAN_VECTOR 检测：向量库有记录但 SQLite 无记录
    // 注意：这里必须同步清理，不能依赖事务（因为后面直接抛异常）
    // ============================================================
    const existingMeta = await this.metaStore.getById(existingMemoryId);
    if (!existingMeta) {
      this.logger.warn('Orphaned vector entry detected, cleaning up', {
        existingMemoryId,
      });
      // 同步清理向量和缓存（不使用事务，因为后面直接抛异常）
      try { await this.vectorStore.delete(existingMemoryId); } catch { /* ignore */ }
      try { await this.cache.delete(existingMemoryId); } catch { /* ignore */ }
      throw new Error(`ORPHAN_VECTOR:${existingMemoryId}`);
    }

    const oldUid = existingMemoryId;
    const oldPalaceRef = existingMeta.currentPalaceRef;
    const newVersion = existingMeta.version + 1;

    // 1. 生成新 UID 和新 palaceRef
    const newUid = IDGenerator.generate('mem');
    const newPalaceLocation: PalaceLocation = {
      wingId: existingMeta.palace.wingId,
      hallId: existingMeta.palace.hallId,
      roomId: existingMeta.palace.roomId,
      closetId: `closet_${newUid}`,
    };
    const newPalaceRef = PalaceStore.generatePalaceRef(newPalaceLocation, newUid, newVersion);

    // 3. 迁移旧版本 palace 文件到新位置 (L4)
    const oldVersionNewPalaceLocation: PalaceLocation = {
      wingId: existingMeta.palace.wingId,
      hallId: existingMeta.palace.hallId,
      roomId: existingMeta.palace.roomId,
      closetId: `closet_${newUid}`,
    };
    const oldVersionNewPalaceRef = PalaceStore.generatePalaceRef(
      oldVersionNewPalaceLocation,
      newUid,
      existingMeta.version
    );

    // 检查是否需要迁移旧 palace（提前检查，用于决定是否注册迁移操作）
    let palaceNeedsMigration = false;
    if (oldPalaceRef !== oldVersionNewPalaceRef) {
      const oldPalaceExists = await this.palaceStore.exists(oldPalaceRef);
      palaceNeedsMigration = oldPalaceExists;
    }

    // 4. 生成新版本的向量（带 fallback）
    let newVector: number[];
    const embeddingDimension = this.getEmbeddingDimension();
    try {
      newVector = await this.embedder(newSummary);
    } catch (error) {
      this.logger.warn('Vector embedding failed in createVersion, using zero vector', {
        existingMemoryId,
        error: String(error),
      });
      newVector = new Array(embeddingDimension).fill(0);
    }
    const versionGroupId = existingMeta.versionGroupId || existingMeta.uid;
    const newVectorDoc: VectorDocument = {
      id: newUid,
      vector: newVector,
      text: newSummary,
      metadata: {
        uid: newUid,
        type: existingMeta.type,
        scope: existingMeta.scope,
        importanceScore: newScores.importance,
        scopeScore: newScores.scopeScore,
        agentId: existingMeta.agentId,
        sessionId: existingMeta.sessionId,
        tags: existingMeta.tags,
        createdAt: now,
        palaceRef: newPalaceRef,
        version: newVersion,
        isLatestVersion: true,
        versionGroupId,
        summary: newSummary,
      },
    };

    // 5. 创建新版本元数据（新版本继承旧 UID）
    const newScope = this.determineScope(newScores.importance, newScores.scopeScore, existingMeta.scope);
    const newMetaRecord: MemoryMetaRecord = {
      uid: oldUid,
      version: newVersion,
      agentId: existingMeta.agentId,
      sessionId: existingMeta.sessionId,
      type: existingMeta.type,
      importanceScore: newScores.importance,
      scopeScore: newScores.scopeScore,
      scope: newScope,
      palace: newPalaceLocation,
      versionChain: [
        ...existingMeta.versionChain.map(entry => {
          // 使用 parsePalaceRef 解析后重新生成，避免依赖字符串格式
          const parsed = PalaceStore.parsePalaceRef(entry.palaceRef);
          if (parsed?.location) {
            const newLocation: PalaceLocation = {
              ...parsed.location,
              closetId: `closet_${newUid}`,
            };
            const newEntryPalaceRef = PalaceStore.generatePalaceRef(newLocation, newUid, entry.version);
            return { ...entry, palaceRef: newEntryPalaceRef };
          }
          // 回退到字符串替换（兼容性）
          const lastSlashIndex = entry.palaceRef.lastIndexOf('/');
          const prefix = entry.palaceRef.substring(0, lastSlashIndex);
          return { ...entry, palaceRef: `${prefix}/closet_${newUid}_v${entry.version}` };
        }),
        {
          version: newVersion,
          palaceRef: newPalaceRef,
          createdAt: now,
          summary: newSummary,
          contentLength: newContent.length,
        },
      ],
      isLatestVersion: true,
      versionGroupId,
      tags: existingMeta.tags,
      createdAt: existingMeta.createdAt,
      updatedAt: now,
      recallCount: existingMeta.recallCount ?? 0,
      currentPalaceRef: newPalaceRef,
    };

    // 6. 创建旧版本的元数据（获得新 UID）
    const oldVersionMetaRecord: MemoryMetaRecord = {
      uid: newUid,
      version: existingMeta.version,
      agentId: existingMeta.agentId,
      sessionId: existingMeta.sessionId,
      type: existingMeta.type,
      importanceScore: existingMeta.importanceScore,
      scopeScore: existingMeta.scopeScore,
      scope: existingMeta.scope,
      palace: oldVersionNewPalaceLocation,
      versionChain: existingMeta.versionChain.map(entry => {
        // 使用 parsePalaceRef 解析后重新生成，避免依赖字符串格式
        const parsed = PalaceStore.parsePalaceRef(entry.palaceRef);
        if (parsed?.location) {
          const newLocation: PalaceLocation = {
            ...parsed.location,
            closetId: `closet_${newUid}`,
          };
          const newEntryPalaceRef = PalaceStore.generatePalaceRef(newLocation, newUid, entry.version);
          return { ...entry, palaceRef: newEntryPalaceRef };
        }
        // 回退到字符串替换（兼容性）
        const lastSlashIndex = entry.palaceRef.lastIndexOf('/');
        const prefix = entry.palaceRef.substring(0, lastSlashIndex);
        return { ...entry, palaceRef: `${prefix}/closet_${newUid}_v${entry.version}` };
      }),
      isLatestVersion: false,
      versionGroupId,
      tags: existingMeta.tags,
      createdAt: now,
      updatedAt: now,
      recallCount: existingMeta.recallCount ?? 0,
      currentPalaceRef: oldVersionNewPalaceRef,
    };

    // 7. 保存旧向量（用于回滚）
    const oldVector = await this.vectorStore.getById(oldUid);

    // 8. 获取旧缓存（用于回滚）
    const oldMemory = await this.cache.get(oldUid);

    // 9. 计算新版本的区块
    const newBlock = this.determineBlock(newScores.importance);

    // 10. 构建新缓存对象（两个分支都使用）
    const newMemoryCache: Memory = {
      uid: oldUid,
      version: newVersion,
      content: newContent,
      summary: newSummary,
      type: existingMeta.type,
      importance: newScores.importance,
      scopeScore: newScores.scopeScore,
      scope: newScope,
      agentId: existingMeta.agentId,
      tags: existingMeta.tags,
      block: newBlock,
      palace: newPalaceLocation,
      versionChain: [
        ...existingMeta.versionChain,
        {
          version: newVersion,
          palaceRef: newPalaceRef,
          createdAt: now,
          summary: newSummary,
          contentLength: newContent.length,
        },
      ],
      isLatestVersion: true,
      accessCount: 0,
      recallCount: existingMeta.recallCount ?? 0,
      lastAccessedAt: now,
      usedByAgents: existingMeta.usedByAgents ?? [],
      createdAt: existingMeta.createdAt,
      updatedAt: now,
      metadata: { versionGroupId },
      lifecycle: {
        createdAt: existingMeta.createdAt,
        events: oldMemory?.lifecycle?.events?.length
          ? [...oldMemory.lifecycle.events, { type: 'updated' as const, timestamp: now, details: { newVersion, newMemoryId: oldUid, oldMemoryId: newUid, similarity: similarity ?? 0 } }]
          : [{ type: 'updated' as const, timestamp: now, details: { newVersion, newMemoryId: oldUid, oldMemoryId: newUid, similarity: similarity ?? 0 } }],
      },
    };

    // ============================================================
    // 使用 TransactionManager（如果提供）
    // ============================================================
    if (txManager) {
      const tx = txManager.beginTransaction();

      // L4: 存储新版本内容到新 palace
      txManager.registerOperation(tx.id, {
        layer: 'palace',
        operation: 'insert',
        targetId: newPalaceRef,
        commit: async () => {
          await this.palaceStore.store(newPalaceRef, newContent, {
            uid: newUid,
            version: newVersion,
            ...newPalaceMetadata,
          });
        },
        rollback: async () => {
          await this.palaceStore.delete(newPalaceRef);
        },
      });

      // L4: 迁移旧版本 palace 文件到新位置
      if (palaceNeedsMigration) {
        txManager.registerOperation(tx.id, {
          layer: 'palace',
          operation: 'update',
          targetId: oldPalaceRef,
          commit: async () => {
            await this.palaceStore.move(oldPalaceRef, oldVersionNewPalaceRef);
          },
          rollback: async () => {
            await this.palaceStore.move(oldVersionNewPalaceRef, oldPalaceRef);
          },
        });
      }

      // L3: 删除旧记录（必须先删，否则 INSERT 会失败）
      txManager.registerOperation(tx.id, {
        layer: 'meta',
        operation: 'delete',
        targetId: oldUid,
        commit: async () => { await this.metaStore.delete(oldUid); },
        rollback: async () => { /* 恢复靠下面的 insert */ },
      });

      // L3: 插入 newMetaRecord (替换旧版本)
      txManager.registerOperation(tx.id, {
        layer: 'meta',
        operation: 'insert',
        targetId: oldUid,
        commit: async () => { await this.metaStore.insert(newMetaRecord); },
        rollback: async () => { /* 恢复靠 delete 后再 insert existingMeta */ },
      });

      // L3: 插入 oldVersionMetaRecord
      txManager.registerOperation(tx.id, {
        layer: 'meta',
        operation: 'insert',
        targetId: newUid,
        commit: async () => { await this.metaStore.insert(oldVersionMetaRecord); },
        rollback: async () => { await this.metaStore.delete(newUid); },
      });

      // L2: 恢复旧向量
      txManager.registerOperation(tx.id, {
        layer: 'vector',
        operation: 'insert',
        targetId: oldUid,
        commit: async () => { /* 无需操作 */ },
        rollback: async () => {
          if (oldVector) {
            // 重建完整的 VectorDocument 用于回滚
            const restoredVectorDoc: VectorDocument = {
              id: oldUid,
              vector: oldVector.vector,
              text: oldVector.text || existingMeta.versionChain[existingMeta.versionChain.length - 1]?.summary || '',
              metadata: {
                uid: oldUid,
                type: existingMeta.type,
                scope: existingMeta.scope,
                importanceScore: existingMeta.importanceScore,
                scopeScore: existingMeta.scopeScore,
                agentId: existingMeta.agentId,
                sessionId: existingMeta.sessionId,
                tags: existingMeta.tags,
                createdAt: existingMeta.createdAt,
                palaceRef: existingMeta.currentPalaceRef,
                version: existingMeta.version,
                isLatestVersion: true,
                versionGroupId: existingMeta.versionGroupId,
                summary: existingMeta.versionChain[existingMeta.versionChain.length - 1]?.summary || '',
              },
            };
            await this.vectorStore.store(restoredVectorDoc);
          }
        },
      });

      // L2: 删除旧向量
      txManager.registerOperation(tx.id, {
        layer: 'vector',
        operation: 'delete',
        targetId: oldUid,
        commit: async () => { await this.vectorStore.delete(oldUid); },
        rollback: async () => { /* 已由上方恢复 */ },
      });

      // L2: 存储新向量
      txManager.registerOperation(tx.id, {
        layer: 'vector',
        operation: 'insert',
        targetId: newUid,
        commit: async () => { await this.vectorStore.store(newVectorDoc); },
        rollback: async () => { await this.vectorStore.delete(newUid); },
      });

      // L1: 恢复旧缓存
      txManager.registerOperation(tx.id, {
        layer: 'cache',
        operation: 'insert',
        targetId: oldUid,
        commit: async () => { /* 无需操作 */ },
        rollback: async () => { await this.cache.delete(oldUid); },
      });

      // L1: 如果有旧缓存，移到新 UID
      if (oldMemory) {
        txManager.registerOperation(tx.id, {
          layer: 'cache',
          operation: 'update',
          targetId: newUid,
          commit: async () => {
            const updatedOldMemory = { ...oldMemory, uid: newUid, isLatestVersion: false, updatedAt: now };
            await this.cache.set(updatedOldMemory);
          },
          rollback: async () => { await this.cache.delete(newUid); },
        });
      }

      // L1: 存储新缓存
      txManager.registerOperation(tx.id, {
        layer: 'cache',
        operation: 'insert',
        targetId: oldUid,
        commit: async () => { await this.cache.set(newMemoryCache); },
        rollback: async () => { await this.cache.delete(oldUid); },
      });

      // L5: 图谱更新
      txManager.registerOperation(tx.id, {
        layer: 'graph',
        operation: 'update',
        targetId: oldUid,
        commit: async () => { await this.updateGraphForVersion(oldUid, newUid); },
        rollback: async () => { await this.graphStore.removeMemory(oldUid); },
      });

      try {
        await txManager.commit(tx.id);
      } catch (error) {
        const rollbackResult = await txManager.rollback(tx.id);
        if (!rollbackResult.success) {
          this.logger.error('Version creation rollback had failures', {
            failedOperations: rollbackResult.failedOperations,
          });
        }
        throw error;
      }
    } else {
      // ============================================================
      // 无 TransactionManager：使用 cleanup-based 回滚（向后兼容）
      // ============================================================
      type CleanupFn = () => Promise<void>;
      const cleanups: CleanupFn[] = [];
      const registerCleanup = (fn: CleanupFn) => cleanups.push(fn);
      const runCleanups = async () => {
        for (let i = cleanups.length - 1; i >= 0; i--) {
          try { await cleanups[i](); } catch (e) { this.logger.error('Cleanup failed', { error: String(e), step: i }); }
        }
        cleanups.length = 0;
      };

      try {
        // L4: 存储新版本内容到新 palace
        await this.palaceStore.store(newPalaceRef, newContent, {
          uid: newUid,
          version: newVersion,
          ...newPalaceMetadata,
        });
        registerCleanup(async () => {
          try { await this.palaceStore.delete(newPalaceRef); } catch { /* ignore */ }
        });

        // L4: 迁移旧版本 palace 文件到新位置
        let palaceMigrated = false;
        if (palaceNeedsMigration) {
          await this.palaceStore.move(oldPalaceRef, oldVersionNewPalaceRef);
          palaceMigrated = true;
          registerCleanup(async () => {
            try { await this.palaceStore.move(oldVersionNewPalaceRef, oldPalaceRef); } catch { /* ignore */ }
          });
          this.logger.debug('Old version palace file migrated (non-tx path)', {
            from: oldPalaceRef,
            to: oldVersionNewPalaceRef,
          });
        }

        // L3: 删除旧记录（必须先删，否则 INSERT 会失败）
        await this.metaStore.delete(oldUid);
        registerCleanup(async () => {
          try {
            if (palaceMigrated) { try { await this.palaceStore.move(oldVersionNewPalaceRef, oldPalaceRef); } catch { /* ignore */ } }
            const restoredMeta = { ...existingMeta, currentPalaceRef: oldPalaceRef };
            await this.metaStore.insert(restoredMeta);
          } catch { /* ignore */ }
        });

        // L3: 插入 newMetaRecord (替换旧版本，新版本继承旧UID)
        await this.metaStore.insert(newMetaRecord);
        registerCleanup(async () => { try { await this.metaStore.delete(oldUid); } catch { /* ignore */ } });

        // L3: 插入 oldVersionMetaRecord
        await this.metaStore.insert(oldVersionMetaRecord);
        registerCleanup(async () => { try { await this.metaStore.delete(newUid); } catch { /* ignore */ } });

        // L2: 删除旧向量
        await this.vectorStore.delete(oldUid);
        registerCleanup(async () => {
          if (oldVector) {
            try {
              // 重建完整的 VectorDocument 用于回滚
              const restoredVectorDoc: VectorDocument = {
                id: oldUid,
                vector: oldVector.vector,
                text: oldVector.text || existingMeta.versionChain[existingMeta.versionChain.length - 1]?.summary || '',
                metadata: {
                  uid: oldUid,
                  type: existingMeta.type,
                  scope: existingMeta.scope,
                  importanceScore: existingMeta.importanceScore,
                  scopeScore: existingMeta.scopeScore,
                  agentId: existingMeta.agentId,
                  sessionId: existingMeta.sessionId,
                  tags: existingMeta.tags,
                  createdAt: existingMeta.createdAt,
                  palaceRef: existingMeta.currentPalaceRef,
                  version: existingMeta.version,
                  isLatestVersion: true,
                  versionGroupId: existingMeta.versionGroupId,
                  summary: existingMeta.versionChain[existingMeta.versionChain.length - 1]?.summary || '',
                },
              };
              await this.vectorStore.store(restoredVectorDoc);
            } catch { /* ignore */ }
          }
        });

        // L2: 存储新向量
        await this.vectorStore.store(newVectorDoc);

        // L1: 更新缓存
        if (oldMemory) {
          await this.cache.delete(oldUid);
          const updatedOldMemory = { ...oldMemory, uid: newUid, isLatestVersion: false, updatedAt: now };
          await this.cache.set(updatedOldMemory);
          registerCleanup(async () => {
            try { await this.cache.delete(newUid); if (oldMemory) await this.cache.set(oldMemory); } catch { /* ignore */ }
          });
        }
        await this.cache.set(newMemoryCache);
        registerCleanup(async () => { try { await this.cache.delete(oldUid); } catch { /* ignore */ } });

        // L5: 图谱更新
        await this.updateGraphForVersion(oldUid, newUid);
        registerCleanup(async () => { try { await this.graphStore.removeMemory(oldUid); } catch { /* ignore */ } });

        cleanups.length = 0;
      } catch (error) {
        await runCleanups();
        throw error;
      }
    }

    this.logger.info('Version created via UID swap', { oldUid, newUid, newVersion, palaceRef: newPalaceRef });

    return {
      success: true,
      newMemoryId: oldUid,
      oldMemoryId: newUid,
      version: newVersion,
      palaceRef: newPalaceRef,
      newScope: newScope,
    };
  }

  /**
   * 回滚到指定版本
   *
   * 基于 UID 互换机制：
   * - 将当前版本（isLatest=true）回滚到指定版本
   * - 回滚后的版本成为新的 isLatest=true
   * - 原最新版本成为 isLatest=false
   */
  async rollback(memoryId: string, targetVersion: number): Promise<RollbackResult> {
    const now = Date.now();

    // 1. 获取当前版本元数据
    const currentMeta = await this.metaStore.getById(memoryId);
    if (!currentMeta) {
      throw new Error(`Memory not found: ${memoryId}`);
    }

    if (!currentMeta.isLatestVersion) {
      throw new Error(`Memory is not the latest version: ${memoryId}`);
    }

    // 2. 查找目标版本
    const targetVersionInfo = currentMeta.versionChain.find(v => v.version === targetVersion);
    if (!targetVersionInfo) {
      throw new Error(`Version not found: v${targetVersion}`);
    }

    // 3. 获取目标版本内容
    const targetContent = await this.palaceStore.retrieve(targetVersionInfo.palaceRef);
    if (!targetContent) {
      throw new Error(`Target version content not found: ${targetVersionInfo.palaceRef}`);
    }

    // 4. 获取目标版本元数据（使用 versionGroupId 查找更准确）
    let allRecords: MemoryMetaRecord[] = [];
    if (currentMeta.versionGroupId) {
      allRecords = await this.metaStore.query({
        versionGroupId: currentMeta.versionGroupId,
      });
    } else {
      // 兼容旧数据：查询所有记录（使用较大的 limit）
      allRecords = await this.metaStore.query({ limit: 10000 });
    }

    // 找到属于同一记忆的所有版本（通过 versionChain 识别）
    const relatedRecords = allRecords.filter(r =>
      r.versionChain.some(v => v.palaceRef === targetVersionInfo.palaceRef) ||
      r.currentPalaceRef === targetVersionInfo.palaceRef
    );

    const targetRecord = relatedRecords.find(r => r.currentPalaceRef === targetVersionInfo.palaceRef);
    const targetUid = targetRecord?.uid || `restored_${memoryId}_v${targetVersion}`;

    // 5. 生成新 UID 用于当前版本（旧版互换）
    const newUidForCurrent = IDGenerator.generate('mem');

    // 6. 执行回滚
    // 6.1 目标版本内容保持不变，但更新元数据
    if (targetRecord) {
      // 目标版本继承当前版本的 UID
      await this.metaStore.delete(targetUid);
      await this.metaStore.insert({
        ...targetRecord,
        uid: memoryId,  // 继承当前 UID
        isLatestVersion: true,
        updatedAt: now,
      });

      // 当前版本获得新 UID
      await this.metaStore.insert({
        ...currentMeta,
        uid: newUidForCurrent,
        isLatestVersion: false,
        updatedAt: now,
      });
    } else {
      // 目标版本是新创建的，需要创建完整记录
      const targetPalaceInfo = PalaceStore.parsePalaceRef(targetVersionInfo.palaceRef);
      const targetPalace = targetPalaceInfo?.location || currentMeta.palace;

      await this.metaStore.delete(memoryId);
      await this.metaStore.insert({
        uid: memoryId,
        version: targetVersion,
        agentId: currentMeta.agentId,
        sessionId: currentMeta.sessionId,  // 继承 sessionId
        type: currentMeta.type,
        importanceScore: currentMeta.importanceScore,
        scopeScore: currentMeta.scopeScore,
        scope: currentMeta.scope,
        palace: targetPalace,
        versionChain: currentMeta.versionChain.filter(v => v.version <= targetVersion),
        isLatestVersion: true,
        versionGroupId: currentMeta.versionGroupId,
        tags: currentMeta.tags,
        createdAt: currentMeta.createdAt,
        updatedAt: now,
        recallCount: currentMeta.recallCount ?? 0,
        currentPalaceRef: targetVersionInfo.palaceRef,
      });

      // 当前版本获得新 UID
      await this.metaStore.insert({
        ...currentMeta,
        uid: newUidForCurrent,
        isLatestVersion: false,
        updatedAt: now,
      });
    }

    // 7. 更新向量存储
    const targetSummary = targetVersionInfo.summary;
    let targetVector: number[];
    const embeddingDimension = this.getEmbeddingDimension();
    try {
      targetVector = await this.embedder(targetSummary);
    } catch (error) {
      this.logger.warn('Vector embedding failed during rollback, using zero vector', {
        memoryId,
        error: String(error),
      });
      targetVector = new Array(embeddingDimension).fill(0);
    }

    await this.vectorStore.delete(memoryId);
    await this.vectorStore.store({
      id: memoryId,
      vector: targetVector,
      text: targetSummary,
      metadata: {
        uid: memoryId,
        type: currentMeta.type,
        scope: currentMeta.scope,
        importanceScore: currentMeta.importanceScore,
        scopeScore: currentMeta.scopeScore,
        agentId: currentMeta.agentId,
        sessionId: currentMeta.sessionId,  // 继承 sessionId
        tags: currentMeta.tags,
        createdAt: currentMeta.createdAt,
        palaceRef: targetVersionInfo.palaceRef,
        version: targetVersion,
        isLatestVersion: true,
        versionGroupId: currentMeta.versionGroupId,
      },
    });

    // 8. 更新图谱关联
    await this.updateGraphForVersion(memoryId, newUidForCurrent);

    this.logger.info('Rollback completed', {
      memoryId,
      targetVersion,
      newUidForCurrent,
    });

    return {
      success: true,
      targetVersion,
      currentMemoryId: memoryId,
      previousMemoryId: newUidForCurrent,
    };
  }

  /**
   * 获取版本历史
   */
  async getVersionHistory(memoryId: string): Promise<VersionInfo[]> {
    const record = await this.metaStore.getById(memoryId);
    if (!record) {
      return [];
    }
    return record.versionChain;
  }

  /**
   * 获取所有版本记录
   */
  async getAllVersions(memoryId: string): Promise<MemoryMetaRecord[]> {
    const currentMeta = await this.metaStore.getById(memoryId);
    if (!currentMeta) {
      return [];
    }

    // 使用 versionGroupId 查找所有版本（更准确）
    if (currentMeta.versionGroupId) {
      const allRecords = await this.metaStore.query({
        versionGroupId: currentMeta.versionGroupId,
        // 不使用 limit，允许查询所有版本
      });
      return allRecords;
    }

    // 兼容旧数据：使用 palaceRef 匹配（当 versionGroupId 不存在时）
    const allRecords = await this.metaStore.query({ limit: 10000 });

    return allRecords.filter(r => {
      // 自己就是查询的记录
      if (r.uid === memoryId) {
        return true;
      }
      // 匹配 versionChain 或 currentPalaceRef
      const inChain = r.versionChain.some(v =>
        currentMeta.versionChain.some(cv => cv.palaceRef === v.palaceRef)
      );
      const isCurrent = currentMeta.versionChain.some(cv => cv.palaceRef === r.currentPalaceRef);
      return inChain || isCurrent;
    });
  }

  /**
   * 清理旧版本
   * 保留最近 maxVersions 个版本
   */
  async pruneVersions(memoryId: string, maxVersions?: number): Promise<string[]> {
    const limit = maxVersions ?? this.config.maxVersions;
    const now = Date.now();

    const currentMeta = await this.metaStore.getById(memoryId);
    if (!currentMeta) {
      return [];
    }

    if (currentMeta.versionChain.length <= limit) {
      return [];
    }

    // 需要删除的版本
    const toDelete = currentMeta.versionChain.slice(0, currentMeta.versionChain.length - limit);
    const deletedPalaceRefs: string[] = [];

    // 使用 versionGroupId 查找所有版本记录（更准确）
    let versionRecords: MemoryMetaRecord[] = [];
    if (currentMeta.versionGroupId) {
      versionRecords = await this.metaStore.query({
        versionGroupId: currentMeta.versionGroupId,
      });
    }

    for (const versionInfo of toDelete) {
      // 查找对应的版本记录
      const versionRecord = versionRecords.find(r => r.currentPalaceRef === versionInfo.palaceRef);

      if (versionRecord && versionRecord.uid !== memoryId) {
        // 删除向量
        await this.vectorStore.delete(versionRecord.uid);

        // 删除缓存
        await this.cache.delete(versionRecord.uid);

        // 删除元数据记录
        await this.metaStore.delete(versionRecord.uid);
      }

      // 删除 palace 内容
      await this.palaceStore.delete(versionInfo.palaceRef);
      deletedPalaceRefs.push(versionInfo.palaceRef);
    }

    // 更新当前记录的 versionChain
    const newChain = currentMeta.versionChain.slice(-limit);
    await this.metaStore.update(memoryId, {
      versionChain: newChain,
    });

    this.logger.info('Versions pruned', {
      memoryId,
      deletedCount: toDelete.length,
      remainingCount: limit,
    });

    return deletedPalaceRefs;
  }

  /**
   * 更新图谱关联
   * 图谱只建立最新版本间的关联
   */
  private async updateGraphForVersion(newVersionId: string, oldVersionId: string): Promise<void> {
    try {
      // 移除旧版本的图谱数据
      await this.graphStore.removeMemory(oldVersionId);

      // 重建新版本的图谱关联
      const memory = await this.cache.get(newVersionId);
      if (!memory) {
        this.logger.warn('updateGraphForVersion: memory not found in cache', { newVersionId });
        return;
      }

      const entities: GraphNodeRecord[] = [];
      const edges: GraphEdgeRecord[] = [];

      // 1. 记忆本身作为实体节点
      const memoryNodeId = memory.uid;
      entities.push({
        id: memoryNodeId,
        entity: memory.content.substring(0, 100),
        type: 'entity' as const,
        uid: memory.uid,
        memoryIds: [memory.uid],
        properties: {
          memoryType: memory.type,
          scope: memory.scope,
          importance: memory.importance,
          createdAt: memory.createdAt,
        },
      });

      // 2. 标签作为概念节点，并建立记忆与标签的关联
      if (memory.tags && memory.tags.length > 0) {
        for (const tag of memory.tags) {
          const tagEntityId = StringUtils.encodeTagEntityId(tag);
          entities.push({
            id: tagEntityId,
            entity: tag,
            type: 'concept' as const,
            uid: memory.uid,
            memoryIds: [memory.uid],
            properties: { source: 'tag', memoryType: memory.type, createdAt: memory.createdAt },
          });

          // 记忆节点 -> 标签节点
          edges.push({
            id: `edge_${memoryNodeId}_${tagEntityId}`,
            sourceId: memoryNodeId,
            targetId: tagEntityId,
            relation: 'has_tag',
            weight: 1.0,
          });
        }

        // 标签之间建立共现关系
        for (let i = 0; i < entities.length - 1; i++) {
          for (let j = i + 1; j < entities.length; j++) {
            if (entities[i].id.startsWith('tag_') && entities[j].id.startsWith('tag_')) {
              edges.push({
                id: `edge_${entities[i].id}_${entities[j].id}`,
                sourceId: entities[i].id,
                targetId: entities[j].id,
                relation: 'co_occurs_with',
                weight: 1.0,
              });
            }
          }
        }
      }

      // 3. 建立记忆之间的直接关联边（通过共享标签）
      try {
        const relatedMemoryIds = await this.graphStore.findMemoriesByTags(memory.tags);
        for (const relatedId of relatedMemoryIds) {
          if (relatedId !== memory.uid) {
            edges.push({
              id: `edge_${memoryNodeId}_${relatedId}`,
              sourceId: memoryNodeId,
              targetId: relatedId,
              relation: 'related_to',
              weight: 0.8,
            });
          }
        }
      } catch (error) {
        this.logger.warn('Failed to add memory-to-memory edges', {
          memoryId: memory.uid,
          error: String(error),
        });
      }

      // 4. 添加到图谱
      await this.graphStore.addMemory(memory.uid, entities, edges);
      this.logger.info('updateGraphForVersion: new version added to graph', { newVersionId });
    } catch (error) {
      this.logger.warn('Graph update skipped', { error: String(error) });
    }
  }

  /**
   * 根据 upgrade rules 确定 MemoryScope
   * - SESSION→AGENT: importance >= sessionToAgentImportance
   * - AGENT→GLOBAL: scopeScore >= agentToGlobalScopeScore AND importance >= agentToGlobalImportance
   * - Scope 只升级，不降级
   * 配置来源：ConfigManager (config.default.json)
   *
   * @param importance - 重要性评分
   * @param scopeScore - 作用域评分
   * @param currentScope - 当前作用域（防止降级）
   */
  private determineScope(importance: number, scopeScore: number, currentScope: MemoryScope): MemoryScope {
    const upgradeResult = shouldUpgradeScope(currentScope, importance, scopeScore);
    if (upgradeResult.shouldUpgrade && upgradeResult.newScope) {
      return upgradeResult.newScope;
    }
    // Keep current scope (no downgrade)
    return currentScope;
  }

  /**
   * 根据 importance 确定 MemoryBlock
   * 保护等级: importance >= coreMinImportance 存入 CORE block
   * 配置来源：ConfigManager (config.default.json)
   */
  private determineBlock(importance: number): MemoryBlock {
    return deriveBlock(importance);
  }

  /**
   * 计算向量相似度
   */
  private computeCosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 获取 embedding 维度
   * 优先级：vectorStore.dimensions > ConfigManager
   */
  private getEmbeddingDimension(): number {
    // 1. 尝试从 vectorStore 获取
    if (this.vectorStore.dimensions) {
      return this.vectorStore.dimensions;
    }

    // 2. 从 ConfigManager 获取
    const embeddingConfig = config.getConfigOrThrow<{ dimensions: number }>('embedding');
    return embeddingConfig.dimensions;
  }

  /**
   * 配置更新
   */
  updateConfig(cfg: Partial<MemoryVersionConfig>): void {
    this.config = { ...this.config, ...cfg };
    this.logger.info('MemoryVersionManager config updated', this.config as unknown as Record<string, unknown>);
  }

  /**
   * 获取版本统计
   */
  async getVersionStats(memoryId: string): Promise<{
    totalVersions: number;
    latestVersion: number;
    oldestVersion: number;
    totalSize: number;
  }> {
    const record = await this.metaStore.getById(memoryId);
    if (!record) {
      return { totalVersions: 0, latestVersion: 0, oldestVersion: 0, totalSize: 0 };
    }

    let totalSize = 0;
    for (const versionInfo of record.versionChain) {
      const content = await this.palaceStore.retrieve(versionInfo.palaceRef);
      if (content) {
        totalSize += content.length;
      }
    }

    return {
      totalVersions: record.versionChain.length,
      latestVersion: record.version,
      oldestVersion: record.versionChain[0]?.version || 1,
      totalSize,
    };
  }
}
