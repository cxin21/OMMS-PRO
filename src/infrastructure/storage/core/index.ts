/**
 * Storage 模块导出
 * @module storage
 */

// Types
export * from './types';

// Store implementations (from stores/ subdirectory)
export { CacheManager } from '../stores/cache-manager';
export { VectorStore } from '../stores/vector-store';
export { SQLiteMetaStore } from '../stores/sqlite-meta-store';
export { PalaceStore } from '../stores/palace-store';
export { GraphStore } from '../stores/graph-store';
export { EpisodeStore } from '../stores/episode-store';
export { SpatialIndex } from '../stores/spatial-index';
export { RoomManager } from '../stores/room-manager';
export { DynamicRoomManager } from '../stores/dynamic-room-manager';
export { MemoryRoomMapping } from '../stores/memory-room-mapping';

// StorageService
export { StorageService } from '../stores/storage-service';
export type { StorageServiceConfig } from '../stores/storage-service';

// Interface re-exports for convenience
export type { ICacheManager } from './types';
export type { IVectorStore } from './types';
export type { ISQLiteMetaStore } from './types';
export type { IMetaStore } from '../../../core/ports/storage';
export type { IPalaceStore } from './types';
export type { IGraphStore } from './types';
export type { IEpisodeStore } from './types';

// Interface exports (new abstraction layer)
export type {
  IStorageBackend,
  IVectorStorageBackend,
  IGraphStorageBackend,
  QueryCondition,
  SearchOptions,
  SearchResult,
  StorageStats,
  StorageOperation,
  VectorStorageMetadata,
  VectorItem,
  GraphNode,
  GraphEdge,
  RelatedNode,
  GraphStats,
} from './interfaces';

// Backends (from backends/ subdirectory)
export { FileSystemBackend } from '../backends/filesystem-backend';
export type { FileSystemBackendConfig } from '../backends/filesystem-backend';
export { SQLiteBackend } from '../backends/sqlite-backend';
export type { SQLiteBackendConfig } from '../backends/sqlite-backend';
export { LanceDBBackend } from '../backends/lancedb-backend';
export type { LanceDBBackendConfig } from '../backends/lancedb-backend';

// MemoryAccessControl exports
export { MemoryAccessControl } from '../../security/memory-access-control';
export type {
  MemoryAccessControlConfig,
  AccessLevel,
  AccessPrincipalType,
  AccessPrincipal,
  AccessPolicy,
  AccessCondition,
  AccessDecision,
} from '../../security/memory-access-control';

// IndexUpdateStrategy exports
export { IndexUpdateStrategy } from '../../indexing/index-update-strategy';
export type {
  IndexUpdateStrategyConfig,
  IndexUpdateMode,
  IndexPriority,
  IndexUpdateTask,
} from '../../indexing/index-update-strategy';

// StorageMigration exports
export { StorageMigration, quickMigrate } from './migration';
export type { MigrationConfig, MigrationResult } from './migration';