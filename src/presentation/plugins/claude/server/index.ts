/**
 * OMMS-PRO MCP Server - Claude Code Plugin Entry Point
 *
 * This MCP server bridges Claude Code to the OMMS-PRO memory system.
 * It supports both local and remote OMMS-PRO instances.
 *
 * 简化版本：所有会话记录和捕获由 Hooks 处理，MCP Server 只提供记忆和Profile工具
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getMemoryTools } from './tools/memory.js';
import { createLogger } from './logger';

const logger = createLogger('MCPServer');
const memoryTools = getMemoryTools();

// Initialize ConfigManager before starting the plugin
try {
  const { ConfigManager } = await import('../../../../shared/config');
  const configManager = ConfigManager.getInstance();
  if (!configManager.isInitialized()) {
    configManager.initialize().catch(() => {
      // ConfigManager 初始化失败不影响插件启动
    });
  }
} catch {
  // ConfigManager 不可用
}

// Create the MCP server
const server = new Server(
  {
    name: 'omms-pro-memory',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
    instructions: `OMMS-PRO Memory System Plugin
This plugin connects Claude Code to the OMMS-PRO memory system for cross-session memory persistence and user profile management.

Available tools:
- memory_recall: Search for relevant memories using semantic similarity
- memory_capture: Store content as a memory for future recall
- memory_list: Browse all available memories
- profile_get: Get user profile including L0 identity (personality, interests, occupation) and L1 preferences (interaction style, content preferences)

The system uses a Memory Palace architecture with vector search for semantic recall.
User profiles are automatically built from conversations and used to personalize interactions.

Session memory capture is handled automatically by hooks at session end - no manual capture needed.`,
  }
);

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: memoryTools.map(t => ({
    name: t.tool.name,
    description: t.tool.description,
    inputSchema: t.tool.inputSchema,
  })),
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const tool = memoryTools.find(t => t.tool.name === name);
  if (!tool) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    return await tool.tool.handler(args ?? {});
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Tool handler error', { tool: name, error: msg });
    return {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const { getOmmsApiUrl, getAgentId } = await import('./config');
  logger.info('OMMS-PRO Memory Plugin starting...', { apiUrl: getOmmsApiUrl(), agentId: getAgentId() });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('OMMS-PRO Memory Plugin connected');
}

main().catch(async error => {
  logger.error('Failed to start OMMS-PRO Memory Plugin', { error: error.message });
  process.exit(1);
});