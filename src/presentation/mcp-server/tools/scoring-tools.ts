/**
 * Scoring Tools - 评分管理工具（2 个）
 *
 * - scoring_calculate: 使用 LLM 计算记忆评分
 * - scoring_reinforce: 强化记忆重要性
 */

import { createLogger } from '../../../shared/logging';
import type { MCPTool, ToolMetadata } from '../types';
import type { StorageMemoryService } from '../../../services/memory/core/storage-memory-service';
import { config } from '../../../shared/config';

const logger = createLogger('mcp-scoring-tools');

export function createScoringTools(memoryService: StorageMemoryService): Array<{ tool: MCPTool; metadata: ToolMetadata }> {
  return [
    {
      tool: {
        name: 'scoring_calculate',
        description: '使用 LLM 计算记忆内容的重要性评分和作用域评分',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '要评分的记忆内容' },
            type: { type: 'string', description: '记忆类型', enum: ['fact', 'event', 'decision', 'error', 'learning', 'relation'] },
            agentId: { type: 'string', description: 'Agent ID' },
          },
          required: ['content', 'type', 'agentId'],
        },
        handler: async (params) => {
          try {
            const { createLLMExtractor } = await import('../../../services/memory/llm/llm-extractor');

            // 从 ConfigManager 获取 LLM 配置
            let llmConfig: any = {};
            try {
              if (config.isInitialized()) {
                const extraction = config.getConfig('llmExtraction') as any;
                const capture = config.getConfig('memoryService.capture') as any;
                llmConfig = {
                  llmProvider: extraction?.provider ?? 'anthropic',
                  llmApiKey: extraction?.apiKey,
                  llmEndpoint: extraction?.baseURL,
                  llmModel: extraction?.model ?? 'claude-3-sonnet-20240229',
                  confidenceThreshold: capture?.confidenceThreshold ?? 0.5,
                  maxMemoriesPerCapture: capture?.maxMemoriesPerCapture ?? 5,
                  similarityThreshold: capture?.similarityThreshold ?? 0.9,
                  enableLLMSummarization: true,
                };
              }
            } catch {
              // 使用默认配置
            }

            const extractor = createLLMExtractor(llmConfig);
            const scores = await extractor.generateScores(params.content);

            return {
              content: [{
                type: 'text',
                text: `评分结果：\n` +
                  `- 重要性：${scores.importance}/10\n` +
                  `- 作用域：${scores.scopeScore}/10\n` +
                  `- 置信度：${(scores.confidence * 100).toFixed(1)}%\n` +
                  `- 推理：${scores.reasoning}`,
              }],
            };
          } catch (error: any) {
            logger.error('scoring_calculate failed', error);
            return {
              content: [{ type: 'text', text: `评分失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'scoring', version: '2.0.0' },
    },

    {
      tool: {
        name: 'scoring_reinforce',
        description: '强化记忆的重要性评分（模拟使用该记忆）',
        inputSchema: {
          type: 'object',
          properties: {
            memoryId: { type: 'string', description: '记忆 UID' },
            amount: { type: 'number', description: '强化量（0-2，默认自动计算）' },
          },
          required: ['memoryId'],
        },
        handler: async (params) => {
          try {
            const memory = await memoryService.reinforce(params.memoryId, params.amount);

            if (!memory) {
              return {
                content: [{ type: 'text', text: `记忆未找到：${params.memoryId}` }],
                isError: true,
              };
            }

            return {
              content: [{
                type: 'text',
                text: `记忆强化成功：\n` +
                  `- UID：${memory.uid}\n` +
                  `- 新重要性：${memory.importance}\n` +
                  `- 作用域评分：${memory.scopeScore}`,
              }],
            };
          } catch (error: any) {
            logger.error('scoring_reinforce failed', error);
            return {
              content: [{ type: 'text', text: `强化记忆失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'scoring', version: '2.0.0' },
    },
  ];
}
