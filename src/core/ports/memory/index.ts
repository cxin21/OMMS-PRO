/**
 * Memory Domain Ports - 记忆领域抽象接口定义
 *
 * 定义记忆领域的业务端口，实现领域与基础设施的解耦
 *
 * @module ports/memory
 */

import type { Memory, MemoryInput, RecallOptions, RecallResult, MemoryUpdate } from '../../../types/memory';
import type { SQLiteQueryOptions } from '../../../infrastructure/storage/core/types';

// ============================================================
// Memory Repository Port
// ============================================================

/**
 * Memory Repository 接口
 *
 * 定义记忆的持久化操作
 */
export interface IMemoryRepository {
  /**
   * 存储新记忆
   */
  store(
    input: MemoryInput,
    scores: { importance: number; scopeScore: number }
  ): Promise<Memory>;

  /**
   * 获取记忆
   */
  get(uid: string): Promise<Memory | null>;

  /**
   * 批量获取记忆
   */
  getMany(uids: string[]): Promise<Map<string, Memory>>;

  /**
   * 更新记忆
   */
  update(uid: string, updates: MemoryUpdate): Promise<Memory>;

  /**
   * 归档记忆
   */
  archive(uid: string): Promise<void>;

  /**
   * 恢复记忆
   */
  restore(uid: string): Promise<void>;

  /**
   * 永久删除记忆
   */
  delete(uid: string): Promise<void>;

  /**
   * 查询记忆
   */
  query(options: SQLiteQueryOptions): Promise<Memory[]>;

  /**
   * 统计记忆
   */
  count(options?: Partial<SQLiteQueryOptions>): Promise<number>;
}

// ============================================================
// Memory Recall Service Port
// ============================================================

/**
 * Memory Recall Service 接口
 *
 * 定义记忆召回相关的操作
 */
export interface IMemoryRecallService {
  /**
   * 召回记忆
   */
  recall(options: RecallOptions): Promise<RecallResult>;

  /**
   * 强化记忆
   */
  reinforce(uid: string): Promise<void>;

  /**
   * 升级记忆作用域
   */
  upgradeScope(uid: string): Promise<{ upgraded: boolean }>;
}

// ============================================================
// Memory Version Service Port
// ============================================================

/**
 * Memory Version Service 接口
 *
 * 定义记忆版本管理操作
 */
export interface IMemoryVersionService {
  /**
   * 创建新版本
   */
  createVersion(
    existingMemoryId: string,
    newContent: string,
    newSummary: string,
    newScores: { importance: number; scopeScore: number },
    newPalaceMetadata: { createdAt: number; updatedAt: number; originalSize: number; compressed: boolean; encrypted: boolean },
    similarity?: number
  ): Promise<VersionCreateResult>;

  /**
   * 获取版本历史
   */
  getVersionHistory(uid: string): Promise<VersionInfo[]>;

  /**
   * 获取特定版本
   */
  getVersion(uid: string, version: number): Promise<Memory | null>;

  /**
   * 归档旧版本
   */
  archiveVersion(uid: string, version: number): Promise<void>;
}

/**
 * 版本创建结果
 */
export interface VersionCreateResult {
  success: boolean;
  newMemoryId: string;     // 新版本的 UID（与旧版本相同）
  oldMemoryId: string;      // 旧版本的 UID（已被归档）
  version: number;         // 新版本号
  palaceRef: string;       // 新版本的 palace ref
  error?: string;
}

/**
 * 版本信息
 */
export interface VersionInfo {
  version: number;
  palaceRef: string;
  createdAt: number;
  summary: string;
  contentLength: number;
}

// ============================================================
// Memory Consolidation Service Port
// ============================================================

/**
 * Memory Consolidation Service 接口
 *
 * 定义记忆整理/合并操作
 */
export interface IMemoryConsolidationService {
  /**
   * 整理一组记忆
   */
  consolidate(
    memoryId: string,
    data: {
      content: string;
      summary: string;
      tags: string[];
      importance: number;
      scopeScore: number;
    },
    options?: {
      archiveSourceIds?: string[];
      insights?: string[];
      sourceIds?: string[];
    }
  ): Promise<ConsolidationResult>;
}

/**
 * 整理结果
 */
export interface ConsolidationResult {
  success: boolean;
  newVersionId?: string;
  oldMemoryId?: string;
  version?: number;
  archivedCount: number;
  errors: string[];
}

// ============================================================
// Backward Compatibility Aliases
// ============================================================

// Type alias for StorageMemoryService to allow future decoupling
// Currently points to concrete implementation; swap to interface when ready
import type { StorageMemoryService } from '../../../services/memory/core/storage-memory-service';
import type { MemoryCaptureService } from '../../../services/memory/capture/memory-capture-service';
import type { ProfileManager } from '../../../services/profile/profile-manager';
import type { IGraphStore } from '../../../infrastructure/storage/core';

// Re-export profile and dreaming ports
export type { ProfileManager } from '../../../services/profile/profile-manager';
export type { IGraphStore } from '../../../infrastructure/storage/core';