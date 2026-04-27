/**
 * Spatial Index - 空间索引
 * @module storage/spatial-index
 *
 * 版本: v1.0.0
 *
 * 核心功能：
 * - 将记忆的向量嵌入映射到 3D 心理空间
 * - 支持空间邻居检索
 * - 基于语义相似度自动布局
 *
 * 关联组件：
 * - VectorStore: 获取向量进行降维
 * - PalaceStore: 存储位置与 Palace 路径对应
 * - EpisodeStore: 情景内的空间组织
 */

import { createServiceLogger, type ILogger } from '../../../shared/logging';
import { config } from '../../../shared/config';

export interface SpatialIndexConfig {
  enabled: boolean;
  dimensions: 2 | 3;                      // 2D 或 3D
  maxNeighbors: number;                   // 最大空间邻居数
  clusteringThreshold: number;             // 聚类阈值
  autoLayout: boolean;                    // 是否自动布局
  layoutRefreshThreshold: number;          // 触发重新布局的新记忆数量
  defaultRadius: number;                  // 默认搜索半径
  enableSpatialRecall: boolean;           // 是否启用空间召回
}

interface SpatialRecord {
  memoryUid: string;
  coordinates: number[];    // 3D 坐标 [x, y, z]
  palaceRef: string;
  episodeId?: string;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// SpatialIndex 主类
// ============================================================================

export class SpatialIndex {
  private logger: ILogger;
  private config: SpatialIndexConfig;
  private records: Map<string, SpatialRecord>;  // memoryUid -> SpatialRecord
  private episodeMembers: Map<string, Set<string>>;  // episodeId -> Set<memoryUid>
  private dirty: boolean = false;  // 是否有未保存的更改

  constructor(userConfig: Partial<SpatialIndexConfig> = {}) {
    this.logger = createServiceLogger('SpatialIndex');
    this.config = {
      enabled: true,
      dimensions: 3,
      maxNeighbors: 10,
      clusteringThreshold: 0.8,
      autoLayout: true,
      layoutRefreshThreshold: 100,
      defaultRadius: 5,
      enableSpatialRecall: true,
      ...userConfig,
    };
    this.records = new Map();
    this.episodeMembers = new Map();
  }

  // ============================================================
  // 公共接口
  // ============================================================

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    // 从 ConfigManager 读取空间索引配置
    const spatialConfig = config.getConfigOrThrow<SpatialIndexConfig>('memoryService.spatial');
    this.config = { ...this.config, ...spatialConfig };

    this.logger.info('SpatialIndex initialized', {
      dimensions: this.config.dimensions,
      autoLayout: this.config.autoLayout,
    });
  }

  /**
   * 设置记忆的空间位置
   */
  async setPosition(
    memoryUid: string,
    coordinates: number[],
    palaceRef: string,
    episodeId?: string
  ): Promise<void> {
    const record: SpatialRecord = {
      memoryUid,
      coordinates,
      palaceRef,
      episodeId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.records.set(memoryUid, record);

    if (episodeId) {
      if (!this.episodeMembers.has(episodeId)) {
        this.episodeMembers.set(episodeId, new Set());
      }
      this.episodeMembers.get(episodeId)!.add(memoryUid);
    }

    this.dirty = true;
    this.logger.debug('Spatial position set', { memoryUid, coordinates });
  }

  /**
   * 获取记忆的空间位置
   */
  async getPosition(memoryUid: string): Promise<number[] | null> {
    const record = this.records.get(memoryUid);
    return record ? record.coordinates : null;
  }

  /**
   * 获取记忆的完整空间记录
   */
  async getRecord(memoryUid: string): Promise<SpatialRecord | null> {
    return this.records.get(memoryUid) || null;
  }

  /**
   * 获取空间邻居
   */
  async getSpatialNeighbors(
    memoryUid: string,
    radius?: number,
    limit?: number
  ): Promise<Array<{ uid: string; distance: number; coordinates: number[] }>> {
    const center = await this.getPosition(memoryUid);
    if (!center) return [];

    const searchRadius = radius ?? this.config.defaultRadius;
    const maxNeighbors = limit ?? this.config.maxNeighbors;

    const neighbors: Array<{ uid: string; distance: number; coordinates: number[] }> = [];

    for (const [uid, record] of this.records) {
      if (uid === memoryUid) continue;

      const distance = this.euclideanDistance(center, record.coordinates);
      if (distance <= searchRadius) {
        neighbors.push({
          uid,
          distance,
          coordinates: record.coordinates,
        });
      }
    }

    // 按距离排序
    neighbors.sort((a, b) => a.distance - b.distance);

    return neighbors.slice(0, maxNeighbors);
  }

  /**
   * 获取指定区域内的所有记忆
   */
  async getMemoriesInRegion(
    center: number[],
    radius: number
  ): Promise<Array<{ uid: string; distance: number }>> {
    const results: Array<{ uid: string; distance: number }> = [];

    for (const [uid, record] of this.records) {
      const distance = this.euclideanDistance(center, record.coordinates);
      if (distance <= radius) {
        results.push({ uid, distance });
      }
    }

    results.sort((a, b) => a.distance - b.distance);
    return results;
  }

  /**
   * 根据 Palace 路径获取同一房间内的空间布局
   */
  async getRoomSpatialLayout(palacePrefix: string): Promise<{
    memories: Array<{ uid: string; coordinates: number[]; palaceRef: string }>;
    bounds: { min: number[]; max: number[] };
    center: number[];
  }> {
    const memories: Array<{ uid: string; coordinates: number[]; palaceRef: string }> = [];

    for (const [uid, record] of this.records) {
      if (record.palaceRef.startsWith(palacePrefix)) {
        memories.push({
          uid,
          coordinates: record.coordinates,
          palaceRef: record.palaceRef,
        });
      }
    }

    const bounds = this.calculateBounds(memories.map(m => m.coordinates));
    const center = this.calculateCenter(memories.map(m => m.coordinates));

    return { memories, bounds, center };
  }

  /**
   * 获取情景内的空间布局
   */
  async getEpisodeSpatialLayout(episodeId: string): Promise<{
    memories: Array<{ uid: string; coordinates: number[]; palaceRef: string }>;
    bounds: { min: number[]; max: number[] };
    center: number[];
  }> {
    const memoryUids = this.episodeMembers.get(episodeId);
    if (!memoryUids) {
      return { memories: [], bounds: { min: [0, 0, 0], max: [0, 0, 0] }, center: [0, 0, 0] };
    }

    const memories: Array<{ uid: string; coordinates: number[]; palaceRef: string }> = [];

    for (const uid of memoryUids) {
      const record = this.records.get(uid);
      if (record) {
        memories.push({
          uid,
          coordinates: record.coordinates,
          palaceRef: record.palaceRef,
        });
      }
    }

    const bounds = this.calculateBounds(memories.map(m => m.coordinates));
    const center = this.calculateCenter(memories.map(m => m.coordinates));

    return { memories, bounds, center };
  }

  /**
   * 计算新记忆的空间位置
   *
   * 策略：
   * 1. 找到语义最相近的 K 个记忆
   * 2. 计算它们的空间中心
   * 3. 在中心附近找一个空位
   */
  async calculatePosition(
    newMemoryVector: number[],
    existingVectors: Map<string, number[]>,
    existingPositions: Map<string, number[]>,
    k: number = 5
  ): Promise<number[]> {
    if (existingPositions.size === 0) {
      // 第一个记忆，放在中心
      return [0, 0, 0];
    }

    // Step 1: 找 k 个最相似的记忆
    const similar = this.findMostSimilar(
      newMemoryVector,
      existingVectors,
      existingPositions,
      k
    );

    if (similar.length === 0) {
      // 没有相似的，找一个空的位置
      return await this.findEmptySlot(existingPositions);
    }

    // Step 2: 计算中心位置
    const center = this.calculateCenter(similar.map(s => s.position));

    // Step 3: 在中心附近找一个空位
    const position = await this.findEmptySlotNear(center, existingPositions);

    return position;
  }

  /**
   * 批量重新布局
   * 使用 PCA 降维
   */
  async relayout(
    memoryVectors: Map<string, number[]>
  ): Promise<Map<string, number[]>> {
    if (memoryVectors.size < 2) {
      // 太少了，不需要降维
      const positions = new Map<string, number[]>();
      let i = 0;
      const step = 10;
      for (const uid of memoryVectors.keys()) {
        const x = (i % 10) * step - 50;
        const y = Math.floor(i / 10) * step - 50;
        positions.set(uid, [x, y, 0]);
        i++;
      }
      return positions;
    }

    // Step 1: 构建向量矩阵
    const vectors: number[][] = [];
    const uids: string[] = [];
    for (const [uid, vec] of memoryVectors) {
      vectors.push(vec);
      uids.push(uid);
    }

    // Step 2: PCA 降维到 3D
    const positions = this.pcaReduce(vectors, this.config.dimensions);

    // Step 3: 确保位置分散开
    const spreadPositions = this.spreadPositions(positions);

    // 返回映射
    const result = new Map<string, number[]>();
    for (let i = 0; i < uids.length; i++) {
      result.set(uids[i], spreadPositions[i]);
    }

    this.logger.info('Spatial layout refreshed', { count: result.size });

    return result;
  }

  /**
   * 删除记忆的空间记录
   */
  async remove(memoryUid: string): Promise<void> {
    const record = this.records.get(memoryUid);
    if (record) {
      if (record.episodeId) {
        this.episodeMembers.get(record.episodeId)?.delete(memoryUid);
      }
      this.records.delete(memoryUid);
      this.dirty = true;
    }
  }

  /**
   * 更新记忆的情景关联
   */
  async updateEpisode(memoryUid: string, episodeId: string): Promise<void> {
    const record = this.records.get(memoryUid);
    if (record) {
      // 从旧情景移除
      if (record.episodeId && record.episodeId !== episodeId) {
        this.episodeMembers.get(record.episodeId)?.delete(memoryUid);
      }

      // 添加到新情景
      if (!this.episodeMembers.has(episodeId)) {
        this.episodeMembers.set(episodeId, new Set());
      }
      this.episodeMembers.get(episodeId)!.add(memoryUid);

      record.episodeId = episodeId;
      record.updatedAt = Date.now();
      this.dirty = true;
    }
  }

  /**
   * 获取所有空间记录
   */
  async getAllRecords(): Promise<SpatialRecord[]> {
    return Array.from(this.records.values());
  }

  /**
   * 检查是否有未保存的更改
   */
  hasUnsavedChanges(): boolean {
    return this.dirty;
  }

  /**
   * 标记为已保存
   */
  markAsSaved(): void {
    this.dirty = false;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalMemories: number;
    episodes: number;
    avgMemoriesPerEpisode: number;
  } {
    return {
      totalMemories: this.records.size,
      episodes: this.episodeMembers.size,
      avgMemoriesPerEpisode: this.episodeMembers.size > 0
        ? this.records.size / this.episodeMembers.size
        : 0,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SpatialIndexConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('SpatialIndex config updated', this.config as unknown as Record<string, unknown>);
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 找最相似的 K 个记忆
   */
  private findMostSimilar(
    targetVector: number[],
    existingVectors: Map<string, number[]>,
    existingPositions: Map<string, number[]>,
    k: number
  ): Array<{ uid: string; position: number[]; similarity: number }> {
    const results: Array<{ uid: string; position: number[]; similarity: number }> = [];

    for (const [uid, vec] of existingVectors) {
      if (!existingPositions.has(uid)) continue;

      const similarity = this.cosineSimilarity(targetVector, vec);
      results.push({
        uid,
        position: existingPositions.get(uid)!,
        similarity,
      });
    }

    // 按相似度排序
    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, k);
  }

  /**
   * 计算欧几里得距离
   */
  private euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length && i < b.length; i++) {
      sum += Math.pow(a[i] - b[i], 2);
    }
    return Math.sqrt(sum);
  }

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length && i < b.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  /**
   * 计算中心点
   */
  private calculateCenter(positions: number[][]): number[] {
    if (positions.length === 0) {
      return [0, 0, 0];
    }

    const dims = positions[0].length;
    const center: number[] = new Array(dims).fill(0);

    for (const pos of positions) {
      for (let i = 0; i < dims; i++) {
        center[i] += pos[i];
      }
    }

    for (let i = 0; i < dims; i++) {
      center[i] /= positions.length;
    }

    return center;
  }

  /**
   * 计算边界
   */
  private calculateBounds(positions: number[][]): { min: number[]; max: number[] } {
    if (positions.length === 0) {
      return { min: [0, 0, 0], max: [0, 0, 0] };
    }

    const dims = positions[0].length;
    const min: number[] = new Array(dims).fill(Infinity);
    const max: number[] = new Array(dims).fill(-Infinity);

    for (const pos of positions) {
      for (let i = 0; i < dims; i++) {
        min[i] = Math.min(min[i], pos[i]);
        max[i] = Math.max(max[i], pos[i]);
      }
    }

    return { min, max };
  }

  /**
   * 找空位
   */
  private async findEmptySlot(
    existingPositions: Map<string, number[]>
  ): Promise<number[]> {
    // 简单实现：找一个距离所有现有位置都足够远的位置
    const step = 10;
    const maxAttempts = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // 螺旋搜索
      const angle = attempt * 0.5;
      const radius = step * (1 + Math.floor(attempt / 20));
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const z = (Math.random() - 0.5) * 20;  // 轻微的 z 轴随机性

      const candidate: number[] = [x, y, z];

      // 检查是否距离所有现有位置足够远
      let isEmpty = true;
      for (const [, pos] of existingPositions) {
        if (this.euclideanDistance(candidate, pos) < step) {
          isEmpty = false;
          break;
        }
      }

      if (isEmpty) {
        return candidate;
      }
    }

    // 没找到，返回一个随机位置
    return [Math.random() * 100 - 50, Math.random() * 100 - 50, 0];
  }

  /**
   * 找附近空位
   */
  private async findEmptySlotNear(
    center: number[],
    existingPositions: Map<string, number[]>
  ): Promise<number[]> {
    const searchRadius = 20;
    const step = 2;
    const maxAttempts = 100;

    for (let i = 0; i < maxAttempts; i++) {
      // 在球面上搜索
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = searchRadius * Math.random();

      const candidate: number[] = [
        center[0] + r * Math.sin(phi) * Math.cos(theta),
        center[1] + r * Math.sin(phi) * Math.sin(theta),
        center[2] + r * Math.cos(phi),
      ];

      // 检查是否距离足够远
      let isEmpty = true;
      for (const [, pos] of existingPositions) {
        if (this.euclideanDistance(candidate, pos) < step) {
          isEmpty = false;
          break;
        }
      }

      if (isEmpty) {
        return candidate;
      }
    }

    // 没找到，返回中心点
    return center;
  }

  /**
   * PCA 降维
   */
  private pcaReduce(vectors: number[][], targetDims: number): number[][] {
    const n = vectors.length;
    const originalDims = vectors[0].length;

    if (n <= targetDims) {
      // 数据点太少，直接返回原向量
      return vectors.map(v => [...v, ...new Array(targetDims - originalDims).fill(0)]);
    }

    // Step 1: 计算均值
    const mean: number[] = new Array(originalDims).fill(0);
    for (const vec of vectors) {
      for (let i = 0; i < originalDims; i++) {
        mean[i] += vec[i];
      }
    }
    for (let i = 0; i < originalDims; i++) {
      mean[i] /= n;
    }

    // Step 2: 中心化
    const centered: number[][] = vectors.map(vec =>
      vec.map((v, i) => v - mean[i])
    );

    // Step 3: 计算协方差矩阵 (简化版：直接用 SVD)
    // 这里使用幂迭代法求主成分
    const components: number[][] = [];

    for (let c = 0; c < targetDims; c++) {
      // 随机初始化方向
      let direction = new Array(originalDims).fill(0).map(() => Math.random() - 0.5);
      direction = this.normalize(direction);

      // 幂迭代
      for (let iter = 0; iter < 100; iter++) {
        // 计算 A @ direction
        const projected: number[] = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
          let sum = 0;
          for (let j = 0; j < originalDims; j++) {
            sum += centered[i][j] * direction[j];
          }
          projected[i] = sum;
        }

        // 计算 A^T @ projected
        const newDirection: number[] = new Array(originalDims).fill(0);
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < originalDims; j++) {
            newDirection[j] += centered[i][j] * projected[i];
          }
        }

        // 正交化（减去之前的成分）
        for (const comp of components) {
          const dot = this.dot(newDirection, comp);
          for (let i = 0; i < originalDims; i++) {
            newDirection[i] -= dot * comp[i];
          }
        }

        // 归一化
        direction = this.normalize(newDirection);
      }

      components.push(direction);

      // 投影并减去该成分
      for (let i = 0; i < n; i++) {
        const dot = this.dot(centered[i], direction);
        for (let j = 0; j < originalDims; j++) {
          centered[i][j] -= dot * direction[j];
        }
      }
    }

    // Step 4: 投影到新空间
    const result: number[][] = [];
    for (const vec of vectors) {
      const projected: number[] = [];
      for (const comp of components) {
        projected.push(this.dot(vec, comp));
      }
      // 填充到 3D
      while (projected.length < targetDims) {
        projected.push(0);
      }
      result.push(projected);
    }

    return result;
  }

  /**
   * 归一化向量
   */
  private normalize(vec: number[]): number[] {
    const norm = Math.sqrt(this.dot(vec, vec));
    if (norm === 0) return vec;
    return vec.map(v => v / norm);
  }

  /**
   * 点积
   */
  private dot(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length && i < b.length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  /**
   * 分散位置（避免重叠）
   */
  private spreadPositions(positions: number[][]): number[][] {
    if (positions.length < 2) return positions;

    const minDist = 5;  // 最小距离
    let iterations = 0;
    const maxIterations = 50;

    while (iterations < maxIterations) {
      let hasOverlap = false;

      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const dist = this.euclideanDistance(positions[i], positions[j]);
          if (dist < minDist) {
            // 推开
            const diff: number[] = [];
            for (let k = 0; k < positions[i].length; k++) {
              diff.push(positions[i][k] - positions[j][k]);
            }
            const push = (minDist - dist) / 2;
            const norm = Math.sqrt(this.dot(diff, diff)) || 1;
            for (let k = 0; k < positions[i].length; k++) {
              positions[i][k] += (diff[k] / norm) * push;
              positions[j][k] -= (diff[k] / norm) * push;
            }
            hasOverlap = true;
          }
        }
      }

      if (!hasOverlap) break;
      iterations++;
    }

    return positions;
  }
}
