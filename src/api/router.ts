/**
 * Router - 路由管理
 *
 * v2.0.0 重构：使用依赖注入模式
 */

import { Application, Router } from 'express';
import { createLogger, type ILogger } from '../shared/logging';
import { createErrorMiddleware } from './middleware/error-handler';
import type { MemoryService, MemoryCaptureService } from '../services/memory';
import type { DreamingManager } from '../services/dreaming/dreaming-manager';
import type { ProfileManager } from '../services/profile/profile-manager';
import { createMemoryRoutes, createDreamingRoutes, createProfileRoutes, createSystemRoutes, createGraphRoutes } from './routes';

const API_VERSION = 'v1';

export interface RouterDeps {
  memoryService: MemoryService;
  captureService?: MemoryCaptureService;
  dreamingManager: DreamingManager | null;
  profileManager: ProfileManager;
  graphStore?: import('../infrastructure/storage/core/types').IGraphStore;
}

/**
 * 设置主路由
 */
export function setupRouter(app: Application, logger: ILogger, deps: RouterDeps): void {
  logger.debug('Setting up API routes with dependencies');

  // 创建 API 版本路由
  const apiRouter = Router();
  const versionRouter = Router();

  // 基础路由
  apiRouter.use(`/${API_VERSION}`, versionRouter);

  // 注册所有路由模块
  registerRoutes(versionRouter, logger, deps);

  // 404 处理
  versionRouter.all('*', (req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.path} not found`,
      },
      timestamp: Date.now(),
      version: API_VERSION,
    });
  });

  // 错误处理中间件（必须放在最后）
  app.use(createErrorMiddleware(logger));

  // 使用 API 路由
  // 注意：REST API Server 已经在 unified-server 中被挂载在 /api 路径下
  // 因此这里直接挂载 apiRouter 到根路径，避免路径重复
  app.use(apiRouter);

  logger.info('API routes registered');
}

/**
 * 注册所有路由
 */
function registerRoutes(router: Router, logger: ILogger, deps: RouterDeps): void {
  logger.debug('Registering route modules');

  // Memory 路由
  router.use('/memories', createMemoryRoutes({
    memoryService: deps.memoryService,
    captureService: deps.captureService,
    profileManager: deps.profileManager,
  }));
  logger.debug('Memory routes registered');

  // Dreaming 路由
  router.use('/dreaming', createDreamingRoutes({
    dreamingManager: deps.dreamingManager,
  }));
  logger.debug('Dreaming routes registered');

  // Profile 路由
  router.use('/profile', createProfileRoutes({
    profileManager: deps.profileManager,
  }));
  logger.debug('Profile routes registered');

  // System 路由
  router.use('/system', createSystemRoutes({
    memoryService: deps.memoryService,
    dreamingManager: deps.dreamingManager,
    profileManager: deps.profileManager,
    logger,
  }));
  logger.debug('System routes registered');

  // Graph 路由
  if (deps.graphStore) {
    router.use('/graph', createGraphRoutes({
      graphStore: deps.graphStore,
    }));
    logger.debug('Graph routes registered');
  }

  logger.info('All API routes registered');
}
