/**
 * Episode Types - 情景记忆类型
 *
 * @module types/episode
 */

import type { Timestamp } from '../memory/core';

// ============================================================================
// Episode Types
// ============================================================================

export interface Episode {
  uid: string;
  name: string;
  description: string;
  startTime: number;
  endTime: number;
  location?: string;
  memoryUids: string[];
  primaryMemoryUid?: string;
  emotions: string[];
  context: string;
  keywords: string[];
  agentId: string;
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
  accessCount: number;
}

export interface EpisodeSummary {
  uid: string;
  name: string;
  description: string;
  startTime: number;
  endTime: number;
  location?: string;
  emotion: string;
  memoryCount: number;
  agentId: string;
  accessCount: number;
}

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

export interface EpisodeUpdate {
  name?: string;
  description?: string;
  location?: string;
  emotions?: string[];
  context?: string;
  keywords?: string[];
  endTime?: number;
}

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

export interface EpisodeAwareWorkingItem {
  uid: string;
  episodeId?: string;
  spatialPosition?: number;
}