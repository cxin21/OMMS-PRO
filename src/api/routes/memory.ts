/**
 * Memory Routes - 记忆接口
 *
 * 提供记忆的捕获、召回、更新、删除等操作
 * 基于业务能力而非直接 CRUD
 */

import { Router, Request, Response } from 'express';
import type { MemoryService, MemoryCaptureService } from '../../services/memory';
import type { ProfileManager } from '../../services/profile/profile-manager';
import type { ILogger } from '../../shared/logging';
import { MemoryType, MemoryScope } from '../../core/types/memory';
import { config } from '../../shared/config';

/**
 * 获取默认 Agent ID
 */
function getDefaultAgentId(): string {
  try {
    if (config.isInitialized()) {
      const agentId = config.getConfig('agentId') as string | undefined;
      if (agentId) return agentId;
      const apiConfig = config.getConfig('api') as any;
      if (apiConfig?.agentId) return apiConfig.agentId;
    }
  } catch { /* ignore */ }
  // 配置不可用时抛出错误，禁止使用硬编码 fallback
  throw new Error('ConfigManager not initialized and no agentId configured');
}

/**
 * 获取默认 Session ID
 */
function getDefaultSessionId(): string {
  try {
    if (config.isInitialized()) {
      // 尝试从 memoryService.session 获取
      const sessionConfig = config.getConfig('memoryService.session') as any;
      if (sessionConfig?.defaultSessionId) return sessionConfig.defaultSessionId;
      // 尝试从 memoryService.agentId 生成会话ID（使用 agentId 作为前缀）
      const agentId = config.getConfig('memoryService.agentId') as string | undefined;
      if (agentId) return `session-${agentId}-${Date.now()}`;
      // 尝试从顶层 agentId 生成
      const topAgentId = config.getConfig('agentId') as string | undefined;
      if (topAgentId) return `session-${topAgentId}-${Date.now()}`;
    }
  } catch { /* ignore */ }
  // 配置不可用时生成基于时间戳的会话ID
  return `session-${Date.now()}`;
}

/**
 * 获取对话内容检测阈值（用于决定是否使用 LLM 提取）
 * 优先从 memoryService.capture.conversationThreshold 获取
 * 降级使用 memoryService.store.chunkThreshold
 */
function getConversationThreshold(): number {
  try {
    if (config.isInitialized()) {
      // 优先从 memoryService.capture 获取
      const captureConfig = config.getConfig('memoryService.capture') as any;
      if (captureConfig?.conversationThreshold) return captureConfig.conversationThreshold;
      // 降级使用 memoryService.store.chunkThreshold
      const storeConfig = config.getConfig('memoryService.store') as any;
      if (storeConfig?.chunkThreshold) return storeConfig.chunkThreshold;
    }
  } catch { /* ignore */ }
  return 500;
}

export interface MemoryRoutesDeps {
  memoryService: MemoryService;
  captureService?: MemoryCaptureService;
  profileManager?: ProfileManager;
  logger?: ILogger;
}

export function createMemoryRoutes(deps: MemoryRoutesDeps): Router {
  const router = Router();

  // Debug log for captureService
  if (deps.captureService) {
    console.log('[createMemoryRoutes] captureService is available');
  } else {
    console.log('[createMemoryRoutes] captureService is UNDEFINED - LLM extraction will be skipped');
  }

  /**
   * GET /api/memories
   * 获取所有记忆列表（不带召回语义，不更新访问统计）
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const { limit, offset } = req.query as {
        limit?: string;
        offset?: string;
      };

      const takeLimit = parseInt(limit || '50');
      const takeOffset = parseInt(offset || '0');

      // 使用 listMemories 而不是 recall，避免更新访问统计
      const result = await deps.memoryService.listMemories({
        limit: takeLimit,
        offset: takeOffset,
      });

      res.json({
        success: true,
        data: {
          memories: result.memories,
          total: result.total,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get memories',
      });
    }
  });

  /**
   * POST /api/memories/capture
   * 从文本捕获记忆
   *
   * 智能处理：
   * - 短内容（< 500字符）：直接存储
   * - 长内容/对话（>= 500字符）：使用 LLM 提取关键记忆
   */
  router.post('/capture', async (req: Request, res: Response) => {
    try {
      const { content, contentBase64, agentId, sessionId, type, scores, tags, useLLMExtraction } = req.body as {
        content?: string;
        contentBase64?: string;
        agentId?: string;
        sessionId?: string;
        type?: string;
        scores?: { importance: number; scopeScore: number };
        tags?: string[];
        useLLMExtraction?: boolean;
      };

      // 支持 base64 编码的 content（避免 shell 转义问题）
      let finalContent = content;
      if (!finalContent && contentBase64) {
        try {
          finalContent = Buffer.from(contentBase64, 'base64').toString('utf8');
        } catch (e) {
          res.status(400).json({
            success: false,
            error: 'invalid_contentBase64',
            details: e instanceof Error ? e.message : String(e),
          });
          return;
        }
      }

      if (!finalContent) {
        res.status(400).json({
          success: false,
          error: 'content is required',
        });
        return;
      }

      const finalAgentId = agentId || getDefaultAgentId();
      const finalSessionId = sessionId || getDefaultSessionId();

      // 检测是否是对话内容（多行、包含用户/助手标记等）
      const conversationThreshold = getConversationThreshold();
      const isConversationContent =
        finalContent.length >= conversationThreshold &&
        (finalContent.includes('\n') || finalContent.includes('用户:') || finalContent.includes('助手:') || finalContent.includes('user:') || finalContent.includes('assistant:'));

      // 决定是否使用 LLM 提取：显式指定或内容是对话
      const shouldUseLLMExtraction = useLLMExtraction === true || isConversationContent;

      // 如果提供了 captureService 且内容是对话或显式要求使用 LLM 提取
      if (deps.captureService && shouldUseLLMExtraction) {
        console.log('[capture] Using LLM extraction - captureService available, content length:', finalContent.length);
        if (deps.logger) {
          deps.logger.info('[capture] Using LLM extraction for conversation content', { contentLength: finalContent.length });
        } else {
          console.log('[capture] Using LLM extraction for conversation content, length:', finalContent.length);
        }

        const captureResult = await deps.captureService.capture({
          agentId: finalAgentId,
          sessionId: finalSessionId,
          content: finalContent,
          metadata: {
            source: 'session-end-hook',
            isConversation: isConversationContent,
          },
        });

        // 异步记录到用户画像
        if (deps.profileManager) {
          const userId = agentId || getDefaultAgentId();
          deps.profileManager.recordInteraction(
            userId,
            'memory_capture',
            finalContent,
            undefined,
            { type: 'conversation', capturedCount: captureResult.captured.length },
            finalSessionId,
            finalAgentId,
            []
          ).catch(() => { /* ignore profile errors */ });
        }

        res.status(201).json({
          success: true,
          data: {
            captured: captureResult.captured,
            skipped: captureResult.skipped,
            totalFound: captureResult.captured.length,
          },
        });
        return;
      }

      // 直接存储模式（短内容或没有 captureService）
      if (!deps.captureService) {
        console.log('[capture] Skipping LLM extraction - captureService is undefined, content length:', finalContent.length);
      }
      const storeConfig = config.getConfig<{ defaultImportance?: number; defaultScopeScore?: number }>('memoryService.store');
      const defaultImportance = storeConfig?.defaultImportance ?? 5;
      const defaultScopeScore = storeConfig?.defaultScopeScore ?? defaultImportance;
      const finalScores = {
        importance: scores?.importance ?? defaultImportance,
        scopeScore: scores?.scopeScore ?? scores?.importance ?? defaultScopeScore,
      };

      const memory = await deps.memoryService.store(
        {
          content: finalContent,
          type: (type as MemoryType) || 'event' as MemoryType,
          metadata: {
            agentId: finalAgentId,
            sessionId: finalSessionId,
            source: 'captured',
            tags: tags ?? [],
          },
        },
        finalScores
      );

      // 异步记录到用户画像（fire-and-forget，不阻塞响应）
      if (deps.profileManager) {
        const userId = agentId || getDefaultAgentId();
        deps.profileManager.recordInteraction(
          userId,
          'memory_capture',
          finalContent,
          undefined,
          { memoryId: memory.uid, type: memory.type, importance: memory.importance },
          finalSessionId,
          finalAgentId,
          [memory.uid]
        ).catch(() => { /* ignore profile errors */ });

        // 自动用户画像分析：对于 FACT/IDENTITY/DECISION/PREFERENCE 类型的记忆，触发画像更新
        const memoryType = type as MemoryType;
        const profileTypes = [MemoryType.FACT, MemoryType.IDENTITY, MemoryType.DECISION, MemoryType.PREFERENCE];
        if (profileTypes.includes(memoryType)) {
          deps.profileManager.buildPersonaFromConversation(userId, [{
            userMessage: finalContent,
            timestamp: Date.now(),
          }]).catch(() => { /* ignore profile errors */ });
        }
      }

      res.status(201).json({
        success: true,
        data: memory,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      if (deps.logger) {
        deps.logger.error('[capture] 500 error', { message: errMsg, stack: errStack });
      } else {
        console.error('[capture] 500 error:', errMsg, errStack);
      }
      res.status(500).json({
        success: false,
        error: errMsg,
        stack: errStack,
        details: errStack,
      });
    }
  });

  /**
   * POST /api/memories/recall
   * 递进式召回记忆
   */
  router.post('/recall', async (req: Request, res: Response) => {
    try {
      const { query, types, limit } = req.body as {
        query?: string;
        types?: string[];
        limit?: number;
      };

      const result = await deps.memoryService.recall({
        query,
        types: types as MemoryType[],
        limit: limit || 20,
      });

      res.json({
        success: true,
        data: {
          memories: result.memories,
          totalFound: result.totalFound,
          scopeDistribution: result.scopeDistribution,
          meetsMinimum: result.meetsMinimum,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to recall memories',
      });
    }
  });

  /**
   * GET /api/memories/degradation-stats
   * 获取遗忘统计
   * 注意：必须放在 /:id 路由之前，否则会被误匹配
   */
  router.get('/degradation-stats', async (req: Request, res: Response) => {
    try {
      const stats = await deps.memoryService.getDegradationStats();

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get degradation stats',
      });
    }
  });

  /**
   * GET /api/memories/:id
   * 获取单条记忆详情
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const memory = await deps.memoryService.get(id);

      if (!memory) {
        res.status(404).json({ success: false, error: 'Memory not found' });
        return;
      }

      res.json({
        success: true,
        data: memory,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get memory',
      });
    }
  });

  /**
   * PUT /api/memories/:id
   * 更新记忆
   * 如果提供了 content，会创建新版本
   */
  router.put('/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { content, importance, scopeScore, scope, tags } = req.body;

      await deps.memoryService.update(id, {
        id,
        content,
        importance,
        scopeScore,
        scope: scope as MemoryScope,
        tags,
      });

      const memory = await deps.memoryService.get(id);

      res.json({
        success: true,
        data: memory,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update memory',
      });
    }
  });

  /**
   * DELETE /api/memories/:id
   * 删除记忆（删除所有版本）
   */
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await deps.memoryService.deleteMemory(id);

      res.json({
        success: true,
        message: 'Memory deleted',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete memory',
      });
    }
  });

  /**
   * POST /api/memories/reinforce/:id
   * 强化记忆
   */
  router.post('/reinforce/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { boostAmount } = req.body as { boostAmount?: number };

      const memory = await deps.memoryService.reinforce(id, boostAmount);

      if (!memory) {
        res.status(404).json({ success: false, error: 'Memory not found' });
        return;
      }

      res.json({
        success: true,
        data: memory,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reinforce memory',
      });
    }
  });

  /**
   * POST /api/memories/reinforce-batch
   * 批量强化记忆
   */
  router.post('/reinforce-batch', async (req: Request, res: Response) => {
    try {
      const { memoryIds } = req.body as { memoryIds: string[] };

      if (!memoryIds || !Array.isArray(memoryIds)) {
        res.status(400).json({
          success: false,
          error: 'memoryIds array is required',
        });
        return;
      }

      await deps.memoryService.reinforceBatch(memoryIds);

      res.json({
        success: true,
        message: `Reinforced ${memoryIds.length} memories`,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reinforce memories',
      });
    }
  });

  /**
   * POST /api/memories/archive/:id
   * 归档记忆
   */
  router.post('/archive/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await deps.memoryService.archiveMemory(id);

      res.json({
        success: true,
        message: 'Memory archived',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to archive memory',
      });
    }
  });

  /**
   * POST /api/memories/restore/:id
   * 恢复记忆
   */
  router.post('/restore/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await deps.memoryService.restoreMemory(id);

      res.json({
        success: true,
        message: 'Memory restored',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to restore memory',
      });
    }
  });

  /**
   * POST /api/memories/upgrade-scope/:id
   * 检查并执行作用域升级
   */
  router.post('/upgrade-scope/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const upgraded = await deps.memoryService.checkAndUpgradeScope(id);

      res.json({
        success: true,
        data: { upgraded },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upgrade scope',
      });
    }
  });

  /**
   * POST /api/memories/forgetting-cycle
   * 执行遗忘周期
   */
  router.post('/forgetting-cycle', async (req: Request, res: Response) => {
    try {
      const report = await deps.memoryService.runForgettingCycle();

      res.json({
        success: true,
        data: report,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run forgetting cycle',
      });
    }
  });

  /**
   * POST /api/memories/scope-degradation-cycle
   * 执行作用域降级周期
   */
  router.post('/scope-degradation-cycle', async (req: Request, res: Response) => {
    try {
      const report = await deps.memoryService.runScopeDegradationCycle();

      res.json({
        success: true,
        data: report,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run scope degradation cycle',
      });
    }
  });

  /**
   * GET /api/memories/:id/versions
   * 获取记忆版本链
   */
  router.get('/:id/versions', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const memory = await deps.memoryService.get(id);

      if (!memory) {
        res.status(404).json({ success: false, error: 'Memory not found' });
        return;
      }

      res.json({
        success: true,
        data: {
          currentVersion: memory.version,
          versionChain: memory.versionChain,
          isLatestVersion: memory.isLatestVersion,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get versions',
      });
    }
  });

  return router;
}
