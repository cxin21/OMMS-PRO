/**
 * MemoryRoomMapping - 记忆与 Room 的多对多关系管理
 *
 * 管理记忆与 Room 之间的关联关系
 * - 支持记忆属于多个 Room
 * - 支持 Room 包含多个记忆
 * - 提供高效的关联查询
 *
 * @module storage/memory-room-mapping
 */

import { createLogger } from '../../../shared/logging';
import type { ILogger } from '../../../shared/logging';
import { FileUtils } from '../../../shared/utils/file';
import { dirname } from 'path';
import Database from 'better-sqlite3';
import { config } from '../../../shared/config';

export interface MemoryRoomMappingConfig {
  /** 记忆最大关联 Room 数量 */
  maxRoomsPerMemory: number;
  /** Room 最大关联记忆数量 */
  maxMemoriesPerRoom: number;
  /** 自动清理孤立的关联 */
  autoCleanupOrphaned: boolean;
}

export interface MemoryRooms {
  memoryId: string;
  roomIds: string[];
  updatedAt: number;
}

export interface RoomMemories {
  roomId: string;
  memoryIds: string[];
  updatedAt: number;
}

interface MappingRecord {
  memoryUid: string;
  roomId: string;
  similarity: number;
  createdAt: number;
}

/**
 * MemoryRoomMapping
 *
 * 维护记忆与 Room 的多对多映射关系
 */
export class MemoryRoomMapping {
  private logger: ILogger;
  // memoryId -> Set of roomIds
  private memoryToRooms: Map<string, Set<string>> = new Map();
  // roomId -> Set of memoryIds
  private roomToMemories: Map<string, Set<string>> = new Map();
  private db: Database.Database | null = null;
  private dbPath: string = '';
  private initialized: boolean = false;
  // Track which memory/room keys have been loaded from SQLite
  private loadedMemoryIds: Set<string> = new Set();
  private loadedRoomIds: Set<string> = new Set();

  constructor(private config: MemoryRoomMappingConfig) {
    this.logger = createLogger('MemoryRoomMapping');
  }

  /**
   * 初始化数据库连接和表结构
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      const storageConfig = config.getConfigOrThrow<{ memoryRoomMappingDbPath: string }>('memoryService.storage');
      this.dbPath = storageConfig.memoryRoomMappingDbPath;

      await FileUtils.ensureDirectory(dirname(this.dbPath));

      this.db = new Database(this.dbPath);

      // Create table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS memory_room_mapping (
          memoryUid TEXT NOT NULL,
          roomId TEXT NOT NULL,
          similarity REAL NOT NULL DEFAULT 1.0,
          createdAt INTEGER NOT NULL,
          PRIMARY KEY (memoryUid, roomId)
        )
      `);

      // Create indexes
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_mapping_roomId ON memory_room_mapping(roomId)
      `);
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_mapping_memoryUid ON memory_room_mapping(memoryUid)
      `);

      this.initialized = true;
      this.logger.info('MemoryRoomMapping initialized', { dbPath: this.dbPath });
    } catch (error) {
      this.logger.error('Failed to initialize MemoryRoomMapping', { error });
      throw error;
    }
  }

  /**
   * 从 SQLite 加载指定 memoryId 的映射到内存
   */
  private loadMemoryMappingsFromDb(memoryId: string): void {
    if (!this.db || this.loadedMemoryIds.has(memoryId)) return;

    try {
      const stmt = this.db.prepare('SELECT * FROM memory_room_mapping WHERE memoryUid = ?');
      const rows = stmt.all(memoryId) as MappingRecord[];

      for (const row of rows) {
        if (!this.memoryToRooms.has(row.memoryUid)) {
          this.memoryToRooms.set(row.memoryUid, new Set());
        }
        this.memoryToRooms.get(row.memoryUid)!.add(row.roomId);

        if (!this.roomToMemories.has(row.roomId)) {
          this.roomToMemories.set(row.roomId, new Set());
        }
        this.roomToMemories.get(row.roomId)!.add(row.memoryUid);
      }

      this.loadedMemoryIds.add(memoryId);
    } catch (error) {
      this.logger.error('Failed to load memory mappings from database', { memoryId, error });
    }
  }

  /**
   * 从 SQLite 加载指定 roomId 的映射到内存
   */
  private loadRoomMappingsFromDb(roomId: string): void {
    if (!this.db || this.loadedRoomIds.has(roomId)) return;

    try {
      const stmt = this.db.prepare('SELECT * FROM memory_room_mapping WHERE roomId = ?');
      const rows = stmt.all(roomId) as MappingRecord[];

      for (const row of rows) {
        if (!this.memoryToRooms.has(row.memoryUid)) {
          this.memoryToRooms.set(row.memoryUid, new Set());
        }
        this.memoryToRooms.get(row.memoryUid)!.add(row.roomId);

        if (!this.roomToMemories.has(row.roomId)) {
          this.roomToMemories.set(row.roomId, new Set());
        }
        this.roomToMemories.get(row.roomId)!.add(row.memoryUid);
      }

      this.loadedRoomIds.add(roomId);
    } catch (error) {
      this.logger.error('Failed to load room mappings from database', { roomId, error });
    }
  }

  /**
   * 将单条映射同步写入 SQLite
   */
  private syncMappingToDb(memoryId: string, roomId: string): void {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT INTO memory_room_mapping (memoryUid, roomId, similarity, createdAt)
        VALUES (?, ?, 1.0, ?)
        ON CONFLICT(memoryUid, roomId) DO NOTHING
      `);
      stmt.run(memoryId, roomId, Date.now());
    } catch (error) {
      this.logger.error('Failed to sync mapping to database', { memoryId, roomId, error });
    }
  }

  /**
   * 从 SQLite 删除单条映射
   */
  private removeMappingFromDb(memoryId: string, roomId: string): void {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare('DELETE FROM memory_room_mapping WHERE memoryUid = ? AND roomId = ?');
      stmt.run(memoryId, roomId);
    } catch (error) {
      this.logger.error('Failed to remove mapping from database', { memoryId, roomId, error });
    }
  }

  /**
   * 将记忆关联到 Room
   */
  async addMemoryToRoom(memoryId: string, roomId: string): Promise<boolean> {
    await this.ensureInitialized();

    try {
      // Check limits
      const currentRooms = this.memoryToRooms.get(memoryId);
      if (currentRooms && currentRooms.size >= this.config.maxRoomsPerMemory) {
        this.logger.warn('Memory reached max rooms limit', {
          memoryId,
          currentRooms: currentRooms.size,
          maxRooms: this.config.maxRoomsPerMemory
        });
        return false;
      }

      const currentMemories = this.roomToMemories.get(roomId);
      if (currentMemories && currentMemories.size >= this.config.maxMemoriesPerRoom) {
        this.logger.warn('Room reached max memories limit', {
          roomId,
          currentMemories: currentMemories.size,
          maxMemories: this.config.maxMemoriesPerRoom
        });
        return false;
      }

      // Add to memory -> rooms mapping
      if (!this.memoryToRooms.has(memoryId)) {
        this.memoryToRooms.set(memoryId, new Set());
      }
      this.memoryToRooms.get(memoryId)!.add(roomId);

      // Add to room -> memories mapping
      if (!this.roomToMemories.has(roomId)) {
        this.roomToMemories.set(roomId, new Set());
      }
      this.roomToMemories.get(roomId)!.add(memoryId);

      // Sync to database
      this.syncMappingToDb(memoryId, roomId);

      this.logger.debug('Memory added to room', { memoryId, roomId });
      return true;
    } catch (error) {
      this.logger.error('Failed to add memory to room', { error: String(error), memoryId, roomId });
      return false;
    }
  }

  /**
   * 将记忆从 Room 移除
   */
  async removeMemoryFromRoom(memoryId: string, roomId: string): Promise<boolean> {
    await this.ensureInitialized();

    try {
      const rooms = this.memoryToRooms.get(memoryId);
      if (rooms) {
        rooms.delete(roomId);
        if (rooms.size === 0) {
          this.memoryToRooms.delete(memoryId);
        }
      }

      const memories = this.roomToMemories.get(roomId);
      if (memories) {
        memories.delete(memoryId);
        if (memories.size === 0) {
          this.roomToMemories.delete(roomId);
        }
      }

      // Sync to database
      this.removeMappingFromDb(memoryId, roomId);

      this.logger.debug('Memory removed from room', { memoryId, roomId });
      return true;
    } catch (error) {
      this.logger.error('Failed to remove memory from room', { error: String(error), memoryId, roomId });
      return false;
    }
  }

  /**
   * 获取记忆关联的所有 Room
   */
  async getRoomsForMemory(memoryId: string): Promise<string[]> {
    await this.ensureInitialized();

    // Check memory first, if not loaded try from DB
    if (!this.loadedMemoryIds.has(memoryId) && this.memoryToRooms.has(memoryId)) {
      // Already in memory but check if we need to load more from DB
    } else if (!this.loadedMemoryIds.has(memoryId)) {
      this.loadMemoryMappingsFromDb(memoryId);
    }

    const rooms = this.memoryToRooms.get(memoryId);
    return rooms ? Array.from(rooms) : [];
  }

  /**
   * 获取 Room 包含的所有记忆
   */
  async getMemoriesForRoom(roomId: string): Promise<string[]> {
    await this.ensureInitialized();

    // Check room first, if not loaded try from DB
    if (!this.loadedRoomIds.has(roomId) && this.roomToMemories.has(roomId)) {
      // Already in memory but check if we need to load more from DB
    } else if (!this.loadedRoomIds.has(roomId)) {
      this.loadRoomMappingsFromDb(roomId);
    }

    const memories = this.roomToMemories.get(roomId);
    return memories ? Array.from(memories) : [];
  }

  /**
   * 检查记忆是否属于某个 Room
   */
  async isMemoryInRoom(memoryId: string, roomId: string): Promise<boolean> {
    await this.ensureInitialized();

    // Lazy load if needed
    if (!this.loadedMemoryIds.has(memoryId)) {
      this.loadMemoryMappingsFromDb(memoryId);
    }

    return this.memoryToRooms.get(memoryId)?.has(roomId) ?? false;
  }

  /**
   * 获取同时属于多个 Room 的记忆
   */
  async getMemoriesInAllRooms(roomIds: string[]): Promise<string[]> {
    await this.ensureInitialized();

    if (roomIds.length === 0) return [];
    if (roomIds.length === 1) return this.getMemoriesForRoom(roomIds[0]);

    // Lazy load all rooms from DB if needed
    for (const roomId of roomIds) {
      if (!this.loadedRoomIds.has(roomId)) {
        this.loadRoomMappingsFromDb(roomId);
      }
    }

    // Start with memories in the first room
    const firstMemories = new Set(this.roomToMemories.get(roomIds[0]) || []);
    const result: string[] = [];

    // Intersect with remaining rooms
    for (let i = 1; i < roomIds.length; i++) {
      const roomMemories = this.roomToMemories.get(roomIds[i]) || new Set();
      for (const memoryId of firstMemories) {
        if (!roomMemories.has(memoryId)) {
          firstMemories.delete(memoryId);
        }
      }
    }

    return Array.from(firstMemories);
  }

  /**
   * 获取属于任一 Room 的记忆
   */
  async getMemoriesInAnyRoom(roomIds: string[]): Promise<string[]> {
    await this.ensureInitialized();

    // Lazy load all rooms from DB if needed
    for (const roomId of roomIds) {
      if (!this.loadedRoomIds.has(roomId)) {
        this.loadRoomMappingsFromDb(roomId);
      }
    }

    const result = new Set<string>();
    for (const roomId of roomIds) {
      const memories = this.roomToMemories.get(roomId);
      if (memories) {
        for (const memoryId of memories) {
          result.add(memoryId);
        }
      }
    }
    return Array.from(result);
  }

  /**
   * 批量添加记忆到 Room
   */
  async batchAddMemoryToRoom(memoryIds: string[], roomId: string): Promise<number> {
    let successCount = 0;
    for (const memoryId of memoryIds) {
      if (await this.addMemoryToRoom(memoryId, roomId)) {
        successCount++;
      }
    }
    return successCount;
  }

  /**
   * 批量从 Room 移除记忆
   */
  async batchRemoveMemoryFromRoom(memoryIds: string[], roomId: string): Promise<number> {
    let successCount = 0;
    for (const memoryId of memoryIds) {
      if (await this.removeMemoryFromRoom(memoryId, roomId)) {
        successCount++;
      }
    }
    return successCount;
  }

  /**
   * 移除记忆的所有关联
   */
  async removeMemory(memoryId: string): Promise<void> {
    await this.ensureInitialized();

    const rooms = this.memoryToRooms.get(memoryId);
    if (rooms) {
      for (const roomId of rooms) {
        const memories = this.roomToMemories.get(roomId);
        if (memories) {
          memories.delete(memoryId);
          if (memories.size === 0) {
            this.roomToMemories.delete(roomId);
          }
        }
      }
      this.memoryToRooms.delete(memoryId);
    }

    // Remove all mappings from DB
    if (this.db) {
      try {
        const stmt = this.db.prepare('DELETE FROM memory_room_mapping WHERE memoryUid = ?');
        stmt.run(memoryId);
      } catch (error) {
        this.logger.error('Failed to remove memory mappings from database', { memoryId, error });
      }
    }

    this.logger.debug('All room associations removed for memory', { memoryId });
  }

  /**
   * 移除 Room 的所有关联
   */
  async removeRoom(roomId: string): Promise<void> {
    await this.ensureInitialized();

    const memories = this.roomToMemories.get(roomId);
    if (memories) {
      for (const memoryId of memories) {
        const rooms = this.memoryToRooms.get(memoryId);
        if (rooms) {
          rooms.delete(roomId);
          if (rooms.size === 0) {
            this.memoryToRooms.delete(memoryId);
          }
        }
      }
      this.roomToMemories.delete(roomId);
    }

    // Remove all mappings from DB
    if (this.db) {
      try {
        const stmt = this.db.prepare('DELETE FROM memory_room_mapping WHERE roomId = ?');
        stmt.run(roomId);
      } catch (error) {
        this.logger.error('Failed to remove room mappings from database', { roomId, error });
      }
    }

    this.logger.debug('All memory associations removed for room', { roomId });
  }

  /**
   * 清理孤立的关联（记忆或 Room 已不存在）
   */
  async cleanupOrphaned(validMemoryIds: Set<string>, validRoomIds: Set<string>): Promise<number> {
    await this.ensureInitialized();

    if (!this.config.autoCleanupOrphaned) {
      return 0;
    }

    let cleanedCount = 0;

    // Clean up memory -> rooms mappings with invalid roomIds
    for (const [memoryId, rooms] of this.memoryToRooms) {
      if (!validMemoryIds.has(memoryId)) {
        this.memoryToRooms.delete(memoryId);
        cleanedCount++;
        continue;
      }
      for (const roomId of rooms) {
        if (!validRoomIds.has(roomId)) {
          rooms.delete(roomId);
          cleanedCount++;
        }
      }
      if (rooms.size === 0) {
        this.memoryToRooms.delete(memoryId);
      }
    }

    // Clean up room -> memories mappings with invalid memoryIds
    for (const [roomId, memories] of this.roomToMemories) {
      if (!validRoomIds.has(roomId)) {
        this.roomToMemories.delete(roomId);
        cleanedCount++;
        continue;
      }
      for (const memoryId of memories) {
        if (!validMemoryIds.has(memoryId)) {
          memories.delete(memoryId);
          cleanedCount++;
        }
      }
      if (memories.size === 0) {
        this.roomToMemories.delete(roomId);
      }
    }

    this.logger.info('Orphaned associations cleaned', { cleanedCount });
    return cleanedCount;
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    totalMemoryAssociations: number;
    totalRoomAssociations: number;
    avgRoomsPerMemory: number;
    avgMemoriesPerRoom: number;
    orphanedMemories: number;
    orphanedRooms: number;
  }> {
    await this.ensureInitialized();

    let totalMemoryAssociations = 0;
    let totalRoomAssociations = 0;
    let memoryRoomSum = 0;
    let roomMemorySum = 0;

    for (const [_, rooms] of this.memoryToRooms) {
      totalMemoryAssociations += rooms.size;
      memoryRoomSum += rooms.size;
    }

    for (const [_, memories] of this.roomToMemories) {
      totalRoomAssociations += memories.size;
      roomMemorySum += memories.size;
    }

    const memoryCount = this.memoryToRooms.size;
    const roomCount = this.roomToMemories.size;

    return {
      totalMemoryAssociations,
      totalRoomAssociations,
      avgRoomsPerMemory: memoryCount > 0 ? memoryRoomSum / memoryCount : 0,
      avgMemoriesPerRoom: roomCount > 0 ? roomMemorySum / roomCount : 0,
      orphanedMemories: 0, // Would need external validation
      orphanedRooms: 0     // Would need external validation
    };
  }

  /**
   * 获取所有记忆的 Room 映射
   */
  async getAllMemoryRooms(): Promise<MemoryRooms[]> {
    await this.ensureInitialized();

    const result: MemoryRooms[] = [];
    for (const [memoryId, rooms] of this.memoryToRooms) {
      result.push({
        memoryId,
        roomIds: Array.from(rooms),
        updatedAt: Date.now()
      });
    }
    return result;
  }

  /**
   * 获取所有 Room 的记忆映射
   */
  async getAllRoomMemories(): Promise<RoomMemories[]> {
    await this.ensureInitialized();

    const result: RoomMemories[] = [];
    for (const [roomId, memories] of this.roomToMemories) {
      result.push({
        roomId,
        memoryIds: Array.from(memories),
        updatedAt: Date.now()
      });
    }
    return result;
  }

  /**
   * 从外部数据恢复映射关系
   */
  async restoreFromData(memoryRooms: MemoryRooms[]): Promise<void> {
    await this.ensureInitialized();

    this.memoryToRooms.clear();
    this.roomToMemories.clear();

    for (const { memoryId, roomIds } of memoryRooms) {
      if (!this.memoryToRooms.has(memoryId)) {
        this.memoryToRooms.set(memoryId, new Set());
      }
      for (const roomId of roomIds) {
        this.memoryToRooms.get(memoryId)!.add(roomId);

        if (!this.roomToMemories.has(roomId)) {
          this.roomToMemories.set(roomId, new Set());
        }
        this.roomToMemories.get(roomId)!.add(memoryId);
      }

      // Batch sync to database
      for (const roomId of roomIds) {
        this.syncMappingToDb(memoryId, roomId);
      }
    }

    this.logger.info('Mapping restored from data', { memoryCount: memoryRooms.length });
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
    this.loadedMemoryIds.clear();
    this.loadedRoomIds.clear();
    this.logger.info('MemoryRoomMapping closed');
  }
}