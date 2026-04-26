/**
 * Memory Capture Service - 记忆捕获服务
 * @module memory-service/memory-capture-service
 *
 * 版本: v1.0.0
 * - 单次对话提取多条记忆
 * 置信度过滤 (< 0.5 丢弃)
 * - 相似度 >= 90% 自动版本化
 * - LLM 生成摘要
 */

import type {
  CaptureInput,
  CaptureResult,
  CapturedMemory,
  MemoryCaptureConfig,
  ExtractedMemory,
  DEFAULT_MEMORY_TYPES,
} from '../../../core/types/memory';
import { MemoryType } from '../../../core/types/memory';
import type { MemoryVersionManager } from '../store/memory-version-manager';
import type { MemoryStoreManager } from '../store/memory-store-manager';
import type { LLMScoringResult } from '../llm/llm-extractor';
import type { ProfileManager } from '../../profile/profile-manager';
import { MemoryInclusionDetector } from '../analysis/memory-inclusion-detector';
import type { InclusionResult } from '../../../core/types/memory';
import { createServiceLogger, wrapWithErrorBoundary } from '../../../shared/logging';
import type { ILogger } from '../../../shared/logging';
import { config } from '../../../shared/config';
import { TransactionManager } from '../utils/transaction-manager';
import { compressToAAAK, encodeAAAK } from '../aaak';
import {
  IncrementalCaptureManager,
} from './incremental-capture';

/**
 * LLM Extractor 接口
 */
export interface ILLMExtractor {
  extractMemories(
    text: string,
    options: {
      maxCount: number;
      typeHints?: MemoryType[];
    }
  ): Promise<ExtractedMemory[]>;

  generateSummary(content: string): Promise<string>;

  generateScores(content: string): Promise<{
    importance: number;
    scope: number;
    confidence: number;
    reasoning: string;
  }>;
}

/**
 * Memory Capture Service
 * 负责从对话内容中提取和存储记忆
 */
export class MemoryCaptureService {
  private logger: ILogger;
  private config: Required<MemoryCaptureConfig>;
  private inclusionDetector: MemoryInclusionDetector;
  private profileManager?: ProfileManager;
  private incrementalCaptureManager: IncrementalCaptureManager;

  // 版本创建锁：防止并发创建导致同一版本组有多个最新版本
  // key: versionGroupId, value: 锁的 Promise
  private versionLocks = new Map<string, Promise<void>>();

  // 锁的创建时间（用于 TTL 检测）
  private versionLockTimestamps = new Map<string, number>();

  // 锁的 TTL（毫秒），从 memoryService.capture.versionLockTTLMs 读取
  private versionLockTTLMs: number;

  // 最大锁数量，从 memoryService.capture.maxVersionLocks 读取
  private maxVersionLocks: number;

  constructor(
    private versionManager: MemoryVersionManager,
    private storeManager: MemoryStoreManager,
    private llmExtractor: ILLMExtractor,
    userConfig?: Partial<MemoryCaptureConfig>
  ) {
    // 如果传入配置则使用，必须包含所有必需字段
    if (userConfig && Object.keys(userConfig).length > 0) {
      this.config = this.loadConfigWithValidation(userConfig);
    } else {
      this.config = this.loadConfigFromManager();
    }

    // 加载版本锁配置
    const captureConfig = config.getConfigOrThrow<Record<string, unknown>>('memoryService.capture');
    this.versionLockTTLMs = (captureConfig['versionLockTTLMs'] as number) ?? 30000;
    this.maxVersionLocks = (captureConfig['maxVersionLocks'] as number) ?? 100;

    this.logger = createServiceLogger('MemoryCaptureService');
    this.inclusionDetector = new MemoryInclusionDetector();
    this.incrementalCaptureManager = new IncrementalCaptureManager();

    // 使用 wrapWithErrorBoundary 包装 capture 方法
    this.capture = wrapWithErrorBoundary(this.logger, 'MemoryCaptureService.capture', this.capture.bind(this)) as any;
  }

  /**
   * 设置 Profile Manager（用于自动用户画像分析）
   */
  setProfileManager(profileManager: ProfileManager): void {
    this.profileManager = profileManager;
    this.logger.info('ProfileManager configured for auto profile extraction');
  }

  /**
   * 从 ConfigManager 加载配置
   */
  private loadConfigFromManager(): Required<MemoryCaptureConfig> {
    const captureConfig = config.getConfigOrThrow<Record<string, unknown>>('memoryService.capture');
    const versionConfig = config.getConfigOrThrow<Record<string, unknown>>('memoryService.version');
    const llmConfig = config.getConfigOrThrow<Record<string, unknown>>('llmExtraction');

    return {
      maxMemoriesPerCapture: captureConfig['maxMemoriesPerCapture'] as number,
      similarityThreshold: versionConfig['similarityThreshold'] as number,
      confidenceThreshold: captureConfig['confidenceThreshold'] as number,
      enableLLMSummarization: captureConfig['enableLLMSummarization'] as boolean,
      llmProvider: llmConfig['provider'] as MemoryCaptureConfig['llmProvider'],
      llmApiKey: llmConfig['apiKey'] as string,
      llmEndpoint: llmConfig['baseURL'] as string,
      llmModel: llmConfig['model'] as string,
    };
  }

  /**
   * 验证并合并用户配置
   * 用户提供的配置必须包含所有必需字段，不允许部分覆盖
   */
  private loadConfigWithValidation(userConfig: Partial<MemoryCaptureConfig>): Required<MemoryCaptureConfig> {
    const captureConfig = config.getConfigOrThrow<Record<string, unknown>>('memoryService.capture');
    const versionConfig = config.getConfigOrThrow<Record<string, unknown>>('memoryService.version');
    const llmConfig = config.getConfigOrThrow<Record<string, unknown>>('llmExtraction');

    // 使用 ConfigManager 配置作为基础，合并用户提供的覆盖
    return {
      maxMemoriesPerCapture: userConfig.maxMemoriesPerCapture ?? captureConfig['maxMemoriesPerCapture'] as number,
      similarityThreshold: userConfig.similarityThreshold ?? versionConfig['similarityThreshold'] as number,
      confidenceThreshold: userConfig.confidenceThreshold ?? captureConfig['confidenceThreshold'] as number,
      enableLLMSummarization: userConfig.enableLLMSummarization ?? captureConfig['enableLLMSummarization'] as boolean,
      llmProvider: userConfig.llmProvider ?? llmConfig['provider'] as MemoryCaptureConfig['llmProvider'],
      llmApiKey: userConfig.llmApiKey ?? llmConfig['apiKey'] as string,
      llmEndpoint: userConfig.llmEndpoint ?? llmConfig['baseURL'] as string,
      llmModel: userConfig.llmModel ?? llmConfig['model'] as string,
    };
  }

  /**
   * 执行记忆捕获
   */
  async capture(input: CaptureInput): Promise<CaptureResult> {
    const result: CaptureResult = {
      captured: [],
      skipped: [],
    };

    // ============================================================
    // 增量摄取预检：在 LLM 提取前检查是否需要跳过
    // ============================================================
    const skipCheck = this.incrementalCaptureManager.checkShouldSkip(input);
    if (skipCheck) {
      this.logger.info('Incremental capture: skipping input', {
        reason: skipCheck.reason,
        sessionId: input.sessionId ?? 'default-session',
        existingMemoryUid: skipCheck.existingMemoryUid,
      });

      if (skipCheck.existingMemoryUid) {
        // 内容 hash 重复：直接复用已有记忆
        result.skipped.push({
          content: this.extractTextFromInput(input),
          reason: 'duplicate',
          details: `reused existing memory: ${skipCheck.existingMemoryUid}`,
        });
      } else {
        // 光标跳过：无 timestamp 或 timestamp <= cursor
        result.skipped.push({
          content: this.extractTextFromInput(input),
          reason: 'duplicate',
          details: 'input timestamp <= cursor, already processed',
        });
      }

      return result;
    }

    const text = this.extractTextFromInput(input);

    // 在 LLM 提取前先检查内容 hash 预检
    // 使用增量管理器的 computeContentHash 确保与 extractContentText 一致
    const contentHash = this.incrementalCaptureManager.computeContentHash(input);
    const existingMemoryUid = this.incrementalCaptureManager.getContentHashCache().checkDuplicate(contentHash);
    if (existingMemoryUid) {
      this.logger.info('Content hash duplicate detected, skipping LLM extraction', {
        contentHash: contentHash.substring(0, 16) + '...',
        existingMemoryUid,
      });
      result.skipped.push({
        content: text,
        reason: 'duplicate',
        details: `reused existing memory: ${existingMemoryUid}`,
      });
      return result;
    }

    let enrichedMemories: Array<{
      item: ExtractedMemory;
      summary: string;
      importance: number;
      scopeScore: number;
      confidence: number;
      reasoning: string;
    }> = [];

    // 1. LLM 提取记忆
    const extracted = await this.llmExtractor.extractMemories(text, {
      maxCount: this.config.maxMemoriesPerCapture,
      typeHints: this.getDefaultTypes(),
    });
    this.logger.info('LLM extraction complete', { count: extracted.length });

    // 2. 置信度过滤
    const qualified = this.filterByConfidence(extracted, result.skipped);
    this.logger.info('Confidence filtering complete', { qualifiedCount: qualified.length, filtered: extracted.length - qualified.length });

    // 3. 生成摘要和评分
    for (const item of qualified) {
      try {
        const enriched = await this.processMemory(item, input);
        enrichedMemories.push(enriched);
      } catch (error) {
        result.skipped.push({
          content: item.content,
          reason: 'error',
          details: String(error),
        });
      }
    }

    // 4. 版本检测和存储
    for (const enriched of enrichedMemories) {
      try {
        const now = Date.now();
        const scores = {
          importance: enriched.importance,
          scopeScore: enriched.scopeScore,
        };

        // 第一级：快速粗筛
        const candidates = await this.versionManager.findCandidates(enriched.item.content, {
          agentId: input.agentId,
          type: enriched.item.type,
          limit: 10,
        });

        if (candidates.length === 0) {
          const captured = await this.storeMemory(
            enriched.item, enriched.summary, scores, input,
            { isNewVersion: false, existingMemoryId: null, similarity: 0 }, now,
            { importance: enriched.importance, scope: enriched.scopeScore, confidence: enriched.confidence, reasoning: enriched.reasoning }
          );
          result.captured.push(captured);
          continue;
        }

        // 第二级：话题分组过滤
        const relevantCandidates = await this.filterCandidatesByTopic(candidates, enriched.item.topicId);

        if (relevantCandidates.length === 0) {
          const captured = await this.storeMemory(
            enriched.item, enriched.summary, scores, input,
            { isNewVersion: false, existingMemoryId: null, similarity: 0 }, now,
            { importance: enriched.importance, scope: enriched.scopeScore, confidence: enriched.confidence, reasoning: enriched.reasoning }
          );
          result.captured.push(captured);
          continue;
        }

        // 第三级：版本检测和语义包含判断
        let shouldStore = true;
        let detection = { isNewVersion: false, existingMemoryId: null as string | null, similarity: 0 };

        for (const candidate of relevantCandidates) {
          const candidateSimilarity = candidate.score;

          if (candidateSimilarity >= 0.95) {
            this.logger.info('High similarity detected, creating new version', {
              existingMemoryId: candidate.memoryId,
              similarity: candidateSimilarity,
            });
            detection = { isNewVersion: true, existingMemoryId: candidate.memoryId, similarity: candidateSimilarity };
            break;
          }

          if (candidateSimilarity >= 0.7 && candidateSimilarity < 0.95) {
            const inclusionResult = await this.checkSemanticInclusion(enriched.item, enriched.summary, candidate.memoryId);

            if (inclusionResult) {
              switch (inclusionResult.type) {
                case 'b_extends_a':
                  this.logger.info('B extends A, creating new version', { existingMemoryId: candidate.memoryId });
                  detection = { isNewVersion: true, existingMemoryId: candidate.memoryId, similarity: candidateSimilarity };
                  break;
                case 'a_extends_b':
                  this.logger.info('A extends B, B discarded', { existingMemoryId: candidate.memoryId });
                  shouldStore = false;
                  break;
                case 'identical':
                  this.logger.info('Memory identical to existing, skipping', { existingMemoryId: candidate.memoryId });
                  shouldStore = false;
                  break;
                case 'overlapping':
                case 'unrelated':
                  continue;
              }
              if (!shouldStore || detection.isNewVersion) break;
            }
          }
        }

        if (!shouldStore) continue;

        // 版本锁：防止并发创建
        if (detection.isNewVersion && detection.existingMemoryId) {
          const lockKey = `version:${detection.existingMemoryId}`;
          const releaseLock = await this.acquireVersionLock(lockKey);

          if (releaseLock) {
            try {
              const recheck = await this.versionManager.detectVersion(enriched.item.content, {
                agentId: input.agentId, type: enriched.item.type,
              });
              if (!recheck.isNewVersion || recheck.existingMemoryId !== detection.existingMemoryId) {
                this.logger.info('Version already created by concurrent request');
                detection = recheck;
              }
            } finally {
              releaseLock();
            }
          } else {
            this.logger.warn('Failed to acquire version lock', { existingMemoryId: detection.existingMemoryId });
            detection = { isNewVersion: false, existingMemoryId: null, similarity: 0 };
          }
        }

        // 存储记忆
        const captured = await this.storeMemory(
          enriched.item, enriched.summary, scores, input, detection, now,
          { importance: enriched.importance, scope: enriched.scopeScore, confidence: enriched.confidence, reasoning: enriched.reasoning }
        );
        result.captured.push(captured);
      } catch (error) {
        result.skipped.push({
          content: enriched.item.content,
          reason: 'error',
          details: String(error),
        });
      }
    }

    this.logger.info('Memory capture completed', {
      captured: result.captured.length,
      skipped: result.skipped.length,
    });

    // 5. 自动用户画像分析（异步，不阻塞返回）
    if (this.profileManager && result.captured.length > 0) {
      this.analyzeAndUpdateProfile(input, result.captured).catch((err) => {
        this.logger.warn('Auto profile analysis failed', { error: String(err) });
      });
    }

    // 6. 标记已处理（更新光标和内容 hash 缓存）
    for (const captured of result.captured) {
      this.incrementalCaptureManager.markProcessed(input, captured.metadata?.versionGroupId ?? '');
    }

    return result;
  }

  /**
   * 从输入中提取文本
   */
  private extractTextFromInput(input: CaptureInput): string {
    if (typeof input.content === 'string') {
      return input.content;
    }

    // 处理对话轮次
    const turns = input.content as Array<{ role: string; content: string }>;
    return turns
      .map(turn => `${turn.role === 'user' ? '用户' : '助手'}: ${turn.content}`)
      .join('\n');
  }

  /**
   * 扩大 sourceSegment 的上下文范围
   * 向后扩展 200 字符，以便在回溯时保留更多对话背景
   */
  private expandSourceSegmentContext(
    sourceSegment: string | undefined,
    segmentStart: number | undefined,
    segmentEnd: number | undefined,
    originalContent: string
  ): string {
    if (!sourceSegment) {
      return originalContent;
    }

    // 使用 segmentStart/segmentEnd 进行字符级扩展
    if (segmentStart !== undefined && segmentEnd !== undefined) {
      const contextExtension = 200;
      const extendedStart = Math.max(0, segmentStart - contextExtension);
      const extendedEnd = Math.min(originalContent.length, segmentEnd + contextExtension);
      return originalContent.substring(extendedStart, extendedEnd);
    }

    // 如果没有 segmentStart/segmentEnd，回退到 sourceSegment 本身
    return sourceSegment;
  }

  /**
   * 处理单条记忆
   */
  /**
   * 处理单条记忆（分别调用 LLM 生成摘要和评分）
   * 当 extractWithScores 不可用时使用
   */
  private async processMemory(
    item: ExtractedMemory,
    input: CaptureInput
  ): Promise<{
    item: ExtractedMemory;
    summary: string;
    importance: number;
    scopeScore: number;
    confidence: number;
    reasoning: string;
  }> {
    // 1. LLM 生成摘要
    const summary = this.config.enableLLMSummarization
      ? await this.llmExtractor.generateSummary(item.content)
      : item.content.substring(0, 100);

    // 2. LLM 直接评分 (importance, scope, confidence)
    const llmScores = await this.llmExtractor.generateScores(item.content);

    return {
      item,
      summary,
      importance: llmScores.importance,
      scopeScore: llmScores.scope,
      confidence: llmScores.confidence,
      reasoning: llmScores.reasoning,
    };
  }

  /**
   * 存储记忆
   */
  private async storeMemory(
    item: ExtractedMemory,
    summary: string,
    scores: { importance: number; scopeScore: number },
    input: CaptureInput,
    detection: { isNewVersion: boolean; existingMemoryId: string | null; similarity: number },
    now: number,
    llmScores?: LLMScoringResult
  ): Promise<CapturedMemory> {
    let versionGroupId: string;
    let previousMemoryId: string | undefined;

    // 获取原始对话片段（用于返回给调用方）
    const originalContent = this.extractTextFromInput(input);
    const rawSegment = item.sourceSegment
      || (item.segmentStart !== undefined && item.segmentEnd !== undefined
          ? originalContent.substring(item.segmentStart, item.segmentEnd)
          : originalContent);

    if (detection.isNewVersion && detection.existingMemoryId) {
      // 版本创建 - 使用事务管理器确保原子性
      const txManager = new TransactionManager();
      try {
        const versionResult = await this.versionManager.createVersion(
          detection.existingMemoryId,
          originalContent,  // 使用完整对话（Verbatim 原则），而非 rawSegment 片段
          summary,
          scores,
          {
            createdAt: now,
            updatedAt: now,
            originalSize: originalContent.length,
            compressed: false,
            encrypted: false,
          },
          txManager  // 传递事务管理器
        );

        versionGroupId = detection.existingMemoryId;  // 继承版本组
        previousMemoryId = versionResult.oldMemoryId;

        this.logger.debug('Created new version', {
          newMemoryId: versionResult.newMemoryId,
          oldMemoryId: versionResult.oldMemoryId,
          similarity: detection.similarity,
        });
      } catch (versionErr) {
        const msg = versionErr instanceof Error ? versionErr.message : String(versionErr);
        // ORPHAN_VECTOR 异常：降级为新建记忆，复用已有 ID
        if (msg.startsWith('ORPHAN_VECTOR:')) {
          const orphanId = msg.replace('ORPHAN_VECTOR:', '');
          this.logger.warn('Version creation failed due to orphan vector, falling back to new memory with reused ID', {
            orphanId,
            reuseExistingId: detection.existingMemoryId,
          });

          // 直接使用完整对话进行 palace 存储（Verbatim 原则）
          // 注意：Palace 必须存储完整原始对话，不允许截断
          const memory = await this.storeManager.store(
            {
              content: item.content,  // LLM 提取的片段（用于向量索引）
              originalContent: originalContent,  // 完整对话（Palace 存储用）
              type: item.type,
              metadata: {
                agentId: input.agentId,
                tags: item.tags,
                keywords: item.keywords,
                sessionId: input.sessionId,
                source: 'extracted',
                segmentStart: item.segmentStart,
                segmentEnd: item.segmentEnd,
                topicId: item.topicId,
              },
              summary,  // 传递已有摘要避免重复生成
              forcedMemoryId: detection.existingMemoryId!,  // 强制复用已有 ID，跳过版本检测
            },
            scores  // 传递已有评分避免使用默认值
          );

          versionGroupId = memory.uid;
          this.logger.debug('Created new memory after ORPHAN_VECTOR recovery', {
            memoryId: memory.uid,
            segmentStart: item.segmentStart,
            segmentEnd: item.segmentEnd
          });
        } else {
          // 其他异常向上穿透
          throw versionErr;
        }
      }
    } else {
      // 新建记忆
      // 直接使用完整对话进行 palace 存储（Verbatim 原则）
      // 注意：Palace 必须存储完整原始对话，不允许截断
      this.logger.debug('Storing memory with complete conversation', {
        hasSourceSegment: !!item.sourceSegment,
        segmentStart: item.segmentStart,
        segmentEnd: item.segmentEnd,
        originalContentLength: originalContent.length,
      });

      const memory = await this.storeManager.store(
        {
          content: item.content,  // LLM 提取的片段（用于向量索引）
          originalContent: originalContent,  // 完整对话（Palace 存储用）
          type: item.type,
          metadata: {
            agentId: input.agentId,
            tags: item.tags,
            keywords: item.keywords,
            sessionId: input.sessionId,
            source: 'extracted',
            segmentStart: item.segmentStart,
            segmentEnd: item.segmentEnd,
            topicId: item.topicId,
          },
          summary,  // 传递已有摘要避免重复生成
        },
        scores
      );

      versionGroupId = memory.uid;

      this.logger.debug('Created new memory with complete conversation', {
        memoryId: memory.uid,
        originalContentLength: originalContent.length,
      });
    }

    // ============================================================
    // 生成 AAAK 压缩索引并存储到 metaStore
    // AAAK 格式: aaak:ENTITY|TOPICS|"quote"|EMOTIONS|FLAGS
    // ============================================================
    try {
      const aaakEntry = compressToAAAK(item.content, {
        memoryType: item.type,
      });
      const aaakEncoded = encodeAAAK(aaakEntry);
      const aaakTag = `aaak:${aaakEncoded}`;

      await this.storeManager.addTags(versionGroupId, [aaakTag]);

      this.logger.debug('AAAK index generated and stored', {
        memoryId: versionGroupId,
        aaakTag: aaakTag.substring(0, 80) + (aaakTag.length > 80 ? '...' : ''),
      });
    } catch (aaakError) {
      // AAAK 生成失败不影响主流程，只记录日志
      this.logger.warn('Failed to generate AAAK index', {
        memoryId: versionGroupId,
        error: String(aaakError),
      });
    }

    return {
      content: rawSegment,  // 返回原始对话片段，而非 LLM 提炼后的摘要
      summary,
      type: item.type,
      confidence: llmScores?.confidence ?? item.confidence,
      importanceLevel: this.getImportanceLevel(scores.importance),
      scopeLevel: this.getScopeLevel(scores.scopeScore),
      keywords: item.keywords,
      tags: item.tags,
      metadata: {
        source: 'agent',
        extractedAt: now,
        sessionId: input.sessionId ?? 'default-session',
        isNewVersion: detection.isNewVersion,
        versionGroupId,
        previousMemoryId,
        reasoning: llmScores?.reasoning,
      },
};
  }

  /**
   * 自动分析并更新用户画像
   * 当捕获到 FACT/IDENTITY 类型的高重要性记忆时，自动更新用户画像
   */
  private async analyzeAndUpdateProfile(
    input: CaptureInput,
    capturedMemories: CapturedMemory[]
  ): Promise<void> {
    this.logger.debug('Starting auto profile analysis', {
      capturedCount: capturedMemories.length,
    });

    // 筛选可能包含用户身份信息的记忆类型
    const identityRelatedTypes = [MemoryType.FACT, MemoryType.IDENTITY, MemoryType.DECISION];
    const relevantMemories = capturedMemories.filter(m =>
      identityRelatedTypes.includes(m.type) && m.importanceLevel !== 'L0'
    );

    if (relevantMemories.length === 0) {
      this.logger.debug('No identity-related memories for profile update');
      return;
    }

    // 获取用户 ID（使用 agentId 作为 userId）
    const userId = input.agentId || 'default-user';

    // 构建对话轮次格式（用于 PersonaBuilder）
    // 注意：profile/persona/persona-builder.ts 中的 ConversationTurn 使用 userMessage/assistantResponse
    // 但 memory/core/types/memory.ts 中定义的是 role/content
    // 需要适配 ProfileManager 期望的格式
    const now = Date.now();
    interface ProfileConversationTurn {
      userMessage: string;
      assistantResponse?: string;
      timestamp: number;
      metadata?: Record<string, any>;
    }

    const turns: ProfileConversationTurn[] = relevantMemories.map((m, idx) => ({
      userMessage: m.content,
      assistantResponse: `Memory importance: ${m.importanceLevel}, type: ${m.type}`,
      timestamp: now - (relevantMemories.length - idx) * 1000,  // 递减时间戳模拟对话顺序
      metadata: {
        memoryType: m.type,
      },
    }));

    try {
      // 调用 ProfileManager 的 buildPersonaFromConversation
      // turns 格式符合 profile/persona-builder.ts 的 ConversationTurn 期望
      const persona = await this.profileManager!.buildPersonaFromConversation(
        userId,
        turns as any
      );
      this.logger.info('Auto profile updated', {
        userId,
        personaVersion: persona.version,
        traitsCount: persona.personalityTraits?.length ?? 0,
      });
    } catch (error) {
      this.logger.warn('Failed to auto update profile', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
    }
  }

  /**
   * 获取重要性等级
   */
  private getImportanceLevel(score: number): 'L0' | 'L1' | 'L2' | 'L3' | 'L4' {
    if (score >= 9) return 'L4';
    if (score >= 7) return 'L3';
    if (score >= 5) return 'L2';
    if (score >= 3) return 'L1';
    return 'L0';
  }

  /**
   * 获取作用域等级
   */
  private getScopeLevel(score: number): 'A0' | 'A1' | 'A2' {
    if (score >= 7) return 'A2';
    if (score >= 4) return 'A1';
    return 'A0';
  }

  /**
   * 获取版本锁
   * @param versionGroupId 版本组 ID
   * @param timeoutMs 超时时间（毫秒）
   * @returns 释放锁的函数，如果超时返回 null
   */
  private async acquireVersionLock(versionGroupId: string, timeoutMs: number = 5000): Promise<(() => void) | null> {
    const startTime = Date.now();
    const now = Date.now();

    // 检查并清理过期锁
    this.cleanupExpiredLocks();

    // 检查锁数量限制
    if (this.versionLocks.size >= this.maxVersionLocks) {
      this.logger.warn('Version lock map full, cleaning up oldest locks', {
        size: this.versionLocks.size,
        maxSize: this.maxVersionLocks,
      });
      this.cleanupOldestLocks();
    }

    while (Date.now() - startTime < timeoutMs) {
      const existingLock = this.versionLocks.get(versionGroupId);

      // 检查锁是否过期
      if (existingLock) {
        const lockAge = now - (this.versionLockTimestamps.get(versionGroupId) || 0);
        if (lockAge > this.versionLockTTLMs) {
          // 锁已过期，删除并创建新锁
          this.versionLocks.delete(versionGroupId);
          this.versionLockTimestamps.delete(versionGroupId);
          this.logger.debug('Removed expired lock', { versionGroupId, lockAge });
        } else {
          // 有锁且未过期，等待释放
          try {
            await existingLock;
          } catch {
            // 忽略 Promise 的 rejection
          }
          // 等待后重试
          await new Promise(resolve => setTimeout(resolve, 50));
          continue;
        }
      }

      // 没有锁（或已过期），创建新锁
      let release: (() => void) | null = null;
      const lockPromise = new Promise<void>(resolve => {
        release = () => resolve();
      });
      this.versionLocks.set(versionGroupId, lockPromise);
      this.versionLockTimestamps.set(versionGroupId, Date.now());
      this.logger.debug('Version lock acquired', { versionGroupId });
      return () => {
        this.versionLocks.delete(versionGroupId);
        this.versionLockTimestamps.delete(versionGroupId);
        release?.();
        this.logger.debug('Version lock released', { versionGroupId });
      };
    }

    this.logger.warn('Failed to acquire version lock', { versionGroupId, timeoutMs });
    return null;
  }

  /**
   * 清理过期锁
   */
  private cleanupExpiredLocks(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.versionLockTimestamps.entries()) {
      if (now - timestamp > this.versionLockTTLMs) {
        this.versionLocks.delete(key);
        this.versionLockTimestamps.delete(key);
        this.logger.debug('Cleaned up expired lock', { key, age: now - timestamp });
      }
    }
  }

  /**
   * 清理最老的锁（当锁数量超限时）
   */
  private cleanupOldestLocks(): void {
    // 按时间排序，删除最老的 N 个锁
    const sortedEntries = [...this.versionLockTimestamps.entries()]
      .sort((a, b) => a[1] - b[1]);

    const toDelete = sortedEntries.slice(0, Math.floor(this.maxVersionLocks / 2));
    for (const [key] of toDelete) {
      this.versionLocks.delete(key);
      this.versionLockTimestamps.delete(key);
      this.logger.debug('Cleaned up oldest lock due to size limit', { key });
    }
  }

  /**
   * 置信度过滤
   */
  private filterByConfidence(
    extracted: ExtractedMemory[],
    skipped: CaptureResult['skipped']
  ): ExtractedMemory[] {
    return extracted.filter(item => {
      const threshold = this.config.confidenceThreshold;

      if (item.confidence < threshold) {
        skipped.push({
          content: item.content,
          reason: 'low_confidence',
          details: `confidence ${item.confidence} < ${threshold} (type: ${item.type})`,
        });
        return false;
      }
      return true;
    });
  }

  /**
   * 语义包含检测
   * 在向量相似度检测之后，进一步判断是否存在包含关系
   *
   * @param newMemory 新提取的记忆
   * @param newSummary 新记忆的摘要
   * @param existingMemoryId 已有记忆的 ID
   * @returns 包含检测结果，如果检测失败返回 null
   */
  private async checkSemanticInclusion(
    newMemory: ExtractedMemory,
    newSummary: string,
    existingMemoryId: string
  ): Promise<InclusionResult | null> {
    try {
      // 获取已有记忆的内容
      const existingMemory = await this.storeManager.get(existingMemoryId);
      if (!existingMemory) {
        this.logger.warn('Existing memory not found for inclusion check', { existingMemoryId });
        return null;
      }

      // 调用包含检测器判断语义包含关系
      const result = await this.inclusionDetector.detectInclusion(
        {
          content: newMemory.content,
          summary: newSummary,
        },
        {
          content: existingMemory.content,
          summary: existingMemory.summary,
        }
      );

      // 填充已有的 memory ID
      result.existingMemoryId = existingMemoryId;

      this.logger.debug('Semantic inclusion check completed', {
        type: result.type,
        inclusionScore: result.inclusionScore,
        existingMemoryId,
      });

      return result;
    } catch (error) {
      this.logger.error('Semantic inclusion check failed', error instanceof Error ? error : new Error(String(error)), {
        existingMemoryId,
      });
      return null;
    }
  }

  /**
   * 按话题过滤候选记忆（两级检测第二级）
   *
   * 只保留与当前记忆 topicId 相同的候选记忆
   * 如果当前记忆没有 topicId，则保留所有候选
   *
   * @param candidates 候选记忆列表
   * @param topicId 当前记忆的话题ID
   * @returns 过滤后的候选列表
   */
  private async filterCandidatesByTopic(
    candidates: Array<{ memoryId: string; score: number }>,
    topicId?: string
  ): Promise<Array<{ memoryId: string; score: number }>> {
    // 如果当前记忆没有 topicId，返回所有候选
    if (!topicId) {
      this.logger.debug('No topicId for current memory, keeping all candidates', {
        candidateCount: candidates.length,
      });
      return candidates;
    }

    // 优化：批量获取所有候选记忆，避免 N+1 查询
    const candidateIds = candidates.map((c) => c.memoryId);
    const memoriesMap = await this.storeManager.getMany(candidateIds);

    // 双重条件过滤：
    // 条件A: topicId 精确匹配（同一 LLM 调用生成的话题）
    // 条件B: 候选记忆没有 topicId（通用记忆），保留让向量相似度判断
    const filtered = candidates.filter((c) => {
      const memory = memoriesMap.get(c.memoryId);
      const candidateTopicId = memory?.metadata?.['topicId'];

      // 条件A: 精确匹配
      if (candidateTopicId === topicId) {
        return true;
      }
      // 条件B: 候选记忆没有 topicId（通用记忆），保留让向量相似度判断
      if (!candidateTopicId) {
        return true;
      }
      // 其他情况（topicId 不同但候选也有 topicId）：不属于同一话题
      return false;
    });

    this.logger.debug('Filtered candidates by topicId', {
      topicId,
      originalCount: candidates.length,
      filteredCount: filtered.length,
    });

    return filtered;
  }

  /**
   * 获取默认类型列表
   */
  private getDefaultTypes(): MemoryType[] {
    return [
      MemoryType.FACT,
      MemoryType.EVENT,
      MemoryType.DECISION,
      MemoryType.ERROR,
      MemoryType.LEARNING,
      MemoryType.RELATION,
    ];
  }

  /**
   * 获取版本链
   */
  async getVersionChain(memoryId: string): Promise<{
    groupId: string;
    currentUid: string;
    versions: Array<{
      uid: string;
      version: number;
      summary: string;
      createdAt: number;
      isLatest: boolean;
    }>;
  }> {
    const history = await this.versionManager.getVersionHistory(memoryId);
    const allVersions = await this.versionManager.getAllVersions(memoryId);

    const currentRecord = allVersions.find(v => v.uid === memoryId);

    return {
      groupId: currentRecord?.versionGroupId ?? memoryId,
      currentUid: memoryId,
      versions: history.map((v) => {
        const versionRecord = allVersions.find(
          av => av.currentPalaceRef === v.palaceRef
        );
        return {
          uid: versionRecord?.uid ?? '',
          version: v.version,
          summary: v.summary,
          createdAt: v.createdAt,
          isLatest: v.version === currentRecord?.version,
        };
      }),
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<MemoryCaptureConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('Config updated', this.config);
  }

  /**
   * 获取配置
   */
  getConfig(): MemoryCaptureConfig {
    return { ...this.config };
  }
}
