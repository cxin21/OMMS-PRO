/**
 * LLM Base - LLM 提取器基类
 * 提供通用功能和配置读取
 */

import { config, ConfigPaths, ConfigDefaults } from '../config';
import { PromptLoader } from '../shared/prompts/prompt-loader';
import { createServiceLogger } from '../shared/logging';
import type { ILogger } from '../shared/logging';
import { JsonParser } from '../shared/utils/json-parser';
import type { AgentRuntimeContext } from '../shared/agents';
import { AgentType } from '../shared/agents';
import type { IAgentContextProvider } from '../shared/agents';
import type {
  ILLMExtractor,
  ExtractedMemory,
  ScoringResult,
  PromptFileMapping,
} from './types';
import { MemoryType } from '../types/memory';

/**
 * LLM 提供商类型
 */
export type LLMProviderType = 'anthropic' | 'openai' | 'custom';

/**
 * LLM 提取器基类
 */
export abstract class BaseLLMExtractor implements ILLMExtractor {
  protected logger: ILogger;
  protected promptLoader = PromptLoader.getInstance();
  protected agentContextProvider?: IAgentContextProvider;
  protected promptFiles: PromptFileMapping;

  constructor(promptFiles: PromptFileMapping) {
    this.logger = createServiceLogger('LLMExtractor');
    this.promptFiles = this.loadPromptFiles(promptFiles);
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
   * 加载 Prompt 文件映射（支持从配置覆盖）
   */
  private loadPromptFiles(defaults: PromptFileMapping): PromptFileMapping {
    try {
      if (config.isInitialized()) {
        const override = config.getConfig<Partial<PromptFileMapping>>(ConfigPaths.memory.llmExtractor);
        if (override) {
          return { ...defaults, ...override };
        }
      }
    } catch {
      // 使用默认值
    }
    return defaults;
  }

  /**
   * 安全获取配置值（带默认值）
   * 替代散落的 ?? 0.5, ?? 200 等硬编码
   */
  protected getConfigValue<T>(path: string, defaultValue: T): T {
    try {
      if (config.isInitialized()) {
        const value = config.getConfig<T>(path);
        if (value !== undefined && value !== null) {
          return value;
        }
      }
    } catch {
      // 使用默认值
    }
    return defaultValue;
  }

  /**
   * 获取 Memory Service 配置值
   */
  protected getMemoryConfig<T>(key: string, defaultValue: T): T {
    return this.getConfigValue<T>(`memoryService.${key}`, defaultValue);
  }

  /**
   * 渲染 Prompt 模板
   */
  protected renderPrompt(filename: string, variables: Record<string, string>): string {
    return this.promptLoader.render(`prompts/${filename}`, variables);
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

  /**
   * 调用 LLM（子类实现）
   */
  protected abstract callLLM(prompt: string, system?: string, signal?: AbortSignal): Promise<string>;

  /**
   * 安全解析 JSON 响应
   */
  protected safeParseJson<T>(
    response: string,
    context: string,
    extractArray: boolean = false
  ): T {
    let cleaned = response.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');

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

    try {
      return JSON.parse(jsonStr) as T;
    } catch (firstError) {
      try {
        const fixed = JsonParser.autoFixJson(jsonStr);
        if (fixed !== jsonStr) {
          this.logger.warn(`JSON auto-fixed for ${context}`, {
            originalLength: jsonStr.length,
            fixedLength: fixed.length,
          });
        }
        return JSON.parse(fixed) as T;
      } catch (secondError) {
        this.logger.error(`JSON parse failed for ${context} after auto-fix`, {
          jsonPreview: jsonStr.substring(0, 500),
        });
        throw secondError;
      }
    }
  }

  /**
   * 解析记忆类型字符串
   */
  protected parseMemoryType(typeStr: string): MemoryType {
    const normalized = typeStr.toLowerCase().trim();
    const typeMap: Record<string, MemoryType> = {
      'fact': MemoryType.FACT,
      'event': MemoryType.EVENT,
      'decision': MemoryType.DECISION,
      'error': MemoryType.ERROR,
      'learning': MemoryType.LEARNING,
      'relation': MemoryType.RELATION,
      'identity': MemoryType.IDENTITY,
      'preference': MemoryType.PREFERENCE,
      'persona': MemoryType.PERSONA,
    };
    return typeMap[normalized] ?? MemoryType.FACT;
  }

  // ============================================================
  // 抽象方法（子类实现）
  // ============================================================

  abstract extractMemories(
    text: string,
    options: { maxCount: number; typeHints?: MemoryType[] },
    signal?: AbortSignal
  ): Promise<ExtractedMemory[]>;

  abstract generateSummary(content: string): Promise<string>;

  abstract generateScores(content: string): Promise<ScoringResult>;

  async mergeMemories(memories: string[]): Promise<string> {
    if (memories.length === 0) return '';
    if (memories.length === 1) return memories[0];

    const prompt = this.buildMergingPrompt(memories);
    this.logger.debug('mergeMemories called', { memoryCount: memories.length });
    const response = await this.callWithAgentContext(prompt, AgentType.MEMORY_MERGE);
    const merged = this.parseMergingResponse(response);

    this.logger.info('mergeMemories completed', {
      memoryCount: memories.length,
      mergedLength: merged.length,
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
        summary: memories[0].substring(0, 50) + (memories[0].length > 50 ? '...' : ''),
      };
    }

    const prompt = this.buildConsolidationPrompt(memories);
    this.logger.debug('consolidateMemories called', { memoryCount: memories.length });
    const response = await this.callWithAgentContext(prompt, AgentType.DREAMING);
    const result = this.parseConsolidationResponse(response);

    this.logger.info('consolidateMemories completed', {
      memoryCount: memories.length,
      contentLength: result.content.length,
    });
    return result;
  }

  async analyzeMemoryFocus(content: string, type: MemoryType): Promise<{ focusLevel: number; reasoning: string }> {
    const prompt = this.buildFocusPrompt(content, type);
    this.logger.debug('analyzeMemoryFocus called', { contentLength: content.length, type });
    const response = await this.callWithAgentContext(prompt, AgentType.MEMORY_CAPTURE);
    const result = this.parseFocusResponse(response);
    this.logger.info('analyzeMemoryFocus completed', { contentLength: content.length, focusLevel: result.focusLevel });
    return result;
  }

  async extractEntities(content: string): Promise<Array<{ name: string; type: string; confidence: number }>> {
    const prompt = this.buildEntityExtractionPrompt(content);
    this.logger.debug('extractEntities called', { contentLength: content.length });
    const response = await this.callWithAgentContext(prompt, AgentType.MEMORY_STORE);
    const result = this.parseEntityExtractionResponse(response);
    this.logger.info('extractEntities completed', { contentLength: content.length, entityCount: result.length });
    return result;
  }

  async extractPersonaFeatures(conversationText: string, existingPersona?: any): Promise<any> {
    const prompt = this.buildPersonaExtractionPrompt(conversationText, existingPersona);
    this.logger.debug('extractPersonaFeatures called', { textLength: conversationText.length });
    const response = await this.callWithAgentContext(prompt, AgentType.PERSONA);
    const result = this.parsePersonaExtractionResponse(response);
    this.logger.info('extractPersonaFeatures completed', {
      textLength: conversationText.length,
      traitsCount: result.personalityTraits?.length ?? 0,
    });
    return result;
  }

  // ============================================================
  // Protected 方法（子类可调用）
  // ============================================================

  protected buildExtractionSystem(typeHints?: MemoryType[]): string {
    const types = typeHints?.map(t => t.valueOf()).join(', ') ?? MemoryType.FACT;
    return this.renderPrompt(this.promptFiles.systemPrompt, { memoryTypes: types });
  }

  protected buildExtractionPrompt(text: string, maxCount: number): string {
    const lines = text.split('\n');
    return this.renderPrompt(this.promptFiles.extractionPrompt, {
      lineCount: String(lines.length),
      maxLineIndex: String(lines.length - 1),
      conversationText: text,
    });
  }

  protected buildScoringPrompt(content: string): string {
    return this.renderPrompt(this.promptFiles.scoringPrompt, { content });
  }

  protected buildSummaryPrompt(content: string): string {
    return this.renderPrompt(this.promptFiles.summaryPrompt, { content });
  }

  protected buildMergingPrompt(memories: string[]): string {
    const memoryList = memories.map((m, i) => `【记忆 ${i + 1}】\n${m}`).join('\n\n');
    return this.renderPrompt(this.promptFiles.mergingPrompt, { memoryList });
  }

  protected buildConsolidationPrompt(memories: string[]): string {
    const memoryList = memories.map((m, i) => `【记忆 ${i + 1}】\n${m}`).join('\n\n');
    return this.renderPrompt(this.promptFiles.consolidationPrompt, { memoryList });
  }

  protected buildEntityExtractionPrompt(content: string): string {
    return this.renderPrompt(this.promptFiles.entityPrompt, { content });
  }

  protected buildFocusPrompt(content: string, type: MemoryType): string {
    return this.renderPrompt(this.promptFiles.focusPrompt, {
      memoryType: type.valueOf(),
      content,
    });
  }

  protected buildPersonaExtractionPrompt(conversationText: string, existingPersona?: any): string {
    const existingBlock = existingPersona
      ? `\n\n现有 Persona 信息（版本 ${existingPersona.version || 1}）：\n- 性格特征：${existingPersona.personalityTraits?.length || 0} 个\n- 兴趣：${existingPersona.interests?.length || 0} 个\n- 价值观：${existingPersona.values?.length || 0} 个\n\n请在现有 Persona 基础上进行更新，标注出变化。`
      : '';
    return this.renderPrompt(this.promptFiles.personaPrompt, {
      conversationText,
      existingPersona: existingBlock,
    });
  }

  // ============================================================
  // Private 解析方法
  // ============================================================

  private parseMergingResponse(response: string): string {
    let cleaned = response.trim();
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
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    return cleaned.trim();
  }

  private parseConsolidationResponse(response: string): {
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
      const cleaned = response.trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '');
      return {
        content: cleaned,
        keywords: [],
        insights: [],
        summary: cleaned.substring(0, 100),
      };
    }
  }

  private parseEntityExtractionResponse(response: string): Array<{
    name: string;
    type: string;
    confidence: number;
  }> {
    try {
      const parsed = this.safeParseJson<{ entities?: Array<{ name: string; type: string; confidence?: number }> }>(
        response, 'entity-extraction'
      );
      if (!parsed.entities || !Array.isArray(parsed.entities)) {
        return [];
      }

      const validTypes = ['person', 'organization', 'location', 'concept', 'technology', 'event', 'other'];
      const defaultConfidence = this.getMemoryConfig('store.defaultConfidence', ConfigDefaults.defaultConfidence);
      return parsed.entities
        .filter((e) => e.name && e.type)
        .map((e) => ({
          name: String(e.name).substring(0, 100),
          type: validTypes.includes(e.type) ? e.type : 'other',
          confidence: Math.max(0, Math.min(1, e.confidence ?? defaultConfidence)),
        }));
    } catch (error) {
      this.logger.error('Failed to parse entity extraction response', error instanceof Error ? error : new Error(String(error)));
      return [];
    }
  }

  private parseFocusResponse(response: string): { focusLevel: number; reasoning: string } {
    const parsed = this.safeParseJson<{ focusLevel: number; reasoning?: string }>(response, 'focus');
    if (typeof parsed.focusLevel !== 'number') {
      throw new Error(`Invalid focus response: focusLevel is not a number`);
    }
    return {
      focusLevel: Math.max(0, Math.min(1, parsed.focusLevel)),
      reasoning: parsed.reasoning ?? '',
    };
  }

  private parsePersonaExtractionResponse(response: any): any {
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
}
