/**
 * RoomManager - Room 统一管理器
 *
 * 整合 DynamicRoomManager 和 MemoryRoomMapping
 * 提供统一的 Room 管理接口
 *
 * @module storage/room-manager
 */

import { createServiceLogger } from '../../../shared/logging';
import type { ILogger } from '../../../shared/logging';
import { config } from '../../../shared/config';

import { DynamicRoomManager, type DynamicRoomManagerConfig, type RoomRecommendation, type MergeResult, type SplitResult, type RoomStats, type Room } from './dynamic-room-manager';
import { MemoryRoomMapping, type MemoryRoomMappingConfig } from './memory-room-mapping';

// Re-export types for external use
export type {
  RoomRecommendation,
  MergeResult,
  SplitResult,
  RoomStats,
  Room,
};

export interface RoomManagerConfig {
  /** 是否启用自动分配 Room */
  autoAssignRooms: boolean;
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
  /** 记忆最大关联 Room 数量 */
  maxRoomsPerMemory: number;
  /** Room 最大关联记忆数量 */
  maxMemoriesPerRoom: number;
  /** 自动清理孤立的关联 */
  autoCleanupOrphaned: boolean;
}

interface RoomManagerConfigFromFile {
  enabled?: boolean;
  autoAssignRooms?: boolean;
  mergeThreshold?: number;
  splitThreshold?: number;
  maxRecommendations?: number;
  similarityThreshold?: number;
  autoManage?: boolean;
  maxRoomsPerMemory?: number;
  maxMemoriesPerRoom?: number;
  autoCleanupOrphaned?: boolean;
}

export interface RoomWithMembership extends Room {
  memberCount: number;
}

export interface RoomManagerStats {
  totalRooms: number;
  totalMemoryAssociations: number;
  totalRoomAssociations: number;
  avgRoomsPerMemory: number;
  avgMemoriesPerRoom: number;
  smallRooms: number;  // Rooms below merge threshold
  largeRooms: number;  // Rooms above split threshold
}

/**
 * RoomManager - Room 统一管理器
 *
 * 整合 DynamicRoomManager（Room 聚类管理）和 MemoryRoomMapping（记忆-Room 映射）
 */
export class RoomManager {
  private logger: ILogger;
  private dynamicRoomManager: DynamicRoomManager;
  private memoryRoomMapping: MemoryRoomMapping;
  private config: RoomManagerConfig;
  private initialized: boolean = false;

  constructor(
    embeddingService: (text: string) => Promise<number[]>,
    config?: Partial<RoomManagerConfig>
  ) {
    this.logger = createServiceLogger('RoomManager');

    // Load configuration from ConfigManager
    const fileConfig = this.loadConfig();

    this.config = {
      autoAssignRooms: config?.autoAssignRooms ?? fileConfig.autoAssignRooms ?? false,
      mergeThreshold: config?.mergeThreshold ?? fileConfig.mergeThreshold ?? 10,
      splitThreshold: config?.splitThreshold ?? fileConfig.splitThreshold ?? 100,
      maxRecommendations: config?.maxRecommendations ?? fileConfig.maxRecommendations ?? 5,
      similarityThreshold: config?.similarityThreshold ?? fileConfig.similarityThreshold ?? 0.6,
      autoManage: config?.autoManage ?? fileConfig.autoManage ?? false,
      maxRoomsPerMemory: config?.maxRoomsPerMemory ?? fileConfig.maxRoomsPerMemory ?? 5,
      maxMemoriesPerRoom: config?.maxMemoriesPerRoom ?? fileConfig.maxMemoriesPerRoom ?? 1000,
      autoCleanupOrphaned: config?.autoCleanupOrphaned ?? fileConfig.autoCleanupOrphaned ?? true,
    };

    // Initialize DynamicRoomManager
    const dynamicConfig: DynamicRoomManagerConfig = {
      mergeThreshold: this.config.mergeThreshold,
      splitThreshold: this.config.splitThreshold,
      maxRecommendations: this.config.maxRecommendations,
      similarityThreshold: this.config.similarityThreshold,
      autoManage: this.config.autoManage,
    };
    this.dynamicRoomManager = new DynamicRoomManager(embeddingService, dynamicConfig);

    // Initialize MemoryRoomMapping
    const mappingConfig: MemoryRoomMappingConfig = {
      maxRoomsPerMemory: this.config.maxRoomsPerMemory,
      maxMemoriesPerRoom: this.config.maxMemoriesPerRoom,
      autoCleanupOrphaned: this.config.autoCleanupOrphaned,
    };
    this.memoryRoomMapping = new MemoryRoomMapping(mappingConfig);

    this.logger.info('RoomManager created', {
      autoAssignRooms: this.config.autoAssignRooms,
      autoManage: this.config.autoManage,
      mergeThreshold: this.config.mergeThreshold,
      splitThreshold: this.config.splitThreshold,
    });
  }

  /**
   * 从配置文件加载配置
   */
  private loadConfig(): RoomManagerConfigFromFile {
    try {
      if (config.isInitialized()) {
        const roomManagerConfig = config.getConfig<RoomManagerConfigFromFile>('roomManager');
        return roomManagerConfig || {};
      }
    } catch {
      // Config not initialized, use defaults
    }
    return {};
  }

  /**
   * 初始化 RoomManager
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('RoomManager already initialized');
      return;
    }

    this.logger.info('RoomManager initializing');
    this.initialized = true;
    this.logger.info('RoomManager initialized');
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 关闭 RoomManager
   */
  async close(): Promise<void> {
    if (!this.initialized) {
      return;
    }
    this.logger.info('RoomManager closing');
    // Cleanup orphaned associations before closing
    if (this.config.autoCleanupOrphaned) {
      try {
        // Note: This requires validMemoryIds and validRoomIds which we don't have here
        // The actual cleanup should be called explicitly before close
        this.logger.debug('RoomManager cleanup skipped - call cleanupOrphaned explicitly');
      } catch (error) {
        this.logger.warn('RoomManager cleanup warning', { error: String(error) });
      }
    }
    this.initialized = false;
    this.logger.info('RoomManager closed');
  }

  // ============================================================
  // Room Management (DynamicRoomManager operations)
  // ============================================================

  /**
   * 根据记忆内容推荐合适的 Room
   */
  async recommendRooms(content: string, limit?: number): Promise<RoomRecommendation[]> {
    return this.dynamicRoomManager.recommendRooms(content, limit);
  }

  /**
   * 合并过小的 Room
   */
  async mergeRooms(roomIds: string[]): Promise<MergeResult> {
    const result = await this.dynamicRoomManager.mergeRooms(roomIds);

    // After merging, update MemoryRoomMapping
    if (result.success) {
      // Move memories from absorbed rooms to merged room
      for (const absorbedRoomId of result.absorbedRoomIds) {
        const memories = await this.memoryRoomMapping.getMemoriesForRoom(absorbedRoomId);
        for (const memoryId of memories) {
          await this.memoryRoomMapping.removeMemoryFromRoom(memoryId, absorbedRoomId);
          await this.memoryRoomMapping.addMemoryToRoom(memoryId, result.mergedRoomId);
        }
      }
    }

    return result;
  }

  /**
   * 拆分过大的 Room
   */
  async splitRoom(roomId: string): Promise<SplitResult> {
    const result = await this.dynamicRoomManager.splitRoom(roomId);

    // After splitting, update MemoryRoomMapping
    if (result.success) {
      // Get memories from original room and redistribute
      const originalMemories = await this.memoryRoomMapping.getMemoriesForRoom(roomId);

      // Remove original room mappings
      for (const memoryId of originalMemories) {
        await this.memoryRoomMapping.removeMemoryFromRoom(memoryId, roomId);
      }

      // Add to new rooms with round-robin distribution
      for (let i = 0; i < originalMemories.length; i++) {
        const targetRoomIdx = i % result.newRoomIds.length;
        const targetRoomId = result.newRoomIds[targetRoomIdx];
        await this.memoryRoomMapping.addMemoryToRoom(originalMemories[i], targetRoomId);
      }
    }

    return result;
  }

  /**
   * 获取 Room 统计信息
   */
  async getRoomStats(roomId: string): Promise<RoomStats | null> {
    return this.dynamicRoomManager.getRoomStats(roomId);
  }

  /**
   * 获取所有 Room 列表
   */
  async getAllRooms(): Promise<Room[]> {
    return this.dynamicRoomManager.getAllRooms();
  }

  /**
   * 创建新的 Room
   */
  createRoom(room: {
    id: string;
    name: string;
    description?: string;
    embeddings?: number[];
  }): void {
    const newRoom: Room = {
      id: room.id,
      name: room.name,
      description: room.description,
      createdAt: Date.now(),
      embeddings: room.embeddings ?? [],
    };
    this.dynamicRoomManager.addRoom(newRoom);
    this.logger.info('Room created', { roomId: room.id, roomName: room.name });
  }

  /**
   * 删除 Room
   */
  async deleteRoom(roomId: string): Promise<void> {
    // Remove all memory associations
    await this.memoryRoomMapping.removeRoom(roomId);

    // Remove from DynamicRoomManager (by getting all rooms and filtering)
    const rooms = await this.dynamicRoomManager.getAllRooms();
    const roomToDelete = rooms.find(r => r.id === roomId);
    if (roomToDelete) {
      // Note: DynamicRoomManager doesn't have a direct deleteRoom method
      // The room will be cleaned up when merge/split operations happen
      this.logger.info('Room deleted (memory mappings removed)', { roomId });
    }
  }

  /**
   * 检查 Room 是否存在
   */
  async hasRoom(roomId: string): Promise<boolean> {
    return this.dynamicRoomManager.hasRoom(roomId);
  }

  // ============================================================
  // Memory-Room Mapping (MemoryRoomMapping operations)
  // ============================================================

  /**
   * 将记忆关联到 Room
   */
  async addMemoryToRoom(memoryId: string, roomId: string): Promise<boolean> {
    // First add to DynamicRoomManager
    if (!(await this.dynamicRoomManager.hasRoom(roomId))) {
      // Create the room if it doesn't exist
      await this.dynamicRoomManager.addRoom({
        id: roomId,
        name: roomId,
        createdAt: Date.now(),
        embeddings: [],
      });
    }

    this.dynamicRoomManager.addMemberToRoom(roomId, memoryId);

    // Then add to MemoryRoomMapping
    const success = await this.memoryRoomMapping.addMemoryToRoom(memoryId, roomId);

    if (success) {
      this.logger.debug('Memory added to room', { memoryId, roomId });
    }

    return success;
  }

  /**
   * 将记忆从 Room 移除
   */
  async removeMemoryFromRoom(memoryId: string, roomId: string): Promise<boolean> {
    // Remove from DynamicRoomManager
    this.dynamicRoomManager.removeMemberFromRoom(roomId, memoryId);

    // Remove from MemoryRoomMapping
    const success = await this.memoryRoomMapping.removeMemoryFromRoom(memoryId, roomId);

    if (success) {
      this.logger.debug('Memory removed from room', { memoryId, roomId });
    }

    return success;
  }

  /**
   * 获取记忆关联的所有 Room
   */
  async getRoomsForMemory(memoryId: string): Promise<string[]> {
    return this.memoryRoomMapping.getRoomsForMemory(memoryId);
  }

  /**
   * 获取 Room 包含的所有记忆
   */
  async getMemoriesForRoom(roomId: string): Promise<string[]> {
    return this.memoryRoomMapping.getMemoriesForRoom(roomId);
  }

  /**
   * 检查记忆是否属于某个 Room
   */
  async isMemoryInRoom(memoryId: string, roomId: string): Promise<boolean> {
    return this.memoryRoomMapping.isMemoryInRoom(memoryId, roomId);
  }

  /**
   * 获取同时属于多个 Room 的记忆
   */
  async getMemoriesInAllRooms(roomIds: string[]): Promise<string[]> {
    return this.memoryRoomMapping.getMemoriesInAllRooms(roomIds);
  }

  /**
   * 获取属于任一 Room 的记忆
   */
  async getMemoriesInAnyRoom(roomIds: string[]): Promise<string[]> {
    return this.memoryRoomMapping.getMemoriesInAnyRoom(roomIds);
  }

  /**
   * 批量添加记忆到 Room
   */
  async batchAddMemoryToRoom(memoryIds: string[], roomId: string): Promise<number> {
    return this.memoryRoomMapping.batchAddMemoryToRoom(memoryIds, roomId);
  }

  /**
   * 批量从 Room 移除记忆
   */
  async batchRemoveMemoryFromRoom(memoryIds: string[], roomId: string): Promise<number> {
    return this.memoryRoomMapping.batchRemoveMemoryFromRoom(memoryIds, roomId);
  }

  /**
   * 移除记忆的所有 Room 关联
   */
  async removeMemoryAllAssociations(memoryId: string): Promise<void> {
    await this.memoryRoomMapping.removeMemory(memoryId);
    this.logger.debug('All room associations removed for memory', { memoryId });
  }

  /**
   * 清理孤立的关联
   */
  async cleanupOrphaned(validMemoryIds: Set<string>, validRoomIds: Set<string>): Promise<number> {
    return this.memoryRoomMapping.cleanupOrphaned(validMemoryIds, validRoomIds);
  }

  // ============================================================
  // Auto Management
  // ============================================================

  /**
   * 执行自动管理（合并小 Room，拆分大 Room）
   */
  async autoManage(): Promise<{
    merged: number;
    split: number;
    details: string[];
  }> {
    if (!this.config.autoManage) {
      return { merged: 0, split: 0, details: ['Auto manage is disabled'] };
    }

    const details: string[] = [];
    let merged = 0;
    let split = 0;

    // Get all rooms and their stats
    const rooms = await this.getAllRooms();

    // Find small rooms (below merge threshold)
    const smallRooms: string[] = [];
    const largeRooms: string[] = [];

    for (const room of rooms) {
      const stats = await this.getRoomStats(room.id);
      if (stats && stats.memoryCount > 0) {
        if (stats.memoryCount < this.config.mergeThreshold) {
          smallRooms.push(room.id);
        } else if (stats.memoryCount > this.config.splitThreshold) {
          largeRooms.push(room.id);
        }
      }
    }

    // Merge small rooms
    if (smallRooms.length >= 2) {
      for (let i = 0; i < smallRooms.length - 1; i += 2) {
        const result = await this.mergeRooms([smallRooms[i], smallRooms[i + 1]]);
        if (result.success) {
          merged++;
          details.push(`Merged ${smallRooms[i]} and ${smallRooms[i + 1]} into ${result.mergedRoomId}`);
        }
      }
    }

    // Split large rooms
    for (const roomId of largeRooms) {
      const result = await this.splitRoom(roomId);
      if (result.success) {
        split++;
        details.push(`Split ${roomId} into ${result.newRoomIds.join(', ')}`);
      }
    }

    this.logger.info('Auto manage completed', { merged, split });
    return { merged, split, details };
  }

  /**
   * 自动为记忆分配 Room
   */
  async autoAssignRoomsForMemory(memoryId: string, content: string, limit: number = 3): Promise<string[]> {
    if (!this.config.autoAssignRooms) {
      return [];
    }

    const recommendations = await this.recommendRooms(content, limit);
    const assignedRooms: string[] = [];

    for (const rec of recommendations) {
      const success = await this.addMemoryToRoom(memoryId, rec.roomId);
      if (success) {
        assignedRooms.push(rec.roomId);
      }
    }

    this.logger.debug('Auto assigned rooms for memory', { memoryId, assignedRooms });
    return assignedRooms;
  }

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * 获取管理器统计
   */
  async getStats(): Promise<RoomManagerStats> {
    const rooms = await this.getAllRooms();
    const mappingStats = await this.memoryRoomMapping.getStats();

    let smallRooms = 0;
    let largeRooms = 0;

    for (const room of rooms) {
      const stats = await this.getRoomStats(room.id);
      if (stats && stats.memoryCount > 0) {
        if (stats.memoryCount < this.config.mergeThreshold) {
          smallRooms++;
        } else if (stats.memoryCount > this.config.splitThreshold) {
          largeRooms++;
        }
      }
    }

    return {
      totalRooms: rooms.length,
      totalMemoryAssociations: mappingStats.totalMemoryAssociations,
      totalRoomAssociations: mappingStats.totalRoomAssociations,
      avgRoomsPerMemory: mappingStats.avgRoomsPerMemory,
      avgMemoriesPerRoom: mappingStats.avgMemoriesPerRoom,
      smallRooms,
      largeRooms,
    };
  }

  /**
   * 获取所有记忆-Room 映射
   */
  async getAllMemoryRooms(): Promise<Array<{ memoryId: string; roomIds: string[] }>> {
    const mapping = await this.memoryRoomMapping.getAllMemoryRooms();
    return mapping.map(m => ({
      memoryId: m.memoryId,
      roomIds: m.roomIds,
    }));
  }

  /**
   * 获取所有 Room-记忆映射
   */
  async getAllRoomMemories(): Promise<Array<{ roomId: string; memoryIds: string[] }>> {
    const mapping = await this.memoryRoomMapping.getAllRoomMemories();
    return mapping.map(r => ({
      roomId: r.roomId,
      memoryIds: r.memoryIds,
    }));
  }

  /**
   * 获取配置
   */
  getConfig(): RoomManagerConfig {
    return { ...this.config };
  }
}