/**
 * Memory Input Types - 记忆输入类型
 *
 * @module types/memory
 */

import type { MemoryType, MemoryScope, MemoryBlock, HallId, GraphNode, GraphEdge } from './core';

// ============================================================================
// MemoryInput
// ============================================================================

export interface MemoryInput {
  content: string;
  type: MemoryType;
  wingId?: string;
  roomId?: string;
  hallId?: HallId;
  metadata?: {
    subject?: string;
    sessionId?: string;
    agentId?: string;
    tags?: string[];
    topicId?: string;
    [key: string]: unknown;
  };
  raw?: boolean;
  summary?: string;
  confidence?: number;
  explicit?: boolean;
  relatedCount?: number;
  sessionLength?: number;
  turnCount?: number;
  forcedMemoryId?: string;
  existingMemoryId?: string;
  originalContent?: string;
}

// ============================================================================
// MemoryUpdate
// ============================================================================

export interface MemoryUpdate {
  id: string;
  content?: string;
  summary?: string;
  type?: MemoryType;
  importance?: number;
  scopeScore?: number;
  scope?: MemoryScope;
  block?: MemoryBlock;
  tags?: string[];
  metadata?: Partial<MemoryMetadata>;
}

type MemoryMetadata = import('./core').MemoryMetadata;

// ============================================================================
// MemoryFilters
// ============================================================================

export interface MemoryFilters {
  wingId?: string;
  roomId?: string;
  hallId?: HallId;
  types?: MemoryType[];
  scopes?: MemoryScope[];
  blocks?: MemoryBlock[];
  tags?: string[];
  agentId?: string;
  sessionId?: string;
  timeRange?: {
    from: number;
    to: number;
  };
  importanceRange?: {
    min: number;
    max: number;
  };
}