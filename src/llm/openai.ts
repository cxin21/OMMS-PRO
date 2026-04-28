/**
 * OpenAI LLM Extractor
 */

import { BaseLLMExtractor } from './base';
import { LLMError } from './types';
import type { ExtractedMemory, ScoringResult, PromptFileMapping } from './types';

/**
 * OpenAI LLM Extractor 实现
 */
export class OpenAIExtractor extends BaseLLMExtractor {
  private get baseURL(): string {
    return this.llmConfig.llmEndpoint || 'https://api.openai.com/v1';
  }

  private get model(): string {
    return this.llmConfig.llmModel || 'gpt-4';
  }

  private llmConfig: {
    llmApiKey?: string;
    llmEndpoint?: string;
    llmModel?: string;
    temperature?: number;
    maxTokens?: number;
  };

  constructor(
    llmConfig: {
      llmApiKey?: string;
      llmEndpoint?: string;
      llmModel?: string;
      temperature?: number;
      maxTokens?: number;
    },
    promptFiles?: PromptFileMapping
  ) {
    super(promptFiles || {
      systemPrompt: 'memory-extraction-system.md',
      extractionPrompt: 'memory-extraction.md',
      summaryPrompt: 'summary-generation.md',
      scoringPrompt: 'scoring.md',
      mergingPrompt: 'memory-merging.md',
      consolidationPrompt: 'memory-consolidation.md',
      entityPrompt: 'entity-extraction.md',
      focusPrompt: 'focus-analysis.md',
      personaPrompt: 'persona-extraction.md',
      inclusionPrompt: 'inclusion-detection.md',
      compressionPrompt: 'memory-compression.md',
    });
    this.llmConfig = llmConfig;
  }

  async extractMemories(
    text: string,
    options: { maxCount: number; typeHints?: any },
    signal?: AbortSignal
  ): Promise<ExtractedMemory[]> {
    const system = this.buildExtractionSystem(options.typeHints);
    const prompt = this.buildExtractionPrompt(text, options.maxCount);

    this.logger.debug('extractMemories called', { textLength: text.length, maxCount: options.maxCount });
    try {
      const response = await this.callWithAgentContext(prompt, 'MemoryCapture' as any, undefined, signal);
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
    const response = await this.callWithAgentContext(prompt, 'MemoryCapture' as any);
    const parsed = this.safeParseJson<{ summary?: string }>(response, 'summary');
    const summaryMaxLength = this.getMemoryConfig('store.summaryMaxLength', 200);

    const summary = (parsed.summary ?? '').substring(0, summaryMaxLength);
    if (!summary) {
      throw new Error('LLM returned empty summary');
    }
    this.logger.info('generateSummary completed', { contentLength: content.length, summaryLength: summary.length });
    return summary;
  }

  async generateScores(content: string): Promise<ScoringResult> {
    const prompt = this.buildScoringPrompt(content);

    this.logger.debug('generateScores called', { contentLength: content.length });
    const response = await this.callWithAgentContext(prompt, 'MemoryStore' as any);
    const result = this.parseScoringResponse(response);

    this.logger.info('generateScores completed', {
      contentLength: content.length,
      importance: result.importance,
      scopeScore: result.scopeScore,
    });
    return result;
  }

  protected async callLLM(prompt: string, system?: string, signal?: AbortSignal): Promise<string> {
    if (!this.llmConfig.llmApiKey) {
      throw new LLMError('API key is required', 'MISSING_API_KEY');
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

    const temperature = this.llmConfig.temperature ?? 0.7;
    if (temperature !== undefined) {
      body['temperature'] = temperature;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.llmConfig.llmApiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new LLMError(
        `API request failed: ${errorText}`,
        'API_ERROR',
        response.status
      );
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? '';
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

    const defaultConfidence = this.getMemoryConfig('store.defaultConfidence', 0.5);
    return parsed.map(item => ({
      content: item.content,
      type: this.parseMemoryType(item.type),
      confidence: Math.max(0, Math.min(1, item.confidence ?? defaultConfidence)),
      keywords: item.keywords ?? [],
      tags: item.tags ?? [],
      segmentStart: item.segmentStart,
      segmentEnd: item.segmentEnd,
      sourceSegment: item.sourceSegment,
      topicId: item.topicId,
    }));
  }

  private parseScoringResponse(response: string): ScoringResult {
    const parsed = this.safeParseJson<{
      importance: number;
      scope: number;
      confidence?: number;
      reasoning?: string;
    }>(response, 'scoring');

    if (typeof parsed.importance !== 'number' || typeof parsed.scope !== 'number') {
      throw new Error(`Invalid scoring response: missing numeric importance/scope`);
    }

    const defaultConfidence = this.getMemoryConfig('store.defaultConfidence', 0.5);
    return {
      importance: Math.max(0, Math.min(10, parsed.importance)),
      scopeScore: Math.max(0, Math.min(10, parsed.scope)),
      confidence: Math.max(0, Math.min(1, parsed.confidence ?? defaultConfidence)),
      reasoning: parsed.reasoning ?? '',
    };
  }
}
