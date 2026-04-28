/**
 * Memory Recall Types - 记忆召回类型
 *
 * @module types/memory
 */

import type { HallId, MemoryType, Memory, GraphNode, GraphEdge } from './core';

export interface RecallOptions {
  query?: string;
  wingId?: string;
  roomId?: string;
  hallId?: HallId;
  types?: MemoryType[];
  tags?: string[];
  limit?: number;
  minImportance?: number;
  minSimilarity?: number;
  timeRange?: {
    from: number;
    to: number;
  };
  agentId?: string;
  sessionId?: string;
  useVectorSearch?: boolean;
  includeVersionChain?: boolean;
  minScopeScore?: number;
}

export interface RecallResult {
  memories: Memory[];
  profile: string;
  boosted?: number;
  relations?: {
    nodes: GraphNode[];
    paths: GraphEdge[];
  };
}