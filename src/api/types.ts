/**
 * API Types - Bridge re-exports from canonical types location (src/types/api).
 * Used by api/middleware/ and api/server.ts for local './types' imports.
 */
export type { APIResponse, APIError, PaginationParams, PaginatedResponse } from '../types/api';
export type { RESTAPIConfig } from '../types/api';
export { ErrorCode } from '../types/api';
export type { Middleware, AsyncMiddleware, RouteHandler } from '../types/api/route';
