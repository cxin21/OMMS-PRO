/**
 * Dreaming Domain Ports - 梦境引擎抽象接口定义
 *
 * @module ports/dreaming
 */

import type { IGraphStore, IPalaceStore, IMetaStore, IVectorStore } from '../../../infrastructure/storage/core';

/**
 * Dreaming Service 接口
 */
export interface IDreamingService {
  /**
   * 开始一个梦境任务
   */
  dream(options: DreamOptions): Promise<DreamReport>;

  /**
   * 获取梦境报告
   */
  getReport(reportId: string): Promise<DreamReport | null>;

  /**
   * 启动调度器
   */
  startScheduler(): void;

  /**
   * 停止调度器
   */
  stopScheduler(): void;
}

/**
 * 梦境选项
 */
export interface DreamOptions {
  type: 'all' | 'consolidation' | 'graph' | 'storage';
  focusUids?: string[];
}

/**
 * 梦境报告
 */
export interface DreamReport {
  id: string;
  type: string;
  startedAt: number;
  completedAt?: number;
  duration?: number;
  memoriesProcessed: number;
  consolidations: number;
  graphUpdates: number;
  storageOptimizations: number;
  errors: string[];
}

/**
 * 整理组
 */
export interface ConsolidationGroup {
  memories: string[];
  theme: string;
  insight?: string;
}

/**
 * Memory Consolidation Result
 */
export interface MemoryConsolidationResult {
  success: boolean;
  newMemoryId?: string;
  archivedMemoryIds: string[];
  theme: string;
  insight?: string;
  errors: string[];
}

/**
 * Storage stores interface for dreaming engine
 */
export interface DreamingStores {
  graphStore: IGraphStore;
  palaceStore: IPalaceStore;
  metaStore: IMetaStore;
  vectorStore: IVectorStore;
}

// Re-export types
export type { IGraphStore, IPalaceStore, IMetaStore, IVectorStore } from '../../../infrastructure/storage/core';