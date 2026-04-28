/**
 * @deprecated Since v2.2.0 - Import from 'src/types/api' instead.
 * This file is kept for backward compatibility.
 */

// Re-export all types from new location
export type {
  APIResponse,
  APIError,
  PaginationParams,
  PaginatedResponse,
  CreateWingRequest,
  CreateWingResponse,
  ListWingsResponse,
  WingInfo,
  ListRoomsRequest,
  ListRoomsResponse,
  RoomInfo,
  StoreMemoryRequest,
  StoreMemoryResponse,
  GetMemoryResponse,
  ListMemoriesRequest,
  UpdateMemoryRequest,
  RecallRequest,
  RecallResponse,
  MemorySnippet,
  TriggerDreamingRequest,
  TriggerDreamingResponse,
  DreamingStatusResponse,
  QueryEntityRequest,
  EntityResponse,
  GetRelationsRequest,
  RelationsResponse,
  RelationInfo,
  GetTunnelsRequest,
  TunnelsResponse,
  TunnelInfo,
  TimelineRequest,
  TimelineResponse,
  TimelineEntry,
  StatsResponse,
  PalaceStats,
  ApiMemoryStats,
  GraphStats,
  DreamingStats,
  SystemStats,
  HealthResponse,
  HealthCheck,
  GetConfigResponse,
  UpdateConfigRequest,
  UpdateConfigResponse,
  RESTAPIConfig,
} from '../types/api';

// Re-export ErrorCode enum (not a type, it's a value)
export { ErrorCode } from '../types/api';

// Re-export Middleware types
export type { Middleware, AsyncMiddleware, RouteHandler } from '../types/api';