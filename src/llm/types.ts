/**
 * LLM Types - LLM 模块类型定义
 */

import type { MemoryType } from '../types/memory';

// ============================================================
// 提供商和配置
// ============================================================

/** LLM 提供商类型 */
export type LLMProvider = 'anthropic' | 'openai' | 'custom';

/** LLM 配置 */
export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  endpoint?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

// ============================================================
// 提取结果
// ============================================================

/** LLM 提取的候选记忆 */
export interface ExtractedMemory {
  content: string;
  type: MemoryType;
  confidence: number;
  keywords: string[];
  tags: string[];
  segmentStart?: number;
  segmentEnd?: number;
  topicId?: string;
  sourceSegment?: string;
}

// ============================================================
// 评分和摘要
// ============================================================

/** LLM 评分结果 */
export interface ScoringResult {
  importance: number;    // 0-10
  scopeScore: number;    // 0-10
  confidence: number;   // 0-1
  reasoning: string;
}

/** LLM 摘要结果 */
export interface SummaryResult {
  summary: string;
}

// ============================================================
// 实体和焦点
// ============================================================

/** 实体类型 */
export type EntityType = 'person' | 'organization' | 'location' | 'concept' | 'technology' | 'event' | 'other';

/** 提取的实体 */
export interface ExtractedEntity {
  name: string;
  type: string;  // 可以是 EntityType 或其他字符串
  confidence: number;
}

/** 焦点分析结果 */
export interface FocusAnalysisResult {
  focusLevel: number;   // 0-1
  reasoning: string;
}

// ============================================================
// Prompt 文件映射
// ============================================================

/** Prompt 文件映射配置 */
export interface PromptFileMapping {
  systemPrompt: string;
  extractionPrompt: string;
  summaryPrompt: string;
  scoringPrompt: string;
  mergingPrompt: string;
  consolidationPrompt: string;
  entityPrompt: string;
  focusPrompt: string;
  personaPrompt: string;
  inclusionPrompt: string;
  compressionPrompt: string;
}

/** 默认 Prompt 文件映射 */
export const DEFAULT_PROMPT_FILES: PromptFileMapping = {
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
};

// ============================================================
// LLM 接口（业务层只依赖此接口）
// ============================================================

/**
 * LLM Extractor 接口
 * 业务层只依赖此接口，不依赖具体实现
 */
export interface ILLMExtractor {
  /** 设置 Agent 上下文提供器 */
  setAgentContextProvider(provider: any): void;

  /** 获取 Agent 上下文提供器 */
  getAgentContextProvider(): any | undefined;

  /** 从文本中提取记忆 */
  extractMemories(
    text: string,
    options: { maxCount: number; typeHints?: MemoryType[] },
    signal?: AbortSignal
  ): Promise<ExtractedMemory[]>;

  /** 生成摘要 */
  generateSummary(content: string): Promise<string>;

  /** 生成评分 */
  generateScores(content: string): Promise<ScoringResult>;

  /** 合并多个记忆 */
  mergeMemories(memories: string[]): Promise<string>;

  /** 整理多个记忆（同步，等待完成） */
  consolidateMemories(memories: string[], query?: string): Promise<{
    content: string;
    keywords: string[];
    insights: string[];
    summary: string;
  }>;

  /** 分析记忆焦点 */
  analyzeMemoryFocus(content: string, type: MemoryType): Promise<FocusAnalysisResult>;

  /** 提取命名实体 */
  extractEntities(content: string): Promise<ExtractedEntity[]>;

  /** 提取用户画像特征 */
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
}

// ============================================================
// 异常
// ============================================================

/** LLM 异常 */
export class LLMError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

// ============================================================
// 向后兼容类型别名
// ============================================================

/** @deprecated 使用 ScoringResult */
export type LLMScoringResult = ScoringResult;

/** @deprecated 使用 FocusAnalysisResult */
export type LLMFocusAnalysisResult = FocusAnalysisResult;
