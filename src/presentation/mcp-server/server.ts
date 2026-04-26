/**
 * MCP Server - MCP 服务器核心实现
 *
 * 实现 Model Context Protocol 服务器
 */

import { createLogger, type ILogger } from '../../shared/logging';
import type { MCPServerConfig } from '../../core/types/config';
import { DEFAULT_MCP_CONFIG } from './types';
import { ToolRegistry } from './tool-registry';
import { registerAllTools, type MCPServiceContainer } from './tools';
import { config } from '../../shared/config';

export interface ServerOptions {
  config?: Partial<MCPServerConfig>;
  services?: MCPServiceContainer;
}

/**
 * MCP 服务器类
 */
export class MCPServer {
  private logger: ILogger;
  private config: MCPServerConfig;
  private toolRegistry: ToolRegistry;
  private isRunning: boolean = false;
  private requestIdCounter: number = 0;
  private services?: MCPServiceContainer;

  constructor(options?: ServerOptions) {
    this.logger = createLogger('mcp-server');
    this.config = this.mergeConfig(options?.config);
    this.services = options?.services;
    this.toolRegistry = new ToolRegistry(this.config);

    // 注册所有工具
    if (this.services) {
      registerAllTools(this.toolRegistry, this.services);
    } else {
      this.logger.warn('MCP Server initialized without services - tools will not be functional');
    }

    this.logger.info('MCP Server initialized');
  }

  /**
   * 合并配置
   */
  private mergeConfig(userConfig?: Partial<MCPServerConfig>): MCPServerConfig {
    let baseConfig = { ...DEFAULT_MCP_CONFIG };

    // 如果传入了配置，优先使用传入的配置
    if (userConfig) {
      if (userConfig.server) {
        baseConfig.server = { ...baseConfig.server, ...userConfig.server };
      }
      if (userConfig.tools) {
        baseConfig.tools = { ...baseConfig.tools, ...userConfig.tools };
      }
      if (userConfig.logging) {
        baseConfig.logging = { ...baseConfig.logging, ...userConfig.logging };
      }
      if (userConfig.performance) {
        baseConfig.performance = { ...baseConfig.performance, ...userConfig.performance };
      }
      return baseConfig;
    }

    // 如果没有传入配置，尝试从 ConfigManager 获取
    try {
      if (config.isInitialized()) {
        const mcpConfig = config.getConfig<MCPServerConfig>('mcp');
        if (mcpConfig) {
          baseConfig = { ...DEFAULT_MCP_CONFIG, ...mcpConfig };
        }
      }
    } catch {
      // ConfigManager 未初始化或获取配置失败，使用默认配置
    }

    return baseConfig;
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('MCP Server is already running');
      return;
    }

    this.logger.info(`Starting MCP Server with ${this.config.server.transport} transport`);
    
    // 根据传输方式启动
    switch (this.config.server.transport) {
      case 'stdio':
        await this.startStdioTransport();
        break;
      case 'sse':
        await this.startSSETransport();
        break;
      case 'websocket':
        await this.startWebSocketTransport();
        break;
      default:
        throw new Error(`Unsupported transport: ${this.config.server.transport}`);
    }

    this.isRunning = true;
    this.logger.info('MCP Server started');
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('MCP Server is not running');
      return;
    }

    this.logger.info('Stopping MCP Server...');
    
    // 清理资源
    await this.toolRegistry.cleanup();
    
    this.isRunning = false;
    this.logger.info('MCP Server stopped');
  }

  /**
   * 处理 MCP 请求
   */
  async handleRequest(request: any): Promise<any> {
    const requestId = ++this.requestIdCounter;
    const startTime = Date.now();

    try {
      this.logger.debug(`Processing request ${requestId}: ${request.method}`);

      // 验证请求
      if (!this.isValidRequest(request)) {
        return this.createErrorResponse(
          request.id,
          -32600,
          'Invalid Request'
        );
      }

      // 处理方法
      const result = await this.handleMethod(request.method, request.params);

      const duration = Date.now() - startTime;
      this.logger.debug(`Request ${requestId} completed in ${duration}ms`);

      return {
        jsonrpc: '2.0',
        id: request.id,
        result,
      };
    } catch (error: any) {
      this.logger.error(`Request ${requestId} failed: ${error.message}`, error);
      
      return this.createErrorResponse(
        request.id,
        error.code || -32603,
        error.message
      );
    }
  }

  /**
   * 验证请求格式
   */
  private isValidRequest(request: any): boolean {
    return (
      request &&
      request.jsonrpc === '2.0' &&
      typeof request.method === 'string' &&
      (request.id === undefined || typeof request.id === 'string' || typeof request.id === 'number')
    );
  }

  /**
   * 处理 MCP 方法
   */
  private async handleMethod(method: string, params: any): Promise<any> {
    switch (method) {
      // 初始化
      case 'initialize':
        return this.handleInitialize(params);
      
      // 工具相关
      case 'tools/list':
        return this.toolRegistry.listTools();
      
      case 'tools/call':
        return this.handleToolCall(params);
      
      // 资源相关
      case 'resources/list':
        return this.toolRegistry.listResources();
      
      case 'resources/read':
        return this.handleResourceRead(params);
      
      // 提示词相关
      case 'prompts/list':
        return this.toolRegistry.listPrompts();
      
      case 'prompts/get':
        return this.handlePromptGet(params);
      
      // 通知
      case 'notifications/initialized':
        return {};
      
      default:
        throw {
          code: -32601,
          message: `Method not found: ${method}`,
        };
    }
  }

  /**
   * 处理初始化
   */
  private handleInitialize(params: any): any {
    this.logger.info('Client initialized', params);

    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      serverInfo: {
        name: 'omms-mcp-server',
        version: '1.0.0',
      },
    };
  }

  /**
   * 处理工具调用
   */
  private async handleToolCall(params: any): Promise<any> {
    const { name, arguments: args } = params;

    if (!name) {
      throw {
        code: -32602,
        message: 'Missing required parameter: name',
      };
    }

    this.logger.info(`Calling tool: ${name}`, args);

    const result = await this.toolRegistry.callTool(name, args);

    return result;
  }

  /**
   * 处理资源读取
   */
  private async handleResourceRead(params: any): Promise<any> {
    const { uri } = params;

    if (!uri) {
      throw {
        code: -32602,
        message: 'Missing required parameter: uri',
      };
    }

    this.logger.info(`Reading resource: ${uri}`);

    const resource = await this.toolRegistry.readResource(uri);

    return {
      contents: [resource],
    };
  }

  /**
   * 处理提示词获取
   */
  private async handlePromptGet(params: any): Promise<any> {
    const { name, arguments: args } = params;

    if (!name) {
      throw {
        code: -32602,
        message: 'Missing required parameter: name',
      };
    }

    this.logger.info(`Getting prompt: ${name}`, args);

    const prompt = await this.toolRegistry.getPrompt(name, args);

    return prompt;
  }

  /**
   * 启动 Stdio 传输
   */
  private async startStdioTransport(): Promise<void> {
    this.logger.info('Starting stdio transport');

    // 监听 stdin
    process.stdin.on('data', async (data) => {
      try {
        const request = JSON.parse(data.toString());
        const response = await this.handleRequest(request);
        
        // 写入 stdout
        process.stdout.write(JSON.stringify(response) + '\n');
      } catch (error: any) {
        this.logger.error('Failed to process stdin data', error);
        
        const errorResponse = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error',
          },
        };
        
        process.stdout.write(JSON.stringify(errorResponse) + '\n');
      }
    });

    this.logger.info('Stdio transport started, waiting for input...');
  }

  /**
   * 启动 SSE 传输
   * SSE (Server-Sent Events) 用于单向事件流推送
   */
  private async startSSETransport(): Promise<void> {
    this.logger.info('Starting SSE transport');

    const { createServer } = await import('node:http');
    const server = createServer((req, res) => {
      // 处理 CORS 预检请求
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }

      // 设置 SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      // 发送初始连接事件
      res.write(`data: ${JSON.stringify({ type: 'connected', server: 'omms-mcp-server' })}\n\n`);

      // 保持连接心跳
      const heartbeat = setInterval(() => {
        res.write(`: heartbeat\n\n`);
      }, 30000);

      // 处理 MCP 请求
      req.on('data', async (data) => {
        try {
          const request = JSON.parse(data.toString());
          const response = await this.handleRequest(request);
          res.write(`data: ${JSON.stringify(response)}\n\n`);
        } catch (error: any) {
          this.logger.error('SSE request failed', error);
          const errorResponse = {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          };
          res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
        }
      });

      // 清理
      req.on('close', () => {
        clearInterval(heartbeat);
      });
    });

    const port = this.config.server.ssePort ?? this.config.server.port ?? 3100;
    const host = this.config.server.host ?? '0.0.0.0';

    server.listen(port, host, () => {
      this.logger.info(`SSE server listening on ${host}:${port}`);
    });

    this.isRunning = true;
  }

  /**
   * 启动 WebSocket 传输
   * 需要 ws 库支持
   */
  private async startWebSocketTransport(): Promise<void> {
    this.logger.info('Starting WebSocket transport');

    try {
      const { createServer } = await import('node:http');
      const { WebSocketServer, WebSocket } = await import('ws');

      const server = createServer();
      const wss = new WebSocketServer({ server });

      wss.on('connection', (ws: WebSocket) => {
        this.logger.info('WebSocket client connected');

        (ws as any).on('message', async (data: Buffer) => {
          try {
            const request = JSON.parse(data.toString());
            const response = await this.handleRequest(request);
            ws.send(JSON.stringify(response));
          } catch (error: unknown) {
            this.logger.error('WebSocket message failed', { error: String(error) });
            const errorResponse = {
              jsonrpc: '2.0',
              id: null,
              error: { code: -32700, message: 'Parse error' },
            };
            ws.send(JSON.stringify(errorResponse));
          }
        });

        (ws as any).on('close', () => {
          this.logger.info('WebSocket client disconnected');
        });

        (ws as any).on('error', (error: unknown) => {
          this.logger.error('WebSocket error', { error: String(error) });
        });
      });

      const port = this.config.server.wsPort ?? this.config.server.port ?? 3200;
      const host = this.config.server.host || '0.0.0.0';

      server.listen(port, host, () => {
        this.logger.info(`WebSocket server listening on ${host}:${port}`);
      });

      this.isRunning = true;
    } catch (error: unknown) {
      this.logger.error('WebSocket transport failed - ws library may not be installed', { error: String(error) });
      throw error;
    }
  }

  /**
   * 创建错误响应
   */
  private createErrorResponse(id: any, code: number, message: string): any {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
      },
    };
  }

  /**
   * 获取服务器状态
   */
  getStatus(): {
    isRunning: boolean;
    transport: string;
    toolCount: number;
  } {
    return {
      isRunning: this.isRunning,
      transport: this.config.server.transport,
      toolCount: this.toolRegistry.getToolCount(),
    };
  }
}

/**
 * 创建 MCP 服务器实例
 */
export function createMCPServer(options?: ServerOptions): MCPServer {
  return new MCPServer(options);
}
