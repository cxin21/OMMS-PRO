/**
 * Dreaming Tools - Dreaming 工具（2 个）
 *
 * - dreaming_trigger: 触发 Dreaming（记忆整合）
 * - dreaming_status: 获取 Dreaming 状态
 */

import type { MCPTool, ToolMetadata } from '../types';
import type { DreamingManager } from '../../../services/dreaming/dreaming-manager';

function notAvailable(res: { content: any[]; isError: boolean }) {
  res.content = [{ type: 'text', text: 'Dreaming 引擎未初始化，请检查系统配置' }];
  res.isError = true;
}

export function createDreamingTools(dreamingManager: DreamingManager | null): Array<{ tool: MCPTool; metadata: ToolMetadata }> {
  return [
    {
      tool: {
        name: 'dreaming_trigger',
        description: '触发 Dreaming 过程，进行记忆整合、归档和图谱重构',
        inputSchema: {
          type: 'object',
          properties: {
            source: { type: 'string', description: '触发源', enum: ['manual', 'scheduled', 'threshold'], default: 'manual' },
            force: { type: 'boolean', description: '是否强制执行（忽略阈值条件）', default: false },
          },
        },
        handler: async (params) => {
          const result = { content: [] as any[], isError: false };

          if (!dreamingManager) {
            notAvailable(result);
            return result;
          }

          try {
            const report = await dreamingManager.dream();

            result.content = [{
              type: 'text',
              text: `Dreaming 完成！\n` +
                `- 报告 ID：${report.id}\n` +
                `- 状态：${report.status}\n` +
                `- 合并记忆：${report.memoriesMerged}\n` +
                `- 归档记忆：${report.memoriesArchived}\n` +
                `- 删除记忆：${report.memoriesDeleted}\n` +
                `- 重建关联：${report.relationsRebuilt}\n` +
                `- 耗时：${report.totalDuration}ms`,
            }];
          } catch (error: any) {
            result.content = [{ type: 'text', text: `Dreaming 执行失败：${error.message}` }];
            result.isError = true;
          }

          return result;
        },
      },
      metadata: { category: 'dreaming', version: '2.0.0' },
    },

    {
      tool: {
        name: 'dreaming_status',
        description: '获取 Dreaming 的当前状态和历史统计',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: async () => {
          const result = { content: [] as any[], isError: false };

          if (!dreamingManager) {
            notAvailable(result);
            return result;
          }

          try {
            const [stats, metrics] = await Promise.all([
              dreamingManager.getStats(),
              dreamingManager.getFragmentationMetrics(),
            ]);

            result.content = [{
              type: 'text',
              text: `Dreaming 状态：\n\n` +
                `整理历史：\n` +
                `- 总整理次数：${stats.totalReports}\n` +
                `- 最后整理时间：${stats.lastReportAt ? new Date(stats.lastReportAt).toLocaleString() : '从未'}\n` +
                `- 平均耗时：${stats.avgDuration.toFixed(0)}ms\n\n` +
                `碎片化指标：\n` +
                `- 宫殿碎片率：${(metrics.palaceFragmentation * 100).toFixed(1)}%\n` +
                `- 图谱边密度：${(metrics.graphEdgeDensity * 100).toFixed(1)}%\n` +
                `- 孤儿记忆数：${metrics.orphanedMemories}\n` +
                `- 陈旧记忆数：${metrics.staleMemories}\n` +
                `- 上次碎片整理：${metrics.lastDefragmentationAt ? new Date(metrics.lastDefragmentationAt).toLocaleString() : '从未'}`,
            }];
          } catch (error: any) {
            result.content = [{ type: 'text', text: `获取 Dreaming 状态失败：${error.message}` }];
            result.isError = true;
          }

          return result;
        },
      },
      metadata: { category: 'dreaming', version: '2.0.0' },
    },
  ];
}
