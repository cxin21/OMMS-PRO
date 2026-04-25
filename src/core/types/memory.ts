/**
 * 记忆相关类型定义
 * 定义记忆的核心数据结构、输入输出、过滤器等
 *
 * @module types/memory
 */

/**
 * Hall ID 类型
 * 对应记忆宫殿中的 Hall 标识
 */
export type HallId = string;

/**
 * 时间戳类型
 */
export type Timestamp = number;

/**
 * MemoryType - 记忆类型枚举
 *
 * 定义六种基本记忆类型
 * 作为全系统统一的 source of truth
 */
export enum MemoryType {
  FACT = 'fact',           // 客观事实
  EVENT = 'event',         // 事件记录
  DECISION = 'decision',   // 决策记录
  ERROR = 'error',         // 错误记录
  LEARNING = 'learning',   // 学习心得
  RELATION = 'relation',   // 关系信息

  // v2.0.0 Profile 相关类型
  IDENTITY = 'identity',      // 身份信息：姓名、职业、位置等
  PREFERENCE = 'preference',  // 偏好设置：响应长度、活跃时间、内容偏好等
  PERSONA = 'persona',      // 人格特征：性格、价值观、兴趣等
}

/**
 * MemoryScope - 记忆作用域
 *
 * session: 仅在当前会话有效
 * agent: 在 Agent 级别有效
 * global: 全局有效
 */
export enum MemoryScope {
  SESSION = 'session',
  AGENT = 'agent',
  GLOBAL = 'global',
}

/**
 * MemoryBlock - 记忆存储区块
 *
 * working: 工作记忆区（临时）
 * session: 会话记忆区
 * core: 核心记忆区（重要）
 * archived: 归档区（低重要性）
 * deleted: 删除区（待清理）
 */
export enum MemoryBlock {
  WORKING = 'working',
  SESSION = 'session',
  CORE = 'core',
  ARCHIVED = 'archived',
  DELETED = 'deleted',
}

/**
 * MemoryMetadata - 记忆元数据
 *
 * 包含标题、摘要、关键词、分类等信息
 * 支持分块相关元数据
 * 支持版本关联信息
 */
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

  // 版本关联信息
  versionGroupId?: string;      // 版本组 ID（首次创建的 UID）
  previousMemoryId?: string;    // 上一个版本的 UID
  nextMemoryId?: string;        // 下一个版本的 UID
  isNewVersion?: boolean;       // 是否是新版本

  // 捕获相关信息
  source?: 'user' | 'agent' | 'extracted' | 'recalled';
  sessionId?: string;
  extractedAt?: number;

  [key: string]: unknown;
}

/**
 * MemoryLifecycleEvent - 记忆生命周期事件
 */
export interface MemoryLifecycleEvent {
  type: 'created' | 'accessed' | 'updated' | 'reinforced' | 'upgraded' | 'downgraded' | 'archived' | 'deleted';
  timestamp: number;
  details?: Record<string, unknown>;
}

/**
 * PalaceLocation - 记忆宫殿位置
 */
export interface PalaceLocation {
  wingId: string;    // "session_xxx", "agent_xxx", "global"
  hallId: string;    // "facts", "events", ...
  roomId: string;    // "room_xxx" 或 "room_default"
  closetId: string;  // "closet_xxx"
}

/**
 * VersionInfo - 版本信息
 */
export interface VersionInfo {
  version: number;              // 版本号
  palaceRef: string;           // wingId/hallId/roomId/closet_{uid}_v{version}
  createdAt: number;            // 版本创建时间
  summary: string;               // 该版本摘要
  contentLength: number;         // 该版本内容长度
}

/**
 * Memory - 核心记忆接口
 *
 * 系统的核心数据结构，包含所有记忆信息
 *
 * 版本: v2.0.0
 * - uid 作为唯一标识，终身不变
 * - version 记录当前版本号
 * - versionChain 记录完整版本历史
 */
export interface Memory {
  uid: string;                 // 唯一标识（终身不变）
  version: number;             // 当前版本号

  content: string;             // 当前版本内容
  summary: string;              // 当前版本摘要

  type: MemoryType;             // 记忆类型
  agentId: string;              // 创建来源 Agent

  importance: number;          // 重要性评分 (0-10)
  scopeScore: number;           // 作用域评分 (0-10)
  scope: MemoryScope;          // SESSION | AGENT | GLOBAL
  block: MemoryBlock;          // 存储区块

  // Palace 位置
  palace: PalaceLocation;

  // 版本信息
  versionChain: VersionInfo[];  // 版本链
  isLatestVersion: boolean;     // 是否最新版本

  // 统计
  accessCount: number;         // 累计访问次数
  recallCount: number;          // 累计召回次数（每次语义召回+1）
  lastAccessedAt: number;       // 上次访问时间戳
  usedByAgents: string[];       // 使用过的 Agent 列表

  // 时间戳
  createdAt: number;
  updatedAt: number;

  // 扩展
  metadata: MemoryMetadata;
  tags: string[];

  // 生命周期
  lifecycle: {
    createdAt: number;
    events: MemoryLifecycleEvent[];
  };
}

/**
 * MemoryInput - 记忆输入参数
 *
 * 存储记忆时的输入参数
 */
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

/**
 * MemoryUpdate - 记忆更新参数
 */
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

/**
 * MemoryFilters - 记忆过滤器
 */
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
    from: Timestamp;
    to: Timestamp;
  };
  importanceRange?: {
    min: number;
    max: number;
  };
}

/**
 * RecallOptions - 召回选项
 */
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
    from: Timestamp;
    to: Timestamp;
  };
  agentId?: string;
  sessionId?: string;
  useVectorSearch?: boolean;
  includeVersionChain?: boolean;
  minScopeScore?: number;
}

/**
 * GraphNode - 图谱节点
 */
export interface GraphNode {
  id: string;
  type: string;
  label: string;
  properties?: Record<string, unknown>;
}

/**
 * GraphEdge - 图谱边
 */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  weight?: number;
}

/**
 * RecallResult - 召回结果
 */
export interface RecallResult {
  memories: Memory[];
  profile: string;
  boosted?: number;
  relations?: {
    nodes: GraphNode[];
    paths: GraphEdge[];
  };
}

/**
 * ExtractedFact - 提取的事实
 */
export interface ExtractedFact {
  content: string;
  type: MemoryType;
  confidence: number;
  source: 'user' | 'agent' | 'both' | 'llm';
  subject?: string;
  importance?: number;
}

/**
 * ForgetReport - 遗忘报告
 */
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

/**
 * MemoryStats - 记忆统计
 */
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

/**
 * Message - 消息接口
 */
export interface Message {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: Timestamp;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * CapturedMemory - 捕获的记忆
 */
export interface CapturedMemory {
  content: string;
  summary: string;
  type: MemoryType;
  confidence: number;
  importanceLevel?: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  scopeLevel?: 'A0' | 'A1' | 'A2';
  keywords: string[];
  tags: string[];
  metadata: {
    source: 'user' | 'agent';
    extractedAt: number;
    sessionId: string;
    isNewVersion: boolean;
    versionGroupId: string;
    previousMemoryId?: string;
    reasoning?: string;
  };
}

/**
 * CaptureResult - 捕获结果
 */
export interface CaptureResult {
  captured: CapturedMemory[];
  skipped: Array<{
    content: string;
    reason: 'low_confidence' | 'duplicate' | 'error';
    details?: string;
  }>;
}

/**
 * ConversationTurn - 对话轮次
 */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * CaptureConfig - 捕获配置
 */
export interface CaptureConfig {
  confidenceThreshold?: number;
  maxMemories?: number;
  enableLLMExtraction?: boolean;
  enableAutoScoring?: boolean;
  enableVersionDetection?: boolean;
  similarityThreshold?: number;
}

/**
 * CaptureInput - 捕获输入
 */
export interface CaptureInput {
  agentId: string;
  sessionId?: string;
  content: string | ConversationTurn[];
  timestamp?: Timestamp;
  metadata?: Record<string, any>;
  config?: CaptureConfig;
}

/**
 * MemoryCaptureConfig - 记忆捕获配置
 */
export interface MemoryCaptureConfig {
  maxMemoriesPerCapture: number;
  similarityThreshold: number;
  confidenceThreshold: number;
  enableLLMSummarization: boolean;
  llmProvider: 'openai' | 'anthropic' | 'custom';
  llmApiKey?: string;
  llmEndpoint?: string;
  llmModel?: string;
}

/**
 * ExtractedMemory - LLM 提取的候选记忆
 */
export interface ExtractedMemory {
  content: string;
  type: MemoryType;
  confidence: number;
  keywords: string[];
  tags: string[];
  sourceSegment?: string;
  segmentStart?: number;
  segmentEnd?: number;
  topicId?: string;
}

/**
 * DefaultMemoryTypes - 默认记忆类型列表
 */
export const DEFAULT_MEMORY_TYPES: MemoryType[] = [
  MemoryType.FACT,
  MemoryType.EVENT,
  MemoryType.DECISION,
  MemoryType.ERROR,
  MemoryType.LEARNING,
  MemoryType.RELATION,
];

/**
 * ProfileTypes - Profile 相关记忆类型
 */
export const PROFILE_TYPES = [
  MemoryType.IDENTITY,
  MemoryType.PREFERENCE,
  MemoryType.PERSONA,
] as const;

/**
 * 检查给定类型是否为 Profile 类型
 */
export function isProfileType(type: MemoryType): boolean {
  return (PROFILE_TYPES as readonly MemoryType[]).includes(type as MemoryType);
}

/**
 * InclusionResult - 语义包含检测结果
 */
export interface InclusionResult {
  type: 'b_extends_a' | 'a_extends_b' | 'identical' | 'overlapping' | 'unrelated';
  inclusionScore: number;
  reasoning: string;
  existingMemoryId: string;
}

/**
 * InclusionCheckRequest - 包含检测请求
 */
export interface InclusionCheckRequest {
  newContent: string;
  newSummary?: string;
  existingContent: string;
  existingSummary?: string;
}