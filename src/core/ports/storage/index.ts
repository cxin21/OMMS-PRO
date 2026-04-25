/**
 * Storage Ports - 存储层抽象接口定义
 *
 * 定义存储层的抽象端口，实现解耦
 *
 * @module ports/storage
 */

import type { Memory } from '../../types/memory';
import type { CacheStats } from './types';
import type {
  VectorDocument,
  VectorSearchOptions,
  VectorSearchResult,
  MemoryMetaRecord,
  SQLiteQueryOptions,
  PalaceMetadata,
  PalaceRecord,
  GraphNodeRecord,
  GraphEdgeRecord,
  RelatedMemoryResult,
  VersionInfo,
} from './types';

// ============================================================
// Cache Manager Port
// ============================================================

/**
 * Cache Manager 接口
 *
 * 内存缓存管理器，负责短期记忆的快速访问
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

// ============================================================
// Vector Store Port
// ============================================================

/**
 * Vector Store 接口
 *
 * 向量存储，负责记忆的语义搜索
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
 * 向量元数据（用于更新操作）
 */
export interface VectorMetadata {
  uid: string;
  type: string;  // MemoryType as string for flexibility
  scope: string;  // MemoryScope as string for flexibility
  importanceScore: number;
  scopeScore: number;
  agentId: string;
  tags: string[];
  createdAt: number;
  palaceRef: string;
  version: number;
  isLatestVersion: boolean;
  versionGroupId: string;
  summary?: string;
}

// ============================================================
// Meta Store Port
// ============================================================

/**
 * Meta Store 接口
 *
 * SQLite 元数据存储，负责记忆的元信息管理
 */
export interface IMetaStore {
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

// ============================================================
// Palace Store Port
// ============================================================

/**
 * Palace Store 接口
 *
 * 文件系统存储，负责记忆内容的持久化
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

  // 高级
  exportAll(): Promise<PalaceRecord[]>;
}

// ============================================================
// Graph Store Port
// ============================================================

/**
 * Graph Store 接口
 *
 * 知识图谱存储，负责实体和关系的持久化
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

// ============================================================
// Episode Store Port
// ============================================================

/**
 * Episode Store 接口
 *
 * 情景记忆存储，负责场景/情节相关记忆的管理
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
  getTimeline(agentId: string): Promise<EpisodeTimelineItem[]>;

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

/**
 * 时间线条目
 */
export interface EpisodeTimelineItem {
  uid: string;
  name: string;
  start: number;
  end: number;
  emotion: string;
}