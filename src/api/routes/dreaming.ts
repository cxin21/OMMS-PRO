/**
 * Dreaming Routes - 梦境引擎接口
 *
 * 提供记忆整理相关操作
 */

import { Router, Request, Response } from 'express';
import type { DreamingManager } from '../../services/dreaming/dreaming-manager';
import { OrganizationType } from '../../services/dreaming/types';
import { config } from '../../shared/config';

export interface DreamingRoutesDeps {
  dreamingManager: DreamingManager | null;
}

function notAvailable(res: Response): void {
  res.status(503).json({
    success: false,
    error: 'DreamingManager is not initialized',
  });
}

export function createDreamingRoutes(deps: DreamingRoutesDeps): Router {
  const router = Router();

  /**
   * POST /api/dreaming/start
   * 启动梦境
   */
  router.post('/start', async (req: Request, res: Response) => {
    if (!deps.dreamingManager) { notAvailable(res); return; }
    try {
      const report = await deps.dreamingManager.dream({
        type: 'all' as any,
      });

      res.json({
        success: true,
        data: {
          reportId: report.id,
          status: report.status,
          totalRuns: 1,
          consolidatedMemories: report.memoriesMerged || 0,
          reorganizedClusters: 0,
          archivedMemories: report.memoriesArchived || 0,
          isRunning: false,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start dreaming',
      });
    }
  });

  /**
   * GET /api/dreaming/history
   * 获取梦境历史
   */
  router.get('/history', async (req: Request, res: Response) => {
    if (!deps.dreamingManager) { notAvailable(res); return; }
    try {
      const reports = await deps.dreamingManager.getAllReports();

      res.json({
        success: true,
        data: reports.map((r: any) => ({
          id: r.id,
          type: r.type,
          status: r.status,
          phases: r.phases,
          memoriesMerged: r.memoriesMerged || 0,
          memoriesArchived: r.memoriesArchived || 0,
          memoriesDeleted: r.memoriesDeleted || 0,
          relationsRebuilt: r.relationsRebuilt || 0,
          storageFreed: r.storageFreed || 0,
          totalDuration: r.totalDuration || 0,
          executedAt: r.executedAt,
        })),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get history',
      });
    }
  });

  /**
   * POST /api/dreaming/organize
   * 触发记忆整理
   *
   * 请求体:
   * {
   *   type?: 'all' | 'consolidation' | 'reorganization' | 'archival',
   *   limit?: number
   * }
   */
  router.post('/organize', async (req: Request, res: Response) => {
    if (!deps.dreamingManager) { notAvailable(res); return; }
    try {
      const { type, limit } = req.body as {
        type?: 'all' | 'consolidation' | 'reorganization' | 'archival';
        limit?: number;
      };

      const orgType = type === 'all' ? OrganizationType.ALL :
                      type === 'consolidation' ? OrganizationType.CONSOLIDATION :
                      type === 'reorganization' ? OrganizationType.REORGANIZATION :
                      type === 'archival' ? OrganizationType.ARCHIVAL :
                      OrganizationType.ALL;

      const report = await deps.dreamingManager.dream({
        type: orgType,
        limit,
      });

      res.json({
        success: true,
        data: {
          id: report.id,
          reportId: report.id,
          type: report.type,
          status: report.status,
          phases: report.phases,
          memoriesMerged: report.memoriesMerged,
          memoriesArchived: report.memoriesArchived,
          memoriesDeleted: report.memoriesDeleted || 0,
          relationsRebuilt: report.relationsRebuilt,
          storageFreed: report.storageFreed,
          totalDuration: report.totalDuration,
          executedAt: report.executedAt,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to organize memories',
      });
    }
  });

  /**
   * GET /api/dreaming/status
   * 获取碎片化指标
   */
  router.get('/status', async (req: Request, res: Response) => {
    if (!deps.dreamingManager) { notAvailable(res); return; }
    try {
      const metrics = await deps.dreamingManager.getFragmentationMetrics();

      res.json({
        success: true,
        data: {
          palaceFragmentation: metrics.palaceFragmentation,
          graphEdgeDensity: metrics.graphEdgeDensity,
          orphanedMemories: metrics.orphanedMemories,
          staleMemories: metrics.staleMemories,
          lastDefragmentationAt: metrics.lastDefragmentationAt,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get fragmentation status',
      });
    }
  });

  /**
   * GET /api/dreaming/stats
   * 获取整理统计
   */
  router.get('/stats', async (req: Request, res: Response) => {
    if (!deps.dreamingManager) { notAvailable(res); return; }
    try {
      const stats = await deps.dreamingManager.getStats();

      res.json({
        success: true,
        data: {
          totalReports: stats.totalReports,
          lastReportAt: stats.lastReportAt,
          avgDuration: stats.avgDuration,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get stats',
      });
    }
  });

  /**
   * POST /api/dreaming/consolidate
   * 触发记忆归纳整理（模拟人类睡眠时的记忆整理）
   */
  router.post('/consolidate', async (req: Request, res: Response) => {
    if (!deps.dreamingManager) { notAvailable(res); return; }
    try {
      const { date, minGroupSize, similarityThreshold, limit } = req.body || {};

      const result = await deps.dreamingManager.consolidateMemories({
        date,
        minGroupSize,
        similarityThreshold,
        limit,
      });

      res.json({
        success: true,
        data: {
          processedCount: result.processedCount,
          groupsFormed: result.groupsFormed,
          newVersionsCreated: result.newVersionsCreated,
          archivedOldVersions: result.archivedOldVersions,
          errors: result.errors,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to consolidate memories',
      });
    }
  });

  /**
   * GET /api/dreaming/config
   * 获取当前整理配置
   */
  router.get('/config', async (req: Request, res: Response) => {
    if (!deps.dreamingManager) { notAvailable(res); return; }
    try {
      res.json({
        success: true,
        data: {
          scheduler: deps.dreamingManager.getSchedulerConfig(),
          consolidation: deps.dreamingManager.getConsolidationConfig(),
          reorganization: deps.dreamingManager.getReorganizationConfig(),
          archival: deps.dreamingManager.getArchivalConfig(),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get config',
      });
    }
  });

  /**
   * PUT /api/dreaming/config
   * 更新整理配置（同时持久化到配置文件）
   */
  router.put('/config', async (req: Request, res: Response) => {
    if (!deps.dreamingManager) { notAvailable(res); return; }
    try {
      const { consolidation, reorganization, archival, scheduler } = req.body;

      if (consolidation) {
        deps.dreamingManager.updateConsolidationConfig(consolidation);
        // 持久化到配置文件
        if (config.isInitialized()) {
          for (const [key, value] of Object.entries(consolidation)) {
            await config.updateConfig(`dreamingEngine.consolidation.${key}`, value, true);
          }
        }
      }
      if (reorganization) {
        deps.dreamingManager.updateReorganizationConfig(reorganization);
        if (config.isInitialized()) {
          for (const [key, value] of Object.entries(reorganization)) {
            await config.updateConfig(`dreamingEngine.reorganization.${key}`, value, true);
          }
        }
      }
      if (archival) {
        deps.dreamingManager.updateArchivalConfig(archival);
        if (config.isInitialized()) {
          for (const [key, value] of Object.entries(archival)) {
            await config.updateConfig(`dreamingEngine.archival.${key}`, value, true);
          }
        }
      }
      if (scheduler) {
        deps.dreamingManager.updateSchedulerConfig(scheduler);
        if (config.isInitialized()) {
          for (const [key, value] of Object.entries(scheduler)) {
            await config.updateConfig(`dreamingEngine.scheduler.${key}`, value, true);
          }
        }
      }

      res.json({
        success: true,
        message: 'Configuration updated and persisted',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update config',
      });
    }
  });

  /**
   * POST /api/dreaming/graph-update
   * 执行增量图谱更新
   *
   * 请求体:
   * {
   *   maxNewRelations?: number,
   *   orphanedMemoryLimit?: number,
   *   cleanupWeakEdges?: boolean
   * }
   */
  router.post('/graph-update', async (req: Request, res: Response) => {
    if (!deps.dreamingManager) { notAvailable(res); return; }
    try {
      const { maxNewRelations, orphanedMemoryLimit, cleanupWeakEdges } = req.body as {
        maxNewRelations?: number;
        orphanedMemoryLimit?: number;
        cleanupWeakEdges?: boolean;
      };

      const result = await deps.dreamingManager.performIncrementalGraphUpdate({
        maxNewRelations,
        orphanedMemoryLimit,
        cleanupWeakEdges,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to perform graph update',
      });
    }
  });

  /**
   * GET /api/dreaming/graph-stats
   * 获取图谱统计信息
   */
  router.get('/graph-stats', async (req: Request, res: Response) => {
    if (!deps.dreamingManager) { notAvailable(res); return; }
    try {
      const stats = await deps.dreamingManager.getGraphStats();

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get graph stats',
      });
    }
  });

  return router;
}
