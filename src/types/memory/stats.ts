/**
 * Memory Stats Types - 记忆统计类型
 *
 * @module types/memory
 */

import type { MemoryType, MemoryScope, MemoryBlock, HallId, Timestamp } from './core';

export interface ForgetReport {
  executedAt: Timestamp;
  archived: {
    count: number;
    memoryIds: string[];
  };
  deleted: {
    count: number;
    memoryIds: string[];
  };
  skipped: {
    count: number;
    reasons: Record<string, number>;
  };
  duration: number;
}

export interface MemoryStats {
  total: number;
  byType: Record<MemoryType, number>;
  byScope: Record<MemoryScope, number>;
  byBlock: Record<MemoryBlock, number>;
  byHall: Record<HallId, number>;
  avgImportance: number;
  avgScopeScore: number;
  avgRecallCount: number;
  oldestMemory?: Timestamp;
  newestMemory?: Timestamp;
}