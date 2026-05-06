/**
 * Vector Store - 基于 LanceDB 的向量存储
 * @module storage/vector-store
 */

import type { MemoryType, MemoryScope } from '../../../types/memory';
import type {
  IVectorStore,
  VectorDocument,
  VectorMetadata,
  VectorSearchOptions,
  VectorSearchResult,
} from '../core/types';
import { createServiceLogger, ILogger } from '../../../shared/logging';
import { config } from '../../../shared/config';

interface VectorStoreConfig {
  dimensions: number;
  tableName: string;
  dataPath: string;
}

/**
 * Vector Store 基于 LanceDB
 * 提供向量存储和相似度搜索功能
 */
export class VectorStore implements IVectorStore {
  private logger: ILogger;
  private db: any; // LanceDB connection
  private table: any; // LanceDB table
  private initialized: boolean;
  private config: VectorStoreConfig;

  private degraded: boolean = false; // true when running in memory-only fallback mode

  constructor(userConfig?: Partial<VectorStoreConfig>) {
    this.logger = createServiceLogger('VectorStore');
    this.db = null;
    this.table = null;
    this.initialized = false;
    this.degraded = false;
    this.config = (userConfig ?? {}) as VectorStoreConfig;
  }

  /**
   * 初始化 LanceDB 连接
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 从 ConfigManager 读取配置
    const embeddingConfig = config.getConfigOrThrow<{ dimensions: number }>('embedding');
    const storageConfig = config.getConfigOrThrow<{ vectorStoreDbPath: string; vectorStoreTableName: string }>('memoryService.storage');
    this.config.dimensions = this.config.dimensions ?? embeddingConfig.dimensions;
    this.config.dataPath = this.config.dataPath ?? storageConfig.vectorStoreDbPath;
    this.config.tableName = this.config.tableName ?? storageConfig.vectorStoreTableName;

    try {
      // 动态导入 lancedb（使用 require 避免类型检查）
      // @ts-ignore - lancedb module types may not be available
      const lancedb = await import('@lancedb/lancedb').catch(() => null);
      
      if (!lancedb) {
        throw new Error('LanceDB not available, using memory mode');
      }
      
      const { connect } = lancedb;

            // 连接数据库
      this.db = await connect(this.config.dataPath);

            // 创建或打开表
      try {
        this.table = await this.db.openTable(this.config.tableName);
      } catch {
        // 表不存在，创建新表（需要至少一条记录）
        // 使用配置的维度创建占位向量（与 DEFAULT_VECTOR_CONFIG.dimensions 保持一致）
        const dimensions = this.config.dimensions;
        const placeholderVector = Float32Array.from(new Array(dimensions).fill(0));
        this.table = await this.db.createTable(this.config.tableName, [
          { id: '__placeholder__', vector: placeholderVector, text: '__init__', metadata: '{}' }
        ]);
        // 删除占位符
        await this.table.delete('id = "__placeholder__"');
      }

      this.initialized = true;
      this.logger.info('VectorStore initialized', { dataPath: this.config.dataPath });
    } catch (error) {
      this.logger.error('Failed to initialize VectorStore', { error });
      // Fallback to memory mode
      await this.initializeMemoryMode();
    }
  }

  /**
   * 内存模式初始化（降级方案）
   */
  private memoryStore: Map<string, VectorDocument> = new Map();

  /**
   * 转义 LanceDB 查询中的字符串值，防止注入
   */
  private escapeLanceDBValue(value: string): string {
    return value.replace(/'/g, "''");
  }

  private async initializeMemoryMode(): Promise<void> {
    this.degraded = true;
    this.logger.warn('VectorStore running in DEGRADED memory-only mode — data will be lost on restart', { mode: 'memory' });
    this.memoryStore = new Map();
    this.initialized = true;
  }

  /**
   * 存储向量文档
   */
  async store(doc: VectorDocument): Promise<void> {
    await this.ensureInitialized();

    try {
      if (this.table) {
        // LanceDB mode - metadata must be stored as JSON string
        await this.table.add([
          {
            id: doc.id,
            vector: doc.vector,
            text: doc.text,
            metadata: typeof doc.metadata === 'string' ? doc.metadata : JSON.stringify(doc.metadata),
          },
        ]);
      } else {
        // Memory mode
        this.memoryStore.set(doc.id, doc);
      }

      this.logger.debug('Vector stored', { id: doc.id });
    } catch (error) {
      this.logger.error('Failed to store vector', { id: doc.id, error });
      throw error;
    }
  }

  /**
   * 批量存储向量文档
   */
  async storeBatch(docs: VectorDocument[]): Promise<void> {
    await this.ensureInitialized();

    try {
      if (this.table) {
        // LanceDB mode - metadata must be stored as JSON string
        await this.table.add(
          docs.map(doc => ({
            id: doc.id,
            vector: doc.vector,
            text: doc.text,
            metadata: typeof doc.metadata === 'string' ? doc.metadata : JSON.stringify(doc.metadata),
          }))
        );
      } else {
        // Memory mode
        for (const doc of docs) {
          this.memoryStore.set(doc.id, doc);
        }
      }

      this.logger.debug('Vectors batch stored', { count: docs.length });
    } catch (error) {
      this.logger.error('Failed to store vectors batch', { error });
      throw error;
    }
  }

  /**
   * 向量相似度搜索
   */
  async search(options: VectorSearchOptions): Promise<VectorSearchResult[]> {
    await this.ensureInitialized();

    const limit = options.limit || 10;
    const minScore = options.minScore || 0.0;

    try {
      if (this.table) {
        // LanceDB mode with vector search
        return await this.searchWithLanceDB(options, limit, minScore);
      } else {
        // Memory mode with simple text matching
        return await this.searchWithMemory(options, limit, minScore);
      }
    } catch (error) {
      this.logger.error('Vector search failed', { error });
      throw error;
    }
  }

  /**
   * LanceDB 向量搜索
   */
  private async searchWithLanceDB(
    options: VectorSearchOptions,
    limit: number,
    minScore: number
  ): Promise<VectorSearchResult[]> {
    // 动态导入 lancedb（使用 require 避免类型检查）
    const lancedb = await import('@lancedb/lancedb').catch(() => null);

    if (!lancedb) {
      throw new Error('LanceDB not available');
    }

    this.logger.debug('[VectorStore.searchWithLanceDB] Starting search', {
      hasQueryVector: !!options.queryVector,
      queryVectorLength: options.queryVector?.length,
      query: options.query?.substring(0, 50),
      limit,
      minScore,
      filters: options.filters,
    });

    // Build filter conditions - sanitize string values to prevent query injection
    const filters: string[] = [];

    if (options.filters?.agentId) {
      filters.push(`metadata.agentId = '${this.escapeLanceDBValue(options.filters.agentId)}'`);
    }

    if (options.filters?.scope) {
      filters.push(`metadata.scope = '${this.escapeLanceDBValue(options.filters.scope)}'`);
    }

    if (options.filters?.type) {
      filters.push(`metadata.type = '${this.escapeLanceDBValue(options.filters.type)}'`);
    }

    if (options.filters?.timeRange) {
      filters.push(`metadata.createdAt >= ${options.filters.timeRange.start}`);
      filters.push(`metadata.createdAt <= ${options.filters.timeRange.end}`);
    }

    // 默认仅搜索最新版本（与 SQLite 查询一致）
    // 如果调用方显式传入 isLatestVersion: false，则不添加此过滤
    if (options.filters?.isLatestVersion !== false) {
      filters.push('metadata.isLatestVersion = true');
    }

    // Execute vector search
    const query = options.queryVector || options.query;

    let results;
    if (options.queryVector) {
      // Pure vector search
      results = await this.table
        .search(options.queryVector)
        .limit(limit * 2) // Over-fetch for filtering
        .toArray();
    } else {
      // Text query without vector - cannot perform vector similarity search on raw text.
      // Caller should use an embedding service to convert text to vector first.
      throw new Error(
        'VectorStore: text-based search requires queryVector. ' +
        'Use an embedding service to convert text to a vector before searching.'
      );
    }

    this.logger.debug('[VectorStore.searchWithLanceDB] Raw results count', { count: results.length });

    // Apply filters and convert to results
    const searchResults: VectorSearchResult[] = [];

    for (const row of results) {
      // Parse metadata if stored as JSON string
      let metadata: VectorMetadata;
      if (typeof row.metadata === 'string') {
        try {
          metadata = JSON.parse(row.metadata);
        } catch {
          metadata = {} as VectorMetadata;
        }
      } else {
        metadata = row.metadata as VectorMetadata;
      }

      // Apply filters manually (LanceDB filter syntax varies)
      if (options.filters?.uids && !options.filters.uids.includes(row.id)) {
        continue;
      }
      if (options.filters?.agentId && metadata.agentId !== options.filters.agentId) {
        continue;
      }
      if (options.filters?.scope && metadata.scope !== options.filters.scope) {
        continue;
      }
      if (options.filters?.type && metadata.type !== options.filters.type) {
        continue;
      }

      // LanceDB 使用 L2 距离（越小越相似），转换为余弦相似度近似值
      // BGE-M3 等归一化模型的向量长度约为 1，此时 L2² = 2(1 - cos)
      // 因此 cos ≈ 1 - dist²/2，比 1/(1+dist) 更准确
      const distance = row._distance ?? row._score ?? 0;
      const score = distance === 0 ? 1 : Math.max(0, 1 - (distance * distance) / 2);

      // Apply min score filter
      if (score < minScore) {
        continue;
      }

      searchResults.push({
        id: row.id,
        score,
        metadata,
      });

      if (searchResults.length >= limit) {
        break;
      }
    }

    return searchResults;
  }

  /**
   * 内存模式搜索（简单文本匹配 + 分数计算）
   */
  private async searchWithMemory(
    options: VectorSearchOptions,
    limit: number,
    minScore: number
  ): Promise<VectorSearchResult[]> {
    const results: VectorSearchResult[] = [];

    for (const doc of this.memoryStore.values()) {
      // Apply filters
      if (options.filters?.uids && !options.filters.uids.includes(doc.id)) {
        continue;
      }
      if (options.filters?.agentId && doc.metadata.agentId !== options.filters.agentId) {
        continue;
      }
      if (options.filters?.scope && doc.metadata.scope !== options.filters.scope) {
        continue;
      }
      if (options.filters?.type && doc.metadata.type !== options.filters.type) {
        continue;
      }

      // Calculate text similarity score
      const score = this.calculateTextSimilarity(options.query ?? '', doc.text);

      if (score >= minScore) {
        results.push({
          id: doc.id,
          score,
          metadata: doc.metadata,
        });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  /**
   * 计算文本相似度（简单实现）
   */
  private calculateTextSimilarity(query: string, text: string): number {
    if (!query || !text) return 0;

    const queryWords = query.toLowerCase().split(/\s+/);
    const textLower = text.toLowerCase();

    let matchCount = 0;
    for (const word of queryWords) {
      if (textLower.includes(word)) {
        matchCount++;
      }
    }

    return matchCount / queryWords.length;
  }

  /**
   * 删除向量
   */
  async delete(uid: string): Promise<void> {
    await this.ensureInitialized();

    try {
      if (this.table) {
        await this.table.delete(`id = '${this.escapeLanceDBValue(uid)}'`);
      } else {
        this.memoryStore.delete(uid);
      }

      this.logger.debug('Vector deleted', { uid });
    } catch (error) {
      this.logger.error('Failed to delete vector', { uid, error });
      throw error;
    }
  }

  /**
   * 更新向量元数据
   * 注意：LanceDB 不支持原地更新，使用删除+添加实现
   * 为确保原子性，先获取原始向量，如果添加失败则恢复
   */
  async updateMetadata(uid: string, metadata: Partial<VectorMetadata>): Promise<void> {
    await this.ensureInitialized();

    if (!this.table) {
      // Memory mode - 直接更新
      const doc = this.memoryStore.get(uid);
      if (doc) {
        doc.metadata = { ...doc.metadata, ...metadata };
        this.memoryStore.set(uid, doc);
      }
      this.logger.debug('Vector metadata updated (memory mode)', { uid });
      return;
    }

    // LanceDB mode - 需要处理原子性
    let originalDoc: VectorDocument | null = null;
    let deleteSucceeded = false;

    try {
      // 1. 先获取完整文档（用于可能的恢复）
      originalDoc = await this.getById(uid);
      if (!originalDoc) {
        this.logger.warn('Vector not found for metadata update', { uid });
        return;
      }

      // 2. 执行删除
      await this.table.delete(`id = '${this.escapeLanceDBValue(uid)}'`);
      deleteSucceeded = true;

      // 3. 计算新元数据并添加
      const newMetadata = { ...originalDoc.metadata, ...metadata };
      const newMetadataStr = typeof newMetadata === 'string' ? newMetadata : JSON.stringify(newMetadata);

      // 确保 vector 是纯 Float32Array，去除 LanceDB 附加的属性（如 isValid）
      const cleanVector = new Float32Array(originalDoc.vector);

      await this.table.add([
        {
          id: originalDoc.id,
          vector: cleanVector,
          text: originalDoc.text,
          metadata: newMetadataStr,
        },
      ]);

      this.logger.debug('Vector metadata updated', { uid });
    } catch (error) {
      this.logger.error('Failed to update vector metadata', { uid, error: String(error) });

      // 4. 如果删除成功但添加失败，尝试恢复原始向量
      if (deleteSucceeded && originalDoc) {
        try {
          // 重新添加原始向量
          const originalMetadataStr = typeof originalDoc.metadata === 'string'
            ? originalDoc.metadata
            : JSON.stringify(originalDoc.metadata);

          const rollbackVector = new Float32Array(originalDoc.vector);

          await this.table.add([
            {
              id: originalDoc.id,
              vector: rollbackVector,
              text: originalDoc.text,
              metadata: originalMetadataStr,
            },
          ]);
          this.logger.info('Vector metadata update rolled back successfully', { uid });
        } catch (recoveryError) {
          this.logger.error('CRITICAL: Vector metadata update failed and recovery also failed', {
            uid,
            updateError: String(error),
            recoveryError: String(recoveryError),
          });
        }
      }

      throw error;
    }
  }

  /**
   * 根据 ID 获取向量文档
   */
  async getById(uid: string): Promise<VectorDocument | null> {
    await this.ensureInitialized();

    if (this.table) {
      try {
        // Use a zero vector for ID lookup (filter-only query, distance is irrelevant)
        const zeroVector = new Float32Array(this.config.dimensions).fill(0);
        const results = await this.table.search(zeroVector).filter(`id = '${this.escapeLanceDBValue(uid)}'`).limit(1).toArray();
        if (results.length > 0) {
          const row = results[0];
          // Parse metadata if stored as JSON string
          let metadata: VectorMetadata;
          if (typeof row.metadata === 'string') {
            try {
              metadata = JSON.parse(row.metadata);
            } catch {
              metadata = {} as VectorMetadata;
            }
          } else {
            metadata = row.metadata as VectorMetadata;
          }
          return {
            id: row.id,
            vector: row.vector,
            text: row.text,
            metadata,
          };
        }
        return null;
      } catch {
        return null;
      }
    } else {
      return this.memoryStore.get(uid) || null;
    }
  }

  /**
   * 根据 IDs 批量获取
   * 优化：使用 LanceDB 批量查询代替串行查询
   */
  async getByIds(uids: string[]): Promise<VectorDocument[]> {
    await this.ensureInitialized();

    if (uids.length === 0) return [];

    if (this.table) {
      // LanceDB 批量查询：使用 filter IN 查询
      try {
        const placeholders = uids.map(id => `'${this.escapeLanceDBValue(id)}'`).join(', ');
        // Use a zero vector for ID lookup (filter-only query, distance is irrelevant)
        const zeroVector = new Float32Array(this.config.dimensions).fill(0);
        const results = await this.table
          .search(zeroVector)
          .filter(`id IN (${placeholders})`)
          .limit(uids.length)
          .toArray();

        return results.map((row: any) => {
          let metadata: VectorMetadata;
          if (typeof row.metadata === 'string') {
            try {
              metadata = JSON.parse(row.metadata);
            } catch {
              metadata = {} as VectorMetadata;
            }
          } else {
            metadata = row.metadata as VectorMetadata;
          }
          return {
            id: row.id,
            vector: row.vector,
            text: row.text,
            metadata,
          };
        });
      } catch (error) {
        this.logger.warn('Batch query failed, falling back to serial', { error: String(error) });
        // Fallback to serial query
      }
    }

    // Memory mode 或 LanceDB 批量查询失败时的串行回退
    const results: VectorDocument[] = [];
    for (const uid of uids) {
      const doc = await this.getById(uid);
      if (doc) {
        results.push(doc);
      }
    }
    return results;
  }

  /**
   * 确保已初始化
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      this.table = null;
    }
    this.memoryStore.clear();
    this.initialized = false;
    this.logger.info('VectorStore closed');
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{ count: number }> {
    await this.ensureInitialized();

    if (this.table) {
      return { count: await this.table.count() };
    } else {
      return { count: this.memoryStore.size };
    }
  }
}
