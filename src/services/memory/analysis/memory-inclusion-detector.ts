/**
 * Memory Inclusion Detector - 语义包含检测服务
 * @module memory-service/memory-inclusion-detector
 *
 * 版本: v1.0.0
 * - 基于 LLM 的语义包含判断
 * - 判断新记忆B是否包含/被包含已有记忆A
 * - 用于记忆版本化和合并策略
 */

import type { InclusionResult, InclusionCheckRequest } from '../../../types/memory';
import { createServiceLogger } from '../../../shared/logging';
import type { ILogger } from '../../../shared/logging';
import { config } from '../../../shared/config';
import type { MemoryCaptureConfig } from '../../../types/memory';
import { PromptLoader } from '../../../shared/prompts';
import { MemoryDefaults } from '../../../config';

/**
 * Inclusion Detector 配置
 */
export interface InclusionDetectorConfig {
  /** LLM API 配置 */
  llmApiKey?: string;
  llmEndpoint?: string;
  llmModel?: string;
  llmProvider?: 'openai' | 'anthropic' | 'custom';
  /** 包含度阈值：低于此值认为不相关 */
  inclusionThreshold?: number;
  /** 包含度阈值：高于此值认为相同 */
  identicalThreshold?: number;
}


/**
 * LLM 返回的包含检测原始结果
 */
interface LLMInclusionResponse {
  type: 'b_extends_a' | 'a_extends_b' | 'identical' | 'overlapping' | 'unrelated';
  inclusionScore: number;
  reasoning: string;
}

/**
 * Memory Inclusion Detector
 * 用于检测两条记忆之间的语义包含关系
 */
export class MemoryInclusionDetector {
  private logger: ILogger;
  private config: Required<InclusionDetectorConfig>;
  private promptLoader = PromptLoader.getInstance();

  constructor(userConfig?: InclusionDetectorConfig) {
    if (userConfig && Object.keys(userConfig).length > 0) {
      this.config = userConfig as Required<InclusionDetectorConfig>;
    } else {
      this.config = this.loadConfigFromManager();
    }
    this.logger = createServiceLogger('MemoryInclusionDetector');
  }

  /**
   * 从 ConfigManager 加载配置
   */
  private loadConfigFromManager(): Required<InclusionDetectorConfig> {
    const llmConfig = config.getConfigOrThrow<Record<string, unknown>>('llmExtraction');
    const inclusionConfig = config.getConfig<Record<string, unknown>>('memoryService.inclusion');
    return {
      llmApiKey: llmConfig['apiKey'] as string | undefined,
      llmEndpoint: llmConfig['baseURL'] as string | undefined,
      llmModel: llmConfig['model'] as string | undefined,
      llmProvider: (llmConfig['provider'] as InclusionDetectorConfig['llmProvider']) ?? 'custom',
      inclusionThreshold: (inclusionConfig?.['inclusionThreshold'] as number | undefined) ?? MemoryDefaults.inclusionThreshold,
      identicalThreshold: (inclusionConfig?.['identicalThreshold'] as number | undefined) ?? MemoryDefaults.identicalThreshold,
    } as Required<InclusionDetectorConfig>;
  }

  /**
   * 检测新记忆B与已有记忆A之间的包含关系
   */
  async detectInclusion(
    newMemory: { content: string; summary?: string },
    existingMemory: { content: string; summary?: string }
  ): Promise<InclusionResult> {
    const newSummary = newMemory.summary || this.truncateContent(newMemory.content);
    const existingSummary = existingMemory.summary || this.truncateContent(existingMemory.content);

    this.logger.debug('detectInclusion called', {
      newContentLength: newMemory.content.length,
      existingContentLength: existingMemory.content.length,
    });

    try {
      // 构建包含检测 prompt
      const prompt = this.buildInclusionPrompt(newSummary, existingSummary);

      // 调用 LLM
      const response = await this.callLLM(prompt);

      // 解析响应
      const result = this.parseInclusionResponse(response);

      this.logger.info('detectInclusion completed', {
        type: result.type,
        inclusionScore: result.inclusionScore,
        reasoning: result.reasoning,
      });

      return result;
    } catch (error) {
      this.logger.error('detectInclusion failed', error instanceof Error ? error : new Error(String(error)));
      // 出错时默认返回 unrelated，让两条记忆独立存储
      return {
        type: 'unrelated',
        inclusionScore: 0,
        reasoning: `检测失败: ${String(error)}`,
        existingMemoryId: '',
      };
    }
  }

  /**
   * 构建包含检测 prompt
   */
  private buildInclusionPrompt(
    newMemorySummary: string,
    existingMemorySummary: string
  ): string {
    return this.promptLoader.render('prompts/inclusion-detection.md', {
      existingMemorySummary: existingMemorySummary,
      newMemorySummary: newMemorySummary,
    });
  }

  /**
   * 调用 LLM
   */
  private async callLLM(prompt: string): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [
      { role: 'user', content: prompt }
    ];

    const body: Record<string, unknown> = {
      model: this.config.llmModel,
      messages,
    };

    // 根据 provider 选择不同的 API
    if (this.config.llmProvider === 'openai') {
      return this.callOpenAI(body);
    } else if (this.config.llmProvider === 'anthropic') {
      return this.callAnthropic(body, prompt);
    } else {
      // custom (OpenAI-compatible)
      return this.callCustom(body);
    }
  }

  /**
   * 调用 OpenAI API
   */
  private async callOpenAI(body: Record<string, unknown>): Promise<string> {
    const url = 'https://api.openai.com/v1/chat/completions';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.llmApiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${errorText}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? '';
  }

  /**
   * 调用 Anthropic API
   */
  private async callAnthropic(body: Record<string, unknown>, prompt: string): Promise<string> {
    const url = `${this.config.llmEndpoint || 'https://api.anthropic.com/v1'}/messages`;
    const apiVersion = '2023-06-01';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.llmApiKey ?? '',
        'anthropic-version': apiVersion,
      },
      body: JSON.stringify({
        model: this.config.llmModel,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${errorText}`);
    }

    const data = await response.json() as { content: Array<{ text: string }> };
    return data.content[0]?.text ?? '';
  }

  /**
   * 调用自定义 API (OpenAI-compatible)
   */
  private async callCustom(body: Record<string, unknown>): Promise<string> {
    const endpoint = this.config.llmEndpoint?.endsWith('/chat/completions')
      ? this.config.llmEndpoint
      : `${this.config.llmEndpoint}/chat/completions`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.llmApiKey ? { 'Authorization': `Bearer ${this.config.llmApiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Custom API error: ${errorText}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      content?: string | string[];
    };

    if (data.choices) {
      return data.choices[0]?.message?.content ?? '';
    } else if (data.content) {
      return Array.isArray(data.content) ? data.content[0] : data.content;
    }
    return '';
  }

  /**
   * 解析 LLM 返回的包含检测结果
   */
  private parseInclusionResponse(response: string): InclusionResult {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`No JSON object found in inclusion response: ${response.substring(0, 100)}`);
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as LLMInclusionResponse;

      // 规范化 type 字段
      let normalizedType: InclusionResult['type'];
      switch (parsed.type) {
        case 'b_extends_a':
          normalizedType = 'b_extends_a';
          break;
        case 'a_extends_b':
          normalizedType = 'a_extends_b';
          break;
        case 'identical':
          normalizedType = 'identical';
          break;
        case 'overlapping':
          normalizedType = 'overlapping';
          break;
        case 'unrelated':
        default:
          normalizedType = 'unrelated';
          break;
      }

      return {
        type: normalizedType,
        inclusionScore: Math.max(0, Math.min(1, parsed.inclusionScore ?? this.config.inclusionThreshold)),
        reasoning: (parsed.reasoning ?? '').substring(0, 100),
        existingMemoryId: '', // 由调用方填充
      };
    } catch (error) {
      throw new Error(`Failed to parse inclusion response: ${error}. Response: ${response.substring(0, 200)}`);
    }
  }

  /**
   * 截断内容用于提示词（避免超出 token 限制）
   */
  private truncateContent(content: string, maxLength: number = 500): string {
    if (content.length <= maxLength) {
      return content;
    }
    return content.substring(0, maxLength) + '...';
  }

  /**
   * 更新配置
   */
  updateConfig(cfg: Partial<InclusionDetectorConfig>): void {
    this.config = { ...this.config, ...cfg };
    this.logger.info('InclusionDetector config updated', this.config);
  }
}
