/**
 * Memory API DTOs - 记忆 API 数据传输对象
 *
 * @module api/dto
 */

/**
 * 记忆列表查询参数
 */
export interface ListMemoriesQuery {
  limit?: number;
  offset?: number;
  type?: string;
  scope?: string;
  tags?: string[];
  agentId?: string;
}

/**
 * 记忆列表响应
 */
export interface ListMemoriesResponse {
  memories: MemoryDTO[];
  total: number;
}

/**
 * 记忆 DTO
 */
export interface MemoryDTO {
  uid: string;
  version: number;
  content: string;
  summary: string;
  type: string;
  agentId: string;
  importance: number;
  scopeScore: number;
  scope: string;
  block: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * 记忆召回请求
 */
export interface RecallMemoriesRequest {
  query: string;
  limit?: number;
  minSimilarity?: number;
  types?: string[];
  tags?: string[];
}

/**
 * 记忆召回响应
 */
export interface RecallMemoriesResponse {
  memories: MemoryDTO[];
  profile: string;
  boosted?: number;
}

/**
 * 创建记忆请求
 */
export interface CreateMemoryRequest {
  content: string;
  type: string;
  metadata?: {
    tags?: string[];
    sessionId?: string;
    agentId?: string;
  };
}

/**
 * 创建记忆响应
 */
export interface CreateMemoryResponse {
  success: boolean;
  memory?: MemoryDTO;
  error?: string;
}

/**
 * 更新记忆请求
 */
export interface UpdateMemoryRequest {
  content?: string;
  summary?: string;
  tags?: string[];
  importance?: number;
  scopeScore?: number;
}

/**
 * 更新记忆响应
 */
export interface UpdateMemoryResponse {
  success: boolean;
  memory?: MemoryDTO;
  error?: string;
}

/**
 * 归档/恢复记忆响应
 */
export interface ArchiveMemoryResponse {
  success: boolean;
  memoryId: string;
  action: 'archive' | 'restore';
}

/**
 * 统计信息响应
 */
export interface MemoryStatsResponse {
  total: number;
  byType: Record<string, number>;
  byScope: Record<string, number>;
  byBlock: Record<string, number>;
  avgImportance: number;
  avgScopeScore: number;
}

/**
 * 记忆详情响应
 */
export interface MemoryDetailResponse {
  memory: MemoryDTO;
  versionChain?: VersionInfoDTO[];
  relatedMemories?: RelatedMemoryDTO[];
}

/**
 * 版本信息 DTO
 */
export interface VersionInfoDTO {
  version: number;
  palaceRef: string;
  createdAt: number;
  summary: string;
  contentLength: number;
}

/**
 * 关联记忆 DTO
 */
export interface RelatedMemoryDTO {
  uid: string;
  relation: string;
  weight: number;
  memory?: MemoryDTO;
}