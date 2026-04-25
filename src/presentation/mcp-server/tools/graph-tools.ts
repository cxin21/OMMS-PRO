/**
 * Graph Tools - 知识图谱工具（4 个）
 *
 * - graph_query_entity: 查询实体信息和关联记忆
 * - graph_get_relations: 获取实体的边/关系
 * - graph_find_tunnels: 发现跨 Wing 的 Tunnels
 * - graph_get_timeline: 获取时间线关系
 */

import { createLogger } from '../../../shared/logging';
import type { MCPTool, ToolMetadata } from '../types';
import type { GraphStore } from '../../../infrastructure/storage/stores/graph-store';

const logger = createLogger('mcp-graph-tools');

export function createGraphTools(graphStore: GraphStore): Array<{ tool: MCPTool; metadata: ToolMetadata }> {
  return [
    {
      tool: {
        name: 'graph_query_entity',
        description: '查询知识图谱中的实体信息及其关联记忆',
        inputSchema: {
          type: 'object',
          properties: {
            entityId: { type: 'string', description: '实体名称或 ID' },
          },
          required: ['entityId'],
        },
        handler: async (params) => {
          try {
            const entity = await graphStore.getEntity(params.entityId);
            const related = await graphStore.findRelated(params.entityId, 10);

            if (!entity) {
              return {
                content: [{ type: 'text', text: `实体未找到：${params.entityId}` }],
                isError: true,
              };
            }

            return {
              content: [{
                type: 'text',
                text: `实体信息：\n` +
                  `- 名称：${entity.entity}\n` +
                  `- 类型：${entity.type}\n` +
                  `- 关联记忆数：${entity.memoryIds.length}\n` +
                  `- 记忆 UIDs：${entity.memoryIds.join(', ')}\n\n` +
                  (related.length > 0
                    ? `相关实体（${related.length} 个）：\n` +
                      related.map(r => `- ${r.uid}（${r.relation}，权重 ${r.weight.toFixed(2)}）`).join('\n')
                    : '暂无相关实体'),
              }],
            };
          } catch (error: any) {
            logger.error('graph_query_entity failed', error);
            return {
              content: [{ type: 'text', text: `查询实体失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'graph', version: '2.0.0' },
    },

    {
      tool: {
        name: 'graph_get_relations',
        description: '获取实体节点的所有边/关系',
        inputSchema: {
          type: 'object',
          properties: {
            entityId: { type: 'string', description: '实体名称' },
            direction: { type: 'string', description: '关系方向', enum: ['in', 'out', 'both'], default: 'both' },
          },
          required: ['entityId'],
        },
        handler: async (params) => {
          try {
            // 先获取实体节点 ID
            const entity = await graphStore.getEntity(params.entityId);
            if (!entity) {
              return {
                content: [{ type: 'text', text: `实体未找到：${params.entityId}` }],
                isError: true,
              };
            }

            const edges = await graphStore.getNodeEdges(entity.id);
            const direction = params.direction ?? 'both';

            // 按方向过滤
            const filtered = edges.filter(edge => {
              if (direction === 'out') return edge.sourceId === entity.id;
              if (direction === 'in') return edge.targetId === entity.id;
              return true;
            });

            if (filtered.length === 0) {
              return {
                content: [{ type: 'text', text: `实体 ${params.entityId} 没有${direction === 'in' ? '入' : direction === 'out' ? '出' : '任何'}边关系` }],
              };
            }

            return {
              content: [{
                type: 'text',
                text: `实体 ${params.entityId} 的关系（${filtered.length} 条，方向=${direction}）：\n\n` +
                  filtered.map(e =>
                    `- ${e.sourceId} --[${e.relation}]--> ${e.targetId}（权重 ${e.weight.toFixed(2)}）`
                  ).join('\n'),
              }],
            };
          } catch (error: any) {
            logger.error('graph_get_relations failed', error);
            return {
              content: [{ type: 'text', text: `获取关系失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'graph', version: '2.0.0' },
    },

    {
      tool: {
        name: 'graph_find_tunnels',
        description: '发现连接不同 Wings 的 Tunnels（实体在多个 Wing 中都有记忆）',
        inputSchema: {
          type: 'object',
          properties: {
            roomName: { type: 'string', description: '实体名称或关键词' },
            limit: { type: 'number', description: '返回数量', default: 10 },
          },
          required: ['roomName'],
        },
        handler: async (params) => {
          try {
            // 查询包含该实体的记忆 UIDs
            const memoryIds = await graphStore.queryByEntity(params.roomName);
            const limit = params.limit ?? 10;

            if (memoryIds.length === 0) {
              return {
                content: [{ type: 'text', text: `未找到实体 ${params.roomName} 关联的记忆` }],
              };
            }

            const stats = await graphStore.getStats();

            return {
              content: [{
                type: 'text',
                text: `实体 "${params.roomName}" 的 Tunnel 信息：\n` +
                  `- 关联记忆数：${memoryIds.length}\n` +
                  `- 图谱节点总数：${stats.nodeCount}\n` +
                  `- 图谱边总数：${stats.edgeCount}\n\n` +
                  `关联记忆 UIDs（前 ${Math.min(limit, memoryIds.length)} 个）：\n` +
                  memoryIds.slice(0, limit).map(id => `- ${id}`).join('\n'),
              }],
            };
          } catch (error: any) {
            logger.error('graph_find_tunnels failed', error);
            return {
              content: [{ type: 'text', text: `发现 Tunnels 失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'graph', version: '2.0.0' },
    },

    {
      tool: {
        name: 'graph_get_timeline',
        description: '获取图谱中的时间线关系',
        inputSchema: {
          type: 'object',
          properties: {
            entityId: { type: 'string', description: '实体名称（可选，不填则获取全局时间线）' },
            limit: { type: 'number', description: '返回数量', default: 20 },
          },
        },
        handler: async (params) => {
          try {
            const limit = params.limit ?? 20;

            // 查询 temporal 类型的关系
            const temporalEdges = await graphStore.queryByRelation('temporal', limit);

            if (temporalEdges.length === 0) {
              // 如果没有 temporal 关系，返回最近的边
              const recentEdges = await graphStore.queryByRelation('related', limit);
              return {
                content: [{
                  type: 'text',
                  text: recentEdges.length === 0
                    ? '图谱中暂无时间线关系'
                    : `最近关系（共 ${recentEdges.length} 条）：\n\n` +
                      recentEdges.map(e =>
                        `- ${e.sourceId} --[${e.relation}]--> ${e.targetId}（权重 ${e.weight.toFixed(2)}）`
                      ).join('\n'),
                }],
              };
            }

            // 如果指定了实体，过滤相关边
            const edges = params.entityId
              ? temporalEdges.filter(e =>
                  e.sourceId.includes(params.entityId) || e.targetId.includes(params.entityId))
              : temporalEdges;

            return {
              content: [{
                type: 'text',
                text: `时间线关系（${edges.length} 条）：\n\n` +
                  edges.map(e => {
                    const timeInfo = e.temporal
                      ? ` [${new Date(e.temporal.start).toLocaleDateString()} → ${e.temporal.end ? new Date(e.temporal.end).toLocaleDateString() : '至今'}]`
                      : '';
                    return `- ${e.sourceId} --[${e.relation}]--> ${e.targetId}${timeInfo}`;
                  }).join('\n'),
              }],
            };
          } catch (error: any) {
            logger.error('graph_get_timeline failed', error);
            return {
              content: [{ type: 'text', text: `获取时间线失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'graph', version: '2.0.0' },
    },
  ];
}
