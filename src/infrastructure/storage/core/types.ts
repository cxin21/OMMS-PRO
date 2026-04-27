/**
 * Storage Types - 存储层类型定义
 *
 * @module storage/types
 *
 * 版本: v2.1.0
 * - UID 作为唯一标识，终身不变
 * - 版本链管理
 * - Palace 层级化存储
 */

import type { MemoryScope, MemoryType, MemoryBlock, Memory } from '../../../core/types/memory';

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
  palaceRef: string;             // palace_{uid}_v{version}
  createdAt: number;              // 版本创建时间
  summary: string;               // 该版本摘要
  contentLength: number;         // 该版本内容长度
}

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
  isLatestVersion: boolean;     // 是否最新版本
  versionGroupId: string;       // 版本组 ID
  summary?: string;              // 摘要（从 VectorDocument.text 复制）
  embeddingFailed?: boolean;     // 标记嵌入是否失败（失败时使用零向量）
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
  isLatestVersion: boolean;     // 是否最新版本
  versionGroupId: string;       // 版本组 ID（首次创建的 UID）

  // 其他
  tags: string[];
  createdAt: number;
  updatedAt: number;
  lastRecalledAt?: number;     // 最后召回时间戳（用于记忆降级和遗忘）
  recallCount: number;         // 召回次数（用于作用域升级评估）
  usedByAgents?: string[];     // 访问过该记忆的 Agent 列表（持久化）
  summary?: string;            // 摘要（用于召回显示，可被压缩更新）

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
  block?: MemoryBlock;
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

/**
 * Palace 存储记录
 */
export interface PalaceRecord {
  palaceRef: string;           // palace_{uid}_v{version}
  content: string;              // 完整原始内容
  metadata: PalaceMetadata;
}

/**
 * Palace 元数据
 */
export interface PalaceMetadata {
  uid: string;                  // 唯一标识
  version: number;              // 版本号
  createdAt: number;
  updatedAt: number;
  originalSize: number;
  compressed: boolean;
  encrypted: boolean;
}

/**
 * 图谱节点类型
 * v2.2.0: 扩展支持更多实体类型，用于知识图谱优化
 */
export type GraphNodeType = 'agent' | 'concept' | 'event' | 'entity' | 'person' | 'organization' | 'location' | 'technology' | 'other';

/**
 * 图谱节点
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
 * 图谱边
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
 * 图谱查询结果
 */
export interface RelatedMemoryResult {
  uid: string;                 // 关联的记忆 UID
  relation: string;
  weight: number;
}

// ============================================================
// 存储层接口定义
// ============================================================

/**
 * Cache Manager 接口
 */
export interface ICacheManager {
  // 基础 CRUD
  get(uid: string): Promise<Memory | null>;
  set(memory: Memory): Promise<void>;
  delete(uid: string): Promise<void>;
  clear(): Promise<void>;
  has(uid: string): boolean;

  // 批量操作
  getMany(uids: string[]): Promise<Map<string, Memory>>;
  setMany(memories: Memory[]): Promise<void>;
  deleteMany(uids: string[]): Promise<void>;

  // 高级
  removeByFilter(filter: (memory: Memory) => boolean): Promise<number>;
  getTopByImportance(limit: number): Promise<Memory[]>;

  // 统计
  getStats(): CacheStats;
}

/**
 * Vector Store 接口
 */
export interface IVectorStore {
  // 初始化
  initialize(): Promise<void>;
  close(): Promise<void>;

  // 基础 CRUD
  store(doc: VectorDocument): Promise<void>;
  storeBatch(docs: VectorDocument[]): Promise<void>;
  search(options: VectorSearchOptions): Promise<VectorSearchResult[]>;
  delete(uid: string): Promise<void>;

  // 元数据
  updateMetadata(uid: string, metadata: Partial<VectorMetadata>): Promise<void>;

  // 查询
  getById(uid: string): Promise<VectorDocument | null>;
  getByIds(uids: string[]): Promise<VectorDocument[]>;

  // 统计
  getStats(): Promise<{ count: number }>;

  // 向量维度（可选，部分实现可能不支持）
  dimensions?: number;
}

/**
 * SQLite Meta Store 接口
 */
export interface ISQLiteMetaStore {
  // 初始化
  initialize(): Promise<void>;
  close(): Promise<void>;

  // 基础 CRUD
  insert(record: MemoryMetaRecord): Promise<void>;
  update(uid: string, updates: Partial<MemoryMetaRecord>): Promise<void>;
  delete(uid: string): Promise<void>;

  // 查询
  query(options: SQLiteQueryOptions): Promise<MemoryMetaRecord[]>;
  getById(uid: string): Promise<MemoryMetaRecord | null>;
  getByIds(uids: string[]): Promise<MemoryMetaRecord[]>;
  count(options?: Partial<SQLiteQueryOptions>): Promise<number>;

  // 版本管理
  getVersionHistory(uid: string): Promise<VersionInfo[]>;
  getVersionsByGroupId(versionGroupId: string): Promise<VersionInfo[]>;
  addVersion(uid: string, versionInfo: VersionInfo): Promise<void>;
  pruneVersions(uid: string, maxVersions: number): Promise<void>;

  // 批量操作
  insertBatch(records: MemoryMetaRecord[]): Promise<void>;
  deleteBatch(uids: string[]): Promise<void>;

  // 统计
  getStats(): Promise<{
    total: number;
    byScope: Record<string, number>;
    byType: Record<string, number>;
    avgScopeScore: number;
  }>;
}

/**
 * Palace Store 接口
 */
export interface IPalaceStore {
  // 初始化
  initialize(): Promise<void>;

  // 基础 CRUD
  store(palaceRef: string, content: string, metadata: PalaceMetadata): Promise<string>;
  retrieve(palaceRef: string): Promise<string | null>;
  delete(palaceRef: string): Promise<void>;
  exists(palaceRef: string): Promise<boolean>;

  // 批量操作
  storeBatch(records: PalaceRecord[]): Promise<void>;
  retrieveMany(palaceRefs: string[]): Promise<Map<string, string>>;
  deleteMany(palaceRefs: string[]): Promise<void>;

  // 查询
  getAllPalaceRefs(): Promise<string[]>;
  getStats(): Promise<{ count: number; totalSize: number }>;

  // 移动/迁移
  move(fromPalaceRef: string, toPalaceRef: string): Promise<void>;
  copy(fromPalaceRef: string, toPalaceRef: string): Promise<void>;
  deleteSourceOnly(palaceRef: string): Promise<void>;

  // 高级
  exportAll(): Promise<PalaceRecord[]>;
}

/**
 * Graph Store 接口
 */
export interface IGraphStore {
  // 初始化
  initialize(): Promise<void>;
  close(): Promise<void>;

  // 记忆关联
  addMemory(uid: string, entities: GraphNodeRecord[], edges: GraphEdgeRecord[]): Promise<void>;
  removeMemory(uid: string): Promise<void>;

  // 查询
  findRelated(uid: string, limit?: number): Promise<RelatedMemoryResult[]>;
  findRelatedBatch(uids: string[], limit?: number): Promise<Map<string, RelatedMemoryResult[]>>;
  queryByEntity(entity: string): Promise<string[]>;
  queryByRelation(relation: string, limit?: number): Promise<GraphEdgeRecord[]>;
  findMemoriesByTags(tags: string[]): Promise<string[]>;

  // 实体
  getEntity(entity: string): Promise<GraphNodeRecord | null>;
  getEntityById(nodeId: string): Promise<GraphNodeRecord | null>;
  getEntitiesByIds(nodeIds: string[]): Promise<Map<string, GraphNodeRecord | null>>;
  getNodeEdges(nodeId: string): Promise<GraphEdgeRecord[]>;

  // 关系
  addRelation(sourceId: string, targetId: string, relation: string, weight?: number): Promise<void>;
  removeRelation(sourceId: string, targetId: string, relation: string): Promise<void>;

  // 批量
  addMemoryBatch(memories: Array<{ uid: string; entities: GraphNodeRecord[]; edges: GraphEdgeRecord[] }>): Promise<void>;

  // 统计
  getStats(): Promise<{ nodeCount: number; edgeCount: number; entityCount: number }>;
}

/**
 * Episode Store 接口
 */
export interface IEpisodeStore {
  // 初始化
  initialize(): Promise<void>;
  close(): Promise<void>;

  // 基础 CRUD
  create(record: EpisodeRecord): Promise<EpisodeRecord>;
  get(uid: string): Promise<EpisodeRecord | null>;
  update(uid: string, updates: Partial<EpisodeRecord>): Promise<EpisodeRecord | null>;
  delete(uid: string): Promise<void>;

  // 记忆关联
  addMemory(episodeUid: string, memoryUid: string, position?: number, temporalIndex?: number): Promise<void>;
  removeMemory(episodeUid: string, memoryUid: string): Promise<void>;
  getMemories(episodeUid: string): Promise<string[]>;
  getMemoriesBatch(episodeUids: string[]): Promise<Map<string, string[]>>;

  // 检索
  getByTimeRange(startTime: number, endTime: number, agentId?: string): Promise<EpisodeRecord[]>;
  getRecent(limit: number, agentId?: string): Promise<EpisodeRecord[]>;
  getByLocation(location: string, agentId?: string): Promise<EpisodeRecord[]>;
  getTimeline(agentId: string): Promise<{ uid: string; name: string; start: number; end: number; emotion: string }[]>;

  // 统计
  incrementAccess(uid: string): Promise<void>;
  getStats(): Promise<{ count: number; avgMemoriesPerEpisode: number }>;
}

/**
 * Episode 记录类型
 */
export interface EpisodeRecord {
  uid: string;
  name: string;
  description?: string;
  startTime: number;
  endTime: number;
  location?: string;
  primaryMemoryUid?: string;
  emotions: string[];
  context?: string;
  keywords: string[];
  agentId: string;
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
  accessCount?: number;
}

// ============================================================
// Storage Backend Types (new abstraction layer)
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