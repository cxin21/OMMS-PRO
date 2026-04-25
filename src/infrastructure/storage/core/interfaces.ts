/**
 * Storage Backend Interfaces
 * @module storage/interfaces
 *
 * Defines the pluggable storage backend interface layer for OMMS-PRO
 */

// ============================================================
// Base Storage Interface
// ============================================================

export interface IStorageBackend {
  initialize(): Promise<void>;
  close(): Promise<void>;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  getMany<T>(keys: string[]): Promise<Map<string, T>>;
  setMany<T>(items: Map<string, T>): Promise<void>;
  deleteMany(keys: string[]): Promise<void>;
  query(condition: QueryCondition): Promise<string[]>;
  search(options: SearchOptions): Promise<SearchResult[]>;
  getStats(): Promise<StorageStats>;
  supports(operation: StorageOperation): boolean;
}

// ============================================================
// Query & Search Types
// ============================================================

export interface QueryCondition {
  scope?: string;
  agentId?: string;
  type?: string;
  tags?: string[];
  timeRange?: { start: number; end: number };
  limit?: number;
  offset?: number;
  orderBy?: 'importance' | 'time' | 'scope';
  orderDir?: 'asc' | 'desc';
}

export interface SearchOptions {
  queryVector?: number[];
  queryText?: string;
  limit: number;
  minScore?: number;
  filters?: {
    uids?: string[];
    agentId?: string;
    scope?: string;
    type?: string;
    tags?: string[];
  };
}

export interface SearchResult {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface StorageStats {
  totalItems: number;
  totalSize: number;
  lastUpdated: number;
}

export type StorageOperation = 'vector_search' | 'full_text_search' | 'transaction' | 'batch_operations';

// ============================================================
// Vector Storage Interface
// ============================================================

export interface IVectorStorageBackend extends IStorageBackend {
  addVector(id: string, vector: number[], metadata?: VectorStorageMetadata): Promise<void>;
  addVectors(vectors: VectorItem[]): Promise<void>;
  deleteVector(id: string): Promise<void>;
  deleteVectors(ids: string[]): Promise<void>;
  searchNearest(queryVector: number[], options: SearchOptions): Promise<SearchResult[]>;
  updateVector(id: string, vector: number[]): Promise<void>;
  getDimension(): number;
  rebuildIndex(): Promise<void>;
}

export interface VectorStorageMetadata {
  uid: string;
  agentId: string;
  sessionId?: string;
  scope: string;
  type: string;
  importanceScore: number;
  scopeScore: number;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  palaceRef: string;
  version: number;
  isLatestVersion: boolean;
  versionGroupId?: string;
  summary?: string;
}

export interface VectorItem {
  id: string;
  vector: number[];
  metadata?: VectorStorageMetadata;
}

// ============================================================
// Graph Storage Interface
// ============================================================

export interface IGraphStorageBackend extends IStorageBackend {
  addNode(node: GraphNode): Promise<void>;
  addEdge(edge: GraphEdge): Promise<void>;
  deleteNode(nodeId: string): Promise<void>;
  deleteEdge(edgeId: string): Promise<void>;
  getNode(nodeId: string): Promise<GraphNode | null>;
  getEdge(edgeId: string): Promise<GraphEdge | null>;
  getNodeEdges(nodeId: string): Promise<GraphEdge[]>;
  findRelated(nodeId: string, maxResults: number): Promise<RelatedNode[]>;
  updateEdgeWeight(edgeId: string, weight: number): Promise<void>;
  getGraphStats(): Promise<GraphStats>;
}

export interface GraphNode {
  id: string;
  type: 'memory' | 'entity' | 'concept';
  label: string;
  properties: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: string;
  weight: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface RelatedNode {
  uid: string;
  relation: string;
  weight: number;
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  avgDegree: number;
}
