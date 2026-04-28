/**
 * Memory Service 模块 - 统一导出
 *
 * @module memory-service
 */

// Core service (main facade)
export { StorageMemoryService as MemoryService } from './core/storage-memory-service';
export { MemoryStoreManager as MemoryCore } from './store/memory-store-manager';

// Types
export type {
  MemoryServiceConfig,
  RecallOptions,
} from './types';

// Sub-services
export { MemoryRecallManager } from './recall/memory-recall-manager';
export { MemoryDegradationManager } from './degradation/memory-degradation-manager';
export { MemoryCaptureService } from './capture/memory-capture-service';
export { MemoryVersionManager } from './store/memory-version-manager';
export { ConsolidationManager } from './consolidation/consolidation-manager';
export type { ConsolidationConfig, ConsolidationResult } from './consolidation/consolidation-manager';

// LLM
export { createLLMExtractor } from './llm/llm-extractor';
export type { ILLMExtractor } from './llm/llm-extractor';
export type { ExtractedMemory as LLMExtractionResult } from '../../types/memory';

// Analysis
export { TopicDetector } from './analysis/topic-detector';
export { SentimentAnalyzer } from './analysis/sentiment-analyzer';
export { MemoryInclusionDetector } from './analysis/memory-inclusion-detector';