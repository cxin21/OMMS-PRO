/**
 * Palace Tools - 宫殿管理工具（6 个）
 *
 * - palace_list_wings: 列出所有 Wings
 * - palace_create_wing: 获取 Wing 信息（Palace 自动创建，此工具展示结构）
 * - palace_list_rooms: 列出 Wing 内的 Rooms
 * - palace_get_taxonomy: 获取完整宫殿分类树
 * - palace_status: 宫殿统计状态
 * - palace_navigate: 导航到指定路径获取记忆内容
 */

import type { MCPTool, ToolMetadata } from '../types';
import type { PalaceStore } from '../../../infrastructure/storage/stores/palace-store';
import { PalaceStore as PalaceStoreClass } from '../../../infrastructure/storage/stores/palace-store';

interface PalaceTaxonomy {
  [wingId: string]: {
    halls: {
      [hallId: string]: {
        rooms: Set<string>;
      };
    };
    count: number;
  };
}

function buildTaxonomy(palaceRefs: string[]): PalaceTaxonomy {
  const taxonomy: PalaceTaxonomy = {};

  for (const ref of palaceRefs) {
    const parsed = PalaceStoreClass.parsePalaceRef(ref);
    if (!parsed) continue;

    const { wingId, hallId, roomId } = parsed.location;

    if (!taxonomy[wingId]) {
      taxonomy[wingId] = { halls: {}, count: 0 };
    }
    if (!taxonomy[wingId].halls[hallId]) {
      taxonomy[wingId].halls[hallId] = { rooms: new Set() };
    }
    taxonomy[wingId].halls[hallId].rooms.add(roomId);
    taxonomy[wingId].count++;
  }

  return taxonomy;
}

export function createPalaceTools(palaceStore: PalaceStore): Array<{ tool: MCPTool; metadata: ToolMetadata }> {
  return [
    {
      tool: {
        name: 'palace_list_wings',
        description: '列出所有记忆宫殿的 Wings（按记忆类型/Agent 组织的顶层区域）',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: async () => {
          try {
            const refs = await palaceStore.getAllPalaceRefs();
            const taxonomy = buildTaxonomy(refs);

            const wings = Object.entries(taxonomy).map(([wingId, info]) => ({
              wingId,
              hallCount: Object.keys(info.halls).length,
              memoryCount: info.count,
              halls: Object.keys(info.halls),
            }));

            return {
              content: [{
                type: 'text',
                text: wings.length === 0
                  ? '宫殿为空，尚无任何 Wing'
                  : `记忆宫殿 Wings（共 ${wings.length} 个）：\n\n` +
                    wings.map(w => `- ${w.wingId}：${w.memoryCount} 条记忆，${w.hallCount} 个 Hall（${w.halls.join(', ')}）`).join('\n'),
              }],
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `获取 Wings 失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'palace', version: '2.0.0' },
    },

    {
      tool: {
        name: 'palace_create_wing',
        description: '查看记忆宫殿结构（Palace 按记忆类型自动创建 Wing，此工具展示当前结构及说明）',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Wing 名称（查询用）' },
            type: { type: 'string', description: 'Wing 类型', enum: ['person', 'project', 'session', 'general'] },
            description: { type: 'string', description: 'Wing 描述' },
          },
          required: ['name', 'type'],
        },
        handler: async (params) => {
          try {
            const refs = await palaceStore.getAllPalaceRefs();
            const taxonomy = buildTaxonomy(refs);

            // 查找是否存在匹配的 wing
            const matchingWings = Object.keys(taxonomy).filter(w =>
              w.toLowerCase().includes(params.name.toLowerCase()) ||
              w.toLowerCase().includes(params.type.toLowerCase())
            );

            const existingInfo = matchingWings.length > 0
              ? `\n\n找到匹配的 Wings：\n${matchingWings.map(w => `- ${w}：${taxonomy[w].count} 条记忆`).join('\n')}`
              : '\n\n未找到匹配的 Wing。';

            return {
              content: [{
                type: 'text',
                text: `记忆宫殿说明：\n` +
                  `Wing 由系统根据 agentId 和记忆类型自动创建，格式为：\n` +
                  `- session_xxx：会话级记忆\n` +
                  `- agent_xxx：Agent 级记忆\n` +
                  `- global：全局记忆\n\n` +
                  `当前宫殿共有 ${Object.keys(taxonomy).length} 个 Wing` +
                  existingInfo,
              }],
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `查询 Wing 失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'palace', version: '2.0.0' },
    },

    {
      tool: {
        name: 'palace_list_rooms',
        description: '列出指定 Wing（和可选 Hall）内的所有 Rooms',
        inputSchema: {
          type: 'object',
          properties: {
            wingId: { type: 'string', description: 'Wing ID' },
            hallId: { type: 'string', description: 'Hall ID（可选过滤）' },
          },
          required: ['wingId'],
        },
        handler: async (params) => {
          try {
            const refs = await palaceStore.getAllPalaceRefs();
            const taxonomy = buildTaxonomy(refs);

            const wingData = taxonomy[params.wingId];
            if (!wingData) {
              return {
                content: [{ type: 'text', text: `Wing 不存在：${params.wingId}` }],
                isError: true,
              };
            }

            const halls = params.hallId
              ? (wingData.halls[params.hallId] ? { [params.hallId]: wingData.halls[params.hallId] } : {})
              : wingData.halls;

            const lines = Object.entries(halls).flatMap(([hallId, hallData]) =>
              Array.from(hallData.rooms).map(roomId => `  - ${params.wingId}/${hallId}/${roomId}`)
            );

            return {
              content: [{
                type: 'text',
                text: lines.length === 0
                  ? `Wing ${params.wingId} 中未找到 Rooms`
                  : `Wing ${params.wingId} 的 Rooms（共 ${lines.length} 个）：\n${lines.join('\n')}`,
              }],
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `列出 Rooms 失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'palace', version: '2.0.0' },
    },

    {
      tool: {
        name: 'palace_get_taxonomy',
        description: '获取整个记忆宫殿的完整分类树（Wing → Hall → Room）',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: async () => {
          try {
            const refs = await palaceStore.getAllPalaceRefs();
            const taxonomy = buildTaxonomy(refs);

            if (Object.keys(taxonomy).length === 0) {
              return {
                content: [{ type: 'text', text: '宫殿为空，尚无任何分类结构' }],
              };
            }

            const lines: string[] = ['记忆宫殿分类树：', ''];
            for (const [wingId, wingData] of Object.entries(taxonomy)) {
              lines.push(`📁 Wing: ${wingId} (${wingData.count} 条记忆)`);
              for (const [hallId, hallData] of Object.entries(wingData.halls)) {
                lines.push(`  📂 Hall: ${hallId}`);
                for (const roomId of hallData.rooms) {
                  lines.push(`    🗃️ Room: ${roomId}`);
                }
              }
            }

            return {
              content: [{ type: 'text', text: lines.join('\n') }],
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `获取分类树失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'palace', version: '2.0.0' },
    },

    {
      tool: {
        name: 'palace_status',
        description: '获取记忆宫殿的存储状态统计',
        inputSchema: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'Agent ID（可选，过滤特定 agent 的统计）' },
          },
        },
        handler: async (params) => {
          try {
            const stats = await palaceStore.getStats();
            const refs = await palaceStore.getAllPalaceRefs();
            const taxonomy = buildTaxonomy(refs);

            const wingCount = Object.keys(taxonomy).length;
            const hallCount = Object.values(taxonomy).reduce((sum, w) => sum + Object.keys(w.halls).length, 0);
            const roomCount = Object.values(taxonomy).reduce((sum, w) =>
              sum + Object.values(w.halls).reduce((s, h) => s + h.rooms.size, 0), 0);

            // 如果指定了 agentId，过滤相关 wings
            let agentInfo = '';
            if (params.agentId) {
              const agentRefs = refs.filter(r => r.startsWith(params.agentId));
              agentInfo = `\n\nAgent ${params.agentId} 专属：${agentRefs.length} 条记忆`;
            }

            return {
              content: [{
                type: 'text',
                text: `记忆宫殿状态：\n` +
                  `- 总文件数：${stats.count}\n` +
                  `- 总大小：${(stats.totalSize / 1024).toFixed(1)} KB\n` +
                  `- Wings：${wingCount}\n` +
                  `- Halls：${hallCount}\n` +
                  `- Rooms：${roomCount}` +
                  agentInfo,
              }],
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `获取宫殿状态失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'palace', version: '2.0.0' },
    },

    {
      tool: {
        name: 'palace_navigate',
        description: '导航到指定宫殿路径，获取该路径下的记忆内容',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '宫殿路径（完整 palaceRef：wingId/hallId/roomId/closet_uid_vN，或目录路径）' },
          },
          required: ['path'],
        },
        handler: async (params) => {
          try {
            // 尝试直接读取（完整 palaceRef）
            const content = await palaceStore.retrieve(params.path);

            if (content !== null) {
              return {
                content: [{
                  type: 'text',
                  text: `宫殿路径内容 [${params.path}]：\n\n${content}`,
                }],
              };
            }

            // 如果不是完整路径，列出该路径下的所有记忆
            const refs = await palaceStore.getAllPalaceRefs();
            const matchingRefs = refs.filter(r => r.startsWith(params.path));

            if (matchingRefs.length === 0) {
              return {
                content: [{ type: 'text', text: `路径不存在：${params.path}` }],
                isError: true,
              };
            }

            return {
              content: [{
                type: 'text',
                text: `路径 ${params.path} 下有 ${matchingRefs.length} 条记忆：\n\n` +
                  matchingRefs.map(r => `- ${r}`).join('\n'),
              }],
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `导航失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'palace', version: '2.0.0' },
    },
  ];
}
