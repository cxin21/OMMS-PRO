/**
 * Conversation Tools - 对话记录工具
 *
 * - omms_record_context: 记录用户/助手对话到 JSONL 文件
 * - omms_capture_session: 会话结束时捕获记忆
 */

import type { MCPTool, ToolMetadata, MCPToolResult, ToolHandlerParams } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../../../../../shared/logging';
import type { ILogger } from '../../../../../shared/logging';
import { getSessionContext, apiFetch } from '../config';

// 统一日志系统 - 输出到控制台方便调试
const logger: ILogger = createLogger('ConversationTools', {
  level: 'debug',
  output: 'console',
  enableConsole: true,
  enableFile: false,
});

interface ConversationEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  sessionId: string;
  agentId: string;
  source: string;
}

export function getConversationTools(): MCPTool[] {
  return [
    // ============================================================
    // omms_record_context: 记录对话到 JSONL 文件
    // ============================================================
    {
      tool: {
        name: 'omms_record_context',
        description: '记录用户或助手的对话内容到本地文件。用于构建完整的对话日志，以便会话结束时进行记忆捕获。会话隔离：每个会话有独立的 JSONL 文件。',
        inputSchema: {
          type: 'object',
          properties: {
            role: {
              type: 'string',
              enum: ['user', 'assistant'],
              description: '角色：user 或 assistant',
            },
            content: {
              type: 'string',
              description: '对话内容',
            },
            sessionId: {
              type: 'string',
              description: '会话 ID（可选，默认从环境变量获取）',
            },
            agentId: {
              type: 'string',
              description: 'Agent ID（可选）',
            },
          },
          required: ['role', 'content'],
        },
        handler: async (params: ToolHandlerParams): Promise<MCPToolResult> => {
          try {
            const { sessionId, agentId, conversationLogDir } = getSessionContext(params);

            // 确保目录存在
            fs.mkdirSync(conversationLogDir, { recursive: true });

            // 创建记录条目
            const entry: ConversationEntry = {
              role: params['role'] as 'user' | 'assistant',
              content: params['content'] as string,
              timestamp: Date.now(),
              sessionId,
              agentId,
              source: 'mcp-omms_record_context',
            };

            const logFile = path.join(conversationLogDir, `${sessionId}.jsonl`);
            fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');

            const fileSize = fs.statSync(logFile).size;

            // 统计当前条目数
            const entries = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);

            logger.info('omms_record_context: Recorded conversation entry', {
              role: params['role'],
              contentLength: (params['content'] as string).length,
              sessionId,
              logFile,
              totalSize: fileSize,
              entryCount: entries.length,
            });

            return {
              content: [{
                type: 'text',
                text: `[omms_record_context] 已记录 ${params['role']} 消息\n` +
                  `- 会话: ${sessionId}\n` +
                  `- 内容长度: ${(params['content'] as string).length}\n` +
                  `- 当前条目数: ${entries.length}`,
              }],
            };
          } catch (error: any) {
            logger.error('omms_record_context failed', error);
            return {
              content: [{ type: 'text', text: `记录失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },

    // ============================================================
    // omms_capture_session: 会话结束记忆捕获
    // ============================================================
    {
      tool: {
        name: 'omms_capture_session',
        description: '[核心] 会话结束时自动捕获记忆。读取当前会话的所有对话记录，构建摘要并存储为记忆。',
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
        handler: async (params: ToolHandlerParams): Promise<MCPToolResult> => {
          try {
            const { sessionId, agentId, conversationLogDir } = getSessionContext(params);

            const logFile = path.join(conversationLogDir, `${sessionId}.jsonl`);

            logger.info('omms_capture_session: Starting session capture', { sessionId, logFile });

            // 检查会话文件是否存在
            if (!fs.existsSync(logFile)) {
              logger.warn('omms_capture_session: No conversation file found', { logFile });
              return {
                content: [{
                  type: 'text',
                  text: `[omms_capture_session] 未找到会话记录: ${sessionId}\n请确保之前调用过 omms_record_context 记录对话。`,
                }],
              };
            }

            // 读取并解析所有对话条目
            const fileContent = fs.readFileSync(logFile, 'utf8');
            const lines = fileContent.trim().split('\n').filter(Boolean);

            if (lines.length === 0) {
              logger.warn('omms_capture_session: Empty conversation file', { logFile });
              return {
                content: [{
                  type: 'text',
                  text: `[omms_capture_session] 会话记录为空: ${sessionId}`,
                }],
              };
            }

            // 解析条目
            const entries: ConversationEntry[] = lines
              .map((line: string) => {
                try {
                  return JSON.parse(line) as ConversationEntry;
                } catch {
                  return null;
                }
              })
              .filter((e): e is ConversationEntry => e !== null);

            const userMessages = entries.filter((e) => e.role === 'user');
            const assistantMessages = entries.filter((e) => e.role === 'assistant');

            logger.info('omms_capture_session: Parsed conversation entries', {
              sessionId,
              totalEntries: entries.length,
              userMessages: userMessages.length,
              assistantMessages: assistantMessages.length,
            });

            // 构建完整原始对话内容（不截断，保留完整内容用于 palace 存储）
            // 注意： palace 存储的是原始内容，LLM 摘要由 MemoryCaptureService 生成
            const conversationText = entries
              .map((e) => `${e.role.toUpperCase()}: ${e.content}`)
              .join('\n\n');

            // 计算原始内容长度
            const originalContentLength = conversationText.length;

            logger.info('omms_capture_session: Building capture data', {
              sessionId,
              conversationTextLength: originalContentLength,
              entryCount: entries.length,
            });

            // 调用 API 捕获记忆
            const captureData = {
              content: conversationText,
              agentId,
              sessionId,
              type: 'event',
              metadata: {
                source: 'omms_capture_session_tool',
                captureMode: 'full_conversation',
                userMessageCount: userMessages.length,
                assistantMessageCount: assistantMessages.length,
                conversationLogDir,
                originalContentLength,
              },
            };

            // 使用带超时的 fetch
            const response = await apiFetch('/memories/capture', {
              method: 'POST',
              body: JSON.stringify(captureData),
            });

            let captureResult: { success: boolean; data?: { uid?: string; summary?: string }; error?: string };
            try {
              captureResult = await response.json() as typeof captureResult;
            } catch {
              captureResult = { success: false, error: 'Failed to parse response' };
            }

            logger.info('omms_capture_session: API response received', {
              sessionId,
              statusCode: response.status,
              success: captureResult.success,
              memoryUid: captureResult.data?.uid,
            });

            if (captureResult.success) {
              logger.info('omms_capture_session: Memory captured successfully', {
                sessionId,
                memoryUid: captureResult.data?.uid,
              });

              return {
                content: [{
                  type: 'text',
                  text: `[omms_capture_session] 会话记忆捕获成功!\n` +
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
                  text: `[omms_capture_session] 会话记忆捕获失败: ${captureResult.error}`,
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
