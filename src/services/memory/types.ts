/**
 * Memory Service 类型定义
 *
 * 本文件定义了 Memory Service 使用的所有核心类型
 * 注意：MemoryType, MemoryScope, MemoryBlock 已统一到 @/types/memory
 * HallType, WingType 已统一到 @/types/palace
 *
 * @module memory-service/types
 * @since 0.1.0
 */

import { LogLevel } from '../../shared/logging/types';
import { MemoryType, MemoryScope, MemoryBlock } from '../../types/memory';

// Re-export from new types layer for backward compatibility
export { MemoryType, MemoryScope, MemoryBlock } from '../../types/memory';
export { HallType, WingType } from '../../types/palace';
export { HALL_TO_MEMORY_TYPE_MAP, MEMORY_TO_HALL_TYPE_MAP } from '../../types/palace';

/**
 * 记忆输入接口
 *
 * 用于创建新记忆的输入参数
 */
export interface MemoryInput {
  /** 记忆内容（完整原始内容） */
  content: string;

  /** 创建者 Agent ID */
  agentId: string;

  /** 记忆类型 */
  type: MemoryType;

  /** 可选的会话 ID */
  sessionId?: string;

  /** 可选的元数据 */
  metadata?: {
    /** 来源（如：对话、文件、API） */
    source?: string;

    /** 标签列表 */
    tags?: string[];

    /** 优先级 (0-10) */
    priority?: number;

    /** 上下文信息 */
    context?: Record<string, any>;

    /** 关键词 */
    keywords?: string[];

    /** 会话 ID */
    sessionId?: string;

    [key: string]: unknown;
  };
}

/**
 * 记忆更新接口
 *
 * 用于更新现有记忆，所有字段可选
 */
export interface MemoryUpdate {
  /** 新内容 */
  content?: string;

  /** 新元数据（合并到现有元数据） */
  metadata?: Record<string, any>;

  /** 新标签（替换现有标签） */
  tags?: string[];

  /** 重要性评分（0-10），用于 archive/moveToScope 等操作 */
  importanceScore?: number;

  /** 作用域评分（0-10），用于 moveToScope 等操作 */
  scopeScore?: number;

  /** 作用域（SESSION/AGENT/GLOBAL），用于作用域升级 */
  scope?: MemoryScope;
}

/**
 * 记忆更新批量接口
 */
export interface MemoryUpdateBatch {
  /** 记忆 ID */
  memoryId: string;
  
  /** 更新内容 */
  update: MemoryUpdate;
}

/**
 * 召回选项接口
 * 
 * 用于控制记忆召回的行为
 */
export interface RecallOptions {
  /** 查询文本（用于向量搜索和关键词搜索） */
  query?: string;
  
  /** Agent ID 过滤 */
  agentId?: string;
  
  /** Wing ID 过滤 */
  wingId?: string;
  
  /** Hall ID 过滤 */
  hallId?: string;
  
  /** Room ID 过滤 */
  roomId?: string;
  
  /** 记忆类型过滤 */
  type?: MemoryType;
  
  /** 时间范围过滤 */
  timeRange?: {
    /** 开始时间戳 */
    start: number;
    
    /** 结束时间戳 */
    end: number;
  };
  
  /** 返回数量限制 */
  limit?: number;
  
  /** 偏移量 */
  offset?: number;
  
  /** 最小相关度阈值 (0-1) */
  minScore?: number;
  
  /** 启用向量搜索 */
  enableVectorSearch?: boolean;

  /** 启用关键词搜索 */
  enableKeywordSearch?: boolean;

  /** 向量搜索权重（默认 0.7） */
  vectorWeight?: number;

  /** 关键词搜索权重（默认 0.3） */
  keywordWeight?: number;

  /** 排序方式 */
  sortBy?: 'relevance' | 'time' | 'importance';
}

/**
 * 记忆信息接口
 * 
 * 记忆的基本信息，用于列表和摘要展示
 */
export interface MemoryInfo {
  /** 记忆 ID（Closet ID） */
  id: string;
  
  /** 记忆摘要 */
  summary: string;
  
  /** 记忆类型 */
  type: MemoryType;
  
  /** 创建者 Agent ID */
  agentId: string;
  
  /** Wing ID */
  wingId: string;
  
  /** Hall ID */
  hallId: string;
  
  /** Room ID */
  roomId: string;
  
  /** 重要性评分 (0-10) */
  importanceScore: number;
  
  /** 作用域评分 (0-10) */
  scopeScore: number;
  
  /** 当前作用域 */
  scope: MemoryScope;
  
  /** 访问次数 */
  accessCount: number;
  
  /** 最后访问时间 */
  lastAccessedAt: number;
  
  /** 创建时间 */
  createdAt: number;
  
  /** 更新时间 */
  updatedAt: number;
}

/**
 * 记忆生命周期事件类型
 */
export type MemoryLifecycleEventType =
  | 'created'
  | 'updated'
  | 'accessed'
  | 'boosted'
  | 'archived'
  | 'upgraded'
  | 'downgraded';

/**
 * 记忆生命周期事件
 */
export interface MemoryLifecycleEvent {
  /** 事件类型 */
  type: MemoryLifecycleEventType;
  
  /** 事件时间戳 */
  timestamp: number;
  
  /** 事件详情 */
  details?: Record<string, any>;
}

/**
 * 记忆生命周期
 * 
 * 记录记忆的完整生命周期历史
 */
export interface MemoryLifecycle {
  /** 创建时间 */
  createdAt: number;
  
  /** 事件历史 */
  events: MemoryLifecycleEvent[];
}

/**
 * 完整记忆接口
 * 
 * 包含所有信息的完整记忆对象
 */
export interface Memory extends MemoryInfo {
  /** 完整原始内容 */
  content: string;
  
  /** 元数据 */
  metadata: Record<string, any>;
  
  /** 标签列表 */
  tags: string[];
  
  /** 向量 ID（可选） */
  vectorId?: string;
  
  /** 生命周期历史 */
  lifecycle: MemoryLifecycle;
}

/**
 * 召回结果接口
 */
export interface RecallResult {
  /** 召回的记忆列表 */
  memories: MemoryInfo[];
  
  /** 符合条件的总数 */
  total: number;
  
  /** 是否有更多结果 */
  hasMore: boolean;
  
  /** 评分详情 */
  scores: {
    /** 向量评分（可选） */
    vector?: number[];
    
    /** 关键词评分（可选） */
    keyword?: number[];
    
    /** 综合评分 */
    combined: number[];
  };
  
  /** 是否应用了强化 */
  boosted?: boolean;
  
  /** 生成的画像（可选） */
  profile?: string;
}

/**
 * 记忆过滤器接口
 * 
 * 用于简单查询
 */
export interface MemoryFilters {
  /** Agent ID 过滤 */
  agentId?: string;
  
  /** Wing ID 过滤 */
  wingId?: string;
  
  /** Hall ID 过滤 */
  hallId?: string;
  
  /** Room ID 过滤 */
  roomId?: string;
  
  /** 类型过滤 */
  type?: MemoryType;
  
  /** 作用域过滤 */
  scope?: MemoryScope;
  
  /** 时间范围 */
  timeRange?: {
    start: number;
    end: number;
  };
  
  /** 标签过滤 */
  tags?: string[];
  
  /** 最小重要性评分 */
  minImportance?: number;
}

/**
 * 遗忘选项接口
 */
export interface ForgetOptions {
  /** 是否只预览，不执行 */
  dryRun?: boolean;
  
  /** 归档重要性阈值 */
  archiveThreshold?: number;
  
  /** 删除重要性阈值 */
  deleteThreshold?: number;
  
  /** 最大未访问天数 */
  maxInactiveDays?: number;
}

/**
 * 遗忘报告接口
 */
export interface ForgetReport {
  /** 扫描的记忆数 */
  scannedCount: number;

  /** 归档的记忆数 */
  archivedCount: number;

  /** 删除的记忆数 */
  deletedCount: number;

  /** 归档的记忆 ID 列表 */
  archivedIds: string[];

  /** 删除的记忆 ID 列表 */
  deletedIds: string[];

  /** 错误详情 */
  errors: Array<{ uid: string; error: string }>;

  /** 执行时间 */
  executedAt: number;

  /** 执行耗时（毫秒） */
  duration: number;
}

/**
 * 强化报告接口
 */
export interface BoostReport {
  /** 强化的记忆数 */
  boosted: number;
  
  /** 升级的记忆数 */
  upgraded: number;
  
  /** 强化的记忆 ID 列表 */
  boostedIds: string[];
  
  /** 升级的记忆 ID 列表 */
  upgradedIds: string[];
}

/**
 * 统计信息接口
 */
export interface MemoryStats {
  /** 总记忆数 */
  totalMemories: number;
  
  /** 按类型分组统计 */
  memoriesByType: Record<MemoryType, number>;
  
  /** 按 Agent 分组统计 */
  memoriesByAgent: Record<string, number>;
  
  /** 按作用域分组统计 */
  memoriesByScope: Record<MemoryScope, number>;
  
  /** 存储大小（字节） */
  storageSize: number;
  
  /** 平均重要性评分 */
  averageImportance: number;
  
  /** 平均作用域评分 */
  averageScope: number;
  
  /** 总访问次数 */
  totalAccessCount: number;
  
  /** 最近 7 天的记忆数 */
  recentMemories: number;
  
  /** 热门记忆数（访问>10） */
  hotMemories: number;
}

/**
 * 批量更新结果接口
 */
export interface UpdateBatchResult {
  /** 成功的数量 */
  success: number;
  
  /** 失败的数量 */
  failed: number;
  
  /** 失败详情 */
  failures: Array<{
    memoryId: string;
    error: string;
  }>;
}

/**
 * 批量删除结果接口
 */
export interface DeleteBatchResult {
  /** 删除的数量 */
  deleted: number;
  
  /** 未找到的数量 */
  notFound: number;
  
  /** 未找到的 ID 列表 */
  notFoundIds: string[];
}

/**
 * Memory Service 配置接口
 */
export interface MemoryServiceConfig {
  // ========== 基础配置 ==========
  
  /** 是否启用服务 */
  enabled: boolean;
  
  /** 当前 Agent ID */
  agentId: string;
  
  // ========== 存储配置 ==========
  
  /** 存储相关配置 */
  store: {
    /** 自动提取事实 */
    autoExtract: boolean;
    
    /** 自动分块 */
    autoChunk: boolean;
    
    /** 自动丰富元数据 */
    autoEnrich: boolean;
    
    /** 分块阈值（内容长度） */
    chunkThreshold: number;
    
    /** 默认记忆类型 */
    defaultType: MemoryType;
  };
  
  // ========== 召回配置 ==========
  
  /** 召回相关配置 */
  recall: {
    /** 默认返回数量 */
    defaultLimit: number;
    
    /** 最大返回数量 */
    maxLimit: number;
    
    /** 最小相关度阈值 */
    minScore: number;
    
    /** 启用向量搜索 */
    enableVectorSearch: boolean;
    
    /** 启用关键词搜索 */
    enableKeywordSearch: boolean;
    
    /** 向量搜索权重 */
    vectorWeight: number;
    
    /** 关键词搜索权重 */
    keywordWeight: number;
  };
  
  // ========== 遗忘配置 ==========
  
  /** 遗忘相关配置 */
  forget: {
    /** 启用遗忘机制 */
    enabled: boolean;
    
    /** 检查间隔（毫秒） */
    checkInterval: number;
    
    /** 归档阈值 */
    archiveThreshold: number;
    
    /** 删除阈值 */
    deleteThreshold: number;
    
    /** 最大未访问天数 */
    maxInactiveDays: number;
    
    /** 遗忘分数计算权重配置 */
    scoringWeights: {
      /** 重要性权重 */
      importanceWeight: number;
      /** 访问次数权重 */
      accessCountWeight: number;
      /** 新近度权重 */
      recencyWeight: number;
      /** 访问次数归一化除数 */
      accessCountNormalizer: number;
    };
  };
  
  // ========== 强化配置 ==========
  
  /** 强化相关配置 */
  reinforce: {
    /** 启用强化机制 */
    enabled: boolean;
    
    /** 访问权重 */
    accessWeight: number;
    
    /** 新近度权重 */
    recencyWeight: number;
    
    /** 升级阈值 */
    upgradeThreshold: number;
    
    /** 强化分数计算配置 */
    scoringConfig: {
      /** 访问次数归一化除数 */
      accessCountNormalizer: number;
      /** 新近度归一化除数（毫秒） */
      recencyNormalizer: number;
      /** 最大强化分数 */
      maxBoostScore: number;
    };
    
    /** 作用域升级配置 */
    scopeUpgrade: {
      /** 升级到 GLOBAL 的重要性阈值 */
      globalImportanceThreshold: number;
      /** 升级到 AGENT 的重要性阈值 */
      agentImportanceThreshold: number;
    };
  };
  
  // ========== 缓存配置 ==========
  
  /** 缓存相关配置 */
  cache: {
    /** 启用缓存 */
    enabled: boolean;
    
    /** 最大缓存数量 */
    maxSize: number;
    
    /** 缓存过期时间（毫秒） */
    ttl: number;
  };
  
  // ========== 日志配置 ==========
  
  /** 日志相关配置 */
  logging: {
    /** 启用日志 */
    enabled: boolean;
    
    /** 日志级别 */
    level: LogLevel;
    
    /** 日志目录 */
    directory?: string;
  };
}

