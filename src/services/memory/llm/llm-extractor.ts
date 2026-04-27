/**
 * LLM Extractor - 基于 LLM 的记忆提取器
 * @module memory-service/llm-extractor
 *
 * 支持 OpenAI、Anthropic 和自定义 API
 */

import type { ExtractedMemory, MemoryCaptureConfig } from '../../../core/types/memory';
import { MemoryType } from '../../../core/types/memory';
import { createServiceLogger } from '../../../shared/logging';
import type { ILogger } from '../../../shared/logging';
import { JsonParser } from '../../../shared/utils/json-parser';
import type { AgentRuntimeContext } from '../../../shared/agents';
import { AgentType } from '../../../shared/agents';
import type { IAgentContextProvider } from '../../../shared/agents';
import { PromptLoader } from '../../../shared/prompts';

/**
 * Extractor 异常
 */
export class ExtractorError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'ExtractorError';
  }
}

/**
 * LLM 评分结果
 */
export interface LLMScoringResult {
  /** 重要性评分 (0-10) */
  importance: number;
  /** 作用域评分 (0-10) - 统一命名 scopeScore */
  scopeScore: number;
  /** 置信度 (0-1) */
  confidence: number;
  /** 评分理由 */
  reasoning: string;
}

/**
 * LLM 焦点分析结果
 */
export interface LLMFocusAnalysisResult {
  /** 焦点等级 (0-1) */
  focusLevel: number;
  /** 分析理由 */
  reasoning: string;
}

/**
 * LLM Extractor 接口
 */
export interface ILLMExtractor {
  extractMemories(
    text: string,
    options: {
      maxCount: number;
      typeHints?: MemoryType[];
    },
    signal?: AbortSignal
  ): Promise<ExtractedMemory[]>;

  generateSummary(content: string): Promise<string>;

  /**
   * 生成评分
   * @param content 记忆内容
   * @returns 评分结果 (importance, scope, confidence)
   */
  generateScores(content: string): Promise<LLMScoringResult>;

  /**
   * 合并多个记忆为一条新记忆
   * @param memories 记忆内容数组
   * @returns 合并后的记忆内容
   */
  mergeMemories(memories: string[]): Promise<string>;

  /**
   * 归纳整理多个记忆（不精简，仅归纳）
   * 模拟人类睡眠时的记忆整理过程
   * @param memories 记忆内容数组
   * @returns 归纳整理结果
   */
  consolidateMemories(memories: string[]): Promise<{
    content: string;
    keywords: string[];
    insights: string[];
    summary: string;
  }>;

  /**
   * 分析记忆的初始焦点等级
   * @param content 记忆内容
   * @param type 记忆类型
   * @returns 焦点等级分析结果
   */
  analyzeMemoryFocus(content: string, type: MemoryType): Promise<LLMFocusAnalysisResult>;

  /**
   * 从记忆内容中提取命名实体
   * 用于知识图谱的实体节点构建
   * @param content 记忆内容
   * @returns 提取的实体列表
   */
  extractEntities(content: string): Promise<Array<{
    name: string;
    type: 'person' | 'organization' | 'location' | 'concept' | 'technology' | 'event' | 'other';
    confidence: number;
  }>>;

  /**
   * 从对话历史中提取用户 Persona 特征
   * @param conversationText 格式化的对话文本
   * @param existingPersona 可选的现有 Persona 用于增量更新
   * @returns Persona 特征提取结果（使用通用类型避免循环依赖）
   */
  extractPersonaFeatures(conversationText: string, existingPersona?: any): Promise<{
    name?: string;
    age?: string;
    gender?: string;
    occupation?: string;
    location?: string;
    personalityTraits: Array<{
      trait: string;
      description?: string;
      confidence?: number;
      evidence?: string[];
      category?: string;
    }>;
    interests: Array<{
      name: string;
      category?: string;
      level?: string;
      confidence?: number;
      firstObserved?: number;
      lastObserved?: number;
      frequency?: number;
    }>;
    communicationStyle?: {
      formality?: string;
      directness?: string;
      detailPreference?: string;
      tone?: string[];
    };
    values: string[];
    goals: string[];
    background?: string;
    confidence: number;
    sources: string[];
  }>;

  /**
   * 设置 Agent 上下文提供器
   */
  setAgentContextProvider(provider: IAgentContextProvider): void;

  /**
   * 获取 Agent 上下文提供器
   */
  getAgentContextProvider(): IAgentContextProvider | undefined;
}

/**
 * Base Extractor
 */
export abstract class BaseLLMExtractor implements ILLMExtractor {
  protected logger: ILogger;
  protected agentContextProvider?: IAgentContextProvider;
  protected promptLoader = PromptLoader.getInstance();

  constructor(protected config: MemoryCaptureConfig) {
    this.logger = createServiceLogger('LLMExtractor');
  }

  /**
   * 设置 Agent 上下文提供器
   */
  setAgentContextProvider(provider: IAgentContextProvider): void {
    this.agentContextProvider = provider;
  }

  /**
   * 获取 Agent 上下文提供器
   */
  getAgentContextProvider(): IAgentContextProvider | undefined {
    return this.agentContextProvider;
  }

  /**
   * 使用 Agent 上下文调用 LLM
   */
  protected async callWithAgentContext(
    prompt: string,
    agentType: AgentType,
    runtimeContext?: AgentRuntimeContext,
    signal?: AbortSignal
  ): Promise<string> {
    let systemPrompt = '';

    if (this.agentContextProvider) {
      try {
        const agentContext = await this.agentContextProvider.getAgentContext(agentType, runtimeContext);
        systemPrompt = agentContext.systemPrompt;
        this.logger.debug('Using agent context', { agentType, hasSystemPrompt: !!systemPrompt });
      } catch (error) {
        this.logger.warn('Failed to get agent context, using fallback', { agentType, error: String(error) });
      }
    }

    return this.callLLM(prompt, systemPrompt, signal);
  }

  abstract extractMemories(
    text: string,
    options: { maxCount: number; typeHints?: MemoryType[] },
    signal?: AbortSignal
  ): Promise<ExtractedMemory[]>;

  abstract generateSummary(content: string): Promise<string>;

  abstract generateScores(content: string): Promise<LLMScoringResult>;

  abstract extractEntities(content: string): Promise<Array<{
    name: string;
    type: 'person' | 'organization' | 'location' | 'concept' | 'technology' | 'event' | 'other';
    confidence: number;
  }>>;

  abstract analyzeMemoryFocus(content: string, type: MemoryType): Promise<LLMFocusAnalysisResult>;

  abstract extractPersonaFeatures(conversationText: string, existingPersona?: any): Promise<{
    name?: string;
    age?: string;
    gender?: string;
    occupation?: string;
    location?: string;
    personalityTraits: Array<{
      trait: string;
      description?: string;
      confidence?: number;
      evidence?: string[];
      category?: string;
    }>;
    interests: Array<{
      name: string;
      category?: string;
      level?: string;
      confidence?: number;
      firstObserved?: number;
      lastObserved?: number;
      frequency?: number;
    }>;
    communicationStyle?: {
      formality?: string;
      directness?: string;
      detailPreference?: string;
      tone?: string[];
    };
    values: string[];
    goals: string[];
    background?: string;
    confidence: number;
    sources: string[];
  }>;

  async mergeMemories(memories: string[]): Promise<string> {
    if (memories.length === 0) return '';
    if (memories.length === 1) return memories[0];

    const prompt = this.buildMergingPrompt(memories);

    this.logger.debug('mergeMemories called', { memoryCount: memories.length });
    const response = await this.callWithAgentContext(prompt, AgentType.MEMORY_MERGE);
    const merged = this.parseMergingResponse(response);

    this.logger.info('mergeMemories completed', {
      memoryCount: memories.length,
      mergedLength: merged.length
    });
    return merged;
  }

  async consolidateMemories(memories: string[]): Promise<{
    content: string;
    keywords: string[];
    insights: string[];
    summary: string;
  }> {
    if (memories.length === 0) {
      return { content: '', keywords: [], insights: [], summary: '' };
    }
    if (memories.length === 1) {
      return {
        content: memories[0],
        keywords: [],
        insights: [],
        summary: memories[0].substring(0, 50) + (memories[0].length > 50 ? '...' : '')
      };
    }

    const prompt = this.buildConsolidationPrompt(memories);

    this.logger.debug('consolidateMemories called', { memoryCount: memories.length });
    const response = await this.callWithAgentContext(prompt, AgentType.DREAMING);
    const result = this.parseConsolidationResponse(response);

    this.logger.info('consolidateMemories completed', {
      memoryCount: memories.length,
      contentLength: result.content.length,
      keywordsCount: result.keywords.length,
      insightsCount: result.insights.length,
    });
    return result;
  }

  /**
   * 解析归纳整理的 LLM 响应
   */
  protected parseConsolidationResponse(response: string): {
    content: string;
    keywords: string[];
    insights: string[];
    summary: string;
  } {
    try {
      const parsed = this.safeParseJson<{
        content?: string;
        keywords?: string[];
        insights?: string[];
        summary?: string;
      }>(response, 'consolidation');

      return {
        content: parsed.content || '',
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        insights: Array.isArray(parsed.insights) ? parsed.insights : [],
        summary: parsed.summary || '',
      };
    } catch {
      // JSON 解析失败，尝试简单处理
      const cleaned = response.trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '');
      this.logger.warn('consolidateMemories JSON parse failed, using fallback', { response: cleaned.substring(0, 100) });
      return {
        content: cleaned,
        keywords: [],
        insights: [],
        summary: cleaned.substring(0, 100),
      };
    }
  }

  protected parseMergingResponse(response: string): string {
    // 清理响应，提取核心内容
    let cleaned = response.trim();

    // 如果有 JSON 包装，尝试提取 content 字段
    try {
      const parsed = this.safeParseJson<{
        content?: string;
        merged?: string;
        result?: string;
        summary?: string;
      }>(response, 'merging');

      if (parsed.content) {
        cleaned = parsed.content;
      } else if (parsed.merged || parsed.result || parsed.summary) {
        cleaned = parsed.merged || parsed.result || parsed.summary || cleaned;
      }
    } catch {
      // 不是 JSON，保持原样
    }

    // 移除可能的 markdown 代码块标记
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    return cleaned.trim();
  }

  // ============================================================
  // Prompt-building methods (using PromptLoader)
  // ============================================================

  protected buildExtractionSystem(typeHints?: MemoryType[]): string {
    const types = typeHints?.map(t => t.valueOf()).join(', ') ?? MemoryType.FACT;
    return this.promptLoader.render('prompts/memory-extraction-system.md', {
      memoryTypes: types,
    });
  }

  protected buildExtractionPrompt(text: string, _maxCount: number): string {
    const lines = text.split('\n');
    return this.promptLoader.render('prompts/memory-extraction.md', {
      lineCount: String(lines.length),
      maxLineIndex: String(lines.length - 1),
      conversationText: text,
    });
  }

  protected buildScoringPrompt(content: string): string {
    return this.promptLoader.render('prompts/scoring.md', { content });
  }

  protected buildMergingPrompt(memories: string[]): string {
    const memoryList = memories.map((m, i) => `【记忆 ${i + 1}】\n${m}`).join('\n\n');
    return this.promptLoader.render('prompts/memory-merging.md', { memoryList });
  }

  protected buildConsolidationPrompt(memories: string[]): string {
    const memoryList = memories.map((m, i) => `【记忆 ${i + 1}】\n${m}`).join('\n\n');
    return this.promptLoader.render('prompts/memory-consolidation.md', { memoryList });
  }

  protected buildEntityExtractionPrompt(content: string): string {
    return this.promptLoader.render('prompts/entity-extraction.md', { content });
  }

  protected buildFocusPrompt(content: string, type: MemoryType): string {
    return this.promptLoader.render('prompts/focus-analysis.md', {
      memoryType: type.valueOf(),
      content,
    });
  }

  protected buildPersonaExtractionPrompt(conversationText: string, existingPersona?: any): string {
    const existingBlock = existingPersona
      ? `\n\n现有 Persona 信息（版本 ${existingPersona.version || 1}）：\n- 性格特征：${existingPersona.personalityTraits?.length || 0} 个\n- 兴趣：${existingPersona.interests?.length || 0} 个\n- 价值观：${existingPersona.values?.length || 0} 个\n\n请在现有 Persona 基础上进行更新，标注出变化。`
      : '';
    return this.promptLoader.render('prompts/persona-extraction.md', {
      conversationText,
      existingPersona: existingBlock,
    });
  }

  protected buildSummaryPrompt(content: string): string {
    return this.promptLoader.render('prompts/summary-generation.md', { content });
  }

  /**
   * 安全解析 LLM 返回的 JSON 响应
   *
   * 处理流程：
   * 1. 移除 markdown 代码块标记
   * 2. 使用正则提取 JSON 对象/数组
   * 3. 尝试直接 JSON.parse
   * 4. 失败时使用 JsonParser.autoFixJson 自动修复后重试
   * 5. 仍然失败则记录详细错误并抛出
   *
   * @param response - LLM 原始响应
   * @param context - 调用上下文标识（用于日志）
   * @param extractArray - 是否提取数组（默认 false，提取对象）
   * @returns 解析后的对象
   */
  protected safeParseJson<T>(response: string, context: string, extractArray: boolean = false): T {
    // 1. 移除 markdown 代码块
    let cleaned = response.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');

    // 2. 提取 JSON
    let jsonStr: string | null = null;
    if (extractArray) {
      const match = cleaned.match(/\[[\s\S]*\]/);
      jsonStr = match ? match[0] : null;
    } else {
      const match = cleaned.match(/\{[\s\S]*\}/);
      jsonStr = match ? match[0] : null;
    }

    if (!jsonStr) {
      this.logger.error(`No JSON found in ${context} response`, {
        responsePreview: response.substring(0, 500),
        responseLength: response.length,
      });
      throw new Error(`No JSON found in ${context} response`);
    }

    // 3. 尝试直接解析
    try {
      return JSON.parse(jsonStr) as T;
    } catch (firstError) {
      // 4. 使用 autoFixJson 自动修复后重试
      try {
        const fixed = JsonParser.autoFixJson(jsonStr);
        if (fixed !== jsonStr) {
          this.logger.warn(`JSON auto-fixed for ${context}`, {
            originalLength: jsonStr.length,
            fixedLength: fixed.length,
            originalError: String(firstError),
          });
        }
        return JSON.parse(fixed) as T;
      } catch (secondError) {
        // 5. 记录详细错误信息后抛出
        this.logger.error(`JSON parse failed for ${context} after auto-fix`, {
          error: String(secondError),
          jsonPreview: jsonStr.substring(0, 500),
          jsonSuffix: jsonStr.length > 500
            ? jsonStr.substring(jsonStr.length - 200)
            : '',
          responseLength: response.length,
        });
        throw secondError;
      }
    }
  }

  protected abstract callLLM(prompt: string, system?: string, signal?: AbortSignal): Promise<string>;
}

/**
 * Anthropic Extractor
 */
export class AnthropicExtractor extends BaseLLMExtractor {
  private readonly API_VERSION = '2023-06-01';

  /**
   * 获取 baseURL - 优先使用配置
   */
  private get baseURL(): string {
    return this.config.llmEndpoint || 'https://api.anthropic.com/v1';
  }

  /**
   * 获取模型 - 优先使用配置
   */
  private get model(): string {
    return this.config.llmModel || 'claude-3-sonnet-20240229';
  }

  async extractMemories(
    text: string,
    options: { maxCount: number; typeHints?: MemoryType[] },
    signal?: AbortSignal
  ): Promise<ExtractedMemory[]> {
    const system = this.buildExtractionSystem(options.typeHints);
    const prompt = this.buildExtractionPrompt(text, options.maxCount);

    this.logger.debug('extractMemories called', { textLength: text.length, maxCount: options.maxCount });
    try {
      const response = await this.callWithAgentContext(prompt, AgentType.MEMORY_CAPTURE, undefined, signal);
      const result = this.parseExtractionResponse(response);
      this.logger.info('extractMemories completed', { textLength: text.length, extractedCount: result.length });
      return result;
    } catch (error) {
      this.logger.error('Extraction failed', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async generateSummary(content: string): Promise<string> {
    const prompt = this.buildSummaryPrompt(content);

    this.logger.debug('generateSummary called', { contentLength: content.length });
    const response = await this.callWithAgentContext(prompt, AgentType.MEMORY_CAPTURE);
    const parsed = this.safeParseJson<{ summary?: string }>(response, 'summary');
    // 从 memoryService.store.summaryMaxLength 读取摘要最大长度（默认200）
    // 注意：LLM 生成的摘要通常较短，50字符过于简短
    let summaryMaxLength = 200;
    try {
      const { config } = require('../../../shared/config');
      if (config.isInitialized()) {
        const storeConfig = config.getConfig('memoryService.store') as { summaryMaxLength?: number } | undefined;
        if (storeConfig?.summaryMaxLength) {
          summaryMaxLength = storeConfig.summaryMaxLength;
        }
      }
    } catch {
      // ConfigManager 不可用，使用默认值
    }

    const summary = (parsed.summary ?? '').substring(0, summaryMaxLength);
    if (!summary) {
      throw new Error('LLM returned empty summary');
    }
    this.logger.info('generateSummary completed', { contentLength: content.length, summaryLength: summary.length });
    return summary;
  }

  async generateScores(content: string): Promise<LLMScoringResult> {
    const prompt = this.buildScoringPrompt(content);

    this.logger.debug('generateScores called', { contentLength: content.length });
    const response = await this.callWithAgentContext(prompt, AgentType.MEMORY_STORE);
    const result = this.parseScoringResponse(response);

    this.logger.info('generateScores completed', {
      contentLength: content.length,
      importance: result.importance,
      scopeScore: result.scopeScore
    });
    return result;
  }

  async analyzeMemoryFocus(content: string, type: MemoryType): Promise<LLMFocusAnalysisResult> {
    const prompt = this.buildFocusPrompt(content, type);

    this.logger.debug('analyzeMemoryFocus called', { contentLength: content.length, type });
    const response = await this.callWithAgentContext(prompt, AgentType.MEMORY_CAPTURE);
    const result = this.parseFocusResponse(response);

    this.logger.info('analyzeMemoryFocus completed', {
      contentLength: content.length,
      type,
      focusLevel: result.focusLevel
    });
    return result;
  }

  async extractEntities(content: string): Promise<Array<{
    name: string;
    type: 'person' | 'organization' | 'location' | 'concept' | 'technology' | 'event' | 'other';
    confidence: number;
  }>> {
    const prompt = this.buildEntityExtractionPrompt(content);

    this.logger.debug('extractEntities called', { contentLength: content.length });
    const response = await this.callWithAgentContext(prompt, AgentType.MEMORY_STORE);
    const result = this.parseEntityExtractionResponse(response);

    this.logger.info('extractEntities completed', {
      contentLength: content.length,
      entityCount: result.length,
    });
    return result;
  }

  async extractPersonaFeatures(conversationText: string, existingPersona?: any): Promise<{
    name?: string;
    age?: string;
    gender?: string;
    occupation?: string;
    location?: string;
    personalityTraits: Array<{
      trait: string;
      description?: string;
      confidence?: number;
      evidence?: string[];
      category?: string;
    }>;
    interests: Array<{
      name: string;
      category?: string;
      level?: string;
      confidence?: number;
      firstObserved?: number;
      lastObserved?: number;
      frequency?: number;
    }>;
    communicationStyle?: {
      formality?: string;
      directness?: string;
      detailPreference?: string;
      tone?: string[];
    };
    values: string[];
    goals: string[];
    background?: string;
    confidence: number;
    sources: string[];
  }> {
    const prompt = this.buildPersonaExtractionPrompt(conversationText, existingPersona);

    this.logger.debug('extractPersonaFeatures called', { textLength: conversationText.length });
    const response = await this.callWithAgentContext(prompt, AgentType.PERSONA);
    const result = this.parsePersonaExtractionResponse(response);

    this.logger.info('extractPersonaFeatures completed', {
      textLength: conversationText.length,
      traitsCount: result.personalityTraits.length,
      interestsCount: result.interests.length,
    });
    return result;
  }

  // ============================================================
  // Parsing methods (Anthropic-specific)
  // ============================================================

  private parseScoringResponse(response: string): LLMScoringResult {
    const parsed = this.safeParseJson<{
      importance: number;
      scope: number;
      confidence?: number;
      reasoning?: string;
    }>(response, 'scoring');

    if (typeof parsed.importance !== 'number' || typeof parsed.scope !== 'number') {
      throw new Error(`Invalid scoring response: missing numeric importance/scope`);
    }
    return {
      importance: Math.max(0, Math.min(10, parsed.importance)),
      scopeScore: Math.max(0, Math.min(10, parsed.scope)),
      confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
      reasoning: parsed.reasoning ?? '',
    };
  }

  private parseEntityExtractionResponse(response: string): Array<{
    name: string;
    type: 'person' | 'organization' | 'location' | 'concept' | 'technology' | 'event' | 'other';
    confidence: number;
  }> {
    try {
      const parsed = this.safeParseJson<{ entities?: Array<{ name: string; type: string; confidence?: number }> }>(
        response, 'entity-extraction',
      );
      if (!parsed.entities || !Array.isArray(parsed.entities)) {
        return [];
      }

      const validTypes = ['person', 'organization', 'location', 'concept', 'technology', 'event', 'other'];
      return parsed.entities
        .filter((e) => e.name && e.type)
        .map((e) => ({
          name: String(e.name).substring(0, 100),
          type: validTypes.includes(e.type) ? e.type as any : 'other',
          confidence: Math.max(0, Math.min(1, e.confidence ?? 0.5)),
        }));
    } catch (error) {
      this.logger.error('Failed to parse entity extraction response', error instanceof Error ? error : new Error(String(error)));
      return [];
    }
  }

  private parseFocusResponse(response: string): LLMFocusAnalysisResult {
    const parsed = this.safeParseJson<{ focusLevel: number; reasoning?: string }>(response, 'focus');

    if (typeof parsed.focusLevel !== 'number') {
      throw new Error(`Invalid focus response: focusLevel is not a number`);
    }
    return {
      focusLevel: Math.max(0, Math.min(1, parsed.focusLevel)),
      reasoning: parsed.reasoning ?? '',
    };
  }

  private parsePersonaExtractionResponse(response: string): any {
    const parsed = this.safeParseJson<any>(response, 'persona-extraction');
    const now = Date.now();

    return {
      name: parsed.name,
      age: parsed.age,
      gender: parsed.gender,
      occupation: parsed.occupation,
      location: parsed.location,
      personalityTraits: Array.isArray(parsed.personalityTraits)
        ? parsed.personalityTraits.map((t: any) => ({
            trait: t.trait ?? 'unknown',
            description: t.description ?? '',
            confidence: typeof t.confidence === 'number' ? t.confidence : 0.5,
            evidence: Array.isArray(t.evidence) ? t.evidence : [],
            category: this.validatePersonalityCategory(t.category),
          }))
        : [],
      interests: Array.isArray(parsed.interests)
        ? parsed.interests.map((i: any) => ({
            name: i.name ?? 'unknown',
            category: i.category ?? 'general',
            level: this.validateInterestLevel(i.level),
            confidence: typeof i.confidence === 'number' ? i.confidence : 0.5,
            firstObserved: typeof i.firstObserved === 'number' ? i.firstObserved : now,
            lastObserved: typeof i.lastObserved === 'number' ? i.lastObserved : now,
            frequency: typeof i.frequency === 'number' ? i.frequency : 1,
          }))
        : [],
      communicationStyle: parsed.communicationStyle ? {
        formality: this.validateFormalityLevel(parsed.communicationStyle.formality),
        directness: this.validateDirectnessLevel(parsed.communicationStyle.directness),
        detailPreference: this.validateDetailLevel(parsed.communicationStyle.detailPreference),
        tone: Array.isArray(parsed.communicationStyle.tone) ? parsed.communicationStyle.tone : [],
      } : undefined,
      values: Array.isArray(parsed.values) ? parsed.values : [],
      goals: Array.isArray(parsed.goals) ? parsed.goals : [],
      background: parsed.background,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      sources: Array.isArray(parsed.sources) ? parsed.sources : ['conversation'],
    };
  }

  private parseExtractionResponse(response: string): ExtractedMemory[] {
    this.logger.info('LLM extraction response', { response: response.substring(0, 1500) });

    const parsed = this.safeParseJson<Array<{
      content: string;
      type: string;
      confidence: number;
      keywords: string[];
      tags: string[];
      segmentStart?: number;
      segmentEnd?: number;
      sourceSegment?: string;
      topicId?: string;
    }>>(response, 'extraction', true);

    return parsed.map(item => ({
      content: item.content,
      type: this.parseMemoryType(item.type),
      confidence: Math.max(0, Math.min(1, item.confidence ?? 0.5)),
      keywords: item.keywords ?? [],
      tags: item.tags ?? [],
      segmentStart: item.segmentStart,
      segmentEnd: item.segmentEnd,
      sourceSegment: item.sourceSegment,
      topicId: item.topicId,
    }));
  }

  private parseMemoryType(typeStr: string): MemoryType {
    const normalized = typeStr.toLowerCase().trim();
    const typeMap: Record<string, MemoryType> = {
      'fact': MemoryType.FACT,
      'event': MemoryType.EVENT,
      'decision': MemoryType.DECISION,
      'error': MemoryType.ERROR,
      'learning': MemoryType.LEARNING,
      'relation': MemoryType.RELATION,
      // v2.0.0 Profile types
      'identity': MemoryType.IDENTITY,
      'preference': MemoryType.PREFERENCE,
      'persona': MemoryType.PERSONA,
    };
    return typeMap[normalized] ?? MemoryType.FACT;
  }

  private validatePersonalityCategory(category: string): string {
    const validCategories = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];
    return validCategories.includes(category) ? category : 'openness';
  }

  private validateInterestLevel(level: string): string {
    const validLevels = ['casual', 'interested', 'passionate', 'expert'];
    return validLevels.includes(level) ? level : 'interested';
  }

  private validateFormalityLevel(level: string): string {
    const validLevels = ['very-informal', 'informal', 'neutral', 'formal', 'very-formal'];
    return validLevels.includes(level) ? level : 'neutral';
  }

  private validateDirectnessLevel(level: string): string {
    const validLevels = ['very-indirect', 'indirect', 'neutral', 'direct', 'very-direct'];
    return validLevels.includes(level) ? level : 'neutral';
  }

  private validateDetailLevel(level: string): string {
    const validLevels = ['minimal', 'summary', 'moderate', 'detailed', 'comprehensive'];
    return validLevels.includes(level) ? level : 'moderate';
  }

  protected async callLLM(prompt: string, system?: string, signal?: AbortSignal): Promise<string> {
    if (!this.config.llmApiKey) {
      throw new ExtractorError('API key is required', 'MISSING_API_KEY');
    }

    const url = `${this.baseURL}/messages`;

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    };

    if (system) {
      body['system'] = system;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.llmApiKey,
        'anthropic-version': this.API_VERSION,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ExtractorError(
        `API request failed: ${errorText}`,
        'API_ERROR',
        response.status
      );
    }

    const data = await response.json() as { content: Array<{ text: string }> };
    return data.content[0]?.text ?? '';
  }
}

/**
 * OpenAI Extractor
 */
export class OpenAIExtractor extends BaseLLMExtractor {
  /**
   * 获取 baseURL - 优先使用配置
   */
  private get baseURL(): string {
    return this.config.llmEndpoint || 'https://api.openai.com/v1';
  }

  /**
   * 获取模型 - 优先使用配置
   */
  private get model(): string {
    return this.config.llmModel || 'gpt-4';
  }

  async extractMemories(
    text: string,
    options: { maxCount: number; typeHints?: MemoryType[] },
    signal?: AbortSignal
  ): Promise<ExtractedMemory[]> {
    const system = this.buildExtractionSystem(options.typeHints);
    const prompt = this.buildExtractionPrompt(text, options.maxCount);

    this.logger.debug('extractMemories called', { textLength: text.length, maxCount: options.maxCount });
    try {
      const response = await this.callWithAgentContext(prompt, AgentType.MEMORY_CAPTURE, undefined, signal);
      const result = this.parseExtractionResponse(response);
      this.logger.info('extractMemories completed', { textLength: text.length, extractedCount: result.length });
      return result;
    } catch (error) {
      this.logger.error('Extraction failed', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async generateSummary(content: string): Promise<string> {
    const prompt = this.buildSummaryPrompt(content);

    this.logger.debug('generateSummary called', { contentLength: content.length });
    const response = await this.callWithAgentContext(prompt, AgentType.MEMORY_CAPTURE);
    const parsed = this.safeParseJson<{ summary?: string }>(response, 'summary');
    // 从 memoryService.store.summaryMaxLength 读取摘要最大长度（默认200）
    // 注意：LLM 生成的摘要通常较短，50字符过于简短
    let summaryMaxLength = 200;
    try {
      const { config } = require('../../../shared/config');
      if (config.isInitialized()) {
        const storeConfig = config.getConfig('memoryService.store') as { summaryMaxLength?: number } | undefined;
        if (storeConfig?.summaryMaxLength) {
          summaryMaxLength = storeConfig.summaryMaxLength;
        }
      }
    } catch {
      // ConfigManager 不可用，使用默认值
    }

    const summary = (parsed.summary ?? '').substring(0, summaryMaxLength);
    if (!summary) {
      throw new Error('LLM returned empty summary');
    }
    this.logger.info('generateSummary completed', { contentLength: content.length, summaryLength: summary.length });
    return summary;
  }

  async generateScores(content: string): Promise<LLMScoringResult> {
    const prompt = this.buildScoringPrompt(content);

    this.logger.debug('generateScores called', { contentLength: content.length });
    const response = await this.callWithAgentContext(prompt, AgentType.MEMORY_STORE);
    const result = this.parseScoringResponse(response);

    this.logger.info('generateScores completed', {
      contentLength: content.length,
      importance: result.importance,
      scopeScore: result.scopeScore
    });
    return result;
  }

  async analyzeMemoryFocus(content: string, type: MemoryType): Promise<LLMFocusAnalysisResult> {
    const prompt = this.buildFocusPrompt(content, type);

    this.logger.debug('analyzeMemoryFocus called', { contentLength: content.length, type });
    const response = await this.callWithAgentContext(prompt, AgentType.MEMORY_CAPTURE);
    const result = this.parseFocusResponse(response);

    this.logger.info('analyzeMemoryFocus completed', {
      contentLength: content.length,
      type,
      focusLevel: result.focusLevel
    });
    return result;
  }

  async extractEntities(content: string): Promise<Array<{
    name: string;
    type: 'person' | 'organization' | 'location' | 'concept' | 'technology' | 'event' | 'other';
    confidence: number;
  }>> {
    const prompt = this.buildEntityExtractionPrompt(content);

    this.logger.debug('extractEntities called', { contentLength: content.length });
    const response = await this.callWithAgentContext(prompt, AgentType.MEMORY_STORE);
    const result = this.parseEntityExtractionResponse(response);

    this.logger.info('extractEntities completed', {
      contentLength: content.length,
      entityCount: result.length,
    });
    return result;
  }

  async extractPersonaFeatures(conversationText: string, existingPersona?: any): Promise<{
    name?: string;
    age?: string;
    gender?: string;
    occupation?: string;
    location?: string;
    personalityTraits: Array<{
      trait: string;
      description?: string;
      confidence?: number;
      evidence?: string[];
      category?: string;
    }>;
    interests: Array<{
      name: string;
      category?: string;
      level?: string;
      confidence?: number;
      firstObserved?: number;
      lastObserved?: number;
      frequency?: number;
    }>;
    communicationStyle?: {
      formality?: string;
      directness?: string;
      detailPreference?: string;
      tone?: string[];
    };
    values: string[];
    goals: string[];
    background?: string;
    confidence: number;
    sources: string[];
  }> {
    const prompt = this.buildPersonaExtractionPrompt(conversationText, existingPersona);

    this.logger.debug('extractPersonaFeatures called', { textLength: conversationText.length });
    const response = await this.callWithAgentContext(prompt, AgentType.PERSONA);
    const result = this.parsePersonaExtractionResponse(response);

    this.logger.info('extractPersonaFeatures completed', {
      textLength: conversationText.length,
      traitsCount: result.personalityTraits.length,
      interestsCount: result.interests.length,
    });
    return result;
  }

  // ============================================================
  // Parsing methods (OpenAI-specific)
  // ============================================================

  private parseScoringResponse(response: string): LLMScoringResult {
    const parsed = this.safeParseJson<{
      importance: number;
      scope: number;
      confidence?: number;
      reasoning?: string;
    }>(response, 'scoring');

    if (typeof parsed.importance !== 'number' || typeof parsed.scope !== 'number') {
      throw new Error(`Invalid scoring response: missing numeric importance/scope`);
    }
    return {
      importance: Math.max(0, Math.min(10, parsed.importance)),
      scopeScore: Math.max(0, Math.min(10, parsed.scope)),
      confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
      reasoning: parsed.reasoning ?? '',
    };
  }

  private parseEntityExtractionResponse(response: string): Array<{
    name: string;
    type: 'person' | 'organization' | 'location' | 'concept' | 'technology' | 'event' | 'other';
    confidence: number;
  }> {
    try {
      const parsed = this.safeParseJson<{ entities?: Array<{ name: string; type: string; confidence?: number }> }>(
        response, 'entity-extraction',
      );
      if (!parsed.entities || !Array.isArray(parsed.entities)) {
        return [];
      }

      const validTypes = ['person', 'organization', 'location', 'concept', 'technology', 'event', 'other'];
      return parsed.entities
        .filter((e) => e.name && e.type)
        .map((e) => ({
          name: String(e.name).substring(0, 100),
          type: validTypes.includes(e.type) ? e.type as any : 'other',
          confidence: Math.max(0, Math.min(1, e.confidence ?? 0.5)),
        }));
    } catch (error) {
      this.logger.error('Failed to parse entity extraction response', error instanceof Error ? error : new Error(String(error)));
      return [];
    }
  }

  private parseFocusResponse(response: string): LLMFocusAnalysisResult {
    const parsed = this.safeParseJson<{ focusLevel: number; reasoning?: string }>(response, 'focus');

    if (typeof parsed.focusLevel !== 'number') {
      throw new Error(`Invalid focus response: focusLevel is not a number`);
    }
    return {
      focusLevel: Math.max(0, Math.min(1, parsed.focusLevel)),
      reasoning: parsed.reasoning ?? '',
    };
  }

  private parsePersonaExtractionResponse(response: string): any {
    const parsed = this.safeParseJson<any>(response, 'persona-extraction');
    const now = Date.now();

    return {
      name: parsed.name,
      age: parsed.age,
      gender: parsed.gender,
      occupation: parsed.occupation,
      location: parsed.location,
      personalityTraits: Array.isArray(parsed.personalityTraits)
        ? parsed.personalityTraits.map((t: any) => ({
            trait: t.trait ?? 'unknown',
            description: t.description ?? '',
            confidence: typeof t.confidence === 'number' ? t.confidence : 0.5,
            evidence: Array.isArray(t.evidence) ? t.evidence : [],
            category: this.validatePersonalityCategory(t.category),
          }))
        : [],
      interests: Array.isArray(parsed.interests)
        ? parsed.interests.map((i: any) => ({
            name: i.name ?? 'unknown',
            category: i.category ?? 'general',
            level: this.validateInterestLevel(i.level),
            confidence: typeof i.confidence === 'number' ? i.confidence : 0.5,
            firstObserved: typeof i.firstObserved === 'number' ? i.firstObserved : now,
            lastObserved: typeof i.lastObserved === 'number' ? i.lastObserved : now,
            frequency: typeof i.frequency === 'number' ? i.frequency : 1,
          }))
        : [],
      communicationStyle: parsed.communicationStyle ? {
        formality: this.validateFormalityLevel(parsed.communicationStyle.formality),
        directness: this.validateDirectnessLevel(parsed.communicationStyle.directness),
        detailPreference: this.validateDetailLevel(parsed.communicationStyle.detailPreference),
        tone: Array.isArray(parsed.communicationStyle.tone) ? parsed.communicationStyle.tone : [],
      } : undefined,
      values: Array.isArray(parsed.values) ? parsed.values : [],
      goals: Array.isArray(parsed.goals) ? parsed.goals : [],
      background: parsed.background,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      sources: Array.isArray(parsed.sources) ? parsed.sources : ['conversation'],
    };
  }

  private parseExtractionResponse(response: string): ExtractedMemory[] {
    this.logger.info('LLM extraction response', { response: response.substring(0, 1500) });

    const parsed = this.safeParseJson<Array<{
      content: string;
      type: string;
      confidence: number;
      keywords: string[];
      tags: string[];
      segmentStart?: number;
      segmentEnd?: number;
      sourceSegment?: string;
      topicId?: string;
    }>>(response, 'extraction', true);

    return parsed.map(item => ({
      content: item.content,
      type: this.parseMemoryType(item.type),
      confidence: Math.max(0, Math.min(1, item.confidence ?? 0.5)),
      keywords: item.keywords ?? [],
      tags: item.tags ?? [],
      segmentStart: item.segmentStart,
      segmentEnd: item.segmentEnd,
      sourceSegment: item.sourceSegment,
      topicId: item.topicId,
    }));
  }

  private parseMemoryType(typeStr: string): MemoryType {
    const normalized = typeStr.toLowerCase().trim();
    const typeMap: Record<string, MemoryType> = {
      'fact': MemoryType.FACT,
      'event': MemoryType.EVENT,
      'decision': MemoryType.DECISION,
      'error': MemoryType.ERROR,
      'learning': MemoryType.LEARNING,
      'relation': MemoryType.RELATION,
      // v2.0.0 Profile types
      'identity': MemoryType.IDENTITY,
      'preference': MemoryType.PREFERENCE,
      'persona': MemoryType.PERSONA,
    };
    return typeMap[normalized] ?? MemoryType.FACT;
  }

  private validatePersonalityCategory(category: string): string {
    const validCategories = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];
    return validCategories.includes(category) ? category : 'openness';
  }

  private validateInterestLevel(level: string): string {
    const validLevels = ['casual', 'interested', 'passionate', 'expert'];
    return validLevels.includes(level) ? level : 'interested';
  }

  private validateFormalityLevel(level: string): string {
    const validLevels = ['very-informal', 'informal', 'neutral', 'formal', 'very-formal'];
    return validLevels.includes(level) ? level : 'neutral';
  }

  private validateDirectnessLevel(level: string): string {
    const validLevels = ['very-indirect', 'indirect', 'neutral', 'direct', 'very-direct'];
    return validLevels.includes(level) ? level : 'neutral';
  }

  private validateDetailLevel(level: string): string {
    const validLevels = ['minimal', 'summary', 'moderate', 'detailed', 'comprehensive'];
    return validLevels.includes(level) ? level : 'moderate';
  }

  protected async callLLM(prompt: string, system?: string, signal?: AbortSignal): Promise<string> {
    if (!this.config.llmApiKey) {
      throw new ExtractorError('API key is required', 'MISSING_API_KEY');
    }

    const url = `${this.baseURL}/chat/completions`;

    const messages: Array<{ role: string; content: string }> = [];
    if (system) {
      messages.push({ role: 'system', content: system });
    }
    messages.push({ role: 'user', content: prompt });

const body: Record<string, unknown> = {
      model: this.model,
      messages,
    };
    // Use temperature from config, default to 0.7
    const temperature = (this.config as any).temperature ?? 0.7;
    if (temperature !== undefined) {
      body['temperature'] = temperature;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.llmApiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ExtractorError(
        `API request failed: ${errorText}`,
        'API_ERROR',
        response.status
      );
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? '';
  }
}

/**
 * Custom Extractor (OpenAI-compatible API)
 */
export class CustomExtractor extends BaseLLMExtractor {
  async extractMemories(
    text: string,
    options: { maxCount: number; typeHints?: MemoryType[] },
    signal?: AbortSignal
  ): Promise<ExtractedMemory[]> {
    const system = this.buildExtractionSystem(options.typeHints);
    const prompt = this.buildExtractionPrompt(text, options.maxCount);

    try {
      const response = await this.callLLM(prompt, system, signal);
      this.logger.debug('LLM raw response', { response: response.substring(0, 1000) });
      return this.parseExtractionResponse(response);
    } catch (error) {
      this.logger.error('Extraction failed', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async generateSummary(content: string): Promise<string> {
    this.logger.debug('generateSummary called', { contentLength: content.length });
    const prompt = this.buildSummaryPrompt(content);

    const response = await this.callLLM(prompt);
    const parsed = this.safeParseJson<{ summary?: string }>(response, 'summary');
    // 从 memoryService.store.summaryMaxLength 读取摘要最大长度（默认200）
    // 注意：LLM 生成的摘要通常较短，50字符过于简短
    let summaryMaxLength = 200;
    try {
      const { config } = require('../../../shared/config');
      if (config.isInitialized()) {
        const storeConfig = config.getConfig('memoryService.store') as { summaryMaxLength?: number } | undefined;
        if (storeConfig?.summaryMaxLength) {
          summaryMaxLength = storeConfig.summaryMaxLength;
        }
      }
    } catch {
      // ConfigManager 不可用，使用默认值
    }

    const summary = (parsed.summary ?? '').substring(0, summaryMaxLength);
    if (!summary) {
      throw new Error('LLM returned empty summary');
    }
    this.logger.info('generateSummary completed', { contentLength: content.length, summaryLength: summary.length });
    return summary;
  }

  async generateScores(content: string): Promise<LLMScoringResult> {
    const prompt = this.buildScoringPrompt(content);

    this.logger.debug('generateScores called', { contentLength: content.length });
    try {
      const response = await this.callLLM(prompt);
      const result = this.parseScoringResponse(response);

      this.logger.info('generateScores completed', {
        contentLength: content.length,
        importance: result.importance,
        scopeScore: result.scopeScore,
        confidence: result.confidence
      });
      return result;
    } catch (error) {
      this.logger.error('generateScores failed', error instanceof Error ? error : new Error(String(error)), { contentLength: content.length });
      // Fallback to default scores if LLM fails - throw instead of returning defaults
      // This ensures memories aren't stored with meaningless default scores
      throw error;
    }
  }

  async analyzeMemoryFocus(content: string, type: MemoryType): Promise<LLMFocusAnalysisResult> {
    const prompt = this.buildFocusPrompt(content, type);

    this.logger.debug('analyzeMemoryFocus called', { contentLength: content.length, type });
    const response = await this.callWithAgentContext(prompt, AgentType.MEMORY_CAPTURE);
    const result = this.parseFocusResponse(response);

    this.logger.info('analyzeMemoryFocus completed', {
      contentLength: content.length,
      type,
      focusLevel: result.focusLevel
    });
    return result;
  }

  async extractEntities(content: string): Promise<Array<{
    name: string;
    type: 'person' | 'organization' | 'location' | 'concept' | 'technology' | 'event' | 'other';
    confidence: number;
  }>> {
    const prompt = this.buildEntityExtractionPrompt(content);

    this.logger.debug('extractEntities called', { contentLength: content.length });
    const response = await this.callWithAgentContext(prompt, AgentType.MEMORY_STORE);
    const result = this.parseEntityExtractionResponse(response);

    this.logger.info('extractEntities completed', {
      contentLength: content.length,
      entityCount: result.length,
    });
    return result;
  }

  async extractPersonaFeatures(conversationText: string, existingPersona?: any): Promise<{
    name?: string;
    age?: string;
    gender?: string;
    occupation?: string;
    location?: string;
    personalityTraits: Array<{
      trait: string;
      description?: string;
      confidence?: number;
      evidence?: string[];
      category?: string;
    }>;
    interests: Array<{
      name: string;
      category?: string;
      level?: string;
      confidence?: number;
      firstObserved?: number;
      lastObserved?: number;
      frequency?: number;
    }>;
    communicationStyle?: {
      formality?: string;
      directness?: string;
      detailPreference?: string;
      tone?: string[];
    };
    values: string[];
    goals: string[];
    background?: string;
    confidence: number;
    sources: string[];
  }> {
    const prompt = this.buildPersonaExtractionPrompt(conversationText, existingPersona);

    this.logger.debug('extractPersonaFeatures called', { textLength: conversationText.length });
    const response = await this.callWithAgentContext(prompt, AgentType.PERSONA);
    const result = this.parsePersonaExtractionResponse(response);

    this.logger.info('extractPersonaFeatures completed', {
      textLength: conversationText.length,
      traitsCount: result.personalityTraits.length,
      interestsCount: result.interests.length,
    });
    return result;
  }

  // ============================================================
  // Parsing methods (Custom-specific)
  // ============================================================

  private parseScoringResponse(response: string): LLMScoringResult {
    const parsed = this.safeParseJson<{
      importance: number;
      scope: number;
      confidence?: number;
      reasoning?: string;
    }>(response, 'scoring');

    if (typeof parsed.importance !== 'number' || typeof parsed.scope !== 'number') {
      throw new Error(`Invalid scoring response: missing numeric importance/scope`);
    }
    return {
      importance: Math.max(0, Math.min(10, parsed.importance)),
      scopeScore: Math.max(0, Math.min(10, parsed.scope)),
      confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
      reasoning: parsed.reasoning ?? '',
    };
  }

  private parseEntityExtractionResponse(response: string): Array<{
    name: string;
    type: 'person' | 'organization' | 'location' | 'concept' | 'technology' | 'event' | 'other';
    confidence: number;
  }> {
    try {
      const parsed = this.safeParseJson<{ entities?: Array<{ name: string; type: string; confidence?: number }> }>(
        response, 'entity-extraction',
      );
      if (!parsed.entities || !Array.isArray(parsed.entities)) {
        return [];
      }

      const validTypes = ['person', 'organization', 'location', 'concept', 'technology', 'event', 'other'];
      return parsed.entities
        .filter((e) => e.name && e.type)
        .map((e) => ({
          name: String(e.name).substring(0, 100),
          type: validTypes.includes(e.type) ? e.type as any : 'other',
          confidence: Math.max(0, Math.min(1, e.confidence ?? 0.5)),
        }));
    } catch (error) {
      this.logger.error('Failed to parse entity extraction response', error instanceof Error ? error : new Error(String(error)));
      return [];
    }
  }

  private parseFocusResponse(response: string): LLMFocusAnalysisResult {
    const parsed = this.safeParseJson<{ focusLevel: number; reasoning?: string }>(response, 'focus');

    if (typeof parsed.focusLevel !== 'number') {
      throw new Error(`Invalid focus response: focusLevel is not a number`);
    }
    return {
      focusLevel: Math.max(0, Math.min(1, parsed.focusLevel)),
      reasoning: parsed.reasoning ?? '',
    };
  }

  private parsePersonaExtractionResponse(response: string): any {
    const parsed = this.safeParseJson<any>(response, 'persona-extraction');
    const now = Date.now();

    return {
      name: parsed.name,
      age: parsed.age,
      gender: parsed.gender,
      occupation: parsed.occupation,
      location: parsed.location,
      personalityTraits: Array.isArray(parsed.personalityTraits)
        ? parsed.personalityTraits.map((t: any) => ({
            trait: t.trait ?? 'unknown',
            description: t.description ?? '',
            confidence: typeof t.confidence === 'number' ? t.confidence : 0.5,
            evidence: Array.isArray(t.evidence) ? t.evidence : [],
            category: this.validatePersonalityCategory(t.category),
          }))
        : [],
      interests: Array.isArray(parsed.interests)
        ? parsed.interests.map((i: any) => ({
            name: i.name ?? 'unknown',
            category: i.category ?? 'general',
            level: this.validateInterestLevel(i.level),
            confidence: typeof i.confidence === 'number' ? i.confidence : 0.5,
            firstObserved: typeof i.firstObserved === 'number' ? i.firstObserved : now,
            lastObserved: typeof i.lastObserved === 'number' ? i.lastObserved : now,
            frequency: typeof i.frequency === 'number' ? i.frequency : 1,
          }))
        : [],
      communicationStyle: parsed.communicationStyle ? {
        formality: this.validateFormalityLevel(parsed.communicationStyle.formality),
        directness: this.validateDirectnessLevel(parsed.communicationStyle.directness),
        detailPreference: this.validateDetailLevel(parsed.communicationStyle.detailPreference),
        tone: Array.isArray(parsed.communicationStyle.tone) ? parsed.communicationStyle.tone : [],
      } : undefined,
      values: Array.isArray(parsed.values) ? parsed.values : [],
      goals: Array.isArray(parsed.goals) ? parsed.goals : [],
      background: parsed.background,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      sources: Array.isArray(parsed.sources) ? parsed.sources : ['conversation'],
    };
  }

  private parseExtractionResponse(response: string): ExtractedMemory[] {
    this.logger.info('LLM extraction response', { response: response.substring(0, 1500) });

    const parsed = this.safeParseJson<Array<{
      content: string;
      type: string;
      confidence: number;
      keywords: string[];
      tags: string[];
      segmentStart?: number;
      segmentEnd?: number;
      sourceSegment?: string;
      topicId?: string;
    }>>(response, 'extraction', true);

    return parsed.map(item => ({
      content: item.content,
      type: this.parseMemoryType(item.type),
      confidence: Math.max(0, Math.min(1, item.confidence ?? 0.5)),
      keywords: item.keywords ?? [],
      tags: item.tags ?? [],
      segmentStart: item.segmentStart,
      segmentEnd: item.segmentEnd,
      sourceSegment: item.sourceSegment,
      topicId: item.topicId,
    }));
  }

  private parseMemoryType(typeStr: string): MemoryType {
    const normalized = typeStr.toLowerCase().trim();
    const typeMap: Record<string, MemoryType> = {
      'fact': MemoryType.FACT,
      'event': MemoryType.EVENT,
      'decision': MemoryType.DECISION,
      'error': MemoryType.ERROR,
      'learning': MemoryType.LEARNING,
      'relation': MemoryType.RELATION,
      // v2.0.0 Profile types
      'identity': MemoryType.IDENTITY,
      'preference': MemoryType.PREFERENCE,
      'persona': MemoryType.PERSONA,
    };
    return typeMap[normalized] ?? MemoryType.FACT;
  }

  private validatePersonalityCategory(category: string): string {
    const validCategories = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];
    return validCategories.includes(category) ? category : 'openness';
  }

  private validateInterestLevel(level: string): string {
    const validLevels = ['casual', 'interested', 'passionate', 'expert'];
    return validLevels.includes(level) ? level : 'interested';
  }

  private validateFormalityLevel(level: string): string {
    const validLevels = ['very-informal', 'informal', 'neutral', 'formal', 'very-formal'];
    return validLevels.includes(level) ? level : 'neutral';
  }

  private validateDirectnessLevel(level: string): string {
    const validLevels = ['very-indirect', 'indirect', 'neutral', 'direct', 'very-direct'];
    return validLevels.includes(level) ? level : 'neutral';
  }

  private validateDetailLevel(level: string): string {
    const validLevels = ['minimal', 'summary', 'moderate', 'detailed', 'comprehensive'];
    return validLevels.includes(level) ? level : 'moderate';
  }

  protected async callLLM(prompt: string, system?: string, signal?: AbortSignal): Promise<string> {
    if (!this.config.llmEndpoint) {
      throw new ExtractorError('API endpoint is required', 'MISSING_ENDPOINT');
    }

    const messages: Array<{ role: string; content: string }> = [];
    if (system) {
      messages.push({ role: 'system', content: system });
    }
    messages.push({ role: 'user', content: prompt });

const body: Record<string, unknown> = {
      model: this.config.llmModel || 'default',
      messages,
    };
    // Use temperature from config, default to 0.7
    const temperature = (this.config as any).temperature ?? 0.7;
    if (temperature !== undefined) {
      body['temperature'] = temperature;
    }

    // Append /chat/completions to base URL for OpenAI-compatible APIs
    const endpoint = this.config.llmEndpoint.endsWith('/chat/completions')
      ? this.config.llmEndpoint
      : `${this.config.llmEndpoint}/chat/completions`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.llmApiKey ? { 'Authorization': `Bearer ${this.config.llmApiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ExtractorError(
        `API request failed: ${errorText}`,
        'API_ERROR',
        response.status
      );
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      content?: string[];
    };

    // Support both OpenAI and custom formats
    if (data.choices) {
      return data.choices[0]?.message?.content ?? '';
    } else if (data.content) {
      return Array.isArray(data.content) ? data.content[0] : data.content;
    }
    return '';
  }
}

/**
 * 创建 LLM Extractor 实例
 */
export function createLLMExtractor(config: MemoryCaptureConfig): ILLMExtractor {
  switch (config.llmProvider) {
    case 'anthropic':
      return new AnthropicExtractor(config);
    case 'openai':
      return new OpenAIExtractor(config);
    case 'custom':
      return new CustomExtractor(config);
    default:
      throw new Error(`Unsupported LLM provider: ${config.llmProvider}`);
  }
}
