/**
 * Graph Routes - 知识图谱接口
 *
 * 提供图谱节点和边的查询、统计
 */

import { Router, Request, Response } from 'express';
import type { IGraphStore, GraphNodeRecord, GraphEdgeRecord } from '../../infrastructure/storage/core/types';

export interface GraphRoutesDeps {
  graphStore: IGraphStore;
}

export function createGraphRoutes(deps: GraphRoutesDeps): Router {
  const router = Router();

  /**
   * GET /api/graph/nodes
   * 获取图谱节点（支持按实体名称、类型、关联记忆ID筛选）
   */
  router.get('/nodes', async (req: Request, res: Response) => {
    try {
      const { type, entity, memoryId, limit, offset } = req.query as {
        type?: string;
        entity?: string;
        memoryId?: string;
        limit?: string;
        offset?: string;
      };

      const rawLimit = parseInt(limit || '100');
      const rawOffset = parseInt(offset || '0');
      const safeLimit = isNaN(rawLimit) || rawLimit < 1 ? 100 : Math.min(rawLimit, 500);
      const safeOffset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

      const graphStore = deps.graphStore as any;
      await graphStore.ensureInitialized?.();

      if (!graphStore.db) {
        res.json({ success: true, data: [], total: 0 });
        return;
      }

      let sql = 'SELECT * FROM graph_nodes';
      const params: string[] = [];
      const conditions: string[] = [];

      if (type) {
        conditions.push('type = ?');
        params.push(type);
      }
      if (entity) {
        conditions.push('entity LIKE ?');
        params.push(`%${entity}%`);
      }
      // Filter by memoryId - check if the memory ID is in the JSON array
      // 使用参数化查询防止 SQL 注入，同时处理 JSON 数组中的引号转义
      if (memoryId) {
        conditions.push('memoryIds LIKE ?');
        // 对 memoryId 进行转义处理，防止特殊字符导致 LIKE 模式匹配错误
        const escapedMemoryId = memoryId.replace(/[%_"\\]/g, (c) => `\\${c}`);
        params.push(`%"${escapedMemoryId}"%`);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      // Get total count first
      const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as cnt');
      const countResult = graphStore.db.prepare(countSql).get(...params);
      const total = countResult?.cnt ?? 0;

      // Add pagination
      // safeLimit 和 safeOffset 已在上面验证为安全整数，使用直接插值是安全的
      sql += ` ORDER BY updatedAt DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;
      const rows: any[] = graphStore.db.prepare(sql).all(...params);

      const nodes: GraphNodeRecord[] = rows.map((row: any) => ({
        id: row.id,
        entity: row.entity,
        type: row.type,
        uid: row.id,
        memoryIds: JSON.parse(row.memoryIds || '[]'),
        properties: JSON.parse(row.properties || '{}'),
        createdAt: (JSON.parse(row.properties || '{}') as any).createdAt || row.updatedAt,
        updatedAt: row.updatedAt,
      }));

      res.json({
        success: true,
        data: nodes,
        total,
        limit: safeLimit,
        offset: safeOffset,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get graph nodes',
      });
    }
  });

  /**
   * GET /api/graph/edges
   * 获取图谱边（支持按源节点和目标节点ID筛选）
   */
  router.get('/edges', async (req: Request, res: Response) => {
    try {
      const { sourceId, targetId, relation, limit, offset } = req.query as {
        sourceId?: string;
        targetId?: string;
        relation?: string;
        limit?: string;
        offset?: string;
      };
      const safeLimit = parseInt(limit || '500');
      const safeOffset = parseInt(offset || '0');
      const validLimit = isNaN(safeLimit) || safeLimit < 1 ? 500 : Math.min(safeLimit, 1000);
      const validOffset = isNaN(safeOffset) || safeOffset < 0 ? 0 : safeOffset;

      const graphStore = deps.graphStore as any;
      await graphStore.ensureInitialized?.();

      if (!graphStore.db) {
        res.json({ success: true, data: [], total: 0 });
        return;
      }

      let sql = 'SELECT * FROM graph_edges';
      const params: string[] = [];
      const conditions: string[] = [];

      if (sourceId) {
        conditions.push('sourceId = ?');
        params.push(sourceId);
      }
      if (targetId) {
        conditions.push('targetId = ?');
        params.push(targetId);
      }
      if (relation) {
        conditions.push('relation LIKE ?');
        params.push(`%${relation}%`);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      // Get total count first
      const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as cnt');
      const countResult = graphStore.db.prepare(countSql).get(...params);
      const total = countResult?.cnt ?? 0;

      // Add pagination and ordering
      sql += ` ORDER BY createdAt DESC LIMIT ${validLimit} OFFSET ${validOffset}`;
      const rows: any[] = graphStore.db.prepare(sql).all(...params);

      const edges: GraphEdgeRecord[] = rows.map((row: any) => ({
        id: row.id,
        sourceId: row.sourceId,
        targetId: row.targetId,
        relation: row.relation,
        weight: row.weight,
        createdAt: row.createdAt,
        ...(row.temporalStart ? { temporal: { start: row.temporalStart, end: row.temporalEnd } } : {}),
      }));

      res.json({
        success: true,
        data: edges,
        total,
        limit: validLimit,
        offset: validOffset,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get graph edges',
      });
    }
  });

  /**
   * GET /api/graph/stats
   * 图谱统计信息
   */
  router.get('/stats', async (req: Request, res: Response) => {
    try {
      const stats = await deps.graphStore.getStats();
      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get graph stats',
      });
    }
  });

  /**
   * GET /api/graph/related/:memoryId
   * 获取与某记忆相关的记忆
   */
  router.get('/related/:memoryId', async (req: Request, res: Response) => {
    try {
      const { memoryId } = req.params;
      const limit = parseInt((req.query['limit'] as string) || '10');
      const related = await deps.graphStore.findRelated(memoryId, limit);
      res.json({
        success: true,
        data: related,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get related memories',
      });
    }
  });

  return router;
}