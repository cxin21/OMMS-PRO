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
import { MemoryType, MemoryScope } from '../../types/memory';
import { config } from '../../shared/config';

/**
 * 获取默认 Agent ID
 */
function getDefaultAgentId(): string {
  try {
    if (config.isInitialized()) {
      const agentId = config.getConfig<string>('agentId');
      if (agentId) return agentId;
      const apiConfig = config.getConfig<{ agentId?: string }>('api');
      if (apiConfig?.agentId) return apiConfig.agentId;
    }
  } catch { /* ignore */ }
  throw new Error('ConfigManager not initialized and no agentId configured');
}

/**
 * 获取默认 Session ID
 */
function getDefaultSessionId(): string {
  try {
    if (config.isInitialized()) {
      // 尝试从 memoryService.session 获取
      const sessionConfig = config.getConfig<{ defaultSessionId?: string }>('memoryService.session');
      if (sessionConfig?.defaultSessionId) return sessionConfig.defaultSessionId;
      const agentId = config.getConfig<string>('memoryService.agentId');
      if (agentId) return `session-${agentId}-${Date.now()}`;
      const topAgentId = config.getConfig<string>('agentId');
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
      const captureConfig = config.getConfig<{ conversationThreshold?: number }>('memoryService.capture');
      if (captureConfig?.conversationThreshold !== undefined) return captureConfig.conversationThreshold;
      const storeConfig = config.getConfig<{ chunkThreshold?: number }>('memoryService.store');
      if (storeConfig?.chunkThreshold !== undefined) return storeConfig.chunkThreshold;
    }
  } catch { /* ignore */ }
  // 禁止硬编码默认值，必须从配置读取
  throw new Error('conversationThreshold not configured in memoryService.capture or memoryService.store');
}

// ========== 分块上传存储 (内存 + 文件双写) ==========
interface ChunkData {
  content: string;
  timestamp: number;
}

interface ChunkedCaptureSession {
  captureId: string;
  sessionId: string;
  agentId: string;
  totalChunks: number;
  receivedChunks: Map<number, ChunkData>;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

// 内存存储（进程内）+ 文件备份（重启可恢复）
const chunkedSessions = new Map<string, ChunkedCaptureSession>();
const CHUNK_SESSION_TTL_MS = 30 * 60 * 1000; // 30 分钟超时

// 获取 chunk 存储目录
function getChunkStorageDir(): string {
  try {
    if (config.isInitialized()) {
      const storageConfig = config.getConfig<{ graphBasePath?: string }>('memoryService.storage');
      return storageConfig?.graphBasePath
        ? `${storageConfig.graphBasePath}/chunks`
        : './data/chunks';
    }
  } catch { /* ignore */ }
  return './data/chunks';
}

// 保存 chunk 到文件（备份）
async function saveChunkToFile(captureId: string, chunkIndex: number, content: string): Promise<void> {
  try {
    const dir = getChunkStorageDir();
    const { mkdir, writeFile } = await import('fs/promises');
    const { join } = await import('path');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${captureId}_${chunkIndex}.chunk`), content, 'utf8');
  } catch { /* ignore */ }
}

// 读取文件中的 chunk
async function loadChunkFromFile(captureId: string, chunkIndex: number): Promise<string | null> {
  try {
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    const dir = getChunkStorageDir();
    return await readFile(join(dir, `${captureId}_${chunkIndex}.chunk`), 'utf8');
  } catch { return null; }
}

// P0 FIX: 删除指定 captureId 的所有 chunk 文件
async function deleteChunkFiles(captureId: string, totalChunks: number): Promise<void> {
  try {
    const { unlink } = await import('fs/promises');
    const { join } = await import('path');
    const dir = getChunkStorageDir();
    const deletePromises: Promise<void>[] = [];
    for (let i = 0; i < totalChunks; i++) {
      deletePromises.push(
        unlink(join(dir, `${captureId}_${i}.chunk`)).catch(() => { /* ignore if not exists */ })
      );
    }
    await Promise.all(deletePromises);
  } catch { /* ignore cleanup errors */ }
}

// 清理过期的 chunk session
function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [captureId, session] of chunkedSessions.entries()) {
    if (now - session.createdAt > CHUNK_SESSION_TTL_MS) {
      chunkedSessions.delete(captureId);
    }
  }
}

// 分块捕获处理函数
async function handleChunkedCapture(
  req: Request,
  res: Response,
  opts: {
    content: string;
    finalAgentId: string;
    finalSessionId: string;
    type?: string;
    scores?: { importance: number; scopeScore: number };
    tags?: string[];
    chunkIndex: number;
    totalChunks: number;
    captureId?: string;
    deps: MemoryRoutesDeps;
  }
): Promise<void> {
  const { content, finalAgentId, finalSessionId, type, scores, tags, chunkIndex, totalChunks, captureId: incomingCaptureId, deps } = opts;

  // P0 FIX: 验证 chunkIndex 和 totalChunks 范围
  if (typeof chunkIndex !== 'number' || typeof totalChunks !== 'number') {
    res.status(400).json({ success: false, error: 'chunkIndex and totalChunks must be numbers' });
    deps.logger?.error('chunked-capture: invalid chunk parameters', { chunkIndex, totalChunks });
    return;
  }
  if (totalChunks <= 0) {
    res.status(400).json({ success: false, error: 'totalChunks must be greater than 0' });
    deps.logger?.error('chunked-capture: invalid totalChunks', { totalChunks });
    return;
  }
  if (chunkIndex < 0 || chunkIndex >= totalChunks) {
    res.status(400).json({
      success: false,
      error: `chunkIndex must be between 0 and ${totalChunks - 1}, got ${chunkIndex}`,
    });
    deps.logger?.error('chunked-capture: chunkIndex out of range', { chunkIndex, totalChunks });
    return;
  }

  // 清理过期 session
  cleanupExpiredSessions();

  // 第一个 chunk：创建 session；后续 chunk：验证 session
  let captureId: string;
  let isLastChunk = chunkIndex === totalChunks - 1;

  if (chunkIndex === 0) {
    // 第一个 chunk：创建新 session
    captureId = incomingCaptureId || `chunk-${finalAgentId}-${finalSessionId}-${Date.now()}`;
    chunkedSessions.set(captureId, {
      captureId,
      sessionId: finalSessionId,
      agentId: finalAgentId,
      totalChunks,
      receivedChunks: new Map(),
      createdAt: Date.now(),
    });
  } else {
    // 后续 chunk：验证 captureId 存在
    if (!incomingCaptureId) {
      res.status(400).json({ success: false, error: 'captureId is required for chunk > 0' });
      return;
    }
    const session = chunkedSessions.get(incomingCaptureId);
    if (!session) {
      res.status(400).json({ success: false, error: 'captureId not found or expired' });
      return;
    }
    if (session.totalChunks !== totalChunks) {
      res.status(400).json({ success: false, error: 'totalChunks mismatch' });
      return;
    }
    captureId = incomingCaptureId;
  }

  // 存储 chunk（内存 + 文件）
  const session = chunkedSessions.get(captureId)!;
  session.receivedChunks.set(chunkIndex, { content, timestamp: Date.now() });
  await saveChunkToFile(captureId, chunkIndex, content);

  // 如果不是最后一个 chunk，返回部分完成
  if (!isLastChunk) {
    res.status(200).json({
      success: true,
      data: {
        captureId,
        chunkIndex,
        status: 'partial',
        receivedChunks: session.receivedChunks.size,
        totalChunks,
      },
    });
    return;
  }

  // 最后一个 chunk：检查是否所有 chunk 都已接收
  if (session.receivedChunks.size < totalChunks) {
    res.status(200).json({
      success: true,
      data: {
        captureId,
        chunkIndex,
        status: 'partial',
        receivedChunks: session.receivedChunks.size,
        totalChunks,
        missingChunks: totalChunks - session.receivedChunks.size,
      },
    });
    return;
  }

  // 合并所有 chunk
  let fullContent = '';
  const missingChunks: number[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const chunk = session.receivedChunks.get(i);
    if (chunk) {
      fullContent += chunk.content;
    } else {
      // 尝试从文件加载
      const fromFile = await loadChunkFromFile(captureId, i);
      if (fromFile) {
        fullContent += fromFile;
      } else {
        // P0 FIX: 记录缺失的 chunk，不再静默跳过
        missingChunks.push(i);
      }
    }
  }

  // P0 FIX: 如果有缺失的 chunk，返回错误而不是返回 complete
  if (missingChunks.length > 0) {
    deps.logger?.error('chunked-capture: missing chunks detected', {
      captureId,
      missingChunks,
      receivedChunks: session.receivedChunks.size,
      totalChunks,
    });
    res.status(400).json({
      success: false,
      error: 'missing chunks detected',
      data: {
        captureId,
        missingChunks,
        receivedChunks: session.receivedChunks.size,
        totalChunks,
      },
    });
    return;
  }

  // P0 FIX: 合并成功后清理 chunk 文件
  await deleteChunkFiles(captureId, totalChunks);

  // 清理 session
  chunkedSessions.delete(captureId);

  // 继续正常的 capture 流程
  deps.logger?.info('chunked-capture: all chunks received, merging', { captureId, fullContentLength: fullContent.length });

  const storeConfig = config.getConfig<{ defaultImportance?: number; defaultScopeScore?: number }>('memoryService.store');
  const defaultImportance = storeConfig?.defaultImportance ?? 5;
  const defaultScopeScore = storeConfig?.defaultScopeScore ?? defaultImportance;
  const finalScores = {
    importance: scores?.importance ?? defaultImportance,
    scopeScore: scores?.scopeScore ?? scores?.importance ?? defaultScopeScore,
  };

  const memory = await deps.memoryService.store(
    {
      content: fullContent,
      type: (type as MemoryType) || 'event' as MemoryType,
      metadata: {
        agentId: finalAgentId,
        sessionId: finalSessionId,
        source: 'captured',
        tags: tags ?? [],
        isChunked: true,
        chunkInfo: { captureId, totalChunks },
      },
    },
    finalScores
  );

  // 异步记录到用户画像
  if (deps.profileManager) {
    deps.profileManager.recordInteraction(
      finalAgentId,
      'memory_capture',
      fullContent,
      undefined,
      { memoryId: memory.uid, type: memory.type, importance: memory.importance },
      finalSessionId,
      finalAgentId,
      [memory.uid]
    ).catch(() => { /* ignore */ });
  }

  res.status(201).json({
    success: true,
    data: {
      uid: memory.uid,
      captureId,
      totalChunks,
      mergedContentLength: fullContent.length,
      status: 'complete',
    },
  });
}
// ========== 分块上传处理结束 ==========

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
    deps.logger?.info('createMemoryRoutes: captureService is available');
  } else {
    deps.logger?.warn('createMemoryRoutes: captureService is UNDEFINED - LLM extraction will be skipped');
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
      deps.logger?.error('memories.list: error', { error: error instanceof Error ? error.message : String(error) });
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
   *
   * 分块上传支持：
   * - chunkIndex: 当前 chunk 索引 (0-based)
   * - totalChunks: 总 chunk 数
   * - captureId: 合并 ID（跨 chunk 一致）
   * - 第一个 chunk 应设置 chunkIndex=0 且不设置 captureId
   */
  router.post('/capture', async (req: Request, res: Response) => {
    try {
      const {
        content, contentBase64, agentId, sessionId, type, scores, tags, useLLMExtraction,
        chunkIndex, totalChunks, captureId,
      } = req.body as {
        content?: string;
        contentBase64?: string;
        agentId?: string;
        sessionId?: string;
        type?: string;
        scores?: { importance: number; scopeScore: number };
        tags?: string[];
        useLLMExtraction?: boolean;
        chunkIndex?: number;
        totalChunks?: number;
        captureId?: string;
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

      // ========== 分块上传处理 ==========
      const isChunkedUpload = typeof chunkIndex === 'number' && typeof totalChunks === 'number';
      if (isChunkedUpload) {
        await handleChunkedCapture(req, res, {
          content: finalContent,
          finalAgentId,
          finalSessionId,
          type,
          scores,
          tags,
          chunkIndex,
          totalChunks,
          captureId,
          deps,
        });
        return;
      }
      // ========== 分块上传处理结束 ==========

      // 检测是否是对话内容（多行、包含用户/助手标记等）
      const conversationThreshold = getConversationThreshold();
      const isConversationContent =
        finalContent.length >= conversationThreshold &&
        (finalContent.includes('\n') || finalContent.includes('用户:') || finalContent.includes('助手:') || finalContent.includes('user:') || finalContent.includes('assistant:'));

      // 决定是否使用 LLM 提取：显式指定或内容是对话
      const shouldUseLLMExtraction = useLLMExtraction === true || isConversationContent;

      // 如果提供了 captureService 且内容是对话或显式要求使用 LLM 提取
      if (deps.captureService && shouldUseLLMExtraction) {
        deps.logger?.info('capture: using LLM extraction', { contentLength: finalContent.length });

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
        deps.logger?.debug('capture: skipping LLM extraction, captureService undefined', { contentLength: finalContent.length });
      }
      const storeConfig = config.getConfig<{ defaultImportance?: number; defaultScopeScore?: number }>('memoryService.store');
      // P1 FIX: 简化配置读取链，避免重复调用
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
      deps.logger?.error('capture: error', { message: errMsg, stack: error instanceof Error ? error.stack : undefined });
      res.status(500).json({
        success: false,
        error: errMsg,
      });
    }
  });

  /**
   * POST /api/memories/recall
   * 递进式召回记忆
   */
  router.post('/recall', async (req: Request, res: Response) => {
    try {
      const { query, types, limit, agentId, sessionId } = req.body as {
        query?: string;
        types?: string[];
        limit?: number;
        agentId?: string;
        sessionId?: string;
      };

      const result = await deps.memoryService.recall({
        query,
        types: types as MemoryType[],
        limit: limit || 20,
        agentId: agentId,
        sessionId: sessionId,
      });

      res.json({
        success: true,
        data: {
          memories: result.memories,
          totalFound: result.totalFound,
          scopeDistribution: result.scopeDistribution,
          meetsMinimum: result.meetsMinimum,
          consolidatedSummary: result.consolidatedSummary,
        },
      });
    } catch (error) {
      deps.logger?.error('memories.recall: error', { error: error instanceof Error ? error.message : String(error) });
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
      deps.logger?.error('memories.degradation-stats: error', { error: error instanceof Error ? error.message : String(error) });
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
    const { id } = req.params;
    try {
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
      deps.logger?.error('memories.get: error', { id, error: error instanceof Error ? error.message : String(error) });
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
    const { id } = req.params;
    try {
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
      deps.logger?.error('memories.update: error', { id, error: error instanceof Error ? error.message : String(error) });
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
    const { id } = req.params;
    try {
      await deps.memoryService.deleteMemory(id);

      res.json({
        success: true,
        message: 'Memory deleted',
      });
    } catch (error) {
      deps.logger?.error('memories.delete: error', { id, error: error instanceof Error ? error.message : String(error) });
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
    const { id } = req.params;
    try {
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
      deps.logger?.error('memories.reinforce: error', { id, error: error instanceof Error ? error.message : String(error) });
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
      deps.logger?.error('memories.reinforce-batch: error', { error: error instanceof Error ? error.message : String(error) });
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
    const { id } = req.params;
    try {
      await deps.memoryService.archiveMemory(id);

      res.json({
        success: true,
        message: 'Memory archived',
      });
    } catch (error) {
      deps.logger?.error('memories.archive: error', { id, error: error instanceof Error ? error.message : String(error) });
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
    const { id } = req.params;
    try {
      await deps.memoryService.restoreMemory(id);

      res.json({
        success: true,
        message: 'Memory restored',
      });
    } catch (error) {
      deps.logger?.error('memories.restore: error', { id, error: error instanceof Error ? error.message : String(error) });
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
    const { id } = req.params;
    try {
      const upgraded = await deps.memoryService.checkAndUpgradeScope(id);

      res.json({
        success: true,
        data: { upgraded },
      });
    } catch (error) {
      deps.logger?.error('memories.upgrade-scope: error', { id, error: error instanceof Error ? error.message : String(error) });
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
      deps.logger?.error('memories.forgetting-cycle: error', { error: error instanceof Error ? error.message : String(error) });
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
      deps.logger?.error('memories.scope-degradation-cycle: error', { error: error instanceof Error ? error.message : String(error) });
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
    const { id } = req.params;
    try {
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
      deps.logger?.error('memories.versions: error', { id, error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get versions',
      });
    }
  });

  return router;
}
