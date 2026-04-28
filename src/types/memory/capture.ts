/**
 * Memory Capture Types - 记忆捕获类型
 *
 * @module types/memory
 */

import type { MemoryType, Timestamp } from './core';

// ============================================================================
// CaptureInput & CaptureConfig
// ============================================================================

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface CaptureConfig {
  confidenceThreshold?: number;
  maxMemories?: number;
  enableLLMExtraction?: boolean;
  enableAutoScoring?: boolean;
  enableVersionDetection?: boolean;
  similarityThreshold?: number;
}

export interface CaptureInput {
  agentId: string;
  sessionId?: string;
  content: string | ConversationTurn[];
  timestamp?: Timestamp;
  metadata?: Record<string, any>;
  config?: CaptureConfig;
}

export interface MemoryCaptureConfig {
  maxMemoriesPerCapture: number;
  similarityThreshold: number;
  confidenceThreshold: number;
  enableLLMSummarization: boolean;
  llmProvider: 'openai' | 'anthropic' | 'custom';
  llmApiKey?: string;
  llmEndpoint?: string;
  llmModel?: string;
  inclusionSimilarityThreshold?: number;
  contextExtension?: number;
}

// ============================================================================
// Capture Result
// ============================================================================

export interface CapturedMemory {
  content: string;
  summary: string;
  type: MemoryType;
  confidence: number;
  importanceLevel?: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  scopeLevel?: 'A0' | 'A1' | 'A2';
  keywords: string[];
  tags: string[];
  metadata: {
    source: 'user' | 'agent';
    extractedAt: number;
    sessionId: string;
    isNewVersion: boolean;
    versionGroupId: string;
    previousMemoryId?: string;
    reasoning?: string;
  };
}

export interface CaptureResult {
  captured: CapturedMemory[];
  skipped: Array<{
    content: string;
    reason: 'low_confidence' | 'duplicate' | 'error';
    details?: string;
  }>;
}

// ============================================================================
// Extracted
// ============================================================================

export interface ExtractedMemory {
  content: string;
  type: MemoryType;
  confidence: number;
  keywords: string[];
  tags: string[];
  sourceSegment?: string;
  segmentStart?: number;
  segmentEnd?: number;
  topicId?: string;
}

export interface ExtractedFact {
  content: string;
  type: MemoryType;
  confidence: number;
  source: 'user' | 'agent' | 'both' | 'llm';
  subject?: string;
  importance?: number;
}