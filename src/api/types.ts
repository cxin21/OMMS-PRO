/**
 * REST API 类型定义
 * 
 * 定义 REST API 相关的所有类型
 */

import type { Request, Response, NextFunction } from 'express';

/**
 * API 统一响应格式
 */
export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: APIError;
  timestamp: number;
  version: string;
}

/**
 * API 错误格式
 */
export interface APIError {
  code: string;
  message: string;
  details?: any;
  stack?: string;
}

/**
 * 错误码定义
 */
export enum ErrorCode {
  // 通用错误
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  INVALID_REQUEST = 'INVALID_REQUEST',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  CONFLICT = 'CONFLICT',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  
  // Palace 相关错误
  WING_NOT_FOUND = 'WING_NOT_FOUND',
  ROOM_NOT_FOUND = 'ROOM_NOT_FOUND',
  WING_ALREADY_EXISTS = 'WING_ALREADY_EXISTS',
  
  // Memory 相关错误
  MEMORY_NOT_FOUND = 'MEMORY_NOT_FOUND',
  MEMORY_ALREADY_EXISTS = 'MEMORY_ALREADY_EXISTS',
  INVALID_MEMORY_DATA = 'INVALID_MEMORY_DATA',
  
  // Graph 相关错误
  ENTITY_NOT_FOUND = 'ENTITY_NOT_FOUND',
  RELATION_NOT_FOUND = 'RELATION_NOT_FOUND',
  
  // Dreaming 相关错误
  DREAMING_ALREADY_RUNNING = 'DREAMING_ALREADY_RUNNING',
  DREAMING_NOT_FOUND = 'DREAMING_NOT_FOUND',
}

/**
 * 分页参数
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * 分页响应
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 *  Palace 相关类型
 */

export interface CreateWingRequest {
  name: string;
  type: 'person' | 'project' | 'session' | 'general';
  description?: string;
  metadata?: Record<string, any>;
}

export interface CreateWingResponse {
  id: string;
  name: string;
  type: string;
  createdAt: number;
}

export interface ListWingsResponse {
  wings: WingInfo[];
}

export interface WingInfo {
  id: string;
  name: string;
  type: string;
  roomCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ListRoomsRequest {
  wingId: string;
  hallId?: string;
}

export interface ListRoomsResponse {
  rooms: RoomInfo[];
}

export interface RoomInfo {
  id: string;
  name: string;
  wingId: string;
  hallId: string;
  memoryCount: number;
  createdAt: number;
}

/**
 * Memory 相关类型
 */

export interface StoreMemoryRequest {
  content: string;
  wingId?: string;
  roomId?: string;
  type?: string;
  metadata?: Record<string, any>;
}

export interface StoreMemoryResponse {
  id: string;
  wingId: string;
  roomId: string;
  type: string;
  createdAt: number;
}

export interface GetMemoryResponse {
  id: string;
  content: string;
  wingId: string;
  roomId: string;
  hallId: string;
  type: string;
  metadata: Record<string, any>;
  importance: number;
  scopeScore: number;
  createdAt: number;
  updatedAt: number;
}

export interface ListMemoriesRequest extends PaginationParams {
  wingId?: string;
  roomId?: string;
  hallId?: string;
  type?: string;
  startDate?: number;
  endDate?: number;
  tags?: string[];
}

export interface UpdateMemoryRequest {
  content?: string;
  metadata?: Record<string, any>;
  importance?: number;
  scopeScore?: number;
}

/**
 * Recall 相关类型
 */

export interface RecallRequest {
  query?: string;
  wingId?: string;
  roomId?: string;
  hallId?: string;
  type?: string;
  limit?: number;
  threshold?: number;
  includeProfile?: boolean;
}

export interface RecallResponse {
  memories: MemorySnippet[];
  profile?: string;
  boosted: boolean;
  duration: number;
}

export interface MemorySnippet {
  id: string;
  summary: string;
  wingId: string;
  roomId: string;
  hallId: string;
  type: string;
  importance: number;
  scopeScore: number;
  relevance?: number;
}

/**
 * Dreaming 相关类型
 */

export interface TriggerDreamingRequest {
  source?: 'manual' | 'scheduled' | 'threshold';
  force?: boolean;
}

export interface TriggerDreamingResponse {
  dreamingId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  estimatedDuration?: number;
}

export interface DreamingStatusResponse {
  isRunning: boolean;
  currentPhase?: 'light' | 'deep' | 'rem';
  progress?: number;
  startedAt?: number;
  lastCompletedAt?: number;
  totalDreamings: number;
}

/**
 * Knowledge Graph 相关类型
 */

export interface QueryEntityRequest {
  entityId: string;
  asOf?: string;
}

export interface EntityResponse {
  id: string;
  name: string;
  type: string;
  attributes: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface GetRelationsRequest {
  entityId: string;
  asOf?: string;
  direction?: 'in' | 'out' | 'both';
}

export interface RelationsResponse {
  entityId: string;
  relations: RelationInfo[];
}

export interface RelationInfo {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  type: string;
  strength: number;
  validFrom?: number;
  validTo?: number;
}

export interface GetTunnelsRequest {
  roomName: string;
  limit?: number;
}

export interface TunnelsResponse {
  tunnels: TunnelInfo[];
}

export interface TunnelInfo {
  id: string;
  roomName: string;
  wingIds: string[];
  strength: number;
  discoveredAt: number;
}

export interface TimelineRequest {
  entityId: string;
  limit?: number;
}

export interface TimelineResponse {
  entityId: string;
  entries: TimelineEntry[];
}

export interface TimelineEntry {
  timestamp: number;
  eventType: string;
  description: string;
  relatedEntities: string[];
}

/**
 * Stats 相关类型
 */

export interface StatsResponse {
  palace: PalaceStats;
  memory: MemoryStats;
  graph: GraphStats;
  dreaming: DreamingStats;
  system: SystemStats;
}

export interface PalaceStats {
  totalWings: number;
  totalRooms: number;
  totalMemories: number;
  wingsByType: Record<string, number>;
}

export interface MemoryStats {
  totalMemories: number;
  memoriesByType: Record<string, number>;
  memoriesByScope: Record<string, number>;
  averageImportance: number;
}

export interface GraphStats {
  totalEntities: number;
  totalRelations: number;
  totalTunnels: number;
  averageEntityDegree: number;
}

export interface DreamingStats {
  totalDreamings: number;
  lastDreamingAt?: number;
  averageDuration: number;
  successRate: number;
}

export interface SystemStats {
  uptime: number;
  memoryUsage: number;
  cacheHits: number;
  cacheMisses: number;
  requestCount: number;
}

/**
 * Health 相关类型
 */

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  timestamp: number;
  checks: HealthCheck[];
}

export interface HealthCheck {
  name: string;
  status: 'healthy' | 'unhealthy';
  message?: string;
  latency?: number;
}

/**
 * Config 相关类型
 */

export interface GetConfigResponse {
  config: Record<string, any>;
}

export interface UpdateConfigRequest {
  key: string;
  value: any;
}

export interface UpdateConfigResponse {
  key: string;
  value: any;
  previousValue?: any;
}

/**
 * 中间件类型
 */

export interface Middleware {
  (req: Request, res: Response, next: NextFunction): void;
}

export interface AsyncMiddleware {
  (req: Request, res: Response, next: NextFunction): Promise<void>;
}

/**
 * 路由处理器类型
 */

export interface RouteHandler {
  (req: Request, res: Response): Promise<void>;
}

/**
 * API 配置
 */

export interface RESTAPIConfig {
  // 服务器配置
  server: {
    host: string;
    port: number;
    cors: {
      enabled: boolean;
      origins: string[];
    };
    timeout: number;
  };
  
  // 日志配置
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    enableRequestLogging: boolean;
    enableResponseLogging: boolean;
    enableFileLogging?: boolean;
    logFilePath?: string;
  };
  
  // 安全配置
  security: {
    enableAuth: boolean;
    apiKey?: string;
    rateLimit: {
      enabled: boolean;
      windowMs: number;
      maxRequests: number;
    };
  };
  
  // 性能配置
  performance: {
    enableCompression: boolean;
    maxRequestBodySize: string;
  };
}

