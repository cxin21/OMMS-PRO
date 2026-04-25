/**
 * Tools - 所有 MCP 工具的统一导出
 */

import type { ToolRegistry } from '../tool-registry';
import type { StorageMemoryService } from '../../../services/memory/core/storage-memory-service';
import type { DreamingManager } from '../../../services/dreaming/dreaming-manager';
import type { ProfileManager } from '../../../services/profile/profile-manager';
import type { PalaceStore } from '../../../infrastructure/storage/stores/palace-store';
import type { GraphStore } from '../../../infrastructure/storage/stores/graph-store';
import { createMemoryTools } from './memory-tools';
import { createPalaceTools } from './palace-tools';
import { createGraphTools } from './graph-tools';
import { createDreamingTools } from './dreaming-tools';
import { createSystemTools } from './system-tools';
import { createScoringTools } from './scoring-tools';
import { createProfileTools } from './profile-tools';

/**
 * MCP 服务容器 - 所有工具依赖的服务实例
 */
export interface MCPServiceContainer {
  memoryService: StorageMemoryService;
  dreamingManager: DreamingManager | null;
  profileManager: ProfileManager;
  palaceStore: PalaceStore;
  graphStore: GraphStore;
}

/**
 * 注册所有工具
 */
export function registerAllTools(registry: ToolRegistry, services: MCPServiceContainer): void {
  // 注册记忆管理工具（9 个）
  registry.registerTools(createMemoryTools(services.memoryService));

  // 注册宫殿管理工具（6 个）
  registry.registerTools(createPalaceTools(services.palaceStore));

  // 注册知识图谱工具（4 个）
  registry.registerTools(createGraphTools(services.graphStore));

  // 注册 Dreaming 工具（2 个）
  registry.registerTools(createDreamingTools(services.dreamingManager));

  // 注册系统工具（3 个）
  registry.registerTools(createSystemTools(services.memoryService, services.dreamingManager));

  // 注册评分工具（2 个）
  registry.registerTools(createScoringTools(services.memoryService));

  // 注册用户画像工具（1 个）
  registry.registerTools(createProfileTools(services.profileManager));
}
