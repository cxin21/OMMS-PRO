/**
 * LLM Layer - LLM 模块统一导出
 *
 * 提供：
 * - ILLMExtractor: LLM 接口
 * - createLLMExtractor: LLM 工厂函数
 * - LLMProvider: 提供商类型
 */

export { BaseLLMExtractor } from './base';
export { AnthropicExtractor } from './anthropic';
export { OpenAIExtractor } from './openai';
export { CustomExtractor } from './custom';
export { createLLMExtractor, getLLMConfig } from './factory';

export type { LLMProvider, DEFAULT_PROMPT_FILES } from './factory';
export type {
  ILLMExtractor,
  ExtractedMemory,
  ScoringResult,
  SummaryResult,
  FocusAnalysisResult,
  ExtractedEntity,
  EntityType,
  LLMConfig,
  PromptFileMapping,
  LLMError,
} from './types';
