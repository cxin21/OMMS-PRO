/**
 * REST API Server - HTTP 服务器
 *
 * v2.0.0 重构：支持依赖注入
 */

import express, { Application } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger, type ILogger } from '../shared/logging';
import type { RESTAPIConfig } from './types';
import { setupRouter, type RouterDeps } from './router';
import { createLoggerMiddleware } from './middleware/logger';
import { createErrorMiddleware } from './middleware/error-handler';
import { createCORSMiddleware } from './middleware/cors';
import { createAuthMiddleware } from './middleware/auth';
import { createRateLimiterMiddleware } from './middleware/rate-limiter';
import { config } from '../shared/config';
import type { APIConfig } from '../core/types/config';
import compression from 'compression';

export interface ServerOptions {
  config?: Partial<RESTAPIConfig>;
  deps?: RouterDeps;
}


/**
 * REST API 服务器类
 */
export class RESTAPIServer {
  private app: Application;
  private logger: ILogger;
  private config: RESTAPIConfig;
  private server?: any;
  private startTime?: number;
  private deps?: RouterDeps;

  constructor(options?: ServerOptions) {
    this.config = this.mergeConfig(options?.config);

    // 从 ConfigManager 获取全局日志配置（包括 filePath）
    // 以确保 API 服务器的日志写入正确的文件
    let loggingConfig: any = { ...this.config.logging };
    try {
      if (config.isInitialized()) {
        const globalLogging = config.getConfig('logging') as any;
        if (globalLogging?.filePath) {
          loggingConfig.filePath = globalLogging.filePath;
        }
        if (globalLogging?.maxSize) {
          loggingConfig.maxSize = globalLogging.maxSize;
        }
        if (globalLogging?.maxFiles) {
          loggingConfig.maxFiles = globalLogging.maxFiles;
        }
        if (globalLogging?.level) {
          loggingConfig.level = globalLogging.level;
        }
      }
    } catch {
      // 如果获取全局配置失败，使用 RESTAPIConfig 的配置
    }

    this.logger = createLogger('rest-api-server', loggingConfig);
    this.deps = options?.deps;
    this.app = express();
    this.initializeMiddleware();
    if (this.deps) {
      this.setupRoutes();
    }
    this.logger.info('REST API Server initialized', { loggingConfig });
  }

  /**
   * 合并配置
   */
  private mergeConfig(userConfig?: Partial<RESTAPIConfig>): RESTAPIConfig {
    // 从 ConfigManager 获取基础配置
    const managerConfig = config.getConfigOrThrow<APIConfig>('api');
    const baseConfig = this.convertFromAPIConfig(managerConfig);

    // 如果传入了配置，优先使用传入的配置
    if (userConfig) {
      if (userConfig.server) {
        baseConfig.server = { ...baseConfig.server, ...userConfig.server };
        if (userConfig.server.cors) {
          baseConfig.server.cors = { ...baseConfig.server.cors, ...userConfig.server.cors };
        }
      }
      if (userConfig.logging) {
        baseConfig.logging = { ...baseConfig.logging, ...userConfig.logging };
      }
      if (userConfig.security) {
        baseConfig.security = { ...baseConfig.security, ...userConfig.security };
        if (userConfig.security.rateLimit) {
          baseConfig.security.rateLimit = { ...baseConfig.security.rateLimit, ...userConfig.security.rateLimit };
        }
      }
      if (userConfig.performance) {
        baseConfig.performance = { ...baseConfig.performance, ...userConfig.performance };
      }
    }

    return baseConfig;
  }

  /**
   * 将 APIConfig 转换为 RESTAPIConfig
   */
  private convertFromAPIConfig(apiConfig: APIConfig): RESTAPIConfig {
    const origin = Array.isArray(apiConfig.cors.origin)
      ? apiConfig.cors.origin
      : apiConfig.cors.origin === '*' ? ['*'] : [apiConfig.cors.origin];

    return {
      server: {
        host: apiConfig.host,
        port: apiConfig.port,
        timeout: apiConfig.server.timeout,
        cors: {
          enabled: apiConfig.cors.enabled,
          origins: origin as string[],
        },
      },
      logging: {
        level: apiConfig.logging.level,
        enableRequestLogging: apiConfig.logging.enableRequestLogging,
        enableResponseLogging: apiConfig.logging.enableResponseLogging,
        enableFileLogging: apiConfig.logging.enableFileLogging,
        logFilePath: apiConfig.logging.logFilePath,
      },
      security: {
        enableAuth: apiConfig.security.enableAuth,
        apiKey: apiConfig.security.apiKey,
        rateLimit: {
          enabled: apiConfig.security.rateLimit.enabled,
          windowMs: apiConfig.security.rateLimit.windowMs ?? 60000,
          maxRequests: apiConfig.security.rateLimit.maxRequests ?? 100,
        },
      },
      performance: {
        enableCompression: apiConfig.performance.enableCompression,
        maxRequestBodySize: apiConfig.performance.maxRequestBodySize,
      },
    };
  }

  /**
   * 初始化中间件
   */
  private initializeMiddleware(): void {
    // 基础中间件
    this.app.use(express.json({ limit: this.config.performance.maxRequestBodySize }));
    this.app.use(express.urlencoded({ extended: true, limit: this.config.performance.maxRequestBodySize }));

    // 性能中间件
    if (this.config.performance.enableCompression) {
      this.app.use(compression());
    }

    // CORS 中间件
    if (this.config.server.cors.enabled) {
      this.app.use(createCORSMiddleware(this.config.server.cors.origins));
    }

    // 日志中间件
    if (this.config.logging.enableRequestLogging) {
      this.app.use(createLoggerMiddleware(this.logger));
    }

    // 认证中间件
    if (this.config.security.enableAuth && this.config.security.apiKey) {
      this.app.use(createAuthMiddleware(this.config.security.apiKey));
    }

    // 限流中间件
    if (this.config.security.rateLimit.enabled) {
      this.app.use(createRateLimiterMiddleware(
        this.config.security.rateLimit.windowMs,
        this.config.security.rateLimit.maxRequests
      ));
    }
  }

  /**
   * 设置静态文件托管
   *
   * 注意：当 REST API 被挂载到 /api 路径下时（如在 UnifiedServer 中），
   * req.path 已经不包含 /api 前缀，因此需要检查 /v1 等 API 版本前缀
   */
  private setupStaticFiles(): void {
    // 使用 process.cwd() 保证从项目根目录定位，避免 tsx/import.meta.url 路径偏差
    const webUIPath = path.join(process.cwd(), 'dist/web-ui');
    this.logger.debug(`Web UI path: ${webUIPath}`);

    this.app.use(express.static(webUIPath));

    this.app.get('*', (req, res, next) => {
      // 检查是否是 API 路由（当挂载到 /api 时，req.path 已不含 /api 前缀，只检查 /v1）
      if (req.path.startsWith('/v')) {
        return next();
      }
      res.sendFile(path.join(webUIPath, 'index.html'), (err) => {
        if (err) {
          next();
        }
      });
    });
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    if (!this.deps) {
      this.logger.warn('Dependencies not provided, routes will not be set up');
      return;
    }
    setupRouter(this.app, this.logger, this.deps);
    this.setupStaticFiles();
  }

  /**
   * 设置依赖（用于延迟初始化）
   */
  setDependencies(deps: RouterDeps): void {
    this.deps = deps;
    this.setupRoutes();
  }

  /**
   * 启动服务器
   */
  async start(port?: number, host?: string): Promise<void> {
    const targetPort = port ?? this.config.server.port;
    const targetHost = host ?? this.config.server.host;

    return new Promise((resolve, reject) => {
      this.server = this.app.listen(targetPort, targetHost, () => {
        this.startTime = Date.now();
        this.logger.info(`REST API Server started on http://${targetHost}:${targetPort}`);
        resolve();
      });

      this.server.on('error', (error: Error) => {
        this.logger.error('REST API Server failed to start', error);
        reject(error);
      });

      // 设置超时
      this.server.timeout = this.config.server.timeout;
    });
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    if (!this.server) {
      this.logger.warn('Server is not running');
      return;
    }

    return new Promise((resolve, reject) => {
      this.server.close((error?: Error) => {
        if (error) {
          this.logger.error('Error while stopping server', error);
          reject(error);
        } else {
          this.logger.info('REST API Server stopped');
          resolve();
        }
      });
    });
  }

  /**
   * 获取服务器信息
   */
  getServerInfo(): {
    port: number;
    host: string;
    uptime: number;
    running: boolean;
  } {
    const uptime = this.startTime ? Date.now() - this.startTime : 0;
    return {
      port: this.config.server.port,
      host: this.config.server.host,
      uptime,
      running: !!this.server,
    };
  }

  /**
   * 获取 Express 应用实例
   */
  getApp(): Application {
    return this.app;
  }
}

/**
 * 创建 API 服务器实例
 */
export function createRESTAPIServer(options?: ServerOptions): RESTAPIServer {
  return new RESTAPIServer(options);
}
