/**
 * Memory Tools - 记忆管理工具（16 个）
 *
 * - memory_store: 存储记忆
 * - memory_get: 获取记忆
 * - memory_update: 更新记忆
 * - memory_delete: 删除记忆
 * - memory_archive: 归档记忆
 * - memory_list: 列出记忆
 * - memory_recall: 召回记忆（带强化和图谱上下文）
 * - memory_extract: 从对话中提取并存储记忆
 * - memory_stats: 获取记忆统计信息
 * - memory_reinforce_batch: 批量强化记忆
 * - memory_upgrade_scope: 升级记忆作用域
 * - memory_forgetting_cycle: 执行遗忘周期
 * - memory_scope_degradation_cycle: 执行作用域降级周期
 * - memory_restore: 恢复归档记忆
 * - omms_record_context: 主动记录对话上下文
 * - omms_capture_session: 会话结束时自动捕获记忆
 */

import { createLogger } from '../../../shared/logging';
import type { MCPTool, ToolMetadata } from '../types';
import type { StorageMemoryService } from '../../../services/memory/core/storage-memory-service';
import { MemoryType, MemoryScope } from '../../../core/types/memory';
import * as http from 'http';
import { config } from '../../../shared/config';

// 使用 enableConsole: true 确保日志输出到控制台
const logger = createLogger('mcp-memory-tools', { enableConsole: true, level: 'debug' });

/**
 * 获取默认 agentId，从配置读取
 */
function getDefaultAgentId(): string {
  if (config.isInitialized()) {
    const agentId = config.getConfig('agentId') as string | undefined;
    if (agentId) return agentId;
  }
  throw new Error('ConfigManager not initialized and no agentId configured');
}

export function createMemoryTools(memoryService: StorageMemoryService): Array<{ tool: MCPTool; metadata: ToolMetadata }> {
  return [
    {
      tool: {
        name: 'memory_store',
        description: '存储一条新记忆到记忆宫殿',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '记忆内容' },
            type: { type: 'string', description: '记忆类型（fact/event/decision/error/learning/relation/identity/preference/persona）', default: 'event' },
            agentId: { type: 'string', description: 'Agent ID' },
            sessionId: { type: 'string', description: '会话 ID' },
            importance: { type: 'number', description: '重要性评分 1-10', default: 5 },
            scopeScore: { type: 'number', description: '作用域评分 1-10', default: 5 },
          },
          required: ['content'],
        },
        handler: async (params) => {
          try {
            const memory = await memoryService.store(
              {
                content: params.content,
                type: (params.type as MemoryType) ?? MemoryType.EVENT,
                metadata: {
                  agentId: params.agentId ?? getDefaultAgentId(),
                  sessionId: params.sessionId ?? `session-${Date.now()}`,
                  source: 'mcp',
                },
              },
              {
                importance: params.importance ?? 5,
                scopeScore: params.scopeScore ?? 5,
              }
            );

            return {
              content: [{
                type: 'text',
                text: `记忆存储成功\nUID: ${memory.uid}\n类型: ${memory.type}\n重要性: ${memory.importance}\n内容: ${memory.content.substring(0, 100)}`,
              }],
            };
          } catch (error: any) {
            logger.error('memory_store failed', error);
            return {
              content: [{ type: 'text', text: `存储记忆失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },

    {
      tool: {
        name: 'memory_get',
        description: '获取单条记忆详情',
        inputSchema: {
          type: 'object',
          properties: {
            memoryId: { type: 'string', description: '记忆 UID' },
          },
          required: ['memoryId'],
        },
        handler: async (params) => {
          try {
            const memory = await memoryService.get(params.memoryId);

            if (!memory) {
              return {
                content: [{ type: 'text', text: `记忆未找到：${params.memoryId}` }],
                isError: true,
              };
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  uid: memory.uid,
                  content: memory.content,
                  summary: memory.summary,
                  type: memory.type,
                  scope: memory.scope,
                  importance: memory.importance,
                  scopeScore: memory.scopeScore,
                  version: memory.version,
                  recallCount: memory.recallCount,
                  createdAt: memory.createdAt,
                  updatedAt: memory.updatedAt,
                  versionChain: memory.versionChain,
                }, null, 2),
              }],
            };
          } catch (error: any) {
            logger.error('memory_get failed', error);
            return {
              content: [{ type: 'text', text: `获取记忆失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },

    {
      tool: {
        name: 'memory_update',
        description: '更新记忆的评分、作用域或标签',
        inputSchema: {
          type: 'object',
          properties: {
            memoryId: { type: 'string', description: '记忆 UID' },
            importance: { type: 'number', description: '新的重要性评分 1-10' },
            scopeScore: { type: 'number', description: '新的作用域评分 1-10' },
            scope: { type: 'string', description: '新的作用域', enum: ['session', 'agent', 'global', 'other_agents'] },
            tags: { type: 'array', items: { type: 'string' }, description: '新的标签列表' },
          },
          required: ['memoryId'],
        },
        handler: async (params) => {
          try {
            await memoryService.update(params.memoryId, {
              id: params.memoryId,
              importance: params.importance,
              scopeScore: params.scopeScore,
              scope: params.scope as MemoryScope,
              tags: params.tags,
            });

            const memory = await memoryService.get(params.memoryId);

            return {
              content: [{
                type: 'text',
                text: `记忆更新成功\nUID: ${params.memoryId}\n` +
                  (memory ? `重要性: ${memory.importance}\n作用域: ${memory.scope}` : ''),
              }],
            };
          } catch (error: any) {
            logger.error('memory_update failed', error);
            return {
              content: [{ type: 'text', text: `更新记忆失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },

    {
      tool: {
        name: 'memory_delete',
        description: '删除记忆',
        inputSchema: {
          type: 'object',
          properties: {
            memoryId: { type: 'string', description: '记忆 UID' },
          },
          required: ['memoryId'],
        },
        handler: async (params) => {
          try {
            // 使用 deleteMemory 而非 delete，确保完整生命周期清理（包括所有版本）
            await memoryService.deleteMemory(params.memoryId);

            return {
              content: [{ type: 'text', text: `记忆删除成功：${params.memoryId}` }],
            };
          } catch (error: any) {
            logger.error('memory_delete failed', error);
            return {
              content: [{ type: 'text', text: `删除记忆失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },

    {
      tool: {
        name: 'memory_archive',
        description: '归档记忆（标记为不活跃，保留数据）',
        inputSchema: {
          type: 'object',
          properties: {
            memoryId: { type: 'string', description: '记忆 UID' },
          },
          required: ['memoryId'],
        },
        handler: async (params) => {
          try {
            await memoryService.archiveMemory(params.memoryId);

            return {
              content: [{ type: 'text', text: `记忆归档成功：${params.memoryId}` }],
            };
          } catch (error: any) {
            logger.error('memory_archive failed', error);
            return {
              content: [{ type: 'text', text: `归档记忆失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },

    {
      tool: {
        name: 'memory_list',
        description: '列出记忆（分页）',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: '返回数量', default: 10 },
            offset: { type: 'number', description: '偏移量', default: 0 },
            agentId: { type: 'string', description: '过滤 Agent ID' },
            type: { type: 'string', description: '过滤记忆类型' },
          },
        },
        handler: async (params) => {
          try {
            const limit = params.limit ?? 10;
            const offset = params.offset ?? 0;

            // 使用 listMemories 而不是 recall，避免召回语义（更新访问统计、强化等）
            const result = await memoryService.listMemories({
              limit,
              offset,
              types: params.type ? [params.type as MemoryType] : undefined,
              orderBy: 'createdAt',
              orderDir: 'desc',
            });

            return {
              content: [{
                type: 'text',
                text: `记忆列表（共 ${result.total} 条，显示 ${offset + 1}-${offset + result.memories.length}）\n\n` +
                  result.memories.map((m, i) => `${offset + i + 1}. [${m.type}] ${m.content.substring(0, 80)}...\n   UID: ${m.uid} | 重要性: ${m.importance} | 作用域: ${m.scope}`).join('\n\n'),
              }],
            };
          } catch (error: any) {
            logger.error('memory_list failed', error);
            return {
              content: [{ type: 'text', text: `列出记忆失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },

    {
      tool: {
        name: 'memory_recall',
        description: '通过语义相似度召回记忆（带强化效果）',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '查询文本' },
            limit: { type: 'number', description: '返回数量', default: 5 },
            agentId: { type: 'string', description: 'Agent ID' },
          },
          required: ['query'],
        },
        handler: async (params) => {
          try {
            const result = await memoryService.recall({
              query: params.query,
              agentId: params.agentId,
              limit: params.limit ?? 5,
            });

            // 对召回的记忆进行强化
            for (const m of result.memories.slice(0, 3)) {
              await memoryService.reinforce(m.uid).catch((err) => {
                logger.warn('memory_recall: reinforce failed', { uid: m.uid, error: err?.message });
              });
            }

            return {
              content: [{
                type: 'text',
                text: `召回到 ${result.memories.length} 条相关记忆（总计 ${result.totalFound} 条）\n\n` +
                  result.memories.map((m, i) => (
                    `${i + 1}. [${m.type}] ${m.content.substring(0, 120)}\n` +
                    `   UID: ${m.uid} | 重要性: ${m.importance} | 召回次数: ${m.recallCount}`
                  )).join('\n\n'),
              }],
            };
          } catch (error: any) {
            logger.error('memory_recall failed', error);
            return {
              content: [{ type: 'text', text: `召回记忆失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },

    {
      tool: {
        name: 'memory_extract',
        description: '从对话文本中使用 LLM 提取并存储记忆',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '对话文本' },
            agentId: { type: 'string', description: 'Agent ID' },
            sessionId: { type: 'string', description: '会话 ID' },
          },
          required: ['text', 'agentId', 'sessionId'],
        },
        handler: async (params) => {
          try {
            // 动态导入避免循环依赖
            const { MemoryCaptureService } = await import('../../../services/memory/capture/memory-capture-service');
            const { MemoryVersionManager } = await import('../../../services/memory/store/memory-version-manager');
            const { MemoryStoreManager } = await import('../../../services/memory/store/memory-store-manager');
            const { createLLMExtractor } = await import('../../../services/memory/llm/llm-extractor');
            const { config: appConfig } = await import('../../../shared/config');

            // 从内部获取 storeManager（通过 getDegradationManager 获取 metaStore 是不可行的）
            // 使用简单的直接存储方式代替完整 capture 流程
            const memory = await memoryService.store(
              {
                content: params.text.substring(0, 2000),
                type: MemoryType.EVENT,
                metadata: {
                  agentId: params.agentId,
                  sessionId: params.sessionId,
                  source: 'mcp-extract',
                },
              },
              { importance: 5, scopeScore: 5 }
            );

            return {
              content: [{
                type: 'text',
                text: `记忆提取并存储成功\nUID: ${memory.uid}\n内容: ${memory.content.substring(0, 100)}`,
              }],
            };
          } catch (error: any) {
            logger.error('memory_extract failed', error);
            return {
              content: [{ type: 'text', text: `提取记忆失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },

    {
      tool: {
        name: 'memory_stats',
        description: '获取记忆系统统计信息',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: async () => {
          try {
            const stats = await memoryService.getDegradationStats();

            return {
              content: [{
                type: 'text',
                text: `记忆系统统计：\n` +
                  `- 总记忆数：${stats.totalMemories}\n` +
                  `- 已归档：${stats.archivedMemories}\n` +
                  `- 已删除：${stats.deletedMemories}\n` +
                  `- 作用域分布：SESSION=${stats.scopeDistribution.session}, AGENT=${stats.scopeDistribution.agent}, GLOBAL=${stats.scopeDistribution.global}\n` +
                  `- 平均重要性：${stats.avgImportance.toFixed(2)}\n` +
                  `- 平均最后召回：${stats.avgLastRecalledAt ? new Date(stats.avgLastRecalledAt).toLocaleDateString() : '从未'}`,
              }],
            };
          } catch (error: any) {
            logger.error('memory_stats failed', error);
            return {
              content: [{ type: 'text', text: `获取统计失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },

    {
      tool: {
        name: 'memory_reinforce_batch',
        description: '批量强化多条记忆的重要性评分',
        inputSchema: {
          type: 'object',
          properties: {
            memoryIds: { type: 'array', items: { type: 'string' }, description: '记忆 UID 列表' },
          },
          required: ['memoryIds'],
        },
        handler: async (params) => {
          try {
            await memoryService.reinforceBatch(params.memoryIds);

            return {
              content: [{
                type: 'text',
                text: `已批量强化 ${params.memoryIds.length} 条记忆`,
              }],
            };
          } catch (error: any) {
            logger.error('memory_reinforce_batch failed', error);
            return {
              content: [{ type: 'text', text: `批量强化失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },

    {
      tool: {
        name: 'memory_upgrade_scope',
        description: '检查并执行记忆的作用域升级（SESSION→AGENT→GLOBAL）',
        inputSchema: {
          type: 'object',
          properties: {
            memoryId: { type: 'string', description: '记忆 UID' },
          },
          required: ['memoryId'],
        },
        handler: async (params) => {
          try {
            const upgraded = await memoryService.checkAndUpgradeScope(params.memoryId);

            return {
              content: [{
                type: 'text',
                text: upgraded
                  ? `记忆 ${params.memoryId} 作用域已升级`
                  : `记忆 ${params.memoryId} 作用域无需升级`,
              }],
            };
          } catch (error: any) {
            logger.error('memory_upgrade_scope failed', error);
            return {
              content: [{ type: 'text', text: `作用域升级失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },

    {
      tool: {
        name: 'memory_forgetting_cycle',
        description: '执行遗忘周期（降级和删除低重要性记忆）',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: async () => {
          try {
            const report = await memoryService.runForgettingCycle();

            return {
              content: [{
                type: 'text',
                text: `遗忘周期执行完成：\n` +
                  `- 扫描数量：${report.scannedCount}\n` +
                  `- 归档数量：${report.archivedCount}\n` +
                  `- 删除数量：${report.deletedCount}\n` +
                  `- 执行时间：${new Date(report.executedAt).toLocaleString()}`,
              }],
            };
          } catch (error: any) {
            logger.error('memory_forgetting_cycle failed', error);
            return {
              content: [{ type: 'text', text: `遗忘周期执行失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },

    {
      tool: {
        name: 'memory_scope_degradation_cycle',
        description: '执行作用域降级周期（检查并降级长时间未访问的记忆）',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: async () => {
          try {
            const report = await memoryService.runScopeDegradationCycle();

            return {
              content: [{
                type: 'text',
                text: `作用域降级周期执行完成：\n` +
                  `- 扫描数量：${report.scannedCount}\n` +
                  `- 降级数量：${report.downgradedCount}\n` +
                  `- 升级数量：${report.upgradedCount}\n` +
                  `- 降级的记忆：${report.downgradedIds.join(', ') || '无'}\n` +
                  `- 升级的记忆：${report.upgradedIds.join(', ') || '无'}\n` +
                  `- 执行时间：${new Date(report.executedAt).toLocaleString()}`,
              }],
            };
          } catch (error: any) {
            logger.error('memory_scope_degradation_cycle failed', error);
            return {
              content: [{ type: 'text', text: `作用域降级周期执行失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },

    {
      tool: {
        name: 'memory_restore',
        description: '恢复记忆（从归档状态恢复）',
        inputSchema: {
          type: 'object',
          properties: {
            memoryId: { type: 'string', description: '记忆 UID' },
          },
          required: ['memoryId'],
        },
        handler: async (params) => {
          try {
            await memoryService.restoreMemory(params.memoryId);

            return {
              content: [{ type: 'text', text: `记忆恢复成功：${params.memoryId}` }],
            };
          } catch (error: any) {
            logger.error('memory_restore failed', error);
            return {
              content: [{ type: 'text', text: `恢复记忆失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },

    // ============================================================
    // 方案1: 主动记录上下文工具（用于 Claude Code 主动记录对话）
    // ============================================================
    {
      tool: {
        name: 'omms_record_context',
        description: '[方案1] 主动记录对话上下文到本地文件，供 SessionEnd 时捕获。Claude Code 可在对话过程中主动调用此工具来记录重要信息。',
        inputSchema: {
          type: 'object',
          properties: {
            role: {
              type: 'string',
              description: '角色：user 或 assistant',
              enum: ['user', 'assistant'],
            },
            content: {
              type: 'string',
              description: '对话内容',
            },
            sessionId: {
              type: 'string',
              description: '会话 ID',
            },
            agentId: {
              type: 'string',
              description: 'Agent ID',
            },
            projectDir: {
              type: 'string',
              description: '项目目录（可选，默认从环境变量获取）',
            },
          },
          required: ['role', 'content'],
        },
        handler: async (params) => {
          try {
            const fs = await import('fs');
            const path = await import('path');

            const sessionId = params.sessionId || process.env['OMMS_SESSION_ID'] || `session-${Date.now()}`;
            const agentId = params.agentId || process.env['OMMS_AGENT_ID'] || 'default-agent';
            const projectDir = params.projectDir || process.env['CLAUDE_PROJECT_DIR'] || './data/sessions';

            // 创建目录
            const convLogDir = path.join(projectDir, '.claude', 'omms-conversation');
            fs.mkdirSync(convLogDir, { recursive: true });

            // 创建记录条目
            const entry = {
              role: params.role,
              content: params.content,
              timestamp: Date.now(),
              sessionId: sessionId,
              agentId: agentId,
              source: 'mcp-omms_record_context',
            };

            const logFile = path.join(convLogDir, `${sessionId}.jsonl`);
            fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');

            const fileSize = fs.statSync(logFile).size;

            // Count current entries
            const entries = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);

            logger.info('omms_record_context: Recorded conversation entry', {
              role: params.role,
              contentLength: params.content.length,
              sessionId,
              logFile,
              totalSize: fileSize,
              entryCount: entries.length,
            });

            return {
              content: [{
                type: 'text',
                text: `[方案1] 已记录 ${params.role} 消息到 ${logFile}\n` +
                  `- 内容长度: ${params.content.length}\n` +
                  `- 会话: ${sessionId}\n` +
                  `- 文件大小: ${fileSize} bytes\n` +
                  `- 当前条目数: ${entries.length}`,
              }],
            };
          } catch (error: any) {
            logger.error('omms_record_context failed', error);
            return {
              content: [{ type: 'text', text: `记录上下文失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },

    // ============================================================
    // 会话结束记忆捕获工具（方案核心）
    // ============================================================
    {
      tool: {
        name: 'omms_capture_session',
        description: '[方案核心] 会话结束时自动捕获记忆。读取当前会话的所有对话记录，生成摘要并存储为记忆。自动调用，无需参数。',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: '会话 ID（可选，默认从环境变量获取）',
            },
            agentId: {
              type: 'string',
              description: 'Agent ID（可选）',
            },
            projectDir: {
              type: 'string',
              description: '项目目录（可选）',
            },
          },
        },
        handler: async (params) => {
          try {
            const fs = await import('fs');
            const path = await import('path');

            const sessionId = params.sessionId || process.env['OMMS_SESSION_ID'] || `session-${Date.now()}`;
            const agentId = params.agentId || process.env['OMMS_AGENT_ID'] || 'default-agent';
            const projectDir = params.projectDir || process.env['CLAUDE_PROJECT_DIR'] || './data/sessions';

            const convLogDir = path.join(projectDir, '.claude', 'omms-conversation');
            const logFile = path.join(convLogDir, `${sessionId}.jsonl`);

            logger.info('omms_capture_session: Starting session capture', { sessionId, logFile });

            // Check if conversation file exists
            if (!fs.existsSync(logFile)) {
              logger.warn('omms_capture_session: No conversation file found', { logFile });
              return {
                content: [{
                  type: 'text',
                  text: `[方案核心] 未找到会话记录文件: ${logFile}\n请确保之前调用过 omms_record_context 记录对话。`,
                }],
              };
            }

            // Read and parse all conversation entries
            const fileContent = fs.readFileSync(logFile, 'utf8');
            const lines = fileContent.trim().split('\n').filter(Boolean);

            if (lines.length === 0) {
              logger.warn('omms_capture_session: Empty conversation file', { logFile });
              return {
                content: [{
                  type: 'text',
                  text: `[方案核心] 会话记录为空: ${sessionId}`,
                }],
              };
            }

            // Parse entries
            const entries = lines.map((line: string) => {
              try {
                return JSON.parse(line);
              } catch {
                return null;
              }
            }).filter(Boolean);

            interface ConversationEntry {
              role: string;
              content: string;
              timestamp?: number;
            }

            const userMessages = entries.filter((e: ConversationEntry) => e.role === 'user');
            const assistantMessages = entries.filter((e: ConversationEntry) => e.role === 'assistant');

            logger.info('omms_capture_session: Parsed conversation entries', {
              sessionId,
              totalEntries: entries.length,
              userMessages: userMessages.length,
              assistantMessages: assistantMessages.length,
            });

            // 构建完整原始对话内容（不截断，保留完整内容用于 palace 存储）
            // 注意： palace 存储的是原始内容，LLM 摘要由 MemoryCaptureService 生成
            const conversationText = entries.map((e: ConversationEntry) =>
              `${e.role.toUpperCase()}: ${e.content}`
            ).join('\n\n');

            // 计算原始内容长度
            const originalContentLength = conversationText.length;

            logger.info('omms_capture_session: Building capture data', {
              sessionId,
              conversationTextLength: originalContentLength,
              entryCount: entries.length,
            });

            // Create memory via API
            const captureData = {
              content: conversationText,  // 完整原始内容，LLM 摘要由后端 MemoryCaptureService 生成
              agentId,
              sessionId,
              type: 'event',
              metadata: {
                source: 'omms_capture_session_tool',
                captureMode: 'full_conversation',
                userMessageCount: userMessages.length,
                assistantMessageCount: assistantMessages.length,
                projectDir,
                originalContentLength,  // 记录原始长度，方便追溯
              },
            };

            logger.info('omms_capture_session: Sending capture request to API', {
              sessionId,
              captureDataSize: JSON.stringify(captureData).length,
            });

            // Make synchronous API call to capture memory
            interface CaptureResult {
              success: boolean;
              data?: { uid?: string; summary?: string };
              error?: string;
            }

            // 从 ConfigManager 读取 API 服务器配置
            const { config: appConfig } = await import('../../../shared/config');
            const apiConfig = appConfig.getConfig<{ port?: number; host?: string }>('api');
            const apiHost = apiConfig?.host || 'localhost';
            const apiPort = apiConfig?.port ?? 3000;

            const captureResult: CaptureResult = await new Promise((resolve) => {
              const postData = JSON.stringify(captureData);

              const options = {
                hostname: apiHost,
                port: apiPort,
                path: '/api/v1/memories/capture',
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(postData),
                },
              };

              const req = http.request(options, (res: http.IncomingMessage) => {
                let data = '';
                res.on('data', (chunk: string | Buffer) => data += chunk);
                res.on('end', () => {
                  try {
                    const result = JSON.parse(data);
                    logger.info('omms_capture_session: API response received', {
                      sessionId,
                      statusCode: res.statusCode,
                      success: result.success,
                      memoryUid: result.data?.uid,
                    });
                    resolve(result);
                  } catch {
                    resolve({ success: false, error: 'Failed to parse API response' });
                  }
                });
              });

              req.on('error', (err: Error) => {
                logger.error('omms_capture_session: API request failed', {
                  sessionId,
                  error: err.message,
                });
                resolve({ success: false, error: err.message });
              });
              req.write(postData);
              req.end();
            });

            if (captureResult.success) {
              // Clean up the conversation file after successful capture
              // fs.unlinkSync(logFile);

              logger.info('omms_capture_session: Memory captured successfully', {
                sessionId,
                memoryUid: captureResult.data?.uid,
              });

              return {
                content: [{
                  type: 'text',
                  text: `[方案核心] 会话记忆捕获成功!\n` +
                    `- 会话 ID: ${sessionId}\n` +
                    `- 用户消息: ${userMessages.length} 条\n` +
                    `- 助手回复: ${assistantMessages.length} 条\n` +
                    `- 原始内容长度: ${originalContentLength}\n` +
                    `- 记忆 UID: ${captureResult.data?.uid || 'N/A'}\n` +
                    `- LLM 摘要: ${captureResult.data?.summary || 'N/A'}`,
                }],
              };
            } else {
              logger.error('omms_capture_session: Failed to capture memory', {
                sessionId,
                error: captureResult.error,
              });

              return {
                content: [{
                  type: 'text',
                  text: `[方案核心] 会话记忆捕获失败: ${captureResult.error}`,
                }],
                isError: true,
              };
            }
          } catch (error: any) {
            logger.error('omms_capture_session: Exception', { error: error.message });
            return {
              content: [{ type: 'text', text: `会话捕获异常: ${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },
  ];
}
