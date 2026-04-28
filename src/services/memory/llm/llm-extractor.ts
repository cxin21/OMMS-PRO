/**
 * LLM Extractor - 基于 LLM 的记忆提取器（兼容层）
 * @module memory-service/llm-extractor
 *
 * 此文件为兼容层，实际实现已迁移到 src/llm/
 * 新代码应直接使用 src/llm/ 模块
 */

// 直接重新导出新模块（保持向后兼容）
export {
  AnthropicExtractor,
  OpenAIExtractor,
  CustomExtractor,
  createLLMExtractor,
  getLLMConfig,
} from '../../../llm';

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
  LLMProvider,
  // 向后兼容别名
  ScoringResult as LLMScoringResult,
  FocusAnalysisResult as LLMFocusAnalysisResult,
  LLMError,
} from '../../../llm';
