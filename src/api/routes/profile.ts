/**
 * Profile Routes - 用户画像接口
 *
 * 提供用户画像相关的所有操作
 */

import { Router, Request, Response } from 'express';
import type { ProfileManager } from '../../services/profile/profile-manager';

export interface ProfileRoutesDeps {
  profileManager: ProfileManager;
}

export function createProfileRoutes(deps: ProfileRoutesDeps): Router {
  const router = Router();

  /**
   * GET /api/profile
   * 获取默认用户画像
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const userId = 'default-user';

      // Fetch real profile data
      const persona = await deps.profileManager.getPersona(userId);
      const preferences = await deps.profileManager.getPreferences(userId);
      const stats = await deps.profileManager.getUserStats(userId);

      res.json({
        success: true,
        data: {
          persona: persona || {
            name: '默认用户',
            description: 'OMMS-PRO 用户',
            traits: [],
          },
          preferences: preferences || {
            communicationStyle: '自然',
            topics: [],
            format: '简洁',
          },
          interactionHistory: stats.totalInteractions || 0,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get profile',
      });
    }
  });

  // ============================================================
  // 基础画像
  // ============================================================

  /**
   * GET /api/profile/:userId
   * 获取完整用户画像
   */
  router.get('/:userId', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const profile = await deps.profileManager.getProfile(userId);

      if (!profile) {
        res.status(404).json({ success: false, error: 'Profile not found' });
        return;
      }

      res.json({
        success: true,
        data: profile,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get profile',
      });
    }
  });

  /**
   * GET /api/profile/:userId/context
   * 获取 L0/L1 Wake-up Context
   */
  router.get('/:userId/context', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const context = await deps.profileManager.getL0L1Context(userId);

      res.json({
        success: true,
        data: {
          context,
          userId,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get context',
      });
    }
  });

  // ============================================================
  // Persona 管理
  // ============================================================

  /**
   * GET /api/profile/:userId/persona
   * 获取用户 Persona
   */
  router.get('/:userId/persona', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { version } = req.query as { version?: string };
      const persona = await deps.profileManager.getPersona(userId, version ? parseInt(version) : undefined);

      if (!persona) {
        res.status(404).json({ success: false, error: 'Persona not found' });
        return;
      }

      res.json({
        success: true,
        data: persona,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get persona',
      });
    }
  });

  /**
   * PUT /api/profile/:userId/persona
   * 更新 Persona
   */
  router.put('/:userId/persona', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const update = req.body;

      const persona = await deps.profileManager.updatePersona(userId, update);

      res.json({
        success: true,
        data: persona,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update persona',
      });
    }
  });

  /**
   * POST /api/profile/:userId/persona/build
   * 从对话历史构建 Persona
   */
  router.post('/:userId/persona/build', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { turns } = req.body as { turns?: Array<{ role: string; content: string }> };

      if (!turns || !Array.isArray(turns)) {
        res.status(400).json({ success: false, error: 'turns array is required' });
        return;
      }

      const conversationTurns = turns.map((t, idx) => ({
        userMessage: t.role === 'user' ? t.content : '',
        assistantResponse: t.role === 'assistant' ? t.content : undefined,
        timestamp: Date.now() - (turns.length - idx) * 60000,
      }));

      const persona = await deps.profileManager.buildPersonaFromConversation(userId, conversationTurns);

      res.status(201).json({
        success: true,
        data: persona,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to build persona',
      });
    }
  });

  // ============================================================
  // 偏好管理
  // ============================================================

  /**
   * GET /api/profile/:userId/preferences
   * 获取用户偏好
   */
  router.get('/:userId/preferences', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const preferences = await deps.profileManager.getPreferences(userId);

      if (!preferences) {
        res.status(404).json({ success: false, error: 'Preferences not found' });
        return;
      }

      res.json({
        success: true,
        data: preferences,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get preferences',
      });
    }
  });

  /**
   * PUT /api/profile/:userId/preferences
   * 更新偏好设置
   */
  router.put('/:userId/preferences', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { key, value } = req.body;

      if (!key) {
        res.status(400).json({ success: false, error: 'key is required' });
        return;
      }

      await deps.profileManager.setPreference(userId, key, value);

      res.json({
        success: true,
        message: 'Preference updated',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update preferences',
      });
    }
  });

  /**
   * POST /api/profile/:userId/preferences/infer
   * 从行为推断偏好
   */
  router.post('/:userId/preferences/infer', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { behaviors } = req.body as { behaviors?: Array<Record<string, unknown>> };

      if (!behaviors || !Array.isArray(behaviors)) {
        res.status(400).json({ success: false, error: 'behaviors array is required' });
        return;
      }

      const preferences = await deps.profileManager.inferPreferences(userId, behaviors);

      res.json({
        success: true,
        data: preferences,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to infer preferences',
      });
    }
  });

  // ============================================================
  // 交互记录
  // ============================================================

  /**
   * POST /api/profile/:userId/interactions
   * 记录交互
   */
  router.post('/:userId/interactions', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { type, input, output, metadata, sessionId, agentId, memoryIds } = req.body;

      if (!type) {
        res.status(400).json({ success: false, error: 'type is required' });
        return;
      }

      const interaction = await deps.profileManager.recordInteraction(
        userId,
        type,
        input,
        output,
        metadata,
        sessionId,
        agentId,
        memoryIds
      );

      res.status(201).json({
        success: true,
        data: interaction,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to record interaction',
      });
    }
  });

  /**
   * GET /api/profile/:userId/interactions
   * 获取交互历史
   */
  router.get('/:userId/interactions', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { types, startDate, endDate, limit } = req.query as {
        types?: string;
        startDate?: string;
        endDate?: string;
        limit?: string;
      };

      const interactions = deps.profileManager.getInteractionHistory(userId, {
        types: types ? types.split(',') as any : undefined,
        startDate: startDate ? parseInt(startDate) : undefined,
        endDate: endDate ? parseInt(endDate) : undefined,
        limit: limit ? parseInt(limit) : undefined,
      });

      res.json({
        success: true,
        data: interactions,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get interactions',
      });
    }
  });

  // ============================================================
  // 统计与报告
  // ============================================================

  /**
   * GET /api/profile/:userId/stats
   * 获取用户统计
   */
  router.get('/:userId/stats', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const stats = await deps.profileManager.getUserStats(userId);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get stats',
      });
    }
  });

  /**
   * POST /api/profile/:userId/report
   * 生成用户报告
   */
  router.post('/:userId/report', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { includePersona, includePreferences, includeInteractions, includeTags, includeStats } = req.body as {
        includePersona?: boolean;
        includePreferences?: boolean;
        includeInteractions?: boolean;
        includeTags?: boolean;
        includeStats?: boolean;
      };

      const report = await deps.profileManager.generateReport(userId, {
        includePersona,
        includePreferences,
        includeInteractions,
        includeTags,
        includeStats,
      });

      res.json({
        success: true,
        data: report,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate report',
      });
    }
  });

  // ============================================================
  // 标签管理
  // ============================================================

  /**
   * GET /api/profile/:userId/tags
   * 获取用户标签
   */
  router.get('/:userId/tags', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { category } = req.query as { category?: string };
      const tags = deps.profileManager.getTags(userId, category as any);

      res.json({
        success: true,
        data: tags,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get tags',
      });
    }
  });

  /**
   * POST /api/profile/:userId/tags
   * 添加标签
   */
  router.post('/:userId/tags', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { name, category, source, confidence, weight } = req.body;

      if (!name || !category) {
        res.status(400).json({ success: false, error: 'name and category are required' });
        return;
      }

      const tag = deps.profileManager.addTag(userId, name, category, source, confidence, weight);

      res.status(201).json({
        success: true,
        data: tag,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add tag',
      });
    }
  });

  /**
   * DELETE /api/profile/:userId/tags/:tagId
   * 删除标签
   */
  router.delete('/:userId/tags/:tagId', async (req: Request, res: Response) => {
    try {
      const { userId, tagId } = req.params;
      deps.profileManager.removeTag(userId, tagId);

      res.json({
        success: true,
        message: 'Tag removed',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove tag',
      });
    }
  });

  // ============================================================
  // 数据导出
  // ============================================================

  /**
   * POST /api/profile/:userId/export
   * 导出用户数据
   */
  router.post('/:userId/export', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { format } = req.body as { format?: 'json' | 'csv' | 'markdown' };

      const exportData = await deps.profileManager.exportUserData(userId, format || 'json');

      res.json({
        success: true,
        data: exportData,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export data',
      });
    }
  });

  return router;
}
