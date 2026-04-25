import type { IVectorStorageBackend, VectorStorageMetadata, VectorItem, SearchOptions, SearchResult, QueryCondition } from '../core/interfaces';
import type { VectorDocument } from '../core/types';
import type { MemoryScope, MemoryType } from '../../../core/types/memory';
import { VectorStore } from '../stores/vector-store';

export class VectorStoreAdapter implements IVectorStorageBackend {
  constructor(private vectorStore: VectorStore) {}

  async initialize(): Promise<void> { await this.vectorStore.initialize(); }
  async close(): Promise<void> { /* no-op */ }
  getDimension(): number {
    // VectorStore stores dimensions in private config - access via type-safe cast
    const store = this.vectorStore as unknown as { config: { dimensions: number } };
    return store.config.dimensions;
  }

  async addVector(id: string, vector: number[], metadata?: VectorStorageMetadata): Promise<void> {
    try {
      // VectorStore.store expects VectorDocument with fully typed VectorMetadata
      const doc: VectorDocument = {
        id,
        vector,
        text: metadata?.summary ?? '',
        metadata: {
          uid: id,
          agentId: metadata?.agentId ?? '',
          sessionId: metadata?.sessionId,
          scope: (metadata?.scope as MemoryScope) ?? 'memory' as MemoryScope,
          type: (metadata?.type as MemoryType) ?? 'episodic' as MemoryType,
          importanceScore: metadata?.importanceScore ?? 0,
          scopeScore: metadata?.scopeScore ?? 0,
          tags: metadata?.tags ?? [],
          createdAt: metadata?.createdAt ?? Date.now(),
          palaceRef: metadata?.palaceRef ?? '',
          version: metadata?.version ?? 1,
          isLatestVersion: metadata?.isLatestVersion ?? true,
          versionGroupId: metadata?.versionGroupId ?? id
        }
      };
      await this.vectorStore.store(doc);
    } catch (error) {
      throw new Error(`Failed to add vector ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async addVectors(vectors: VectorItem[]): Promise<void> {
    try {
      for (const v of vectors) await this.addVector(v.id, v.vector, v.metadata);
    } catch (error) {
      throw new Error(`Failed to add vectors batch: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async deleteVector(id: string): Promise<void> {
    try {
      await this.vectorStore.delete(id);
    } catch (error) {
      throw new Error(`Failed to delete vector ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async deleteVectors(ids: string[]): Promise<void> {
    for (const id of ids) await this.deleteVector(id);
  }
  async updateVector(id: string, vector: number[]): Promise<void> {
    // No-op: VectorStore does not support updating vectors, only metadata
    // Vector metadata updates should go through VectorStore.store() with the same id
  }
  async searchNearest(queryVector: number[], options: SearchOptions): Promise<SearchResult[]> {
    try {
      // Convert SearchOptions.filters to VectorSearchOptions.filters
      // SearchOptions uses string types while VectorSearchOptions uses MemoryScope/MemoryType enums
      const filters = options.filters ? {
        agentId: options.filters.agentId,
        scope: (options.filters.scope as MemoryScope) ?? undefined,
        type: (options.filters.type as MemoryType) ?? undefined,
        tags: options.filters.tags,
        uids: options.filters.uids
      } : undefined;

      const vectorResults = await this.vectorStore.search({
        query: '',
        queryVector,
        limit: options.limit,
        minScore: options.minScore,
        filters
      });

      // Convert VectorSearchResult[] to SearchResult[] by mapping metadata to a plain object
      return vectorResults.map(vr => ({
        id: vr.id,
        score: vr.score,
        metadata: { ...vr.metadata } as Record<string, unknown>
      }));
    } catch (error) {
      throw new Error(`Failed to search vectors: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async search(options: SearchOptions): Promise<SearchResult[]> {
    if (options.queryVector) return this.searchNearest(options.queryVector, options);
    return [];
  }
  async rebuildIndex(): Promise<void> { /* no-op */ }

  // IStorageBackend methods (not natively supported, return defaults)
  async get<T>(key: string): Promise<T | null> { return null; }
  async set<T>(key: string, value: T): Promise<void> { /* no-op */ }
  async delete(key: string): Promise<void> { await this.deleteVector(key); }
  async getMany<T>(keys: string[]): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    try {
      for (const id of keys) {
        const item = await this.vectorStore.getById(id);
        if (item) results.set(id, item as T);
      }
    } catch (error) {
      throw new Error(`Failed to get vectors: ${error instanceof Error ? error.message : String(error)}`);
    }
    return results;
  }
  async setMany<T>(items: Map<string, T>): Promise<void> { /* no-op */ }
  async deleteMany(keys: string[]): Promise<void> { await this.deleteVectors(keys); }
  async query(condition: QueryCondition): Promise<string[]> {
    // No-op: VectorStore does not support query-based filtering, only vector search
    return [];
  }
  async getStats(): Promise<{ totalItems: number; totalSize: number; lastUpdated: number }> {
    // No-op: VectorStore does not maintain size statistics
    return { totalItems: 0, totalSize: 0, lastUpdated: Date.now() };
  }
  supports(operation: string): boolean {
    return ['vector_search', 'batch_operations'].includes(operation);
  }
}