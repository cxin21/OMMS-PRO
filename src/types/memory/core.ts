/**
 * Memory Core Types - 记忆核心类型
 *
 * @module types/memory
 */

// ============================================================================
// 基础类型
// ============================================================================

/** Hall ID 类型 */
export type HallId = string;

/** 时间戳类型 */
export type Timestamp = number;

// ============================================================================
// 枚举
// ============================================================================

/**
 * MemoryType - 记忆类型枚举
 */
export enum MemoryType {
  FACT = 'fact',
  EVENT = 'event',
  DECISION = 'decision',
  ERROR = 'error',
  LEARNING = 'learning',
  RELATION = 'relation',
  IDENTITY = 'identity',
  PREFERENCE = 'preference',
  PERSONA = 'persona',
}

/**
 * MemoryScope - 记忆作用域
 */
export enum MemoryScope {
  SESSION = 'session',
  AGENT = 'agent',
  GLOBAL = 'global',
}

/**
 * MemoryBlock - 记忆存储区块
 */
export enum MemoryBlock {
  WORKING = 'working',
  SESSION = 'session',
  CORE = 'core',
  ARCHIVED = 'archived',
  DELETED = 'deleted',
}

// ============================================================================
// 基础结构
// ============================================================================

export interface MemoryMetadata {
  title?: string;
  summary?: string;
  keywords?: string[];
  category?: string;
  isChunk?: boolean;
  parentId?: string;
  chunkIndex?: number;
  totalChunks?: number;
  enrichedAt?: Timestamp;
  versionGroupId?: string;
  previousMemoryId?: string;
  nextMemoryId?: string;
  isNewVersion?: boolean;
  source?: 'user' | 'agent' | 'extracted' | 'recalled';
  sessionId?: string;
  extractedAt?: number;
  [key: string]: unknown;
}

export interface MemoryLifecycleEvent {
  type: 'created' | 'accessed' | 'updated' | 'reinforced' | 'upgraded' | 'downgraded' | 'archived' | 'deleted';
  timestamp: number;
  details?: Record<string, unknown>;
}

export interface PalaceLocation {
  wingId: string;
  hallId: string;
  roomId: string;
  closetId: string;
}

export interface VersionInfo {
  version: number;
  palaceRef: string;
  createdAt: number;
  summary: string;
  contentLength: number;
}

// ============================================================================
// Memory 接口
// ============================================================================

export interface Memory {
  uid: string;
  version: number;
  content: string;
  summary: string;
  type: MemoryType;
  agentId: string;
  importance: number;
  scopeScore: number;
  scope: MemoryScope;
  block: MemoryBlock;
  palace: PalaceLocation;
  versionChain: VersionInfo[];
  isLatestVersion: boolean;
  accessCount: number;
  recallCount: number;
  lastAccessedAt: number;
  usedByAgents: string[];
  createdAt: number;
  updatedAt: number;
  metadata: MemoryMetadata;
  tags: string[];
  lifecycle: {
    createdAt: number;
    events: MemoryLifecycleEvent[];
  };
}

// ============================================================================
// Graph Types（统一版本）
// ============================================================================

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  properties?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  weight?: number;
}

// ============================================================================
// 常量
// ============================================================================

export const DEFAULT_MEMORY_TYPES: MemoryType[] = [
  MemoryType.FACT,
  MemoryType.EVENT,
  MemoryType.DECISION,
  MemoryType.ERROR,
  MemoryType.LEARNING,
  MemoryType.RELATION,
];

export const PROFILE_TYPES = [
  MemoryType.IDENTITY,
  MemoryType.PREFERENCE,
  MemoryType.PERSONA,
] as const;

export function isProfileType(type: MemoryType): boolean {
  return (PROFILE_TYPES as readonly MemoryType[]).includes(type);
}