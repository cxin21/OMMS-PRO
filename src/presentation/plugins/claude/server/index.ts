/**
 * OMMS-PRO MCP Server - Claude Code Plugin Entry Point
 *
 * This MCP server bridges Claude Code to the OMMS-PRO memory system.
 * It supports both local and remote OMMS-PRO instances.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { getConversationTools } from './tools/conversation.js';
import { getOmmsApiUrl, getAgentId, apiFetch } from './config';
import { ConfigManager } from '../../../../shared/config';

// Initialize ConfigManager before starting the plugin
// Claude Code 启动插件时，OMMS 后端可能尚未初始化
let configInitialized = false;
try {
  const configManager = ConfigManager.getInstance();
  if (!configManager.isInitialized()) {
    configManager.initialize().catch(() => {
      // ConfigManager 初始化失败不影响插件启动
    });
  }
  configInitialized = true;
} catch {
  // ConfigManager 不可用
}

const logger = {
  info: (msg: string, data?: Record<string, unknown>) => {
    writeLog('info', msg, data);
  },
  error: (msg: string, data?: Record<string, unknown>) => {
    writeLog('error', msg, data);
  },
  warn: (msg: string, data?: Record<string, unknown>) => {
    writeLog('warn', msg, data);
  },
};

/**
 * Write log to OMMS log management system via API
 */
async function writeLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  data?: Record<string, unknown>
): Promise<void> {
  try {
    await apiFetch('/system/logs/write', {
      method: 'POST',
      body: JSON.stringify({
        level,
        message,
        module: 'claude-plugin',
        data,
      }),
    });
  } catch {
    // Fallback to stderr if logging API is unavailable
    console.error(`[${level}] ${message}`, data);
  }
}

interface Memory {
  uid: string;
  content: string;
  summary: string;
  type: string;
  importance: number;
  scope: string;
  createdAt: number;
}

// Memory recall tool - searches for relevant memories
const memoryRecallTool: Tool = {
  name: 'memory_recall',
  description: 'Recall relevant memories from OMMS-PRO memory system based on semantic similarity. Returns memories that are relevant to the current query.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The query to search for relevant memories'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of memories to return',
        default: 5
      }
    },
    required: ['query']
  }
};

// Memory capture tool - stores conversation summary
const memoryCaptureTool: Tool = {
  name: 'memory_capture',
  description: 'Capture the current conversation as a memory in OMMS-PRO. Use this after responding to save the conversation for future recall.',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The content/summary to store as a memory'
      },
      sessionId: {
        type: 'string',
        description: 'Session identifier for grouping memories'
      },
      type: {
        type: 'string',
        description: 'Memory type (fact/event/learning/decision)',
        default: 'event'
      },
      importance: {
        type: 'number',
        description: 'Importance score 1-10',
        default: 5
      }
    },
    required: ['content']
  }
};

// Memory list tool - for browsing memories
const memoryListTool: Tool = {
  name: 'memory_list',
  description: 'List all memories in the OMMS-PRO system with optional filtering.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Number of memories to return',
        default: 20
      },
      type: {
        type: 'string',
        description: 'Filter by memory type'
      }
    }
  }
};

// Profile get tool - for getting user profile and preferences
const profileGetTool: Tool = {
  name: 'profile_get',
  description: 'Get the user profile including L0 identity (name, occupation, personality, interests) and L1 preferences (interaction style, content preferences, technical preferences). Use this to understand the user you are interacting with.',
  inputSchema: {
    type: 'object',
    properties: {
      userId: {
        type: 'string',
        description: 'User ID to get profile for',
        default: 'default-user'
      },
      includeContext: {
        type: 'boolean',
        description: 'Include formatted L0/L1 context string',
        default: true
      }
    }
  }
};

// Create the MCP server
const server = new Server(
  {
    name: 'omms-pro-memory',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      experimental: {
        'claude/context': {}
      }
    },
    instructions: `OMMS-PRO Memory System Plugin
This plugin connects Claude Code to the OMMS-PRO memory system for cross-session memory persistence and user profile management.

Available tools:
- memory_recall: Search for relevant memories using semantic similarity
- memory_capture: Store conversation summaries for future recall
- memory_list: Browse all available memories
- profile_get: Get user profile including L0 identity (personality, interests, occupation) and L1 preferences (interaction style, content preferences)
- omms_record_context: Record user/assistant conversation to local JSONL file (MANDATORY after each response)
- omms_capture_session: Capture full conversation memory at session end

The system uses a Memory Palace architecture with vector search for semantic recall.
User profiles are automatically built from conversations and used to personalize interactions.

IMPORTANT: After every assistant response, you MUST call omms_record_context to record your response.`
  }
);

// Helper: Make API request to OMMS-PRO with timeout
async function ommsApi(endpoint: string, options: RequestInit = {}): Promise<any> {
  try {
    const response = await apiFetch(endpoint, options);

    if (!response.ok) {
      throw new Error(`OMMS API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  } catch (error) {
    await writeLog('error', `OMMS API request failed: ${error}`);
    throw error;
  }
}

// Get all tools including conversation tools
const conversationTools = getConversationTools();

// Convert to SDK Tool format
const allTools: Tool[] = [
  memoryRecallTool,
  memoryCaptureTool,
  memoryListTool,
  profileGetTool,
  ...conversationTools.map(ct => ({
    name: ct.tool.name,
    description: ct.tool.description,
    inputSchema: ct.tool.inputSchema,
  })) as Tool[]
];

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: allTools
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Handle conversation tools first
    const conversationTool = conversationTools.find(ct => ct.tool.name === name);
    if (conversationTool) {
      const result = await conversationTool.tool.handler(args ?? {});
      return {
        content: result.content,
        isError: result.isError,
      };
    }

    switch (name) {
      case 'memory_recall': {
        const { query, limit = 5 } = args as { query: string; limit?: number };

        const result = await ommsApi('/memories/recall', {
          method: 'POST',
          body: JSON.stringify({ query, limit }),
        });

        if (!result.success) {
          return {
            content: [{ type: 'text', text: `Recall failed: ${result.error}` }],
            isError: true
          };
        }

        const memories = result.data?.memories ?? [];
        if (memories.length === 0) {
          return {
            content: [{ type: 'text', text: 'No relevant memories found.' }]
          };
        }

        const text = memories.map((m: Memory, i: number) =>
          `[${i + 1}] ${(m.type || 'unknown').toUpperCase()} (importance: ${m.importance})\n${m.summary || m.content || ''}`
        ).join('\n\n');

        return {
          content: [{
            type: 'text',
            text: `Found ${result.data?.totalFound ?? memories.length} relevant memories:\n\n${text}`
          }]
        };
      }

      case 'memory_capture': {
        const { content, sessionId, type = 'event', importance = 5 } = args as {
          content: string;
          sessionId?: string;
          type?: string;
          importance?: number;
        };

        const result = await ommsApi('/memories/capture', {
        method: 'POST',
        body: JSON.stringify({
          content,
          agentId: getAgentId(),
          sessionId: sessionId || `session-${Date.now()}`,
          type,
          scores: { importance, scopeScore: importance },
          useLLMExtraction: true,  // Claude plugin 捕获的内容需要 LLM 提取
        }),
      });

        if (!result.success) {
          return {
            content: [{ type: 'text', text: `Capture failed: ${result.error}` }],
            isError: true
          };
        }

        return {
          content: [{
            type: 'text',
            text: `Memory captured successfully.\nUID: ${result.data?.uid}\nType: ${result.data?.type}\nImportance: ${result.data?.importance}`
          }]
        };
      }

      case 'memory_list': {
        const { limit = 20, type } = args as { limit?: number; type?: string };

        const params = new URLSearchParams({ limit: String(limit) });
        if (type) params.set('type', type);

        const result = await ommsApi(`/memories?${params.toString()}`);

        if (!result.success) {
          return {
            content: [{ type: 'text', text: `List failed: ${result.error}` }],
            isError: true
          };
        }

        const memories = result.data?.memories ?? [];
        const text = memories.map((m: Memory, i: number) =>
          `[${i + 1}] ${m.type || 'unknown'} | ${m.scope || 'unknown'} | imp: ${m.importance}\n${m.summary || (m.content || '').slice(0, 80)}...`
        ).join('\n\n');

        return {
          content: [{
            type: 'text',
            text: `Total memories: ${result.data?.total ?? memories.length}\n\n${text || 'No memories stored yet.'}`
          }]
        };
      }

      case 'profile_get': {
        const { userId = 'default-user', includeContext = true } = args as {
          userId?: string;
          includeContext?: boolean;
        };

        const profileResult = await ommsApi(`/profile/${userId}`);
        const contextResult = includeContext
          ? await ommsApi(`/profile/${userId}/context`)
          : { success: false };

        if (!profileResult.success) {
          return {
            content: [{ type: 'text', text: `Profile not found for user: ${userId}. Use this tool after gathering user information to build the profile.` }],
            isError: false
          };
        }

        const profile = profileResult.data;
        const context = contextResult.success ? contextResult.data?.context : null;

        // Format profile summary
        let responseText = `## User Profile: ${userId}\n\n`;

        // Persona
        if (profile.persona) {
          responseText += `### L0 Identity\n`;
          const p = profile.persona;
          if (p.name) responseText += `- **Name**: ${p.name}\n`;
          if (p.occupation) responseText += `- **Occupation**: ${p.occupation}\n`;
          if (p.location) responseText += `- **Location**: ${p.location}\n`;
          if (p.personalityTraits && p.personalityTraits.length > 0) {
            const traits = p.personalityTraits.slice(0, 3).map((t: { trait: string }) => t.trait).join(', ');
            responseText += `- **Personality**: ${traits}\n`;
          }
          if (p.interests && p.interests.length > 0) {
            const interests = p.interests.slice(0, 5).map((i: { name: string }) => i.name).join(', ');
            responseText += `- **Interests**: ${interests}\n`;
          }
          if (p.values && p.values.length > 0) {
            responseText += `- **Values**: ${p.values.slice(0, 3).join(', ')}\n`;
          }
          responseText += `\n`;
        }

        // Preferences
        if (profile.preferences) {
          responseText += `### L1 Preferences\n`;
          const pref = profile.preferences;
          if (pref.interaction) {
            if (pref.interaction.responseLength) responseText += `- **Response Style**: ${pref.interaction.responseLength}\n`;
            if (pref.interaction.activeHours && pref.interaction.activeHours.length > 0) {
              responseText += `- **Active Hours**: ${pref.interaction.activeHours.map((h: { start: string; end: string }) => `${h.start}-${h.end}`).join(', ')}\n`;
            }
          }
          if (pref.content) {
            if (pref.content.topics && pref.content.topics.length > 0) {
              const topics = pref.content.topics.slice(0, 5).map((t: { topic: string }) => t.topic).join(', ');
              responseText += `- **Topics of Interest**: ${topics}\n`;
            }
            if (pref.content.complexityLevel) responseText += `- **Complexity Level**: ${pref.content.complexityLevel}\n`;
          }
          if (pref.technical && pref.technical.preferredTools && pref.technical.preferredTools.length > 0) {
            responseText += `- **Preferred Tools**: ${pref.technical.preferredTools.slice(0, 5).join(', ')}\n`;
          }
          responseText += `\n`;
        }

        // Stats
        if (profile.stats) {
          responseText += `### Interaction Stats\n`;
          responseText += `- **Total Interactions**: ${profile.stats.totalInteractions || 0}\n`;
          responseText += `- **Engagement Level**: ${profile.stats.engagementScore || 'N/A'}\n`;
          if (profile.stats.favoriteTopics && profile.stats.favoriteTopics.length > 0) {
            responseText += `- **Favorite Topics**: ${profile.stats.favoriteTopics.slice(0, 3).join(', ')}\n`;
          }
          responseText += `\n`;
        }

        // Tags
        if (profile.tags && profile.tags.length > 0) {
          responseText += `### User Tags\n`;
          const tags = profile.tags.map((t: unknown) => (t as { name: string }).name).join(', ');
          responseText += `${tags}\n\n`;
        }

        // L0/L1 Context
        if (context) {
          responseText += `### L0/L1 Wake-up Context\n`;
          responseText += `\`\`\`\n${context}\n\`\`\`\n`;
        }

        // Confidence
        if (profile.preferences?.confidence) {
          responseText += `*Preference confidence: ${(profile.preferences.confidence * 100).toFixed(1)}%*\n`;
        }

        return {
          content: [{
            type: 'text',
            text: responseText
          }]
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true
        };
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    };
  }
});

// Start the server
async function main() {
  await writeLog('info', 'OMMS-PRO Memory Plugin starting...', { apiUrl: getOmmsApiUrl(), agentId: getAgentId() });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  await writeLog('info', 'OMMS-PRO Memory Plugin connected');
}

main().catch(async error => {
  await writeLog('error', 'Failed to start OMMS-PRO Memory Plugin', { error: error.message });
  process.exit(1);
});
