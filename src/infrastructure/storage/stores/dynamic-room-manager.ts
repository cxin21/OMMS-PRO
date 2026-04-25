/**
 * DynamicRoomManager - 动态 Room 管理器
 *
 * 根据记忆内容自动进行 Room 聚类
 * - 推荐合适的 Room 给新记忆
 * - 合并过小的 Room
 * - 拆分过大的 Room
 *
 * @module storage/dynamic-room-manager
 */

import { createLogger } from '../../../shared/logging';
import type { ILogger } from '../../../shared/logging';

export interface DynamicRoomManagerConfig {
  /** 合并阈值：记忆数低于此值则合并 */
  mergeThreshold: number;
  /** 拆分阈值：记忆数高于此值则考虑拆分 */
  splitThreshold: number;
  /** 推荐 Room 数量上限 */
  maxRecommendations: number;
  /** 相似度阈值：低于此值不推荐 */
  similarityThreshold: number;
  /** 是否启用自动合并/拆分 */
  autoManage: boolean;
}

export interface RoomRecommendation {
  roomId: string;
  roomName: string;
  similarity: number;
  reason: string;
}

export interface MergeResult {
  success: boolean;
  mergedRoomId: string;
  absorbedRoomIds: string[];
  memoryCount: number;
}

export interface SplitResult {
  success: boolean;
  originalRoomId: string;
  newRoomIds: string[];
  memoryDistribution: number[];
}

export interface RoomStats {
  roomId: string;
  memoryCount: number;
  avgImportance: number;
  lastUpdated: number;
  members: string[];
}

export interface Room {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  embeddings: number[];
}

/**
 * DynamicRoomManager
 *
 * 维护 Room 列表及其成员，实现基于内容语义的 Room 推荐和管理
 */
export class DynamicRoomManager {
  private logger: ILogger;
  private rooms: Map<string, Room> = new Map();
  private roomMembers: Map<string, Set<string>> = new Map();

  constructor(
    private embeddingService: (text: string) => Promise<number[]>,
    private config: DynamicRoomManagerConfig
  ) {
    this.logger = createLogger('DynamicRoomManager');
  }

  /**
   * 根据记忆内容推荐合适的 Room
   *
   * 1. 将 content 转换为嵌入向量
   * 2. 计算与所有现有 Room 嵌入的余弦相似度
   * 3. 返回相似度最高的 Room 列表
   */
  async recommendRooms(content: string, limit?: number): Promise<RoomRecommendation[]> {
    try {
      // 1. Get content embedding
      const contentEmbedding = await this.embeddingService(content);

      // 2. Calculate similarity with each room
      const recommendations: RoomRecommendation[] = [];

      for (const [roomId, room] of this.rooms) {
        const similarity = this.cosineSimilarity(contentEmbedding, room.embeddings);

        if (similarity >= this.config.similarityThreshold) {
          recommendations.push({
            roomId,
            roomName: room.name,
            similarity,
            reason: `内容与 "${room.name}" 主题相关度 ${(similarity * 100).toFixed(1)}%`
          });
        }
      }

      // 3. Sort by similarity and limit
      recommendations.sort((a, b) => b.similarity - a.similarity);
      const maxRecs = limit ?? this.config.maxRecommendations;

      this.logger.debug('Room recommendations generated', {
        contentLength: content.length,
        recommendationsCount: recommendations.length
      });

      return recommendations.slice(0, maxRecs);
    } catch (error) {
      this.logger.error('Failed to recommend rooms', { error: String(error) });
      return [];
    }
  }

  /**
   * 合并过小的 Room
   *
   * 当 Room 记忆数低于阈值时触发
   * 1. 收集所有要合并的 Room 的成员
   * 2. 创建新的合并 Room（保留第一个 Room 的 ID）
   * 3. 删除被吸收的 Room
   */
  async mergeRooms(roomIds: string[]): Promise<MergeResult> {
    if (roomIds.length < 2) {
      this.logger.warn('Cannot merge less than 2 rooms', { roomIds });
      return { success: false, mergedRoomId: '', absorbedRoomIds: [], memoryCount: 0 };
    }

    try {
      // Collect all members from all rooms
      const allMembers: string[] = [];
      for (const roomId of roomIds) {
        const members = this.roomMembers.get(roomId);
        if (members) {
          allMembers.push(...members);
        }
      }

      // Check if merge threshold is met
      if (allMembers.length < this.config.mergeThreshold) {
        this.logger.info('Room merge skipped - below threshold', {
          memoryCount: allMembers.length,
          threshold: this.config.mergeThreshold
        });
        return { success: false, mergedRoomId: '', absorbedRoomIds: [], memoryCount: 0 };
      }

      // Create new merged room (keep first roomId as the primary)
      const mergedRoomId = roomIds[0];
      this.roomMembers.set(mergedRoomId, new Set(allMembers));

      // Update merged room's timestamp
      const mergedRoom = this.rooms.get(mergedRoomId);
      if (mergedRoom) {
        mergedRoom.createdAt = Date.now();
      }

      // Remove absorbed rooms
      const absorbedRoomIds: string[] = [];
      for (let i = 1; i < roomIds.length; i++) {
        this.roomMembers.delete(roomIds[i]);
        this.rooms.delete(roomIds[i]);
        absorbedRoomIds.push(roomIds[i]);
      }

      this.logger.info('Rooms merged successfully', {
        mergedRoomId,
        absorbedRoomIds,
        memoryCount: allMembers.length
      });

      return {
        success: true,
        mergedRoomId,
        absorbedRoomIds,
        memoryCount: allMembers.length
      };
    } catch (error) {
      this.logger.error('Failed to merge rooms', { error: String(error), roomIds });
      return { success: false, mergedRoomId: '', absorbedRoomIds: [], memoryCount: 0 };
    }
  }

  /**
   * 拆分过大的 Room
   *
   * 当 Room 记忆数高于阈值时触发
   * 使用简单的轮询分配算法将成员分散到新 Room
   */
  async splitRoom(roomId: string): Promise<SplitResult> {
    const members = this.roomMembers.get(roomId);

    if (!members || members.size < this.config.splitThreshold) {
      this.logger.debug('Room split skipped - below threshold', {
        roomId,
        memoryCount: members?.size ?? 0,
        threshold: this.config.splitThreshold
      });
      return { success: false, originalRoomId: roomId, newRoomIds: [], memoryDistribution: [] };
    }

    try {
      const memberArray = Array.from(members);

      // Calculate number of splits needed
      const numSplits = Math.ceil(memberArray.length / this.config.splitThreshold);

      // Create new rooms
      const newRoomIds: string[] = [];
      const memoryDistribution: number[] = [];
      const originalRoom = this.rooms.get(roomId);

      for (let i = 0; i < numSplits; i++) {
        const newRoomId = `${roomId}_split_${i}`;
        newRoomIds.push(newRoomId);

        // Create new room with slight offset embedding
        const newRoom: Room = {
          id: newRoomId,
          name: `${originalRoom?.name ?? 'Room'} 分组 ${i + 1}`,
          description: `从 ${roomId} 拆分`,
          createdAt: Date.now(),
          embeddings: originalRoom?.embeddings ?? []
        };
        this.rooms.set(newRoomId, newRoom);

        // Initialize member set
        this.roomMembers.set(newRoomId, new Set());
        memoryDistribution.push(0);
      }

      // Redistribute members (round-robin)
      for (let i = 0; i < memberArray.length; i++) {
        const targetRoomIdx = i % numSplits;
        const targetRoom = newRoomIds[targetRoomIdx];
        this.roomMembers.get(targetRoom)!.add(memberArray[i]);
        memoryDistribution[targetRoomIdx]++;
      }

      // Remove original room
      this.roomMembers.delete(roomId);
      this.rooms.delete(roomId);

      this.logger.info('Room split successfully', {
        originalRoomId: roomId,
        newRoomIds,
        memoryDistribution
      });

      return {
        success: true,
        originalRoomId: roomId,
        newRoomIds,
        memoryDistribution
      };
    } catch (error) {
      this.logger.error('Failed to split room', { error: String(error), roomId });
      return { success: false, originalRoomId: roomId, newRoomIds: [], memoryDistribution: [] };
    }
  }

  /**
   * 获取 Room 统计信息
   */
  async getRoomStats(roomId: string): Promise<RoomStats | null> {
    const room = this.rooms.get(roomId);
    const members = this.roomMembers.get(roomId);

    if (!room || !members) {
      return null;
    }

    return {
      roomId,
      memoryCount: members.size,
      avgImportance: 0,  // Would need to query metaStore for actual importance
      lastUpdated: room.createdAt,
      members: Array.from(members)
    };
  }

  /**
   * 获取所有 Room 列表
   */
  async getAllRooms(): Promise<Room[]> {
    return Array.from(this.rooms.values());
  }

  /**
   * 添加一个新的 Room
   */
  addRoom(room: Room): void {
    this.rooms.set(room.id, room);
    if (!this.roomMembers.has(room.id)) {
      this.roomMembers.set(room.id, new Set());
    }
    this.logger.debug('Room added', { roomId: room.id, roomName: room.name });
  }

  /**
   * 将记忆添加到 Room
   */
  addMemberToRoom(roomId: string, memoryId: string): void {
    if (!this.roomMembers.has(roomId)) {
      this.roomMembers.set(roomId, new Set());
    }
    this.roomMembers.get(roomId)!.add(memoryId);
  }

  /**
   * 从 Room 移除记忆
   */
  removeMemberFromRoom(roomId: string, memoryId: string): void {
    this.roomMembers.get(roomId)?.delete(memoryId);
  }

  /**
   * 检查 Room 是否存在
   */
  hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  /**
   * 获取 Room 成员数量
   */
  getMemberCount(roomId: string): number {
    return this.roomMembers.get(roomId)?.size ?? 0;
  }

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) {
      return 0;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator > 0 ? dot / denominator : 0;
  }
}
