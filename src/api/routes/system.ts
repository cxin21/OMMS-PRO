/**
 * System Routes - 系统接口
 *
 * 提供系统健康检查、统计和日志查看
 */

import { Router, Request, Response } from 'express';
import { createReadStream, existsSync, statSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import type { MemoryService } from '../../services/memory';
import type { DreamingManager } from '../../services/dreaming/dreaming-manager';
import type { ProfileManager } from '../../services/profile/profile-manager';
import type { ILogger } from '../../shared/logging';
import { config } from '../../shared/config';
import { ConfigLoader } from '../../shared/config/loader';

export interface SystemRoutesDeps {
  memoryService: MemoryService;
  dreamingManager: DreamingManager | null;
  profileManager: ProfileManager | null;
  logger: ILogger;
}

export function createSystemRoutes(deps: SystemRoutesDeps): Router {
  const router = Router();

  /**
   * GET /api/system/health
   * 健康检查
   */
  router.get('/health', async (req: Request, res: Response) => {
    try {
      const checks = {
        memoryService: !!deps.memoryService,
        dreamingManager: !!deps.dreamingManager,
        profileManager: !!deps.profileManager,
        timestamp: Date.now(),
      };

      const isHealthy = checks.memoryService;

      res.status(isHealthy ? 200 : 503).json({
        success: isHealthy,
        data: {
          status: isHealthy ? 'healthy' : 'unhealthy',
          checks,
          uptime: process.uptime(),
          timestamp: checks.timestamp,
        },
      });
    } catch (error) {
      res.status(503).json({
        success: false,
        data: {
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
        },
      });
    }
  });

  /**
   * POST /api/system/logs/write
   * 写入日志条目（供插件等外部模块使用）
   */
  router.post('/logs/write', async (req: Request, res: Response) => {
    try {
      const { level = 'info', message, module: moduleName, data } = req.body as {
        level?: 'debug' | 'info' | 'warn' | 'error';
        message: string;
        module?: string;
        data?: Record<string, unknown>;
      };

      if (!message) {
        res.status(400).json({
          success: false,
          error: 'message is required',
        });
        return;
      }

      const validLevels = ['debug', 'info', 'warn', 'error'];
      if (!validLevels.includes(level)) {
        res.status(400).json({
          success: false,
          error: `Invalid level. Must be one of: ${validLevels.join(', ')}`,
        });
        return;
      }

      const targetModule = moduleName || 'plugin';
      const pluginLogger = deps.logger.child(targetModule);

      switch (level) {
        case 'debug':
          pluginLogger.debug(message, data);
          break;
        case 'info':
          pluginLogger.info(message, data);
          break;
        case 'warn':
          pluginLogger.warn(message, data);
          break;
        case 'error':
          pluginLogger.error(message, data);
          break;
      }

      res.json({
        success: true,
        data: {
          logged: true,
          level,
          module: targetModule,
          message,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to write log',
      });
    }
  });

  /**
   * GET /api/system/stats
   * 系统统计（实时查询，不使用缓存）
   */
  router.get('/stats', async (req: Request, res: Response) => {
    try {
      // 实时查询，不使用任何缓存
      const stats = {
        totalMemories: 0,
        memoriesByType: {} as Record<string, number>,
        memoriesByScope: { session: 0, agent: 0, global: 0 } as Record<string, number>,
        avgImportanceScore: 0,
        avgScopeScore: 0,
        dreamingRuns: 0,
        lastDreamingRun: null as number | null,
      };

      if (deps.memoryService) {
        // 只统计最新版本的记录（isLatestVersion = 1）
        const storeStats = await deps.memoryService.getStoreManagerStats();
        stats.totalMemories = await deps.memoryService.metaStore.count({ isLatestVersion: true });
        stats.avgScopeScore = storeStats.avgScopeScore;

        // 只查询最新版本的 byScope 和 byType
        const latestMetas = await deps.memoryService.metaStore.query({
          isLatestVersion: true,
          limit: 10000,
        } as any);

        // 重新统计 byScope 和 byType（因为 metaStats 可能包含旧版本）
        const byScope: Record<string, number> = {};
        const byType: Record<string, number> = {};
        let totalImportance = 0;

        for (const m of latestMetas) {
          byScope[m.scope] = (byScope[m.scope] || 0) + 1;
          byType[m.type] = (byType[m.type] || 0) + 1;
          totalImportance += m.importanceScore;
        }

        stats.memoriesByScope = byScope as typeof stats.memoriesByScope;
        stats.memoriesByType = byType;
        stats.avgImportanceScore = latestMetas.length > 0
          ? Math.round((totalImportance / latestMetas.length) * 100) / 100
          : 0;
      }

      if (deps.dreamingManager) {
        try {
          const dreamStats = await deps.dreamingManager.getStats();
          stats.dreamingRuns = dreamStats.totalReports;
          stats.lastDreamingRun = dreamStats.lastReportAt || null;
        } catch {
          // Dreaming 统计获取失败
        }
      }

      res.json({ success: true, data: stats });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get system stats',
      });
    }
  });

  /**
   * GET /api/system/logs
   * 获取日志文件列表和旋转信息
   */
  router.get('/logs', async (req: Request, res: Response) => {
    try {
      // 从配置获取日志路径
      let logDir: string;
      let logFilePath: string;

      try {
        if (config.isInitialized()) {
          const loggingConfig = config.getConfig('logging') as { filePath?: string; maxFiles?: number; maxSize?: number };
          logFilePath = loggingConfig?.filePath || './logs/omms.log';
          logDir = join(logFilePath, '..');
        } else {
          logFilePath = './logs/omms.log';
          logDir = './logs';
        }
      } catch {
        logFilePath = './logs/omms.log';
        logDir = './logs';
      }

      const baseName = basename(logFilePath);
      const logFiles: Array<{
        name: string;
        path: string;
        size: number;
        modifiedAt: number;
        isMain: boolean;
      }> = [];

      // 读取主日志文件
      if (existsSync(logFilePath)) {
        const stat = statSync(logFilePath);
        logFiles.push({
          name: baseName,
          path: logFilePath,
          size: stat.size,
          modifiedAt: stat.mtimeMs,
          isMain: true,
        });

        // 读取旋转文件
        try {
          const files = readdirSync(logDir);
          for (const file of files) {
            if (file.startsWith(baseName + '.') && file !== baseName) {
              const filePath = join(logDir, file);
              if (existsSync(filePath)) {
                const fileStat = statSync(filePath);
                logFiles.push({
                  name: file,
                  path: filePath,
                  size: fileStat.size,
                  modifiedAt: fileStat.mtimeMs,
                  isMain: false,
                });
              }
            }
          }
        } catch {
          // 读取旋转文件失败，忽略
        }
      }

      // 获取旋转配置
      let rotationConfig = { maxSize: 10485760, maxFiles: 5 };
      try {
        if (config.isInitialized()) {
          rotationConfig = {
            maxSize: (config.getConfig('logging') as { maxSize?: number })?.maxSize ?? 10485760,
            maxFiles: (config.getConfig('logging') as { maxFiles?: number })?.maxFiles ?? 5,
          };
        }
      } catch {
        // 配置获取失败，使用默认值
      }

      res.json({
        success: true,
        data: {
          files: logFiles,
          rotationConfig,
          logDir,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get log files',
      });
    }
  });

  /**
   * GET /api/system/logs/content
   * 获取日志文件内容
   */
  router.get('/logs/content', async (req: Request, res: Response) => {
    try {
      const { file: fileName, offset = '0', limit = '1000' } = req.query as {
        file?: string;
        offset?: string;
        limit?: string;
      };

      // 从配置获取日志路径
      let logDir: string;
      let defaultLogFile: string;

      try {
        if (config.isInitialized()) {
          const loggingConfig = config.getConfig('logging') as { filePath?: string };
          defaultLogFile = loggingConfig?.filePath || './logs/omms.log';
          logDir = join(defaultLogFile, '..');
        } else {
          defaultLogFile = './logs/omms.log';
          logDir = './logs';
        }
      } catch {
        defaultLogFile = './logs/omms.log';
        logDir = './logs';
      }

      const targetFile = fileName
        ? join(logDir, fileName)
        : defaultLogFile;

      // 安全检查：确保文件在日志目录内
      if (!targetFile.startsWith(logDir)) {
        res.status(403).json({
          success: false,
          error: 'Invalid file path',
        });
        return;
      }

      if (!existsSync(targetFile)) {
        res.status(404).json({
          success: false,
          error: 'Log file not found',
        });
        return;
      }

      const startOffset = parseInt(offset as string, 10) || 0;
      const lineLimit = parseInt(limit as string, 10) || 1000;

      // 使用流式读取
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Transfer-Encoding', 'chunked');

      let linesRead = 0;
      let bytesSkipped = 0;
      let totalLines = 0;
      const allLines: string[] = [];

      // 首先统计总行数
      return new Promise<void>((resolve, reject) => {
        const stream = createReadStream(targetFile, { encoding: 'utf8' });

        stream.on('data', (chunk: string | Buffer) => {
          const chunkStr = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
          const chunkLines = chunkStr.split('\n');
          totalLines += chunkLines.length - 1;

          // 如果还没到偏移量，跳过这些行
          if (bytesSkipped < startOffset) {
            bytesSkipped += Buffer.byteLength(chunk, 'utf8');
            // 计算需要跳过多少行
            let lineCount = 0;
            let charCount = 0;
            for (const line of chunkStr.split('\n')) {
              charCount += line.length + 1;
              if (charCount <= bytesSkipped) {
                lineCount++;
              } else {
                break;
              }
            }
            // 只保留从偏移量开始的行
            const remainingLines = chunkLines.slice(lineCount);
            allLines.push(...remainingLines);
          } else {
            allLines.push(...chunkLines);
          }
        });

        stream.on('end', () => {
          // 应用行数限制
          const startLine = Math.max(0, startOffset);
          const slicedLines = allLines.slice(startLine, startLine + lineLimit);

          res.json({
            success: true,
            data: {
              file: basename(targetFile),
              lines: slicedLines,
              totalLines: allLines.length,
              offset: startLine,
              limit: lineLimit,
              hasMore: startLine + lineLimit < allLines.length,
            },
          });
          res.end();
          resolve();
        });

        stream.on('error', (err) => {
          res.status(500).json({
            success: false,
            error: err.message,
          });
          res.end();
          reject(err);
        });
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read log file',
      });
    }
  });

  // ============================================================
  // Config Management Routes
  // ============================================================

  /**
   * GET /api/system/config
   * 获取当前配置（从 ConfigManager 读取）
   */
  router.get('/config', async (req: Request, res: Response) => {
    try {
      if (!config.isInitialized()) {
        res.status(503).json({
          success: false,
          error: 'ConfigManager not initialized',
        });
        return;
      }

      const { path } = req.query as { path?: string };
      let configData;

      if (path) {
        configData = config.getConfig(path);
      } else {
        configData = config.getConfig() as Record<string, unknown>;
        if (configData && typeof configData === 'object') {
          const sensitiveKeys = ['apiKey', 'password', 'secret', 'token'];
          for (const key of sensitiveKeys) {
            if (key in configData) {
              (configData as Record<string, unknown>)[key] = '***REDACTED***';
            }
          }
        }
      }

      res.json({
        success: true,
        data: configData,
        path: path || 'root',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get config',
      });
    }
  });

  /**
   * PUT /api/system/config
   * 更新配置（写入 ConfigManager 和配置文件）
   */
  router.put('/config', async (req: Request, res: Response) => {
    try {
      if (!config.isInitialized()) {
        res.status(503).json({
          success: false,
          error: 'ConfigManager not initialized',
        });
        return;
      }

      const { path, value, persist = true } = req.body as {
        path: string;
        value: unknown;
        persist?: boolean;
      };

      if (!path) {
        res.status(400).json({
          success: false,
          error: 'path is required',
        });
        return;
      }

      await config.updateConfig(path, value, persist);

      res.json({
        success: true,
        data: { path, value },
        message: persist ? 'Config updated and persisted' : 'Config updated (not persisted)',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update config',
      });
    }
  });

  /**
   * POST /api/system/config/reset
   * 重置配置到默认值
   */
  router.post('/config/reset', async (req: Request, res: Response) => {
    try {
      if (!config.isInitialized()) {
        res.status(503).json({
          success: false,
          error: 'ConfigManager not initialized',
        });
        return;
      }

      const { path } = req.body as { path?: string };

      if (path) {
        const loader = new ConfigLoader();
        const defaults = loader.loadDefaults();
        const pathParts = path.split('.');
        let defaultValue: unknown = defaults;
        for (const part of pathParts) {
          defaultValue = (defaultValue as Record<string, unknown>)?.[part];
        }

        if (defaultValue !== undefined) {
          await config.updateConfig(path, defaultValue, true);
        }
      }

      res.json({
        success: true,
        message: path ? `Config reset to default for ${path}` : 'Full config reset requested',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reset config',
      });
    }
  });

  // ============================================================
  // Module Status Routes
  // ============================================================

  /**
   * GET /api/system/modules
   * 获取所有模块的状态
   */
  router.get('/modules', async (req: Request, res: Response) => {
    try {
      const modules = [];

      // MemoryService 模块
      if (deps.memoryService) {
        try {
          const storeStats = await deps.memoryService.getStoreManagerStats();
          const degradationStats = await deps.memoryService.getDegradationStats();
          const metaCount = await deps.memoryService.metaStore.count({ isLatestVersion: true } as any);

          modules.push({
            id: 'memory-service',
            name: 'MemoryService',
            description: '核心记忆存储与召回服务',
            status: 'running',
            stats: {
              totalMemories: metaCount,
              avgScopeScore: storeStats.avgScopeScore,
              archivedCount: degradationStats.archivedMemories,
              deletedCount: degradationStats.deletedMemories,
            },
            subModules: [
              { id: 'cache', name: 'CacheManager', status: 'running' },
              { id: 'vector-store', name: 'VectorStore', status: 'running' },
              { id: 'meta-store', name: 'SQLiteMetaStore', status: 'running' },
              { id: 'palace-store', name: 'PalaceStore', status: 'running' },
              { id: 'graph-store', name: 'GraphStore', status: 'running' },
            ],
          });
        } catch (e) {
          modules.push({
            id: 'memory-service',
            name: 'MemoryService',
            description: '核心记忆存储与召回服务',
            status: 'error',
            error: e instanceof Error ? e.message : 'Unknown error',
          });
        }
      } else {
        modules.push({
          id: 'memory-service',
          name: 'MemoryService',
          description: '核心记忆存储与召回服务',
          status: 'stopped',
        });
      }

      // DreamingManager 模块
      if (deps.dreamingManager) {
        try {
          const dreamStats = await deps.dreamingManager.getStats();
          const fragMetrics = await deps.dreamingManager.getFragmentationMetrics();

          modules.push({
            id: 'dreaming-manager',
            name: 'DreamingManager',
            description: '记忆整理与优化引擎',
            status: dreamStats.totalReports > 0 ? 'running' : 'idle',
            stats: {
              totalReports: dreamStats.totalReports,
              lastRunAt: dreamStats.lastReportAt,
              avgDuration: dreamStats.avgDuration,
              palaceFragmentation: fragMetrics.palaceFragmentation,
              orphanedMemories: fragMetrics.orphanedMemories,
              staleMemories: fragMetrics.staleMemories,
            },
            subModules: [
              { id: 'consolidation', name: 'ConsolidationEngine', status: 'running' },
              { id: 'reorganization', name: 'ReorganizationEngine', status: 'running' },
              { id: 'archival', name: 'ArchivalEngine', status: 'running' },
              { id: 'scheduler', name: 'Scheduler', status: 'running' },
            ],
          });
        } catch (e) {
          modules.push({
            id: 'dreaming-manager',
            name: 'DreamingManager',
            description: '记忆整理与优化引擎',
            status: 'error',
            error: e instanceof Error ? e.message : 'Unknown error',
          });
        }
      } else {
        modules.push({
          id: 'dreaming-manager',
          name: 'DreamingManager',
          description: '记忆整理与优化引擎',
          status: 'stopped',
        });
      }

      // ProfileManager 模块
      if (deps.profileManager) {
        try {
          modules.push({
            id: 'profile-manager',
            name: 'ProfileManager',
            description: '用户画像与偏好管理服务',
            status: 'running',
            stats: {},
            subModules: [
              { id: 'persona-builder', name: 'PersonaBuilder', status: 'running' },
              { id: 'preference-inference', name: 'PreferenceInference', status: 'running' },
              { id: 'interaction-tracker', name: 'InteractionTracker', status: 'running' },
            ],
          });
        } catch (e) {
          modules.push({
            id: 'profile-manager',
            name: 'ProfileManager',
            description: '用户画像与偏好管理服务',
            status: 'error',
            error: e instanceof Error ? e.message : 'Unknown error',
          });
        }
      } else {
        modules.push({
          id: 'profile-manager',
          name: 'ProfileManager',
          description: '用户画像与偏好管理服务',
          status: 'stopped',
        });
      }

      res.json({
        success: true,
        data: {
          modules,
          totalModules: modules.length,
          runningModules: modules.filter(m => m.status === 'running' || m.status === 'idle').length,
          timestamp: Date.now(),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get module status',
      });
    }
  });

  /**
   * GET /api/system/config-schema
   * 获取配置结构说明
   */
  router.get('/config-schema', async (req: Request, res: Response) => {
    try {
      const schema = {
        memoryService: {
          capture: { description: '记忆捕获配置', fields: ['maxMemoriesPerCapture', 'similarityThreshold', 'confidenceThreshold', 'enableLLMSummarization', 'llmProvider', 'llmApiKey', 'llmEndpoint', 'llmModel'] },
          store: { description: '记忆存储配置', fields: ['blockThresholds', 'scopeUpgradeThresholds', 'autoExtract', 'autoChunk', 'chunkThreshold'] },
          recall: { description: '记忆召回配置', fields: ['defaultLimit', 'maxLimit', 'minSimilarity', 'vectorWeight', 'keywordWeight'] },
          forget: { description: '记忆遗忘配置', fields: ['decayRate', 'archiveThreshold', 'deleteThreshold', 'protectLevel', 'checkInterval'] },
          reinforce: { description: '记忆强化配置', fields: ['boostThresholds', 'scopeUpgrade'] },
          degradation: { description: '作用域降级配置', fields: ['decayRate', 'checkInterval'] },
          cache: { description: '缓存配置', fields: ['maxSize', 'ttl'] },
          version: { description: '版本管理配置', fields: ['similarityThreshold', 'maxVersions', 'enableVersioning'] },
        },
        dreamingEngine: {
          scheduler: { description: '调度器配置', fields: ['autoOrganize', 'organizeInterval', 'memoryThreshold', 'fragmentationThreshold'] },
          consolidation: { description: '合并配置', fields: ['similarityThreshold', 'maxGroupSize', 'preserveNewest'] },
          reorganization: { description: '重组配置', fields: ['minEdgeWeight', 'densityTarget', 'orphanThreshold'] },
          archival: { description: '归档配置', fields: ['importanceThreshold', 'stalenessDays', 'retentionDays'] },
        },
        embedding: { description: 'Embedding服务配置', fields: ['model', 'dimensions', 'baseURL', 'apiKey', 'batchSize'] },
        logging: { description: '日志配置', fields: ['level', 'output', 'filePath', 'maxSize', 'maxFiles'] },
      };

      res.json({
        success: true,
        data: schema,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get config schema',
      });
    }
  });

  return router;
}
