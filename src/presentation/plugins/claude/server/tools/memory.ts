/**
 * Memory Tools - 记忆系统工具
 *
 * - memory_recall: 语义搜索记忆
 * - memory_capture: 存储记忆
 * - memory_list: 浏览记忆列表
 * - profile_get: 获取用户 Profile
 */

import { getOmmsApiUrl, getAgentId, apiPost } from '../config';
import { createLogger } from '../logger';
import type { MCPTool, ToolResult, Memory, MemoryRecallResult, MemoryCaptureResult, UserProfile } from '../types';
import { successResult, errorResult } from '../types';

const logger = createLogger('MemoryTools');

export function getMemoryTools(): MCPTool[] {
  return [
    // ============================================================
    // memory_recall: 语义搜索记忆
    // ============================================================
    {
      tool: {
        name: 'memory_recall',
        description: 'Recall relevant memories from OMMS-PRO memory system based on semantic similarity. Returns memories that are relevant to the current query.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The query to search for relevant memories',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of memories to return',
              default: 5,
            },
          },
          required: ['query'],
        },
        handler: async (params): Promise<ToolResult> => {
          try {
            const { query, limit = 5 } = params as { query: string; limit?: number };

            const result = await apiPost<{ memories: Memory[]; totalFound: number }>(
              '/memories/recall',
              { query, limit, agentId: getAgentId() }
            );

            if (!result.success) {
              return errorResult(`Recall failed: ${result.error || result.details}`);
            }

            const memories = result.data?.memories ?? [];
            if (memories.length === 0) {
              return successResult('No relevant memories found.');
            }

            const text = memories.map((m, i) =>
              `[${i + 1}] ${(m.type || 'unknown').toUpperCase()} (importance: ${m.importance})\n${m.summary || m.content || ''}`
            ).join('\n\n');

            return successResult(`Found ${result.data?.totalFound ?? memories.length} relevant memories:\n\n${text}`);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error('memory_recall failed', { error: msg });
            return errorResult(`Recall failed: ${msg}`);
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },

    // ============================================================
    // memory_capture: 存储记忆
    // ============================================================
    {
      tool: {
        name: 'memory_capture',
        description: 'Capture content as a memory in OMMS-PRO. Use this to store important information that should be remembered across sessions.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The content to store as a memory',
            },
            sessionId: {
              type: 'string',
              description: 'Session identifier for grouping memories',
            },
            type: {
              type: 'string',
              description: 'Memory type (fact/event/learning/decision)',
              default: 'event',
            },
            importance: {
              type: 'number',
              description: 'Importance score 1-10',
              default: 5,
            },
          },
          required: ['content'],
        },
        handler: async (params): Promise<ToolResult> => {
          try {
            const { content, sessionId, type = 'event', importance = 5 } = params as {
              content: string;
              sessionId?: string;
              type?: string;
              importance?: number;
            };

            const result = await apiPost<MemoryCaptureResult>('/memories/capture', {
              content,
              agentId: getAgentId(),
              sessionId: sessionId || `session-${Date.now()}`,
              type,
              scores: { importance, scopeScore: importance },
              useLLMExtraction: true,
            });

            if (!result.success) {
              return errorResult(`Capture failed: ${result.error || result.details}`);
            }

            const data = result.data;
            return successResult(
              `Memory captured successfully.\nUID: ${data?.uid}\nType: ${data?.type}\nImportance: ${data?.importance}`
            );
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error('memory_capture failed', { error: msg });
            return errorResult(`Capture failed: ${msg}`);
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },

    // ============================================================
    // memory_list: 浏览记忆列表
    // ============================================================
    {
      tool: {
        name: 'memory_list',
        description: 'List all memories in the OMMS-PRO system with optional filtering.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Number of memories to return',
              default: 20,
            },
            type: {
              type: 'string',
              description: 'Filter by memory type (fact/event/learning/decision/preference)',
            },
          },
        },
        handler: async (params): Promise<ToolResult> => {
          try {
            const { limit = 20, type } = params as { limit?: number; type?: string };

            const paramsObj = new URLSearchParams({ limit: String(limit) });
            if (type) paramsObj.set('type', type);

            const result = await apiPost<{ memories: Memory[]; total: number }>(
              `/memories?${paramsObj.toString()}`,
              {}
            );

            if (!result.success) {
              return errorResult(`List failed: ${result.error || result.details}`);
            }

            const memories = result.data?.memories ?? [];
            const text = memories.map((m, i) =>
              `[${i + 1}] ${m.type || 'unknown'} | ${m.scope || 'unknown'} | imp: ${m.importance}\n${m.summary || (m.content || '').slice(0, 80)}...`
            ).join('\n\n');

            return successResult(`Total memories: ${result.data?.total ?? memories.length}\n\n${text || 'No memories stored yet.'}`);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error('memory_list failed', { error: msg });
            return errorResult(`List failed: ${msg}`);
          }
        },
      },
      metadata: { category: 'memory', version: '2.0.0' },
    },

    // ============================================================
    // profile_get: 获取用户 Profile
    // ============================================================
    {
      tool: {
        name: 'profile_get',
        description: 'Get the user profile including L0 identity (name, occupation, personality, interests) and L1 preferences (interaction style, content preferences, technical preferences).',
        inputSchema: {
          type: 'object',
          properties: {
            userId: {
              type: 'string',
              description: 'User ID to get profile for',
              default: 'default-user',
            },
            includeContext: {
              type: 'boolean',
              description: 'Include formatted L0/L1 context string',
              default: true,
            },
          },
        },
        handler: async (params): Promise<ToolResult> => {
          try {
            const { userId = 'default-user', includeContext = true } = params as {
              userId?: string;
              includeContext?: boolean;
            };

            const profileResult = await apiPost<{ profile: UserProfile }>(
              `/profile/${userId}`,
              {}
            );

            const contextResult = includeContext
              ? await apiPost<{ context: string }>(`/profile/${userId}/context`, {})
              : { success: false };

            if (!profileResult.success) {
              return successResult(`Profile not found for user: ${userId}. Use this tool after gathering user information to build the profile.`);
            }

            const profile = profileResult.data?.profile;
            const context = contextResult.success ? contextResult.data?.context : null;

            // Format profile summary
            let responseText = `## User Profile: ${userId}\n\n`;

            // Persona
            if (profile?.persona) {
              responseText += `### L0 Identity\n`;
              const p = profile.persona;
              if (p.name) responseText += `- **Name**: ${p.name}\n`;
              if (p.occupation) responseText += `- **Occupation**: ${p.occupation}\n`;
              if (p.location) responseText += `- **Location**: ${p.location}\n`;
              if (p.personalityTraits?.length) {
                const traits = p.personalityTraits.slice(0, 3).map(t => t.trait).join(', ');
                responseText += `- **Personality**: ${traits}\n`;
              }
              if (p.interests?.length) {
                const interests = p.interests.slice(0, 5).map(i => i.name).join(', ');
                responseText += `- **Interests**: ${interests}\n`;
              }
              if (p.values?.length) {
                responseText += `- **Values**: ${p.values.slice(0, 3).join(', ')}\n`;
              }
              responseText += `\n`;
            }

            // Preferences
            if (profile?.preferences) {
              responseText += `### L1 Preferences\n`;
              const pref = profile.preferences;
              if (pref.interaction) {
                if (pref.interaction.responseLength) responseText += `- **Response Style**: ${pref.interaction.responseLength}\n`;
                if (pref.interaction.activeHours?.length) {
                  const hours = pref.interaction.activeHours.map(h => `${h.start}-${h.end}`).join(', ');
                  responseText += `- **Active Hours**: ${hours}\n`;
                }
              }
              if (pref.content) {
                if (pref.content.topics?.length) {
                  const topics = pref.content.topics.slice(0, 5).map(t => t.topic).join(', ');
                  responseText += `- **Topics of Interest**: ${topics}\n`;
                }
                if (pref.content.complexityLevel) responseText += `- **Complexity Level**: ${pref.content.complexityLevel}\n`;
              }
              if (pref.technical?.preferredTools?.length) {
                responseText += `- **Preferred Tools**: ${pref.technical.preferredTools.slice(0, 5).join(', ')}\n`;
              }
              responseText += `\n`;
            }

            // Stats
            if (profile?.stats) {
              responseText += `### Interaction Stats\n`;
              responseText += `- **Total Interactions**: ${profile.stats.totalInteractions || 0}\n`;
              responseText += `- **Engagement Level**: ${profile.stats.engagementScore || 'N/A'}\n`;
              if (profile.stats.favoriteTopics?.length) {
                responseText += `- **Favorite Topics**: ${profile.stats.favoriteTopics.slice(0, 3).join(', ')}\n`;
              }
              responseText += `\n`;
            }

            // Tags
            if (profile?.tags?.length) {
              responseText += `### User Tags\n`;
              const tags = profile.tags.map(t => t.name).join(', ');
              responseText += `${tags}\n\n`;
            }

            // L0/L1 Context
            if (context) {
              responseText += `### L0/L1 Wake-up Context\n`;
              responseText += `\`\`\`\n${context}\n\`\`\`\n`;
            }

            // Confidence
            if (profile?.preferences?.confidence) {
              responseText += `*Preference confidence: ${(profile.preferences.confidence * 100).toFixed(1)}%*\n`;
            }

            return successResult(responseText);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error('profile_get failed', { error: msg });
            return errorResult(`Profile fetch failed: ${msg}`);
          }
        },
      },
      metadata: { category: 'profile', version: '2.0.0' },
    },
  ];
}