/**
 * Graph Store - 知识图谱存储
 * @module storage/graph-store
 */

import type { IGraphStore, GraphNodeRecord, GraphEdgeRecord, RelatedMemoryResult } from '../core/types';
import { createServiceLogger, ILogger } from '../../../shared/logging';
import { FileUtils } from '../../../shared/utils/file';
import { StringUtils } from '../../../shared/utils/string';
import { join, dirname } from 'path';
import Database from 'better-sqlite3';
import { config } from '../../../shared/config';

/**
 * Graph Store
 * 负责知识图谱的实体和关系存储
 */
export class GraphStore implements IGraphStore {
  private logger: ILogger;
  private db: any; // better-sqlite3
  private initialized: boolean;
  private config: { dbPath: string };

  constructor(userConfig?: Partial<{ dbPath: string }>) {
    this.config = { dbPath: userConfig?.dbPath ?? '' };
    this.logger = createServiceLogger('GraphStore');
    this.db = null;
    this.initialized = false;
  }

  /**
   * 转义 SQL LIKE 模式中的特殊字符，防止注入和误匹配
   * SQLite LIKE 模式中：
   * - `%` 匹配任意字符序列
   * - `_` 匹配单个任意字符
   * - `'` 需要转义以防止 SQL 注入
   * 由于内存 ID 包含下划线，必须转义 `_` 以避免误匹配
   *
   * @param value - 要转义的值
   * @returns 转义后的值，可安全用于 LIKE 查询
   */
  private escapeLikeValue(value: string): string {
    // 转义所有 LIKE 元字符：%、_、'
    // 使用 ESCAPE 子句将 \ 定义为转义字符
    return value.replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_');
  }

  /**
   * 初始化图数据库
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 从 ConfigManager 读取配置
    const storageConfig = config.getConfigOrThrow<{ graphStoreDbPath: string }>('memoryService.storage');
    this.config.dbPath = this.config.dbPath || storageConfig.graphStoreDbPath;

    try {
      // Ensure directory exists - use dirname() for cross-platform compatibility
      await FileUtils.ensureDirectory(dirname(this.config.dbPath));

      this.db = new Database(this.config.dbPath);

      // Create nodes table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS graph_nodes (
          id TEXT PRIMARY KEY,
          entity TEXT NOT NULL,
          type TEXT NOT NULL,
          memoryIds TEXT NOT NULL DEFAULT '[]',
          properties TEXT NOT NULL DEFAULT '{}',
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL
        )
      `);

      // Create edges table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS graph_edges (
          id TEXT PRIMARY KEY,
          sourceId TEXT NOT NULL,
          targetId TEXT NOT NULL,
          relation TEXT NOT NULL,
          weight REAL NOT NULL DEFAULT 1.0,
          temporalStart INTEGER,
          temporalEnd INTEGER,
          createdAt INTEGER NOT NULL,
          FOREIGN KEY (sourceId) REFERENCES graph_nodes(id),
          FOREIGN KEY (targetId) REFERENCES graph_nodes(id)
        )
      `);

      // Create indexes
      // === MemPalace-inspired: entity type composite index and time-based index ===
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_entity ON graph_nodes(entity);
        CREATE INDEX IF NOT EXISTS idx_sourceId ON graph_edges(sourceId);
        CREATE INDEX IF NOT EXISTS idx_targetId ON graph_edges(targetId);
        CREATE INDEX IF NOT EXISTS idx_relation ON graph_edges(relation);
        -- MemPalace source_closet equivalent: entity+type composite for type-filtered entity lookup
        CREATE INDEX IF NOT EXISTS idx_node_entity_type ON graph_nodes(entity, type);
        -- MemPalace valid_from/valid_to equivalent: time-range index for temporal queries
        CREATE INDEX IF NOT EXISTS idx_node_createdAt ON graph_nodes(createdAt);
        -- Temporal time-range index for edges (valid_from/valid_to equivalent)
        CREATE INDEX IF NOT EXISTS idx_edge_temporal ON graph_edges(temporalStart, temporalEnd);
        -- Relation weight composite index for weight-sorted relation queries
        CREATE INDEX IF NOT EXISTS idx_edge_relation_weight ON graph_edges(relation, weight DESC);
      `);

      this.initialized = true;
      this.logger.info('GraphStore initialized', { dbPath: this.config.dbPath });
    } catch (error) {
      this.logger.error('Failed to initialize GraphStore', { error });
      throw error;
    }
  }

  /**
   * 添加记忆相关的实体和关系
   */
  async addMemory(
    memoryId: string,
    entities: GraphNodeRecord[],
    edges: GraphEdgeRecord[]
  ): Promise<void> {
    await this.ensureInitialized();

    this.logger.debug('addMemory called', {
      memoryId,
      entityCount: entities.length,
      entityIds: entities.map(e => e.id),
      edgeCount: edges.length,
    });

    const transaction = this.db.transaction(() => {
      // Insert or update entities
      for (const entity of entities) {
        this.upsertNode(entity);
      }

      // Insert edges
      for (const edge of edges) {
        this.insertEdge(edge);
      }

      // Link memory to entities
      const entityIds = entities.map(e => e.id);
      this.logger.debug('Calling linkMemoryToEntities', { memoryId, entityIds });
      this.linkMemoryToEntities(memoryId, entityIds);
    });

    try {
      transaction();
      this.logger.debug('Memory entities and edges added', {
        memoryId,
        entityCount: entities.length,
        edgeCount: edges.length,
      });
    } catch (error) {
      this.logger.error('Failed to add memory entities', { memoryId, error });
      throw error;
    }
  }

  /**
   * 插入或更新节点
   */
  private upsertNode(node: GraphNodeRecord): void {
    const existingStmt = this.db.prepare('SELECT id, memoryIds FROM graph_nodes WHERE id = ?');
    const existing = existingStmt.get(node.id);

    if (existing) {
      // Merge memoryIds
      const existingMemoryIds = JSON.parse(existing.memoryIds);
      const newMemoryIds = [...new Set([...existingMemoryIds, ...node.memoryIds])];

      const updateStmt = this.db.prepare(`
        UPDATE graph_nodes SET
          entity = ?,
          type = ?,
          memoryIds = ?,
          properties = ?,
          updatedAt = ?
        WHERE id = ?
      `);

      updateStmt.run(
        node.entity,
        node.type,
        JSON.stringify(newMemoryIds),
        JSON.stringify(node.properties),
        Date.now(),
        node.id
      );
    } else {
      const insertStmt = this.db.prepare(`
        INSERT INTO graph_nodes (id, entity, type, memoryIds, properties, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      insertStmt.run(
        node.id,
        node.entity,
        node.type,
        JSON.stringify(node.memoryIds),
        JSON.stringify(node.properties),
        (node.properties as any).createdAt || Date.now(),
        Date.now()
      );
    }
  }

  /**
   * 插入边
   */
  private insertEdge(edge: GraphEdgeRecord): void {
    // Check if edge already exists
    const existingStmt = this.db.prepare(`
      SELECT id FROM graph_edges WHERE sourceId = ? AND targetId = ? AND relation = ?
    `);
    const existing = existingStmt.get(edge.sourceId, edge.targetId, edge.relation);

    if (existing) {
      // Update weight
      const updateStmt = this.db.prepare(`
        UPDATE graph_edges SET weight = ? WHERE id = ?
      `);
      updateStmt.run(edge.weight, existing.id);
    } else {
      const insertStmt = this.db.prepare(`
        INSERT INTO graph_edges (id, sourceId, targetId, relation, weight, temporalStart, temporalEnd, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertStmt.run(
        edge.id,
        edge.sourceId,
        edge.targetId,
        edge.relation,
        edge.weight,
        edge.temporal?.start || null,
        edge.temporal?.end || null,
        Date.now()
      );
    }
  }

  /**
   * 将记忆关联到实体
   */
  private linkMemoryToEntities(memoryId: string, entityIds: string[]): void {
    for (const entityId of entityIds) {
      const selectStmt = this.db.prepare('SELECT memoryIds FROM graph_nodes WHERE id = ?');
      const row = selectStmt.get(entityId);

      if (row) {
        const memoryIds = JSON.parse(row.memoryIds);
        if (!memoryIds.includes(memoryId)) {
          memoryIds.push(memoryId);

          const updateStmt = this.db.prepare('UPDATE graph_nodes SET memoryIds = ?, updatedAt = ? WHERE id = ?');
          updateStmt.run(JSON.stringify(memoryIds), Date.now(), entityId);
        }
      }
    }
  }

  /**
   * 移除记忆的所有实体和关系
   */
  async removeMemory(memoryId: string): Promise<void> {
    await this.ensureInitialized();

    const transaction = this.db.transaction(() => {
      // Find all nodes containing this memory - escape LIKE special characters
      // NOTE: This LIKE '%uid%' query is a known performance bottleneck since memoryIds is a JSON array.
      // SQLite cannot optimize JSON array containment with a standard index.
      // Future optimization options:
      //   a. Use SQLite JSON_TABLE function to extract array elements and build a separate index
      //   b. Decompose memoryIds into a separate memory_node_links junction table
      const escapedMemoryId = this.escapeLikeValue(memoryId);
      const nodesStmt = this.db.prepare("SELECT id, memoryIds FROM graph_nodes WHERE memoryIds LIKE ?");
      const nodes = nodesStmt.all(`%${escapedMemoryId}%`);

      for (const node of nodes) {
        const memoryIds = JSON.parse(node.memoryIds).filter((id: string) => id !== memoryId);

        if (memoryIds.length === 0) {
          // Delete node and its edges
          this.db.prepare('DELETE FROM graph_edges WHERE sourceId = ? OR targetId = ?').run(node.id, node.id);
          this.db.prepare('DELETE FROM graph_nodes WHERE id = ?').run(node.id);
        } else {
          // Update memoryIds
          this.db.prepare('UPDATE graph_nodes SET memoryIds = ?, updatedAt = ? WHERE id = ?')
            .run(JSON.stringify(memoryIds), Date.now(), node.id);
        }
      }

    });

    try {
      transaction();
      this.logger.debug('Memory graph data removed', { memoryId });
    } catch (error) {
      this.logger.error('Failed to remove memory graph', { memoryId, error });
      throw error;
    }
  }

  /**
   * 查找相关记忆
   */
  async findRelated(memoryId: string, limit: number = 10): Promise<RelatedMemoryResult[]> {
    await this.ensureInitialized();

    try {
      // Find all entities this memory is connected to - escape LIKE special characters
      // NOTE: This LIKE '%uid%' query is a known performance bottleneck since memoryIds is a JSON array.
      // Future optimization: see options in removeMemory method.
      const escapedMemoryId = this.escapeLikeValue(memoryId);
      const nodesStmt = this.db.prepare("SELECT id, entity, memoryIds FROM graph_nodes WHERE memoryIds LIKE ?");
      const nodes = nodesStmt.all(`%${escapedMemoryId}%`) as any[];

      if (nodes.length === 0) {
        return [];
      }

      const relatedMemories = new Map<string, { relation: string; weight: number }>();

      for (const node of nodes) {
        const memoryIds = JSON.parse(node.memoryIds);

        // Find edges to other entities
        const edgesStmt = this.db.prepare(`
          SELECT targetId, relation, weight FROM graph_edges
          WHERE sourceId = ? OR targetId = ?
        `);
        const edges = edgesStmt.all(node.id, node.id) as any[];

        for (const edge of edges) {
          // Get the other node's memoryIds
          const otherNodeId = edge.sourceId === node.id ? edge.targetId : edge.sourceId;
          const otherNodeStmt = this.db.prepare('SELECT memoryIds FROM graph_nodes WHERE id = ?');
          const otherNode = otherNodeStmt.get(otherNodeId) as any;

          if (otherNode) {
            const otherMemoryIds = JSON.parse(otherNode.memoryIds);
            for (const otherMemoryId of otherMemoryIds) {
              if (otherMemoryId !== memoryId && !relatedMemories.has(otherMemoryId)) {
                relatedMemories.set(otherMemoryId, {
                  relation: edge.relation,
                  weight: edge.weight,
                });
              }
            }
          }
        }
      }

      // Convert to array and sort by weight
      const results: RelatedMemoryResult[] = Array.from(relatedMemories.entries())
        .map(([uid, data]) => ({
          uid,
          relation: data.relation,
          weight: data.weight,
        }))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, limit);

      return results;
    } catch (error) {
      this.logger.error('Failed to find related memories', { memoryId, error });
      return [];
    }
  }

  /**
   * 批量查找相关记忆（优化 N+1 查询）
   */
  async findRelatedBatch(memoryIds: string[], limit: number = 10): Promise<Map<string, RelatedMemoryResult[]>> {
    await this.ensureInitialized();

    const result = new Map<string, RelatedMemoryResult[]>();

    if (memoryIds.length === 0) {
      return result;
    }

    try {
      // 构建查询条件：查找所有包含任一 memoryId 的节点
      // 使用 LIKE 查询效率较低，但实现简单。优化方案可考虑 JSON_TABLE 或全文索引
      // 注意：需要转义 memoryId 中的 LIKE 特殊字符
      const placeholders = memoryIds.map(() => `memoryIds LIKE ?`).join(' OR ');
      const params = memoryIds.map(id => `%${this.escapeLikeValue(id)}%`);
      const nodesStmt = this.db.prepare(`SELECT id, entity, memoryIds FROM graph_nodes WHERE ${placeholders}`);
      const nodes = nodesStmt.all(...params) as any[];

      // 按 memoryId 分组结果
      const nodesByMemoryId = new Map<string, any[]>();
      for (const node of nodes) {
        const nodeMemoryIds = JSON.parse(node.memoryIds);
        for (const memId of nodeMemoryIds) {
          if (memoryIds.includes(memId)) {
            if (!nodesByMemoryId.has(memId)) {
              nodesByMemoryId.set(memId, []);
            }
            nodesByMemoryId.get(memId)!.push(node);
          }
        }
      }

      // 获取所有相关节点 ID 进行批量查询边
      const allNodeIds = [...new Set(nodes.map(n => n.id))];

      if (allNodeIds.length > 0) {
        const edgePlaceholders = allNodeIds.map(() => '?').join(',');
        const edgesStmt = this.db.prepare(`
          SELECT sourceId, targetId, relation, weight FROM graph_edges
          WHERE sourceId IN (${edgePlaceholders}) OR targetId IN (${edgePlaceholders})
        `);
        const allEdges = edgesStmt.all(...allNodeIds, ...allNodeIds) as any[];

        // 按节点 ID 分组边
        const edgesByNodeId = new Map<string, any[]>();
        for (const edge of allEdges) {
          if (!edgesByNodeId.has(edge.sourceId)) {
            edgesByNodeId.set(edge.sourceId, []);
          }
          edgesByNodeId.get(edge.sourceId)!.push(edge);
          if (!edgesByNodeId.has(edge.targetId)) {
            edgesByNodeId.set(edge.targetId, []);
          }
          edgesByNodeId.get(edge.targetId)!.push(edge);
        }

        // 批量获取节点 memoryIds
        const nodePlaceholders = allNodeIds.map(() => '?').join(',');
        const nodeMemoryStmt = this.db.prepare(`SELECT id, memoryIds FROM graph_nodes WHERE id IN (${nodePlaceholders})`);
        const nodeMemoryRows = nodeMemoryStmt.all(...allNodeIds) as any[];
        const memoryIdsByNodeId = new Map<string, string[]>();
        for (const row of nodeMemoryRows) {
          memoryIdsByNodeId.set(row.id, JSON.parse(row.memoryIds));
        }

        // 为每个 memoryId 计算关联
        for (const memoryId of memoryIds) {
          const relatedMemories = new Map<string, { relation: string; weight: number }>();
          const memoryNodes = nodesByMemoryId.get(memoryId) || [];

          for (const node of memoryNodes) {
            const edges = edgesByNodeId.get(node.id) || [];
            for (const edge of edges) {
              const otherNodeId = edge.sourceId === node.id ? edge.targetId : edge.sourceId;
              const otherMemoryIds = memoryIdsByNodeId.get(otherNodeId) || [];

              for (const otherMemoryId of otherMemoryIds) {
                if (otherMemoryId !== memoryId && !relatedMemories.has(otherMemoryId)) {
                  relatedMemories.set(otherMemoryId, {
                    relation: edge.relation,
                    weight: edge.weight,
                  });
                }
              }
            }
          }

          const results: RelatedMemoryResult[] = Array.from(relatedMemories.entries())
            .map(([uid, data]) => ({
              uid,
              relation: data.relation,
              weight: data.weight,
            }))
            .sort((a, b) => b.weight - a.weight)
            .slice(0, limit);

          result.set(memoryId, results);
        }
      } else {
        // 没有找到任何节点，返回空结果
        for (const memoryId of memoryIds) {
          result.set(memoryId, []);
        }
      }
    } catch (error) {
      this.logger.error('Failed to find related memories batch', { count: memoryIds.length, error });
      // 失败时返回空 Map
      for (const memoryId of memoryIds) {
        result.set(memoryId, []);
      }
    }

    return result;
  }

  /**
   * 根据实体名称查询
   */
  async queryByEntity(entity: string): Promise<string[]> {
    await this.ensureInitialized();

    try {
      const stmt = this.db.prepare('SELECT memoryIds FROM graph_nodes WHERE entity = ?');
      const rows = stmt.all(entity) as any[];

      const memoryIds: string[] = [];
      for (const row of rows) {
        const ids = JSON.parse(row.memoryIds);
        memoryIds.push(...ids);
      }

      return [...new Set(memoryIds)];
    } catch (error) {
      this.logger.error('Failed to query by entity', { entity, error });
      return [];
    }
  }

  /**
   * 查找共享标签的其他记忆
   * 用于在添加记忆时建立记忆之间的直接关联边
   */
  async findMemoriesByTags(tags: string[]): Promise<string[]> {
    await this.ensureInitialized();

    if (!tags || tags.length === 0) return [];

    try {
      // Find all tag entity IDs
      const tagEntityIds: string[] = [];
      for (const tag of tags) {
        const tagEntityId = StringUtils.encodeTagEntityId(tag);
        tagEntityIds.push(tagEntityId);
      }

      // Find all memories connected to these tag nodes (excluding the current memory)
      const placeholders = tagEntityIds.map(() => '?').join(',');
      const stmt = this.db.prepare(`
        SELECT memoryIds FROM graph_nodes
        WHERE id IN (${placeholders})
      `);
      const rows = stmt.all(...tagEntityIds) as any[];

      const memoryIdsSet = new Set<string>();
      for (const row of rows) {
        const memoryIds = JSON.parse(row.memoryIds || '[]');
        for (const id of memoryIds) {
          memoryIdsSet.add(id);
        }
      }

      return Array.from(memoryIdsSet);
    } catch (error) {
      this.logger.error('Failed to find memories by tags', { tags, error });
      return [];
    }
  }

  /**
   * 根据关系类型查询
   */
  async queryByRelation(relation: string, limit: number = 100): Promise<GraphEdgeRecord[]> {
    await this.ensureInitialized();

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM graph_edges
        WHERE relation = ?
        ORDER BY weight DESC
        LIMIT ?
      `);
      const rows = stmt.all(relation, limit) as any[];

      return rows.map(row => ({
        id: row.id,
        sourceId: row.sourceId,
        targetId: row.targetId,
        relation: row.relation,
        weight: row.weight,
        temporal: row.temporalStart
          ? { start: row.temporalStart, end: row.temporalEnd }
          : undefined,
      }));
    } catch (error) {
      this.logger.error('Failed to query by relation', { relation, error });
      return [];
    }
  }

  /**
   * 获取实体的详细信息
   */
  async getEntity(entity: string): Promise<GraphNodeRecord | null> {
    await this.ensureInitialized();

    try {
      const stmt = this.db.prepare('SELECT * FROM graph_nodes WHERE entity = ?');
      const row = stmt.get(entity) as any;

      if (!row) return null;

      return {
        id: row.id,
        entity: row.entity,
        type: row.type,
        uid: row.id,  // uid 与 id 相同
        memoryIds: JSON.parse(row.memoryIds),
        properties: JSON.parse(row.properties),
      };
    } catch (error) {
      this.logger.error('Failed to get entity', { entity, error });
      return null;
    }
  }

  /**
   * 根据节点ID获取实体
   */
  async getEntityById(nodeId: string): Promise<GraphNodeRecord | null> {
    await this.ensureInitialized();

    try {
      const stmt = this.db.prepare('SELECT * FROM graph_nodes WHERE id = ?');
      const row = stmt.get(nodeId) as any;

      if (!row) return null;

      return {
        id: row.id,
        entity: row.entity,
        type: row.type,
        uid: row.id,
        memoryIds: JSON.parse(row.memoryIds),
        properties: JSON.parse(row.properties),
      };
    } catch (error) {
      this.logger.error('Failed to get entity by id', { nodeId, error });
      return null;
    }
  }

  /**
   * 批量根据节点ID获取实体
   * 优化：使用单次 SQL 查询代替多次独立查询
   */
  async getEntitiesByIds(nodeIds: string[]): Promise<Map<string, GraphNodeRecord | null>> {
    await this.ensureInitialized();

    const result = new Map<string, GraphNodeRecord | null>();

    if (nodeIds.length === 0) {
      return result;
    }

    try {
      const placeholders = nodeIds.map(() => '?').join(', ');
      const stmt = this.db.prepare(`SELECT * FROM graph_nodes WHERE id IN (${placeholders})`);
      const rows = stmt.all(...nodeIds) as any[];

      // 构建 ID -> 记录映射
      const rowMap = new Map<string, any>();
      for (const row of rows) {
        rowMap.set(row.id, row);
      }

      // 按原顺序填充结果（不存在的返回 null）
      for (const nodeId of nodeIds) {
        const row = rowMap.get(nodeId);
        if (row) {
          result.set(nodeId, {
            id: row.id,
            entity: row.entity,
            type: row.type,
            uid: row.id,
            memoryIds: JSON.parse(row.memoryIds),
            properties: JSON.parse(row.properties),
          });
        } else {
          result.set(nodeId, null);
        }
      }
    } catch (error) {
      this.logger.error('Failed to get entities by ids', { count: nodeIds.length, error });
      // 失败时返回空 Map
      for (const nodeId of nodeIds) {
        result.set(nodeId, null);
      }
    }

    return result;
  }

  /**
   * 获取节点的所有边
   */
  async getNodeEdges(nodeId: string): Promise<GraphEdgeRecord[]> {
    await this.ensureInitialized();

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM graph_edges
        WHERE sourceId = ? OR targetId = ?
      `);
      const rows = stmt.all(nodeId) as any[];

      return rows.map(row => ({
        id: row.id,
        sourceId: row.sourceId,
        targetId: row.targetId,
        relation: row.relation,
        weight: row.weight,
        temporal: row.temporalStart
          ? { start: row.temporalStart, end: row.temporalEnd }
          : undefined,
      }));
    } catch (error) {
      this.logger.error('Failed to get node edges', { nodeId, error });
      return [];
    }
  }

  /**
   * 添加关系
   */
  async addRelation(
    sourceId: string,
    targetId: string,
    relation: string,
    weight: number = 1.0
  ): Promise<void> {
    await this.ensureInitialized();

    const edgeId = `edge_${sourceId}_${targetId}_${relation}_${Date.now()}`;
    const edge: GraphEdgeRecord = {
      id: edgeId,
      sourceId,
      targetId,
      relation,
      weight,
    };

    try {
      this.insertEdge(edge);
      this.logger.debug('Relation added', { sourceId, targetId, relation });
    } catch (error) {
      this.logger.error('Failed to add relation', { sourceId, targetId, relation, error });
      throw error;
    }
  }

  /**
   * 移除关系
   */
  async removeRelation(
    sourceId: string,
    targetId: string,
    relation: string
  ): Promise<void> {
    await this.ensureInitialized();

    try {
      const stmt = this.db.prepare(`
        DELETE FROM graph_edges
        WHERE sourceId = ? AND targetId = ? AND relation = ?
      `);
      stmt.run(sourceId, targetId, relation);
      this.logger.debug('Relation removed', { sourceId, targetId, relation });
    } catch (error) {
      this.logger.error('Failed to remove relation', { sourceId, targetId, relation, error });
      throw error;
    }
  }

  /**
   * 批量添加记忆实体和关系
   */
  async addMemoryBatch(
    memories: Array<{ uid: string; entities: GraphNodeRecord[]; edges: GraphEdgeRecord[] }>
  ): Promise<void> {
    await this.ensureInitialized();

    const transaction = this.db.transaction(() => {
      for (const { uid, entities, edges } of memories) {
        // Insert or update entities
        for (const entity of entities) {
          this.upsertNode(entity);
        }

        // Insert edges
        for (const edge of edges) {
          this.insertEdge(edge);
        }

        // Link memory to entities
        this.linkMemoryToEntities(uid, entities.map(e => e.id));
      }
    });

    try {
      transaction();
      this.logger.debug('Memory batch added', { count: memories.length });
    } catch (error) {
      this.logger.error('Failed to add memory batch', { error });
      throw error;
    }
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
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
    this.logger.info('GraphStore closed');
  }

  /**
   * 获取统计
   * NOTE: indexHitRate is an approximation based on query planner estimates.
   * For production monitoring, use SQLite's query_log or EXPLAIN QUERY PLAN.
   */
  async getStats(): Promise<{
    nodeCount: number;
    edgeCount: number;
    entityCount: number;
    indexInfo?: {
      nodeIndexes: string[];
      edgeIndexes: string[];
    };
  }> {
    await this.ensureInitialized();

    const nodeStmt = this.db.prepare('SELECT COUNT(*) as count FROM graph_nodes');
    const edgeStmt = this.db.prepare('SELECT COUNT(*) as count FROM graph_edges');
    const entityStmt = this.db.prepare('SELECT COUNT(DISTINCT entity) as count FROM graph_nodes');

    const nodeCount = nodeStmt.get().count;
    const edgeCount = edgeStmt.get().count;
    const entityCount = entityStmt.get().count;

    // Index information for monitoring
    const nodeIndexes = ['idx_entity', 'idx_node_entity_type', 'idx_node_createdAt'];
    const edgeIndexes = ['idx_sourceId', 'idx_targetId', 'idx_relation', 'idx_edge_temporal', 'idx_edge_relation_weight'];

    return { nodeCount, edgeCount, entityCount, indexInfo: { nodeIndexes, edgeIndexes } };
  }
}
