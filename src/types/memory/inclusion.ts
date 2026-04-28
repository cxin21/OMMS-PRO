/**
 * Memory Inclusion Types - 语义包含检测类型
 *
 * @module types/memory
 */

export interface InclusionResult {
  type: 'b_extends_a' | 'a_extends_b' | 'identical' | 'overlapping' | 'unrelated';
  inclusionScore: number;
  reasoning: string;
  existingMemoryId: string;
}

export interface InclusionCheckRequest {
  newContent: string;
  newSummary?: string;
  existingContent: string;
  existingSummary?: string;
}