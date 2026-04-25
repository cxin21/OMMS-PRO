/**
 * Unified Server - 统一服务器
 * 整合 API Server + MCP Server + Static File Server
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import compression from 'compression';
import { OMMS } from '../index';
import { createRESTAPIServer } from '../api/server';
import { MCPServer } from '../presentation/mcp-server/server';
import { createLogger, type ILogger } from '../shared/logging';
import type { MCPServiceContainer } from '../presentation/mcp-server/tools';

interface UnifiedServerOptions {
  port?: number;
  host?: string;
  enableMCP?: boolean;
  enableWebUI?: boolean;
  webUIPath?: string;
}

interface UnifiedServerComponents {
  omms: OMMS;
  apiServer: ReturnType<typeof createRESTAPIServer>;
  mcpServer?: MCPServer;
  httpServer: ReturnType<typeof createServer>;
  wss?: WebSocketServer;
}

export class UnifiedServer {
  private app: Express;
  private options: Required<UnifiedServerOptions>;
  private logger: ILogger;
  private components?: UnifiedServerComponents;
  private isShuttingDown: boolean = false;

  constructor(options: UnifiedServerOptions = {}) {
    this.app = express();
    this.options = {
      port: options.port ?? 3000,
      host: options.host ?? '0.0.0.0',
      enableMCP: options.enableMCP ?? true,
      enableWebUI: options.enableWebUI ?? true,
      webUIPath: options.webUIPath ?? './dist/web-ui',
    };
    this.logger = createLogger('UnifiedServer');
  }

  /**
   * Start the unified server
   */
  async start(): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Server is shutting down');
    }

    this.logger.info('Starting Unified Server...');

    try {
      // 1. Initialize OMMS
      this.logger.info('Initializing OMMS...');
      const omms = new OMMS();
      await omms.initialize();

      // 2. Create API server with dependencies
      this.logger.info('Creating API Server...');
      const apiServer = createRESTAPIServer({
        deps: {
          memoryService: omms.memoryService,
          dreamingManager: omms.dreamingManager,
          profileManager: omms.profileManager,
          graphStore: omms.graphStore,
          captureService: omms.captureService,
        },
      });

      // 3. Create HTTP server
      const httpServer = createServer(this.app);

      // 4. Setup middleware
      this.setupMiddleware();

      // 5. Mount API routes at /api
      this.logger.info('Mounting API routes at /api...');
      this.app.use('/api', apiServer.getApp());

      // 6. Mount MCP at /mcp/sse and /mcp/ws
      let mcpServer: MCPServer | undefined;
      if (this.options.enableMCP) {
        this.logger.info('Setting up MCP Server...');
        mcpServer = this.setupMCP(omms, httpServer);
      }

      // 7. Mount static files at /
      if (this.options.enableWebUI) {
        this.logger.info('Mounting static files...');
        this.setupStaticFiles();
      }

      // 8. Health check at /health
      this.setupHealthCheck();

      // 9. Error handling
      this.setupErrorHandling();

      // 10. Start HTTP server
      await this.startHTTPServer(httpServer);

      // Store components for shutdown
      this.components = {
        omms,
        apiServer,
        mcpServer,
        httpServer,
        wss: mcpServer ? this.createWebSocketServer(httpServer) : undefined,
      };

      this.logger.info(`Unified Server started on http://${this.options.host}:${this.options.port}`);
    } catch (error: unknown) {
      this.logger.error('Failed to start Unified Server', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // JSON parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Compression
    this.app.use(compression());

    // Request logging
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      this.logger.debug(`${req.method} ${req.path}`);
      next();
    });
  }

  /**
   * Setup MCP Server routes
   */
  private setupMCP(omms: OMMS, httpServer: ReturnType<typeof createServer>): MCPServer {
    // Create MCP service container
    const services: MCPServiceContainer = {
      memoryService: omms.memoryService,
      dreamingManager: omms.dreamingManager,
      profileManager: omms.profileManager,
      palaceStore: omms.palaceStore,
      graphStore: omms.graphStore,
    };

    // Create MCP server instance
    const mcpServer = new MCPServer({ services });

    // Setup SSE endpoint
    this.setupSSEEndpoint(mcpServer);

    return mcpServer;
  }

  /**
   * Setup SSE endpoint for MCP
   */
  private setupSSEEndpoint(mcpServer: MCPServer): void {
    this.app.get('/mcp/sse', (req: Request, res: Response) => {
      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      // Send initial connection event
      res.write(`data: ${JSON.stringify({ type: 'connected', server: 'omms-mcp-server' })}\n\n`);

      // Keep-alive heartbeat
      const heartbeat = setInterval(() => {
        res.write(`: heartbeat\n\n`);
      }, 30000);

      // Handle incoming POST requests with MCP JSON-RPC messages
      const handleMessage = async (data: string) => {
        try {
          const request = JSON.parse(data);
          const response = await mcpServer.handleRequest(request);
          res.write(`data: ${JSON.stringify(response)}\n\n`);
        } catch (error: unknown) {
          this.logger.error('SSE MCP request failed', error instanceof Error ? error : new Error(String(error)));
          const errorResponse = {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          };
          res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
        }
      };

      // Handle POST requests with size limit
      let postDataSize = 0;
      const maxPostDataSize = 10 * 1024 * 1024; // 10MB limit
      req.on('data', (data: Buffer) => {
        postDataSize += data.length;
        if (postDataSize > maxPostDataSize) {
          res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Payload too large' } })}\n\n`);
          req.destroy();
          return;
        }
        handleMessage(data.toString());
      });

      // Handle client disconnect
      req.on('close', () => {
        clearInterval(heartbeat);
        this.logger.debug('SSE client disconnected');
      });

      // Handle errors - cleanup heartbeat interval
      req.on('error', () => {
        clearInterval(heartbeat);
        this.logger.debug('SSE client error - cleanup');
      });
    });

    this.logger.debug('MCP SSE endpoint mounted at /mcp/sse');
  }

  /**
   * Create WebSocket server for MCP
   */
  private createWebSocketServer(httpServer: ReturnType<typeof createServer>): WebSocketServer {
    const wss = new WebSocketServer({ server: httpServer, path: '/mcp/ws' });

    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.logger.info('MCP WebSocket client connected');

      ws.on('message', async (data: Buffer) => {
        try {
          const request = JSON.parse(data.toString());
          const response = await this.components?.mcpServer?.handleRequest(request);
          if (response) {
            ws.send(JSON.stringify(response));
          }
        } catch (error: unknown) {
          this.logger.error('WebSocket MCP message failed', { error: String(error) });
          const errorResponse = {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          };
          ws.send(JSON.stringify(errorResponse));
        }
      });

      ws.on('close', () => {
        this.logger.debug('MCP WebSocket client disconnected');
      });

      ws.on('error', (error: unknown) => {
        this.logger.error('MCP WebSocket error', { error: String(error) });
      });
    });

    wss.on('error', (error: unknown) => {
      this.logger.error('WebSocket server error', { error: String(error) });
    });

    this.logger.debug('MCP WebSocket endpoint mounted at /mcp/ws');
    return wss;
  }

  /**
   * Setup static file serving for Web UI
   */
  private setupStaticFiles(): void {
    const webUIPath = path.resolve(process.cwd(), this.options.webUIPath);
    this.logger.debug(`Web UI path: ${webUIPath}`);

    // Serve static files
    this.app.use(express.static(webUIPath));

    // SPA fallback - serve index.html for non-API routes
    this.app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/mcp')) {
        return next();
      }
      res.sendFile(path.join(webUIPath, 'index.html'), (err) => {
        if (err) {
          this.logger.warn(`Could not serve index.html: ${err.message}`);
          next();
        }
      });
    });
  }

  /**
   * Setup health check endpoint
   */
  private setupHealthCheck(): void {
    this.app.get('/health', (req: Request, res: Response) => {
      const status = {
        status: 'ok',
        timestamp: Date.now(),
        uptime: process.uptime(),
        components: {
          omms: this.components?.omms.isInitialized() ?? false,
          api: !!this.components?.apiServer,
          mcp: !!this.components?.mcpServer,
        },
      };
      res.json(status);
    });

    this.logger.debug('Health check endpoint mounted at /health');
  }

  /**
   * Setup error handling
   */
  private setupErrorHandling(): void {
    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Route ${req.method} ${req.path} not found`,
        },
        timestamp: Date.now(),
      });
    });

    // Global error handler
    this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      this.logger.error('Unhandled error', err);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An internal error occurred',
        },
        timestamp: Date.now(),
      });
    });
  }

  /**
   * Start HTTP server
   */
  private startHTTPServer(httpServer: ReturnType<typeof createServer>): Promise<void> {
    return new Promise((resolve, reject) => {
      httpServer.on('error', (error: Error) => {
        this.logger.error('HTTP server error', error);
        reject(error);
      });

      httpServer.listen(this.options.port, this.options.host, () => {
        this.logger.info(`HTTP server listening on ${this.options.host}:${this.options.port}`);
        resolve();
      });
    });
  }

  /**
   * Gracefully shutdown all components
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.warn('Server is already shutting down');
      return;
    }

    this.isShuttingDown = true;
    this.logger.info('Shutting down Unified Server...');

    try {
      // 1. Stop accepting new connections
      if (this.components?.httpServer) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            this.logger.warn('HTTP server close timeout - forcing');
            resolve();
          }, 5000);
          this.components!.httpServer.close(() => {
            clearTimeout(timeout);
            this.logger.debug('HTTP server closed');
            resolve();
          });
        });
      }

      // 2. Close WebSocket server
      if (this.components?.wss) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            this.logger.warn('WebSocket server close timeout - forcing');
            resolve();
          }, 5000);
          this.components!.wss!.close(() => {
            clearTimeout(timeout);
            this.logger.debug('WebSocket server closed');
            resolve();
          });
        });
      }

      // 3. Shutdown OMMS
      if (this.components?.omms) {
        try {
          await this.components.omms.shutdown();
          this.logger.debug('OMMS shutdown complete');
        } catch (error: unknown) {
          this.logger.error('OMMS shutdown error', error instanceof Error ? error : new Error(String(error)));
        }
      }

      this.logger.info('Unified Server shutdown complete');
    } catch (error: unknown) {
      this.logger.error('Error during shutdown', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get the Express app instance
   */
  getApp(): Express {
    return this.app;
  }

  /**
   * Get server status
   */
  getStatus(): {
    running: boolean;
    port: number;
    host: string;
    components: {
      omms: boolean;
      api: boolean;
      mcp: boolean;
      websocket: boolean;
    };
  } {
    return {
      running: !this.isShuttingDown && !!this.components,
      port: this.options.port,
      host: this.options.host,
      components: {
        omms: !!this.components?.omms?.isInitialized(),
        api: !!this.components?.apiServer,
        mcp: !!this.components?.mcpServer,
        websocket: !!this.components?.wss,
      },
    };
  }
}

export default UnifiedServer;
