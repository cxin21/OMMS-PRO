/**
 * Episode Types - 情景记忆类型定义
 * @module types/episode
 *
 * 版本: v1.0.0
 * 情景记忆：按时间和上下文组织的一组记忆
 */

import type { MemoryType } from './memory';

// ============================================================================
// 情景记忆类型
// ============================================================================

/**
 * Episode - 情景记忆
 *
 * 情景记忆将相关的记忆组织在一起，形成一个连贯的"经历"
 * 类比人类的情景记忆：一次会议、一次讨论、一次调试等
 */
export interface Episode {
  /** 情景唯一 ID */
  uid: string;

  /** 情景名称（LLM 生成或用户定义） */
  name: string;

  /** 情景描述 */
  description: string;

  /** 开始时间戳 */
  startTime: number;

  /** 结束时间戳 */
  endTime: number;

  /** 心理位置（对应 Palace 路径或用户自定义） */
  location?: string;

  /** 属于这个情景的记忆 UID 列表 */
  memoryUids: string[];

  /** 主记忆 UID（最核心的记忆） */
  primaryMemoryUid?: string;

  /** 情感标签 */
  emotions: string[];

  /** 情景上下文摘要 */
  context: string;

  /** 关键词 */
  keywords: string[];

  /** 创建来源 Agent */
  agentId: string;

  /** 来源会话 */
  sessionId?: string;

  /** 创建时间 */
  createdAt: number;

  /** 更新时间 */
  updatedAt: number;

  /** 被检索次数 */
  accessCount: number;
}

/**
 * EpisodeSummary - 情景摘要（用于列表展示）
 */
export interface EpisodeSummary {
  uid: string;
  name: string;
  description: string;
  startTime: number;
  endTime: number;
  location?: string;
  emotion: string;              // 主要情感
  memoryCount: number;
  agentId: string;
  accessCount: number;
}

/**
 * EpisodeCreate - 创建情景输入
 */
export interface EpisodeCreate {
  name: string;
  description?: string;
  startTime: number;
  endTime: number;
  location?: string;
  memoryUids?: string[];
  emotions?: string[];
  context?: string;
  keywords?: string[];
  agentId: string;
  sessionId?: string;
}

/**
 * EpisodeUpdate - 更新情景输入
 */
export interface EpisodeUpdate {
  name?: string;
  description?: string;
  location?: string;
  emotions?: string[];
  context?: string;
  keywords?: string[];
  endTime?: number;
}

/**
 * EpisodeDetection - LLM 情景边界检测结果
 */
export interface EpisodeDetection {
  shouldCreate: boolean;
  reason?: string;
  episode?: {
    name: string;
    description: string;
    startTime: number;
    endTime: number;
    location?: string;
    emotions: string[];
    keywords: string[];
    primaryMemoryUid?: string;
  };
}

/**
 * EpisodeTimeline - 情景时间线
 */
export interface EpisodeTimeline {
  agentId: string;
  episodes: EpisodeSpan[];
  totalDuration: number;
}

export interface EpisodeSpan {
  uid: string;
  name: string;
  start: number;
  end: number;
  emotion: string;
  memoryCount: number;
}

/**
 * WorkingMemoryItem 的情景扩展
 */
export interface EpisodeAwareWorkingItem {
  uid: string;
  episodeId?: string;           // 所属情景
  spatialPosition?: number;       // 在情景中的空间位置
}
