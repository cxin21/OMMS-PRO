/**
 * Tool Registry - 工具注册表
 * 
 * 管理所有 MCP 工具的注册和调用
 */

import { createLogger, type ILogger } from '../../shared/logging';
import type {
  MCPTool,
  MCPToolResult,
  MCPResource,
  MCPPrompt,
  MCPServerConfig,
  ToolMetadata,
  ToolCallContext,
  ToolCallResult,
} from './types';
import { MCPErrorCode } from './types';

/**
 * 工具注册表类
 */
export class ToolRegistry {
  private logger: ILogger;
  private config: MCPServerConfig;
  private tools: Map<string, { tool: MCPTool; metadata: ToolMetadata }>;
  private resources: Map<string, MCPResource>;
  private prompts: Map<string, MCPPrompt>;
  private callQueue: Array<{ toolName: string; params: any; resolve: any; reject: any }>;
  private activeCalls: number = 0;

  constructor(config: MCPServerConfig) {
    this.logger = createLogger('tool-registry');
    this.config = config;
    this.tools = new Map();
    this.resources = new Map();
    this.prompts = new Map();
    this.callQueue = [];
    this.logger.debug('ToolRegistry initialized');
  }

  /**
   * 注册工具
   */
  registerTool(
    tool: MCPTool,
    metadata: ToolMetadata
  ): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Tool ${tool.name} already exists, overriding`);
    }

    this.tools.set(tool.name, { tool, metadata });
    this.logger.info(`Tool registered: ${tool.name} (${metadata.category})`);
  }

  /**
   * 注册多个工具
   */
  registerTools(tools: Array<{ tool: MCPTool; metadata: ToolMetadata }>): void {
    for (const item of tools) {
      this.registerTool(item.tool, item.metadata);
    }
  }

  /**
   * 注册资源
   */
  registerResource(resource: MCPResource): void {
    this.resources.set(resource.uri, resource);
    this.logger.debug(`Resource registered: ${resource.uri}`);
  }

  /**
   * 注册提示词
   */
  registerPrompt(prompt: MCPPrompt): void {
    this.prompts.set(prompt.name, prompt);
    this.logger.debug(`Prompt registered: ${prompt.name}`);
  }

  /**
   * 列出所有工具
   */
  listTools(): { tools: Array<{ name: string; description: string; inputSchema: any }> } {
    const tools = Array.from(this.tools.values()).map(({ tool, metadata }) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      metadata,
    }));

    return { tools };
  }

  /**
   * 列出所有资源
   */
  listResources(): { resources: MCPResource[] } {
    const resources = Array.from(this.resources.values());
    return { resources };
  }

  /**
   * 列出所有提示词
   */
  listPrompts(): { prompts: Array<{ name: string; description?: string }> } {
    const prompts = Array.from(this.prompts.values()).map(prompt => ({
      name: prompt.name,
      description: prompt.description,
    }));
    return { prompts };
  }

  /**
   * 调用工具
   */
  async callTool(toolName: string, params: any): Promise<MCPToolResult> {
    const toolData = this.tools.get(toolName);
    
    if (!toolData) {
      throw {
        code: MCPErrorCode.TOOL_NOT_FOUND,
        message: `Tool not found: ${toolName}`,
      };
    }

    const { tool, metadata } = toolData;

    // 检查是否超过最大并发数
    if (this.activeCalls >= this.config.performance.maxConcurrentTools) {
      this.logger.warn('Max concurrent tools reached, queuing request');
      return new Promise((resolve, reject) => {
        this.callQueue.push({ toolName, params, resolve, reject });
      });
    }

    const context: ToolCallContext = {
      toolName,
      params,
      startTime: Date.now(),
      requestId: this.generateRequestId(),
    };

    try {
      this.activeCalls++;

      if (this.config.tools.enableLogging) {
        this.logger.info(`Tool call started: ${toolName}`, { params, requestId: context.requestId });
      }

      // 执行工具
      const result = await Promise.race([
        tool.handler(params),
        this.createTimeout(this.config.tools.timeout),
      ]);

      const duration = Date.now() - context.startTime;

      if (this.config.tools.enableLogging) {
        this.logger.info(`Tool call completed: ${toolName} (${duration}ms)`, {
          requestId: context.requestId,
        });
      }

      return result;
    } catch (error: any) {
      this.logger.error(`Tool call failed: ${toolName}`, {
        error: error.message,
        requestId: context.requestId,
      });

      throw {
        code: MCPErrorCode.TOOL_EXECUTION_ERROR,
        message: error.message,
        data: error.data,
      };
    } finally {
      this.activeCalls--;
      // activeCalls-- 必须在 processQueue 之前，否则队列中的请求永远得不到处理
      this.processQueue();
    }
  }

  /**
   * 读取资源
   */
  async readResource(uri: string): Promise<MCPResource> {
    const resource = this.resources.get(uri);
    
    if (!resource) {
      throw {
        code: MCPErrorCode.RESOURCE_NOT_FOUND,
        message: `Resource not found: ${uri}`,
      };
    }

    this.logger.debug(`Resource read: ${uri}`);

    return resource;
  }

  /**
   * 获取提示词
   */
  async getPrompt(name: string, args: any): Promise<any> {
    const prompt = this.prompts.get(name);
    
    if (!prompt) {
      throw {
        code: MCPErrorCode.PROMPT_NOT_FOUND,
        message: `Prompt not found: ${name}`,
      };
    }

    this.logger.debug(`Prompt get: ${name}`, args);

    return await prompt.handler(args);
  }

  /**
   * 获取工具数量
   */
  getToolCount(): number {
    return this.tools.size;
  }

  /**
   * 清理资源
   */
  async cleanup(timeoutMs: number = 30000): Promise<void> {
    this.logger.info('Cleaning up tool registry');

    // 等待所有活跃调用完成（带超时机制）
    const deadline = Date.now() + timeoutMs;
    while (this.activeCalls > 0) {
      if (Date.now() >= deadline) {
        this.logger.warn(`Cleanup timeout after ${timeoutMs}ms, ${this.activeCalls} active calls remaining`);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // 清空队列（拒绝所有等待中的请求）
    for (const queued of this.callQueue) {
      queued.reject({
        code: MCPErrorCode.TOOL_EXECUTION_ERROR,
        message: 'Tool registry is shutting down',
      });
    }
    this.callQueue = [];

    this.logger.info('Tool registry cleaned up');
  }

  /**
   * 处理队列
   */
  private processQueue(): void {
    if (this.callQueue.length > 0 && this.activeCalls < this.config.performance.maxConcurrentTools) {
      const next = this.callQueue.shift();
      if (next) {
        this.callTool(next.toolName, next.params)
          .then(next.resolve)
          .catch(next.reject);
      }
    }
  }

  /**
   * 创建超时
   */
  private createTimeout(timeoutMs: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject({
          code: MCPErrorCode.TIMEOUT_ERROR,
          message: `Tool execution timeout after ${timeoutMs}ms`,
        });
      }, timeoutMs);
    });
  }

  /**
   * 生成请求 ID
   */
  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
