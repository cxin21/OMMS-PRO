/**
 * Memory Store Manager - 存储协调类
 * @module memory-service/memory-store-manager
 *
 * 版本: v2.1.0
 * - 集成版本管理（MemoryVersionManager）
 * - 支持相似度检测和版本创建
 * - Palace 层级化存储
 */

import type { Memory, MemoryInput } from '../../../core/types/memory';
import { MemoryType, MemoryScope, MemoryBlock, isProfileType } from '../../../core/types/memory';
import type {
  ICacheManager,
  IVectorStore,
  ISQLiteMetaStore,
  IPalaceStore,
  IGraphStore,
  VectorDocument,
  MemoryMetaRecord,
  PalaceMetadata,
  PalaceLocation,
  GraphNodeRecord,
  GraphNodeType,
  GraphEdgeRecord,
} from '../../../infrastructure/storage/core/types';
import { PalaceStore } from '../../../infrastructure/storage/stores/palace-store';
import { IDGenerator } from '../../../shared/utils/id-generator';
import { StringUtils } from '../../../shared/utils/string';
import { createLogger } from '../../../shared/logging';
import type { ILogger } from '../../../shared/logging';
import { MemoryVersionManager } from './memory-version-manager';
import { TransactionManager } from '../utils/transaction-manager';
import { GraphRetryQueue } from '../utils/graph-retry-queue';
import type { ILLMExtractor } from '../llm/llm-extractor';
import { config } from '../../../shared/config';
import type { MemoryStoreConfig } from '../../../core/types/config';
import { deriveBlock, shouldUpgradeScope, getScopeUpgradeThresholds } from '../utils/block-utils';

/**
 * MemoryStoreManager
 * 协调各存储层，将记忆写入 Cache、VectorDB、SQLite、Palace、Graph
 */
export class MemoryStoreManager {
  private logger: ILogger;
  private cache: ICacheManager;
  private vectorStore: IVectorStore;
  private metaStore: ISQLiteMetaStore;
  private palaceStore: IPalaceStore;
  private graphStore: IGraphStore;
  private embedder: (text: string) => Promise<number[]>;
  private versionManager: MemoryVersionManager;
  private llmExtractor?: ILLMExtractor;
  private txManager: TransactionManager;
  private graphRetryQueue: GraphRetryQueue;

  constructor(
    cache: ICacheManager,
    vectorStore: IVectorStore,
    metaStore: ISQLiteMetaStore,
    palaceStore: IPalaceStore,
    graphStore: IGraphStore,
    embedder: (text: string) => Promise<number[]>,
    versionManager?: MemoryVersionManager,
    llmExtractor?: ILLMExtractor
  ) {
    this.cache = cache;
    this.vectorStore = vectorStore;
    this.metaStore = metaStore;
    this.palaceStore = palaceStore;
    this.graphStore = graphStore;
    this.embedder = embedder;
    this.logger = createLogger('MemoryStoreManager');
    this.llmExtractor = llmExtractor;

    // 初始化事务管理器
    this.txManager = new TransactionManager();

    // 初始化 Graph 重试队列
    this.graphRetryQueue = new GraphRetryQueue();
    this.graphRetryQueue.setGraphStoreAdder(
      (memoryId, entities, edges) => this.graphStore.addMemory(memoryId, entities, edges)
    );

    // 从配置获取 Graph 处理器间隔
    let graphProcessorIntervalMs = 30000;
    try {
      if (config.isInitialized()) {
        const storageConfig = config.getConfig<{ graphProcessorIntervalMs?: number }>('memoryService.storage');
        graphProcessorIntervalMs = storageConfig?.graphProcessorIntervalMs || 30000;
      }
    } catch {
      // 配置获取失败，使用默认值
    }
    this.graphRetryQueue.startProcessor(graphProcessorIntervalMs).catch(err => {
      this.logger.warn('GraphRetryQueue processor start failed', { error: String(err) });
    });

    // 初始化版本管理器
    this.versionManager = versionManager || new MemoryVersionManager(
      cache,
      vectorStore,
      metaStore,
      palaceStore,
      graphStore,
      embedder
    );
  }

  /**
   * 设置 LLM 提取器
   */
  setLLMExtractor(extractor: ILLMExtractor): void {
    this.llmExtractor = extractor;
    this.logger.info('LLM Extractor set', { provider: extractor.constructor.name });
  }

  /**
   * 获取 LLM 提取器
   */
  getLLMExtractor(): ILLMExtractor | undefined {
    return this.llmExtractor;
  }

  /**
   * 根据 ID 获取记忆
   * 用于包含检测时获取已有记忆的详细内容
   */
  async get(uid: string): Promise<Memory | null> {
    // 优先从缓存获取
    const cached = await this.cache.get(uid);
    if (cached) {
      return cached;
    }

    // 缓存未命中，从元数据存储获取
    const meta = await this.metaStore.getById(uid);
    if (!meta) {
      return null;
    }

    // 从 Palace 获取内容
    const content = await this.palaceStore.retrieve(meta.currentPalaceRef);
    if (!content) {
      return null;
    }

    // 重建 Memory 对象
    return {
      uid: meta.uid,
      version: meta.version,
      content,
      summary: meta.versionChain[meta.versionChain.length - 1]?.summary || '',
      type: meta.type,
      agentId: meta.agentId,
      importance: meta.importanceScore,
      scopeScore: meta.scopeScore,
      scope: meta.scope,
      block: this.determineBlock(meta.importanceScore),
      palace: meta.palace,
      versionChain: meta.versionChain,
      isLatestVersion: meta.isLatestVersion,
      accessCount: meta.recallCount || 0,
      recallCount: meta.recallCount || 0,
      lastAccessedAt: meta.updatedAt,
      usedByAgents: meta.usedByAgents || [],
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      metadata: {
        versionGroupId: meta.versionGroupId,
        topicId: meta.topicId,
      },
      tags: meta.tags || [],
      lifecycle: {
        createdAt: meta.createdAt,
        events: [],
      },
    };
  }

  /**
   * 批量获取记忆
   * 用于需要获取多个记忆场记忆的场景（如话题过滤）
   */
  async getMany(uids: string[]): Promise<Map<string, Memory>> {
    const result = new Map<string, Memory>();

    if (uids.length === 0) {
      return result;
    }

    // 1. 批量从缓存获取
    const cachedMemories = await this.cache.getMany(uids);
    for (const [uid, memory] of cachedMemories) {
      result.set(uid, memory);
    }

    // 2. 找出缓存中缺失的 UID
    const missingUids = uids.filter((uid) => !result.has(uid));
    if (missingUids.length === 0) {
      return result;
    }

    // 3. 批量从元数据存储获取缺失的
    const metas = await this.metaStore.getByIds(missingUids);

    // 4. 批量获取 Palace 内容
    const palaceRefs = metas.map((m) => m.currentPalaceRef).filter(Boolean);
    const palaceContents = await this.palaceStore.retrieveMany(palaceRefs);

    // 5. 重建 Memory 对象
    for (const meta of metas) {
      if (!meta) continue;
      const content = palaceContents.get(meta.currentPalaceRef) ?? '';
      result.set(meta.uid, {
        uid: meta.uid,
        version: meta.version,
        content,
        summary: meta.versionChain[meta.versionChain.length - 1]?.summary || '',
        type: meta.type,
        agentId: meta.agentId,
        importance: meta.importanceScore,
        scopeScore: meta.scopeScore,
        scope: meta.scope,
        block: this.determineBlock(meta.importanceScore),
        palace: meta.palace,
        versionChain: meta.versionChain,
        isLatestVersion: meta.isLatestVersion,
        accessCount: meta.recallCount || 0,
        recallCount: meta.recallCount || 0,
        lastAccessedAt: meta.updatedAt,
        usedByAgents: meta.usedByAgents || [],
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        metadata: {
          versionGroupId: meta.versionGroupId,
          topicId: meta.topicId,
        },
        tags: meta.tags || [],
        lifecycle: {
          createdAt: meta.createdAt,
          events: [],
        },
      });
    }

    return result;
  }

  /**
   * 存储记忆 - 协调各存储层
   *
   * 版本: v2.1.0
   * - 支持版本检测：新内容与已有记忆相似度 >= 90% 时创建新版本
   * - 版本创建使用 UID 互换机制
   * - Palace 层级化存储
   */
  async store(input: MemoryInput, scores: { importance: number; scopeScore: number }): Promise<Memory> {
    // ============================================================
    // 前置校验 - 快速失败
    // ============================================================
    if (!input.content?.trim()) {
      throw new Error('Empty content not allowed');
    }
    if (scores.importance < 0 || scores.importance > 10) {
      throw new Error(`Invalid importance score: ${scores.importance}, must be between 0 and 10`);
    }
    if (scores.scopeScore < 0 || scores.scopeScore > 10) {
      throw new Error(`Invalid scope score: ${scores.scopeScore}, must be between 0 and 10`);
    }
    if (input.type !== undefined && !Object.values(MemoryType).includes(input.type)) {
      throw new Error(`Invalid memory type: ${input.type}`);
    }

    const now = Date.now();

    // 从配置获取 extraction timeout，默认 30000ms（来自 config.default.json）
    const DEFAULT_EXTRACTION_TIMEOUT = 30000;
    let extractionTimeout = DEFAULT_EXTRACTION_TIMEOUT;
    if (config.isInitialized()) {
      const captureConfig = config.getConfig<{ extractionTimeout?: number }>('capture');
      if (captureConfig?.extractionTimeout !== undefined) {
        extractionTimeout = captureConfig.extractionTimeout;
      }
    }

    // 用于 ORPHAN_VECTOR 恢复时复用已有记忆 ID
    // forcedMemoryId 优先级最高，表示强制创建新记忆（而非新版本）
    let orphanMemoryId: string | null = input.forcedMemoryId || null;

    // 1. 检测是否为新版本
    // - 如果有 forcedMemoryId，跳过检测，强制走新建记忆路径
    // - 如果有 existingMemoryId 但没有 forcedMemoryId，跳过检测但走版本创建路径
    let versionDetection;
    if (orphanMemoryId) {
      // ORPHAN_VECTOR 恢复：跳过版本检测，走新建记忆路径
      versionDetection = { isNewVersion: false, existingMemoryId: null, similarity: 0, shouldReplace: false };
    } else if (input.existingMemoryId) {
      // 调用方已检测到相似记忆，跳过内部检测
      versionDetection = { isNewVersion: true, existingMemoryId: input.existingMemoryId, similarity: 1.0, shouldReplace: true };
    } else {
      // 正常检测
      versionDetection = await this.versionManager.detectVersion(input.content, {
        agentId: input.metadata?.agentId,
        type: input.type,
      });
    }

    // 2. 如果是已有记忆的新版本，执行版本创建
    if (versionDetection.isNewVersion && versionDetection.shouldReplace && versionDetection.existingMemoryId) {
      const summary = await this.generateSummary(input.content);

      try {
        const versionResult = await this.versionManager.createVersion(
          versionDetection.existingMemoryId,
          input.content,
          summary,
          scores,
          {
            createdAt: now,
            updatedAt: now,
            originalSize: input.content.length,
            compressed: false,
            encrypted: false,
          },
          this.txManager,
          versionDetection.similarity
        );

      // 解析 palaceRef 获取 palace 位置
      const palaceInfo = PalaceStore.parsePalaceRef(versionResult.palaceRef);
      const palace = palaceInfo?.location || {
        wingId: 'agent_default',
        hallId: input.type.toLowerCase(),
        roomId: 'room_default',
        closetId: `closet_${versionResult.newMemoryId}`,
      };

      // 直接使用 createVersion() 返回的 newScope（已在版本管理器中正确计算）
      // 避免 store() 重新计算导致 scope 降级（如 AGENT→SESSION）
      const newScope = versionResult.newScope;
      const newBlock = this.determineBlock(scores.importance);

      // 返回新版本记忆
      const versionMemory: Memory = {
        uid: versionResult.newMemoryId,
        content: input.content,
        summary,
        type: input.type,
        agentId: input.metadata?.agentId || 'default',
        importance: scores.importance,
        scopeScore: scores.scopeScore,
        scope: newScope,
        block: newBlock,
        palace,
        version: versionResult.version,
        isLatestVersion: true,
        versionChain: [{
          version: versionResult.version,
          palaceRef: versionResult.palaceRef,
          createdAt: now,
          summary,
          contentLength: input.content.length,
        }],
        accessCount: 0,
        recallCount: 0,
        lastAccessedAt: now,
        usedByAgents: [input.metadata?.agentId || 'default'],
        createdAt: now,
        updatedAt: now,
        metadata: {},
        tags: input.metadata?.tags || [],
        lifecycle: {
          createdAt: now,
          events: [{
            type: 'created',
            timestamp: now,
            details: { palaceRef: versionResult.palaceRef, isVersion: true },
          }],
        },
      };

      // 注意：Graph 更新已在 createVersion() 事务中完成，无需重复更新

      return versionMemory;
      } catch (versionErr) {
        const msg = versionErr instanceof Error ? versionErr.message : String(versionErr);
        // 孤儿向量导致的版本创建失败：直接降级为新建记忆
        if (msg.startsWith('ORPHAN_VECTOR:')) {
          const orphanId = msg.replace('ORPHAN_VECTOR:', '');
          this.logger.warn('Version creation skipped due to orphan vector, reusing existing memory ID', {
            orphanId,
            reuseExistingId: versionDetection.existingMemoryId,
          });
          // 复用已有记忆 ID，避免 ID 浪费（仅当未通过 forcedMemoryId 指定时）
          orphanMemoryId = orphanMemoryId || versionDetection.existingMemoryId;
        } else {
          throw versionErr;
        }
      }
    }

    // 3. 新建记忆（若 ORPHAN_VECTOR 恢复则复用已有 ID）
    const memoryId = orphanMemoryId || IDGenerator.generate('memory');
    const now2 = Date.now();

    // Determine scope based on upgrade rules
    // 注意：如果复用已有记忆 ID（ORPHAN_VECTOR 恢复），应保留原有 scope 而非从 SESSION 重新计算
    const existingMemory = orphanMemoryId ? await this.metaStore.getById(orphanMemoryId) : null;
    const baseScope = existingMemory?.scope ?? MemoryScope.SESSION;
    const scope = this.determineScope(scores.importance, scores.scopeScore, baseScope);

    // Profile types (IDENTITY/PREFERENCE/PERSONA) always use CORE block
    const isProfile = isProfileType(input.type);
    const block = isProfile
      ? MemoryBlock.CORE
      : this.determineBlock(scores.importance);

    // 并行执行摘要生成和标签提取（两个 LLM 调用互不依赖）
    const extractor = this.llmExtractor;
    const [summaryResult, tagsResult] = await Promise.allSettled([
      input.summary
        ? Promise.resolve(input.summary)
        : this.generateSummary(input.content),
      input.metadata?.tags?.length
        ? Promise.resolve(input.metadata!.tags!)
        : extractor
          ? (async () => {
              try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), extractionTimeout);
                try {
                  const extracted = await extractor.extractMemories(input.content, {
                    maxCount: 1,
                    typeHints: [input.type],
                  }, controller.signal);
                  return extracted.length > 0 ? extracted[0].tags : [];
                } finally {
                  clearTimeout(timeoutId);
                }
              } catch {
                return [];
              }
            })()
          : Promise.resolve([]),
    ]);

    const summary = summaryResult.status === 'fulfilled'
      ? summaryResult.value
      : input.content.substring(0, 200);
    const extractedTags = tagsResult.status === 'fulfilled'
      ? tagsResult.value
      : [];

    // Calculate palace location
    const palaceLocation = this.calculatePalaceLocation(
      input.type,
      scope,
      input.metadata?.agentId || 'default',
      input.metadata?.sessionId
    );

    // Generate palaceRef using new format
    const palaceRef = PalaceStore.generatePalaceRef(palaceLocation, memoryId, 1);

    // 4. Prepare palace metadata
    const palaceMetadata: PalaceMetadata = {
      uid: memoryId,
      version: 1,
      createdAt: now2,
      updatedAt: now2,
      originalSize: input.content.length,
      compressed: false,
      encrypted: false,
    };

    // 5. Prepare meta record for SQLite
    const usedByAgentsList = [input.metadata?.agentId || 'default'];
    const metaRecord: MemoryMetaRecord = {
      uid: memoryId,
      version: 1,
      agentId: input.metadata?.agentId || 'default',
      sessionId: input.metadata?.sessionId,
      type: input.type,
      topicId: input.metadata?.topicId,
      importanceScore: scores.importance,
      scopeScore: scores.scopeScore,
      scope,
      palace: palaceLocation,
      versionChain: [
        {
          version: 1,
          palaceRef,
          createdAt: now2,
          summary,
          contentLength: input.content.length,
        },
      ],
      isLatestVersion: true,
      versionGroupId: memoryId,
      tags: extractedTags,
      createdAt: now2,
      updatedAt: now2,
      recallCount: 0,
      usedByAgents: usedByAgentsList,
      currentPalaceRef: palaceRef,
    };

    // 6. Prepare vector document (with fallback on failure)
    const embeddingDimension = this.getEmbeddingDimension();
    let vector: number[];
    if (!this.embedder) {
      // Embedder 未配置，使用零向量
      this.logger.warn('Embedder not configured, using zero vector', { memoryId });
      vector = new Array(embeddingDimension).fill(0);
    } else {
      try {
        vector = await this.embedder(summary);
      } catch (error) {
        this.logger.warn('Vector embedding failed, using zero vector', {
          memoryId,
          error: String(error),
        });
        // 使用零向量作为 fallback，确保存储流程可以继续
        // 注意：这会导致相似度搜索失效，但不会阻止记忆存储
        vector = new Array(embeddingDimension).fill(0);
      }
    }
    const vectorDoc: VectorDocument = {
      id: memoryId,
      vector,
      text: summary,
      metadata: {
        uid: memoryId,
        type: input.type,
        scope,
        importanceScore: scores.importance,
        scopeScore: scores.scopeScore,
        agentId: input.metadata?.agentId || 'default',
        sessionId: input.metadata?.sessionId,
        tags: extractedTags,
        createdAt: now2,
        palaceRef,
        version: 1,
        isLatestVersion: true,
        versionGroupId: memoryId,
        summary,
      },
    };

    // 7. Build memory object
    const memory: Memory = {
      uid: memoryId,
      version: 1,
      content: input.content,
      summary,
      type: input.type,
      agentId: input.metadata?.agentId || 'default',
      importance: scores.importance,
      scopeScore: scores.scopeScore,
      scope,
      block,
      palace: palaceLocation,
      isLatestVersion: true,
      versionChain: [{
        version: 1,
        palaceRef,
        createdAt: now2,
        summary,
        contentLength: input.content.length,
      }],
      accessCount: 0,
      recallCount: 0,
      lastAccessedAt: now2,
      usedByAgents: [input.metadata?.agentId || 'default'],
      createdAt: now2,
      updatedAt: now2,
      metadata: {},
      tags: extractedTags,
      lifecycle: {
        createdAt: now2,
        events: [{
          type: 'created',
          timestamp: now2,
          details: { palaceRef },
        }],
      },
    };

    // 8. 准备 Graph 数据
    const { entities, edges } = await this._prepareGraphData(memory);

    // 9. 使用事务写入所有存储层
    const tx = this.txManager.beginTransaction();

    this.txManager.registerOperation(tx.id, {
      layer: 'cache',
      operation: 'insert',
      targetId: memory.uid,
      commit: () => this.cache.set(memory),
      rollback: () => this.cache.delete(memory.uid),
    });

    this.txManager.registerOperation(tx.id, {
      layer: 'vector',
      operation: 'insert',
      targetId: memory.uid,
      commit: () => this.vectorStore.store(vectorDoc),
      rollback: () => this.vectorStore.delete(memory.uid),
    });

    this.txManager.registerOperation(tx.id, {
      layer: 'meta',
      operation: 'insert',
      targetId: memory.uid,
      commit: () => this.metaStore.insert(metaRecord),
      rollback: () => this.metaStore.delete(memory.uid),
    });

    this.txManager.registerOperation(tx.id, {
      layer: 'palace',
      operation: 'insert',
      targetId: palaceRef,
      // palace 存储 originalContent（原始完整对话）而非 content（LLM提取的片段）
      // 这是记忆宫殿的核心原则：保存原始内容用于完整回溯
      commit: async () => {
        const palaceContent = input.originalContent || input.content;
        await this.palaceStore.store(palaceRef, palaceContent, palaceMetadata);
        this.logger.debug('Palace store: using originalContent', {
          hasOriginalContent: !!input.originalContent,
          palaceContentLength: palaceContent.length,
        });
      },
      rollback: async () => { await this.palaceStore.delete(palaceRef); },
    });

    // Graph 使用重试队列，不参与事务（失败不阻断主流程）
    // Graph 操作是"尽力而为"模式，失败后重试，不回滚已成功的 Graph 操作
    this.txManager.registerOperation(tx.id, {
      layer: 'graph',
      operation: 'insert',
      targetId: memory.uid,
      commit: async () => {
        try {
          await this.graphStore.addMemory(memory.uid, entities, edges);
        } catch (error) {
          // Graph 失败加入重试队列，不回滚
          this.logger.warn('Graph write failed, queuing for retry', {
            memoryId: memory.uid,
            error: String(error),
          });
          this.graphRetryQueue.enqueue(memory.uid, entities, edges);
        }
      },
      // Graph 不回滚 - 因为 Graph 是非关键操作，且可能已经在其他事务中成功
      // 如果事务失败后执行此回滚，会删除有效的 Graph 数据
      rollback: async () => {
        this.logger.debug('Graph rollback skipped (fire-and-forget with retry queue)', {
          memoryId: memory.uid,
        });
      },
    });

    try {
      await this.txManager.commit(tx.id);
    } catch (error) {
      this.logger.error('Transaction failed', { memoryId, error: String(error) });
      throw error;
    }

    this.logger.info('Memory stored via MemoryStoreManager', {
      memoryId,
      scope,
      importance: scores.importance,
      isNewVersion: false,
      palaceRef,
    });

    return memory;
  }

  /**
   * 删除记忆
   */
  async delete(memoryId: string): Promise<void> {
    // Get meta to find palaceRef
    const meta = await this.metaStore.getById(memoryId);
    if (!meta) {
      throw new Error(`Memory not found: ${memoryId}`);
    }

    // 使用事务删除
    const tx = this.txManager.beginTransaction();

    this.txManager.registerOperation(tx.id, {
      layer: 'cache',
      operation: 'delete',
      targetId: memoryId,
      commit: () => this.cache.delete(memoryId),
      rollback: () => Promise.resolve(), // 缓存删除无回滚
    });

    this.txManager.registerOperation(tx.id, {
      layer: 'vector',
      operation: 'delete',
      targetId: memoryId,
      commit: () => this.vectorStore.delete(memoryId),
      rollback: () => Promise.resolve(),
    });

    this.txManager.registerOperation(tx.id, {
      layer: 'meta',
      operation: 'delete',
      targetId: memoryId,
      commit: () => this.metaStore.delete(memoryId),
      rollback: () => Promise.resolve(),
    });

    this.txManager.registerOperation(tx.id, {
      layer: 'palace',
      operation: 'delete',
      targetId: meta.currentPalaceRef,
      commit: () => this.palaceStore.delete(meta.currentPalaceRef),
      rollback: () => Promise.resolve(),
    });

    this.txManager.registerOperation(tx.id, {
      layer: 'graph',
      operation: 'delete',
      targetId: memoryId,
      commit: () => this.graphStore.removeMemory(memoryId),
      rollback: () => Promise.resolve(),
    });

    await this.txManager.commit(tx.id);

    this.logger.info('Memory deleted via MemoryStoreManager', { memoryId, palaceRef: meta.currentPalaceRef });
  }

  /**
   * 更新记忆
   */
  async update(
    memoryId: string,
    updates: Partial<{
      content: string;
      importanceScore: number;
      scopeScore: number;
      scope: MemoryScope;
      block: MemoryBlock;
      tags: string[];
    }>
  ): Promise<void> {
    const now = Date.now();

    // Get existing meta
    const existingMeta = await this.metaStore.getById(memoryId);
    if (!existingMeta) {
      throw new Error(`Memory not found: ${memoryId}`);
    }

    // Build meta updates
    const metaUpdates: Partial<MemoryMetaRecord> = {
      updatedAt: now,
    };

    if (updates.importanceScore !== undefined) {
      metaUpdates.importanceScore = updates.importanceScore;
    }
    if (updates.scopeScore !== undefined) {
      metaUpdates.scopeScore = updates.scopeScore;
    }
    if (updates.scope !== undefined) {
      metaUpdates.scope = updates.scope;
    }
    // Note: block is not stored in MemoryMetaRecord, it's computed from importanceScore
    if (updates.tags !== undefined) {
      metaUpdates.tags = updates.tags;
    }

    // Use transaction for atomic update
    const tx = this.txManager.beginTransaction();

    // L3: 更新 SQLite 元数据
    this.txManager.registerOperation(tx.id, {
      layer: 'meta',
      operation: 'update',
      targetId: memoryId,
      commit: async () => { await this.metaStore.update(memoryId, metaUpdates); },
      rollback: async () => { await this.metaStore.update(memoryId, { updatedAt: existingMeta.updatedAt }); },
    });

    // L4: 更新 Palace 内容（如果 content 变更）
    if (updates.content) {
      this.txManager.registerOperation(tx.id, {
        layer: 'palace',
        operation: 'update',
        targetId: existingMeta.currentPalaceRef,
        commit: async () => {
          await this.palaceStore.store(
            existingMeta.currentPalaceRef,
            updates.content!,
            {
              uid: memoryId,
              version: existingMeta.version,
              createdAt: existingMeta.createdAt,
              updatedAt: now,
              originalSize: updates.content!.length,
              compressed: false,
              encrypted: false,
            }
          );
        },
        rollback: async () => {
          // 恢复旧内容需要先获取，但 palaceStore 不支持获取旧内容
          // 这种情况需要依赖备份或降级方案
          this.logger.warn('Palace rollback not fully supported, content may be inconsistent');
        },
      });
    }

    // L2: 更新向量元数据
    this.txManager.registerOperation(tx.id, {
      layer: 'vector',
      operation: 'update',
      targetId: memoryId,
      commit: async () => {
        await this.vectorStore.updateMetadata(memoryId, {
          importanceScore: updates.importanceScore ?? existingMeta.importanceScore,
          scopeScore: updates.scopeScore ?? existingMeta.scopeScore,
          scope: updates.scope ?? existingMeta.scope,
          tags: updates.tags ?? existingMeta.tags,
        });
      },
      rollback: async () => {
        await this.vectorStore.updateMetadata(memoryId, {
          importanceScore: existingMeta.importanceScore,
          scopeScore: existingMeta.scopeScore,
          scope: existingMeta.scope,
          tags: existingMeta.tags,
        });
      },
    });

    // L1: 使缓存失效
    this.txManager.registerOperation(tx.id, {
      layer: 'cache',
      operation: 'delete',
      targetId: memoryId,
      commit: async () => { await this.cache.delete(memoryId); },
      rollback: async () => { /* 缓存删除无回滚 */ },
    });

    try {
      await this.txManager.commit(tx.id);
    } catch (error) {
      this.logger.error('Memory update transaction failed', { memoryId, error: String(error) });
      throw error;
    }

    this.logger.info('Memory updated via MemoryStoreManager', { memoryId });
  }

  /**
   * 根据 upgrade rules 确定 MemoryScope
   * - SESSION→AGENT: importance >= sessionToAgentImportance
   * - AGENT→GLOBAL: scopeScore >= agentToGlobalScopeScore AND importance >= agentToGlobalImportance
   * - Scope 只升级，不降级
   *
   * @param importance - 重要性评分
   * @param scopeScore - 作用域评分
   * @param currentScope - 当前作用域（防止降级）
   */
  private determineScope(importance: number, scopeScore: number, currentScope: MemoryScope): MemoryScope {
    const thresholds = getScopeUpgradeThresholds();

    // Only upgrade, never downgrade
    if (currentScope === MemoryScope.SESSION && importance >= thresholds.sessionToAgentImportance) {
      return MemoryScope.AGENT;
    }
    if (currentScope === MemoryScope.AGENT && scopeScore >= thresholds.agentToGlobalScopeScore && importance >= thresholds.agentToGlobalImportance) {
      return MemoryScope.GLOBAL;
    }
    // Keep current scope (no downgrade)
    return currentScope;
  }

  /**
   * 根据 importance 确定 MemoryBlock
   * 保护等级: importance >= coreMinImportance 存入 CORE block
   */
  private determineBlock(importance: number): MemoryBlock {
    return deriveBlock(importance);
  }

  /**
   * 生成摘要
   * 必须使用 LLM 生成摘要，不接受其他方式
   *
   * @param content 记忆内容
   * @returns 摘要
   */
  private async generateSummary(content: string): Promise<string> {
    // LLM Extractor 是必须存在的
    if (!this.llmExtractor) {
      throw new Error('LLM Extractor is required for summary generation. Memory storage cannot proceed without LLM analysis.');
    }

    try {
      this.logger.debug('generateSummary called', { contentLength: content.length });
      const summary = await this.llmExtractor.generateSummary(content);
      this.logger.info('generateSummary completed', {
        contentLength: content.length,
        summaryLength: summary.length
      });
      return summary;
    } catch (error) {
      const errorMsg = `LLM summary generation failed: ${error instanceof Error ? error.message : error}. Memory storage cannot proceed without LLM analysis.`;
      this.logger.error('generateSummary failed', {
        contentLength: content.length,
        error: errorMsg,
      });
      throw new Error(errorMsg);
    }
  }

  /**
   * 获取版本管理器
   */
  getVersionManager(): MemoryVersionManager {
    return this.versionManager;
  }

  /**
   * 获取元数据统计（委托给 metaStore）
   */
  async getMetaStats(): Promise<{
    total: number;
    byScope: Record<string, number>;
    byType: Record<string, number>;
    avgScopeScore: number;
  }> {
    return this.metaStore.getStats();
  }

  /**
   * 准备 Graph 数据（不写入）
   * 用于事务提交时执行
   *
   * 版本: v2.2.0
   * - 支持 LLM 实体提取：从记忆内容中提取命名实体作为图谱节点
   * - 支持 LLM 关系质量评估：使用 LLM 判断关系类型和权重
   * - 支持 Profile 类型特殊处理：建立与标签、实体的关联
   */
  private async _prepareGraphData(
    memory: Memory
  ): Promise<{ entities: GraphNodeRecord[]; edges: GraphEdgeRecord[] }> {
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

    // 2. LLM 实体提取（如果可用）
    if (this.llmExtractor) {
      try {
        const extractedEntities = await this.llmExtractor.extractEntities(memory.content);
        for (const entity of extractedEntities) {
          const entityId = StringUtils.encodeTagEntityId(`entity_${entity.name}`);
          entities.push({
            id: entityId,
            entity: entity.name,
            type: entity.type as GraphNodeType,
            uid: memory.uid,
            memoryIds: [memory.uid],
            properties: {
              source: 'llm_extracted',
              entityType: entity.type,
              confidence: entity.confidence,
              memoryType: memory.type,
              createdAt: memory.createdAt,
            },
          });

          // 记忆与实体之间的关系（使用 LLM 提供的置信度作为权重基础）
          edges.push({
            id: `edge_${memoryNodeId}_${entityId}`,
            sourceId: memoryNodeId,
            targetId: entityId,
            relation: 'mentions',
            weight: entity.confidence,
          });
        }

        // 实体间关系（基于类型推断）
        const extractedEntityIds = extractedEntities.map(e => StringUtils.encodeTagEntityId(`entity_${e.name}`));
        for (let i = 0; i < extractedEntityIds.length; i++) {
          for (let j = i + 1; j < extractedEntityIds.length; j++) {
            // 根据实体类型决定关系权重
            const entityI = extractedEntities[i];
            const entityJ = extractedEntities[j];
            const relationWeight = this._calculateEntityRelationWeight(entityI.type, entityJ.type);

            edges.push({
              id: `edge_${extractedEntityIds[i]}_${extractedEntityIds[j]}`,
              sourceId: extractedEntityIds[i],
              targetId: extractedEntityIds[j],
              relation: 'semantically_related',
              weight: relationWeight,
            });
          }
        }
      } catch (error) {
        this.logger.warn('LLM entity extraction failed, using tag-based fallback', {
          memoryId: memory.uid,
          error: String(error),
        });
      }
    }

    // 3. 标签作为概念节点（始终保留，作为 fallback）
    if (memory.tags && memory.tags.length > 0) {
      const tagEntities: typeof entities = [];
      for (const tag of memory.tags) {
        const tagEntityId = StringUtils.encodeTagEntityId(tag);
        // 检查是否已存在同名实体（避免与 LLM 提取的实体重复）
        if (entities.some(e => e.id === tagEntityId)) {
          continue;
        }

        tagEntities.push({
          id: tagEntityId,
          entity: tag,
          type: 'concept' as const,
          uid: memory.uid,
          memoryIds: [memory.uid],
          properties: { source: 'tag', memoryType: memory.type, createdAt: memory.createdAt },
        });

        edges.push({
          id: `edge_${memoryNodeId}_${tagEntityId}`,
          sourceId: memoryNodeId,
          targetId: tagEntityId,
          relation: 'has_tag',
          weight: 1.0,
        });
      }
      entities.push(...tagEntities);

      // 标签共现关系（限制最多 20 条，避免 O(n²) 边爆炸）
      const maxCoOccurrenceEdges = 20;
      let coOccurrenceEdgeCount = 0;
      for (let i = 0; i < tagEntities.length && coOccurrenceEdgeCount < maxCoOccurrenceEdges; i++) {
        for (let j = i + 1; j < tagEntities.length && coOccurrenceEdgeCount < maxCoOccurrenceEdges; j++) {
          edges.push({
            id: `edge_${tagEntities[i].id}_${tagEntities[j].id}`,
            sourceId: tagEntities[i].id,
            targetId: tagEntities[j].id,
            relation: 'co_occurs_with',
            weight: 1.0,
          });
          coOccurrenceEdgeCount++;
        }
      }
    }

    // 4. 记忆间关联
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
      this.logger.warn('Failed to find related memories for graph', {
        memoryId: memory.uid,
        error: String(error),
      });
    }

    // 5. Profile 类型特殊处理：建立与 Identity/Preference/Persona 概念节点的关联
    if (isProfileType(memory.type)) {
      const profileConceptId = StringUtils.encodeTagEntityId(`concept_profile_${memory.type.toLowerCase()}`);
      // 检查是否已存在
      if (!entities.some(e => e.id === profileConceptId)) {
        entities.push({
          id: profileConceptId,
          entity: `Profile: ${memory.type}`,
          type: 'concept' as const,
          uid: memory.uid,
          memoryIds: [memory.uid],
          properties: {
            source: 'profile_type',
            memoryType: memory.type,
            createdAt: memory.createdAt,
          },
        });
      }

      edges.push({
        id: `edge_${memoryNodeId}_${profileConceptId}`,
        sourceId: memoryNodeId,
        targetId: profileConceptId,
        relation: 'is_profile_of',
        weight: 1.0,
      });
    }

    return { entities, edges };
  }

  /**
   * 计算实体间关系权重
   * 基于实体类型的语义关联强度
   */
  private _calculateEntityRelationWeight(
    typeA: GraphNodeType,
    typeB: GraphNodeType
  ): number {
    // 相同类型实体之间的关联更强
    if (typeA === typeB) {
      return 0.9;
    }

    // 技术和概念经常相关
    if ((typeA === 'technology' && typeB === 'concept') || (typeA === 'concept' && typeB === 'technology')) {
      return 0.7;
    }

    // 人物与组织相关
    if ((typeA === 'person' && typeB === 'organization') || (typeA === 'organization' && typeB === 'person')) {
      return 0.8;
    }

    // 地点与组织/人物可能相关
    if (typeA === 'location' || typeB === 'location') {
      return 0.5;
    }

    // 事件与相关参与者
    if (typeA === 'event' || typeB === 'event') {
      return 0.6;
    }

    // 默认关联权重
    return 0.4;
  }

  /**
   * 将记忆添加到知识图谱
   * - 记忆本身作为实体节点
   * - LLM 提取的命名实体作为节点
   * - 标签作为关联的概念节点
   * - 记忆与标签/实体之间建立关系
   * - 记忆之间通过共享标签建立直接关联边
   * - Profile 类型特殊处理
   */
  private async _addMemoryToGraph(memory: Memory): Promise<void> {
    this.logger.debug('_addMemoryToGraph called', { memoryId: memory.uid });
    try {
      const { entities, edges } = await this._prepareGraphData(memory);
      await this.graphStore.addMemory(memory.uid, entities, edges);
      this.logger.info('Memory added to graph successfully', {
        memoryId: memory.uid,
        entityCount: entities.length,
        edgeCount: edges.length,
      });
    } catch (error) {
      this.logger.error('_addMemoryToGraph failed', { memoryId: memory.uid, error: String(error) });
      throw error;
    }
  }

  // ============================================================
  // Palace 位置计算
  // ============================================================

  /**
   * 计算 Palace 位置
   *
   * 注意: closetId 由 PalaceStore.generatePalaceRef 根据 uid 和 version 自动生成
   *
   * @param type - 记忆类型 (决定 Hall)
   * @param scope - 作用域 (决定 Wing)
   * @param agentId - Agent ID
   * @param sessionId - 会话 ID (可选)
   * @param tags - 标签 (可选，用于 Room)
   */
  calculatePalaceLocation(
    type: MemoryType,
    scope: MemoryScope,
    agentId: string,
    sessionId?: string,
    tags?: string[]
  ): PalaceLocation {
    // Profile types use dedicated wing/hall/room
    const isProfile = isProfileType(type);

    // Wing: Profile types always use wing_profile; others based on scope
    const wingId = isProfile
      ? 'wing_profile'
      : scope === MemoryScope.SESSION
        ? `session_${sessionId || 'default'}`
        : scope === MemoryScope.GLOBAL
          ? 'global'
          : `agent_${agentId}`;

    // Hall: Profile types use hall_profile; others based on type
    const hallId = isProfile ? 'hall_profile' : type.toLowerCase();

    // Room: Profile types use room_{type}; others based on tags or default
    const roomId = isProfile
      ? `room_${type.toLowerCase()}`
      : tags?.length
        ? `room_${tags[0].replace(/[^a-zA-Z0-9]/g, '_')}`
        : 'room_default';

    // Closet: 占位符，会在 generatePalaceRef 时被 uid 和 version 替换
    const closetId = 'closet_placeholder';

    return { wingId, hallId, roomId, closetId };
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
}
