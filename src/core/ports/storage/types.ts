/**
 * Storage Types - 存储层数据类型定义
 *
 * 存储层使用的数据类型，与端口定义分开
 *
 * @module ports/storage/types
 */

import type { MemoryScope, MemoryType } from '../../types/memory';

// ============================================================
// Palace Types
// ============================================================

/**
 * Palace 位置
 *
 * 定义记忆在 Palace 层级结构中的位置
 */
export interface PalaceLocation {
  wingId: string;    // "session_xxx", "agent_xxx", "global"
  hallId: string;    // "facts", "events", ...
  roomId: string;    // "room_xxx" 或 "room_default"
  closetId: string;  // "closet_xxx"
}

/**
 * 版本信息
 */
export interface VersionInfo {
  version: number;              // 版本号
  palaceRef: string;           // palace_{uid}_v{version}
  createdAt: number;           // 版本创建时间
  summary: string;              // 该版本摘要
  contentLength: number;       // 该版本内容长度
}

// ============================================================
// Cache Types
// ============================================================

/**
 * 缓存配置
 */
export interface CacheConfig {
  maxSize: number;              // 最大缓存条数
  ttl: number;                  // 缓存 TTL (ms)
  evictionPolicy: 'lru' | 'lfu';
}

/**
 * 缓存统计
 */
export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
}

// ============================================================
// Vector Types
// ============================================================

/**
 * 向量文档
 */
export interface VectorDocument {
  id: string;                   // UID
  vector: number[];
  text: string;                 // summary
  metadata: VectorMetadata;
}

/**
 * 向量元数据
 */
export interface VectorMetadata {
  uid: string;                  // 唯一标识
  type: MemoryType;
  scope: MemoryScope;
  importanceScore: number;
  scopeScore: number;
  agentId: string;
  sessionId?: string;          // 来源会话 ID
  tags: string[];
  createdAt: number;
  palaceRef: string;            // palace_{uid}_v{version}
  version: number;             // 当前版本号
  isLatestVersion: boolean;    // 是否最新版本
  versionGroupId: string;      // 版本组 ID
  summary?: string;             // 摘要（从 VectorDocument.text 复制）
}

/**
 * 向量搜索选项
 */
export interface VectorSearchOptions {
  query?: string;
  queryVector?: number[];
  limit?: number;
  minScore?: number;
  filters?: {
    agentId?: string;
    scope?: MemoryScope;
    scopes?: MemoryScope[];
    type?: MemoryType;
    types?: MemoryType[];
    tags?: string[];
    timeRange?: { start: number; end: number };
    uids?: string[];           // 指定 UID 列表
  };
}

/**
 * 向量搜索结果
 */
export interface VectorSearchResult {
  id: string;                   // UID
  score: number;
  metadata: VectorMetadata;
}

// ============================================================
// Meta Store Types
// ============================================================

/**
 * SQLite 元数据记录
 */
export interface MemoryMetaRecord {
  uid: string;                  // 唯一标识（主键）
  version: number;              // 当前版本号

  // 类型与来源
  agentId: string;
  sessionId?: string;           // 来源会话 ID
  type: MemoryType;
  topicId?: string;             // 话题标识符（格式：topic_N）

  // 评分
  importanceScore: number;
  scopeScore: number;
  scope: MemoryScope;

  // Palace 位置
  palace: PalaceLocation;

  // 版本
  versionChain: VersionInfo[];  // 版本链
  isLatestVersion: boolean;    // 是否最新版本
  versionGroupId: string;       // 版本组 ID（首次创建的 UID）

  // 其他
  tags: string[];
  createdAt: number;
  updatedAt: number;
  lastRecalledAt?: number;     // 最后召回时间戳（用于记忆降级和遗忘）
  recallCount: number;         // 召回次数（用于作用域升级评估）
  usedByAgents?: string[];     // 访问过该记忆的 Agent 列表（持久化）

  // 指向当前版本内容
  currentPalaceRef: string;    // wingId/hallId/roomId/closet_{uid}_v{version}
}

/**
 * SQLite 查询选项
 */
export interface SQLiteQueryOptions {
  uid?: string;                // 精确查询
  uids?: string[];             // 批量查询
  agentId?: string;
  agentIdNotEq?: string;       // agentId 不等于
  sessionId?: string;          // 精确匹配 sessionId
  scope?: MemoryScope;
  scopes?: MemoryScope[];
  type?: MemoryType;
  types?: MemoryType[];
  block?: import('../../types/memory').MemoryBlock;
  tags?: string[];
  minImportance?: number;
  maxImportance?: number;
  minScopeScore?: number;
  maxScopeScore?: number;
  timeRange?: { start: number; end: number };
  isLatestVersion?: boolean;    // 只查最新版本
  versionGroupId?: string;     // 版本组查询
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'updatedAt' | 'importanceScore' | 'scopeScore';
  orderDir?: 'asc' | 'desc';
}

// ============================================================
// Palace Types
// ============================================================

/**
 * Palace 存储记录
 */
export interface PalaceRecord {
  palaceRef: string;           // palace_{uid}_v{version}
  content: string;             // 完整原始内容
  metadata: PalaceMetadata;
}

/**
 * Palace 元数据
 */
export interface PalaceMetadata {
  uid: string;                 // 唯一标识
  version: number;             // 版本号
  createdAt: number;
  updatedAt: number;
  originalSize: number;
  compressed: boolean;
  encrypted: boolean;
}

// ============================================================
// Graph Types
// ============================================================

/**
 * 图谱节点类型
 */
export type GraphNodeType = 'agent' | 'concept' | 'event' | 'entity' | 'person' | 'organization' | 'location' | 'technology' | 'other';

/**
 * 图谱节点记录
 */
export interface GraphNodeRecord {
  id: string;                   // UID
  entity: string;
  type: GraphNodeType;
  uid: string;                  // 关联的记忆 UID
  memoryIds: string[];          // 关联的记忆 UID 列表
  properties: Record<string, unknown>;
}

/**
 * 图谱边记录
 */
export interface GraphEdgeRecord {
  id: string;
  sourceId: string;            // UID
  targetId: string;            // UID
  relation: string;
  weight: number;
  temporal?: {
    start: number;
    end: number;
  };
}

/**
 * 图谱查询结果 - 关联记忆
 */
export interface RelatedMemoryResult {
  uid: string;                  // 关联的记忆 UID
  relation: string;
  weight: number;
}

// ============================================================
// Storage Backend Types
// ============================================================

/**
 * Storage backend types
 */
export type BackendType = 'lancedb' | 'sqlite' | 'filesystem' | 'memory';

export interface StorageBackendConfig {
  type: BackendType;
  path?: string;
  options?: Record<string, unknown>;
}

export enum StorageTier {
  HOT = 'hot',
  WARM = 'warm',
  COLD = 'cold'
}

export interface StorageItem<T = unknown> {
  key: string;
  value: T;
  tier: StorageTier;
  createdAt: number;
  updatedAt: number;
  size: number;
}