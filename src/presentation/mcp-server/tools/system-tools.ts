/**
 * System Tools - 系统工具（3 个）
 *
 * - system_stats: 系统统计信息
 * - system_health: 系统健康检查
 * - system_config: 读取系统配置
 */

import { createLogger } from '../../../shared/logging';
import type { MCPTool, ToolMetadata } from '../types';
import type { StorageMemoryService } from '../../../services/memory/core/storage-memory-service';
import type { DreamingManager } from '../../../services/dreaming/dreaming-manager';
import { config } from '../../../shared/config';

const logger = createLogger('mcp-system-tools');

export function createSystemTools(
  memoryService: StorageMemoryService,
  dreamingManager: DreamingManager | null
): Array<{ tool: MCPTool; metadata: ToolMetadata }> {
  return [
    {
      tool: {
        name: 'system_stats',
        description: '获取系统完整统计信息',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: async () => {
          try {
            const [memStats, dreamStats] = await Promise.all([
              memoryService.getDegradationStats(),
              dreamingManager ? dreamingManager.getStats() : Promise.resolve(null),
            ]);

            const dreamingSection = dreamStats
              ? `\nDreaming 统计：\n` +
                `- 总整理次数：${dreamStats.totalReports}\n` +
                `- 最后整理：${dreamStats.lastReportAt ? new Date(dreamStats.lastReportAt).toLocaleString() : '从未'}\n` +
                `- 平均耗时：${dreamStats.avgDuration.toFixed(0)}ms`
              : '\nDreaming：未初始化';

            return {
              content: [{
                type: 'text',
                text: `系统统计信息：\n\n` +
                  `记忆统计：\n` +
                  `- 总记忆数：${memStats.totalMemories}\n` +
                  `- 已归档：${memStats.archivedMemories}\n` +
                  `- 已删除：${memStats.deletedMemories}\n` +
                  `- 作用域分布：SESSION=${memStats.scopeDistribution.session}, AGENT=${memStats.scopeDistribution.agent}, GLOBAL=${memStats.scopeDistribution.global}\n` +
                  `- 平均重要性：${memStats.avgImportance.toFixed(2)}` +
                  dreamingSection,
              }],
            };
          } catch (error: any) {
            logger.error('system_stats failed', error);
            return {
              content: [{ type: 'text', text: `获取统计失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'system', version: '2.0.0' },
    },

    {
      tool: {
        name: 'system_health',
        description: '检查系统各组件的健康状态',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: async () => {
          const checks: { name: string; status: 'healthy' | 'degraded' | 'error'; detail?: string }[] = [];

          // 检查 MemoryService
          try {
            await memoryService.getDegradationStats();
            checks.push({ name: 'memory-service', status: 'healthy' });
          } catch (e: any) {
            checks.push({ name: 'memory-service', status: 'error', detail: e.message });
          }

          // 检查 ConfigManager
          try {
            const isInit = config.isInitialized();
            checks.push({ name: 'config', status: isInit ? 'healthy' : 'degraded', detail: isInit ? undefined : '未初始化' });
          } catch (e: any) {
            checks.push({ name: 'config', status: 'error', detail: e.message });
          }

          // 检查 DreamingEngine
          if (dreamingManager) {
            try {
              await dreamingManager.getStats();
              checks.push({ name: 'dreaming-engine', status: 'healthy' });
            } catch (e: any) {
              checks.push({ name: 'dreaming-engine', status: 'error', detail: e.message });
            }
          } else {
            checks.push({ name: 'dreaming-engine', status: 'degraded', detail: '未初始化（功能不可用）' });
          }

          const hasError = checks.some(c => c.status === 'error');
          const hasDegraded = checks.some(c => c.status === 'degraded');
          const overall = hasError ? '❌ 异常' : hasDegraded ? '⚠️ 降级' : '✅ 健康';

          return {
            content: [{
              type: 'text',
              text: `系统健康状态：${overall}\n\n` +
                checks.map(c => {
                  const icon = c.status === 'healthy' ? '✅' : c.status === 'degraded' ? '⚠️' : '❌';
                  return `${icon} ${c.name}: ${c.status}${c.detail ? ` - ${c.detail}` : ''}`;
                }).join('\n'),
            }],
          };
        },
      },
      metadata: { category: 'system', version: '2.0.0' },
    },

    {
      tool: {
        name: 'system_config',
        description: '读取系统配置信息',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', description: '操作类型', enum: ['get', 'set'], default: 'get' },
            key: { type: 'string', description: '配置键（如 embedding.model、capture.confidenceThreshold）' },
            value: { type: 'string', description: '配置值（set 操作时必需，配置更改需重启生效）' },
          },
        },
        handler: async (params) => {
          if (params.action === 'set') {
            return {
              content: [{
                type: 'text',
                text: `配置说明：\n配置项 ${params.key ?? '(未指定)'} 的更改需要通过修改配置文件并重启服务生效。\n当前不支持热更新配置。`,
              }],
            };
          }

          // get 操作
          try {
            if (!config.isInitialized()) {
              return {
                content: [{ type: 'text', text: 'ConfigManager 未初始化' }],
                isError: true,
              };
            }

            if (params.key) {
              const value = config.getConfig(params.key);
              return {
                content: [{
                  type: 'text',
                  text: `配置 ${params.key}：\n${JSON.stringify(value, null, 2)}`,
                }],
              };
            }

            // 返回常用配置摘要（不包含敏感的 API Key）
            const summaryKeys = ['embedding.model', 'embedding.dimensions', 'capture.confidenceThreshold', 'dreamingEngine.scheduler.autoOrganize'];
            const summary: Record<string, any> = {};

            for (const key of summaryKeys) {
              try {
                summary[key] = config.getConfig(key);
              } catch {
                summary[key] = '(未配置)';
              }
            }

            return {
              content: [{
                type: 'text',
                text: `系统配置摘要：\n${JSON.stringify(summary, null, 2)}\n\n提示：传入 key 参数可查询具体配置项`,
              }],
            };
          } catch (error: any) {
            logger.error('system_config failed', error);
            return {
              content: [{ type: 'text', text: `读取配置失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'system', version: '2.0.0' },
    },
  ];
}
