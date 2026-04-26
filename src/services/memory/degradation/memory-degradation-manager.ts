/**
 * Memory Degradation Manager - 记忆降级与遗忘管理器
 * @module memory-service/memory-degradation-manager
 *
 * 版本: v2.1.0
 * - 集成 scoring-engine 的遗忘策略和强化引擎
 * - 支持定时遗忘检查和作用域降级
 * - 管理记忆的归档、删除、降级
 * - Palace 迁移支持（作用域升级/降级时）
 */

import type {
  ICacheManager,
  IVectorStore,
  ISQLiteMetaStore,
  IPalaceStore,
  IGraphStore,
  MemoryMetaRecord,
  PalaceLocation,
  GraphNodeRecord,
  GraphEdgeRecord,
  VersionInfo,
} from '../../../infrastructure/storage/core/types';
import { PalaceStore } from '../../../infrastructure/storage/stores/palace-store';
import { StringUtils } from '../../../shared/utils/string';
import { createLogger } from '../../../shared/logging';
import type { ILogger } from '../../../shared/logging';
import type { ForgetReport } from '../types';
import { MemoryScope, MemoryType, PROFILE_TYPES, isProfileType } from '../../../core/types/memory';
import { config } from '../../../shared/config';
import { TransactionManager } from '../utils/transaction-manager';

// ============================================================
// AAAK Flag 保护配置
// ============================================================

/**
 * AAAK Flag 保护系数
 * 来自 MemPalace 设计原则：DECISION/ORIGIN/CORE/PIVOT/TECHNICAL 标记提升重要性
 */
const AAAK_FLAG_PROTECTION: Record<string, number> = {
  DECISION: 0.5,
  CORE: 0.3,
  PIVOT: 0.4,
  TECHNICAL: 0.2,
};

/** AAAK Flag 标签前缀 */
const AAAK_FLAG_PREFIX = 'aaak:';

/** AAAK Flag 最大叠加保护值 */
const AAAK_MAX_PROTECTION = 1.0;

/**
 * 从 tags 中提取 AAAK flags
 * @param tags 记忆标签数组
 * @returns AAAK flag 保护系数总和（最大 1.0）
 */
function extractAAAKProtection(tags: string[] | undefined): number {
  if (!tags || tags.length === 0) {
    return 0;
  }

  let totalProtection = 0;

  for (const tag of tags) {
    if (tag.startsWith(AAAK_FLAG_PREFIX)) {
      const flag = tag.substring(AAAK_FLAG_PREFIX.length);
      const protection = AAAK_FLAG_PROTECTION[flag];
      if (protection !== undefined) {
        totalProtection += protection;
      }
    }
  }

  // 最大叠加 1.0
  return Math.min(totalProtection, AAAK_MAX_PROTECTION);
}

// ============================================================
// 类型定义
// ============================================================

/**
 * 遗忘配置（双评分遗忘算法）
 */
export interface DegradationConfig {
  /** 启用遗忘机制 */
  enabled: boolean;
  /** 检查间隔（毫秒），默认 24 小时 */
  checkInterval: number;
  /** 衰减率：每天衰减 0.05 */
  decayRate: number;
  /** 重要性权重：默认 0.7 */
  importanceWeight: number;
  /** 作用域权重：默认 0.3 */
  scopeWeight: number;
  /** 删除阈值：遗忘分数 < 此值删除，默认 1.5 */
  deleteThreshold: number;
  /** 归档阈值：遗忘分数 < 此值归档，默认 3.0 */
  archiveThreshold: number;
  /** 保护等级：importance >= 此值受保护，默认 7 */
  protectLevel: number;
}

/**
 * 作用域降级配置
 */
export interface ScopeDegradationConfig {
  /** 启用作用域降级 */
  enabled: boolean;
  /** SESSION 多少天未访问降级到 AGENT */
  sessionToAgentDays: number;
  /** AGENT 多少天未访问降级到 GLOBAL */
  agentToGlobalDays: number;
  /** SESSION 记忆被召回多少次升级到 AGENT */
  sessionUpgradeRecallThreshold: number;
  /** AGENT 记忆被召回多少次升级到 GLOBAL */
  agentUpgradeRecallThreshold: number;
  /** 升级时 scopeScore 上限 */
  upgradeScopeScoreMax: number;
}

/**
 * 强化配置
 */
export interface ReinforcementConfig {
  /** 启用强化机制 */
  enabled: boolean;
  /** 低重要性阈值 (< 此值使用高强化) */
  lowBoostThreshold: number;
  /** 中重要性阈值 (< 此值使用中等强化) */
  mediumBoostThreshold: number;
  /** 高重要性阈值 (< 此值使用低强化，>= 使用默认) */
  highBoostThreshold: number;
  /** 低重要性强化幅度 */
  lowBoost: number;
  /** 中重要性强化幅度 */
  mediumBoost: number;
  /** 高重要性强化幅度 */
  highBoost: number;
  /** 默认强化幅度 */
  defaultBoost: number;
  /** 最大 importanceScore 上限 */
  maxImportance: number;
  /** scopeScore 强化幅度（被其他Agent召回时） */
  scopeBoost: number;
  /** 强化冷却时间（毫秒） */
  cooldownMs: number;
}

/**
 * 作用域降级报告
 */
export interface ScopeDegradationReport {
  /** 扫描的记忆数 */
  scannedCount: number;
  /** 降级的记忆数 */
  downgradedCount: number;
  /** 升级的记忆数 */
  upgradedCount: number;
  /** 降级的记忆 UID 列表 */
  downgradedIds: string[];
  /** 升级的记忆 UID 列表 */
  upgradedIds: string[];
  /** 执行时间 */
  executedAt: number;
}

/**
 * 遗忘统计
 */
export interface DegradationStats {
  totalMemories: number;
  archivedMemories: number;
  deletedMemories: number;
  scopeDistribution: {
    session: number;
    agent: number;
    global: number;
  };
  avgImportance: number;
  avgLastRecalledAt: number;
}

// ============================================================
// MemoryDegradationManager
// ============================================================

/**
 * 获取降级配置
 * 从 ConfigManager 读取配置，所有配置必须来自 ConfigManager
 */
function getDegradationConfig(): DegradationConfig {
  return config.getConfigOrThrow<DegradationConfig>('memoryService.degradation');
}

/**
 * 获取作用域降级配置
 * 所有配置必须来自 ConfigManager
 */
function getScopeDegradationConfig(): ScopeDegradationConfig {
  return config.getConfigOrThrow<ScopeDegradationConfig>('memoryService.scopeDegradation');
}

/**
 * 获取强化配置
 * 所有配置必须来自 ConfigManager
 */
function getReinforcementConfig(): ReinforcementConfig {
  return config.getConfigOrThrow<ReinforcementConfig>('memoryService.reinforcement');
}

/**
 * MemoryDegradationManager
 * 负责记忆的降级、遗忘和强化
 */
export class MemoryDegradationManager {
  private logger: ILogger;
  private config: DegradationConfig;
  private scopeConfig: ScopeDegradationConfig;
  private reinforcementConfig: ReinforcementConfig;

  private cacheManager: ICacheManager;
  private vectorStore: IVectorStore;
  private metaStore: ISQLiteMetaStore;
  private palaceStore: IPalaceStore;
  private graphStore: IGraphStore;
  private txManager: TransactionManager;

  private degradationTimer?: NodeJS.Timeout;
  private lastReinforceTime: Map<string, number>;
  private globalLastReinforceTime: number;
  private isDegradationRunning: boolean = false;
  private isDeletionInProgress: boolean = false;
  private isArchivationInProgress: boolean = false;
  private isRestorationInProgress: boolean = false;
  private scopeChangedThisCycle: Set<string> = new Set();
  // Per-memory 操作锁，防止并发 archive/delete 冲突
  private operationLocks: Map<string, Promise<void>> = new Map();

  constructor(
    cacheManager: ICacheManager,
    vectorStore: IVectorStore,
    metaStore: ISQLiteMetaStore,
    palaceStore: IPalaceStore,
    graphStore: IGraphStore,
    userConfig?: Partial<DegradationConfig>,
    scopeUserConfig?: Partial<ScopeDegradationConfig>,
    reinforcementUserConfig?: Partial<ReinforcementConfig>
  ) {
    this.logger = createLogger('MemoryDegradationManager', {
      level: 'debug',
      output: 'both',
      filePath: 'logs/memory-degradation.log',
      enableConsole: true,
      enableFile: true,
      enableRotation: true,
      maxFileSize: '50MB',
      maxFiles: 10,
    });

    // 优先使用传入的配置，否则从 ConfigManager 获取
    this.config = userConfig && Object.keys(userConfig).length > 0
      ? { ...getDegradationConfig(), ...userConfig }
      : getDegradationConfig();

    this.scopeConfig = scopeUserConfig && Object.keys(scopeUserConfig).length > 0
      ? { ...getScopeDegradationConfig(), ...scopeUserConfig }
      : getScopeDegradationConfig();

    this.reinforcementConfig = reinforcementUserConfig && Object.keys(reinforcementUserConfig).length > 0
      ? { ...getReinforcementConfig(), ...reinforcementUserConfig }
      : getReinforcementConfig();

    this.logger.info('MemoryDegradationManager initialized', {
      config: this.config,
      scopeConfig: this.scopeConfig,
      reinforcementConfig: this.reinforcementConfig,
    });

    this.cacheManager = cacheManager;
    this.vectorStore = vectorStore;
    this.metaStore = metaStore;
    this.palaceStore = palaceStore;
    this.graphStore = graphStore;

    // 初始化事务管理器
    this.txManager = new TransactionManager();

    this.lastReinforceTime = new Map();
    this.globalLastReinforceTime = 0;

    // 自动启动遗忘定时器（确保遗忘和降级功能正常运行）
    this.startDegradationTimer();
  }

  // ============================================================
  // 定时任务管理
  // ============================================================

  /**
   * 启动定时遗忘检查
   */
  startDegradationTimer(): void {
    if (this.degradationTimer) {
      this.logger.warn('Degradation timer already running');
      return;
    }

    this.degradationTimer = setInterval(async () => {
      try {
        this.logger.debug('Running scheduled degradation check');
        await this.runForgettingCycle();
        await this.runScopeDegradationCycle();
      } catch (error) {
        this.logger.error('Degradation cycle failed', error instanceof Error ? error : new Error(String(error)));
      }
    }, this.config.checkInterval);

    this.logger.info('Degradation timer started', {
      checkInterval: this.config.checkInterval,
    });
  }

  /**
   * 停止定时遗忘检查
   */
  stopDegradationTimer(): void {
    if (this.degradationTimer) {
      clearInterval(this.degradationTimer);
      this.degradationTimer = undefined;
      this.logger.info('Degradation timer stopped');
    }
  }

  // ============================================================
  // 遗忘周期
  // ============================================================

  /**
   * 执行遗忘周期
   * 扫描所有记忆，决定归档或删除
   */
  async runForgettingCycle(): Promise<ForgetReport> {
    // [runForgettingCycle:410] 方法入口
    this.logger.debug('[runForgettingCycle:410] Method entry');

    // 互斥锁：防止与作用域降级周期并发执行
    this.logger.debug('[runForgettingCycle:412] Checking if degradation is already running');
    if (this.isDegradationRunning) {
      this.logger.warn('[runForgettingCycle:413] Forgetting cycle skipped (degradation already running)');
      return { scannedCount: 0, archivedCount: 0, deletedCount: 0, archivedIds: [], deletedIds: [], errors: [], executedAt: Date.now(), duration: 0 };
    }
    this.isDegradationRunning = true;
    // [runForgettingCycle:416] isDegradationRunning 设置为 true

    const startTime = Date.now();
    this.logger.debug('[runForgettingCycle:418] Start time recorded');

    const report: ForgetReport = {
      scannedCount: 0,
      archivedCount: 0,
      deletedCount: 0,
      archivedIds: [],
      deletedIds: [],
      errors: [],
      executedAt: Date.now(),
      duration: 0,
    };
    // [runForgettingCycle:430] report 对象初始化完成

    try {
      // [runForgettingCycle:432] 进入 try 块
      this.logger.debug('[runForgettingCycle:433] Querying all latest version memories from metaStore');
      // 查询所有最新版本的记忆
      const memories = await this.metaStore.query({
        isLatestVersion: true,
        limit: 10000,
      });
      // [runForgettingCycle:437] memories 查询完成

      report.scannedCount = memories.length;
      this.logger.debug('[runForgettingCycle:438] Memories queried', { count: memories.length });

      this.logger.debug('[runForgettingCycle:440] Starting loop over memories');
      for (const memory of memories) {
        // [runForgettingCycle:441] 处理每条记忆
        try {
          this.logger.debug('[runForgettingCycle:442] Calling evaluateForgetting', { uid: memory.uid });
          const action = this.evaluateForgetting(memory);
          // [runForgettingCycle:443] evaluateForgetting 返回
          this.logger.debug('[runForgettingCycle:444] evaluateForgetting result', { uid: memory.uid, action });

          if (action === 'archive') {
            // [runForgettingCycle:445] 执行归档
            this.logger.info('[runForgettingCycle:445] Action: archive', { uid: memory.uid });
            this.isArchivationInProgress = true;
            try {
              this.logger.debug('[runForgettingCycle:447] Calling archiveMemory', { uid: memory.uid });
              await this.archiveMemory(memory.uid);
              // [runForgettingCycle:448] archiveMemory 完成
              report.archivedCount++;
              report.archivedIds.push(memory.uid);
              this.logger.debug('[runForgettingCycle:449] Archived memory', { uid: memory.uid, archivedCount: report.archivedCount });
            } finally {
              this.isArchivationInProgress = false;
              // [runForgettingCycle:451] isArchivationInProgress 设置为 false
            }
          } else if (action === 'delete') {
            // [runForgettingCycle:453] 执行删除
            this.logger.info('[runForgettingCycle:453] Action: delete', { uid: memory.uid });
            this.isDeletionInProgress = true;
            try {
              this.logger.debug('[runForgettingCycle:456] Calling deleteMemory', { uid: memory.uid });
              await this.deleteMemory(memory.uid);
              // [runForgettingCycle:457] deleteMemory 完成
              report.deletedCount++;
              report.deletedIds.push(memory.uid);
              this.logger.debug('[runForgettingCycle:458] Deleted memory', { uid: memory.uid, deletedCount: report.deletedCount });
            } finally {
              this.isDeletionInProgress = false;
              // [runForgettingCycle:460] isDeletionInProgress 设置为 false
            }
          } else {
            // [runForgettingCycle:462] 保持不动
            this.logger.debug('[runForgettingCycle:462] Action: keep', { uid: memory.uid });
          }
        } catch (error) {
          // [runForgettingCycle:463] 捕获错误
          this.logger.error('[runForgettingCycle:463] Error processing memory', error instanceof Error ? error : new Error(String(error)), { uid: memory.uid });
          report.errors.push({
            uid: memory.uid,
            error: String(error),
          });
        }
      }
      // [runForgettingCycle:469] 记忆循环结束
      this.logger.debug('[runForgettingCycle:469] Memory loop completed');
    } finally {
      // [runForgettingCycle:471] finally 块
      this.isDegradationRunning = false;
      this.logger.debug('[runForgettingCycle:471] isDegradationRunning set to false');
    }

    report.duration = Date.now() - startTime;
    // [runForgettingCycle:474] duration 计算完成

    this.logger.info('[runForgettingCycle:476] Forgetting cycle completed', {
      scanned: report.scannedCount,
      archived: report.archivedCount,
      deleted: report.deletedCount,
      duration: report.duration,
    });

    // [runForgettingCycle:483] 返回 report
    return report;
  }

  /**
   * 评估记忆是否应该遗忘（双评分遗忘算法）
   *
   * 遗忘分数 = effectiveImportance * importanceWeight + effectiveScope * scopeWeight + aaakProtection
   * effectiveImportance = max(importance - daysSinceRecalled * decayRate * archivedDecayMultiplier, 0)
   * effectiveScope = max(scopeScore - daysSinceRecalled * decayRate * archivedDecayMultiplier, 0)
   * archivedDecayMultiplier = 2.0（归档记忆）或 1.0（普通记忆）
   * aaakProtection = AAAK flags 提供的额外保护（最大 1.0）
   *
   * 注意：Profile 类型（IDENTITY/PREFERENCE/PERSONA）永不遗忘
   */
  private evaluateForgetting(memory: MemoryMetaRecord): 'keep' | 'archive' | 'delete' {
    // Step 0: Profile 类型永不遗忘
    if (isProfileType(memory.type)) {
      return 'keep';
    }

    // Step 0.5: 提取 AAAK 保护系数（仅对未归档记忆生效）
    // 归档记忆按原规则遗忘，不受 AAAK 保护
    const aaakProtection = this.isArchived(memory) ? 0 : extractAAAKProtection(memory.tags);

    // 已经在归档状态，只检查是否应该删除（不受保护等级约束）
    if (this.isArchived(memory)) {
      const forgetScore = this.calculateForgetScore(memory, 0);
      if (forgetScore < this.config.deleteThreshold) {
        return 'delete';
      }
      return 'keep';
    }

    // Step 1: 检查保护等级（仅对未归档记忆生效）
    if (memory.importanceScore >= this.config.protectLevel) {
      return 'keep';
    }

    // Step 2: 计算遗忘分数（包含 AAAK 保护）
    const forgetScore = this.calculateForgetScore(memory, aaakProtection);

    // Step 3: 遗忘判定
    if (forgetScore < this.config.deleteThreshold) {
      return 'delete';
    }
    if (forgetScore < this.config.archiveThreshold) {
      return 'archive';
    }
    return 'keep';
  }

  /**
   * 计算遗忘分数（双评分遗忘算法）
   *
   * forgetScore = effectiveImportance * importanceWeight + effectiveScope * scopeWeight + aaakProtection
   * effectiveImportance = max(importanceScore - days * decayRate * archivedDecayMultiplier, 0)
   * effectiveScope = max(scopeScore - days * decayRate * archivedDecayMultiplier, 0)
   * archivedDecayMultiplier = 2.0（归档记忆衰减翻倍）或 1.0（普通记忆）
   * aaakProtection = AAAK flags 提供的额外保护（最大 1.0，来自 MemPalace 设计）
   *
   * @param memory 记忆元记录
   * @param aaakProtection AAAK flag 保护系数（从 tags 中提取），默认为 0
   */
  calculateForgetScore(memory: MemoryMetaRecord, aaakProtection: number = 0): number {
    const now = Date.now();
    const lastRecalled = memory.lastRecalledAt ?? memory.updatedAt;
    const daysSinceRecalled = (now - lastRecalled) / (1000 * 60 * 60 * 24);

    // 归档记忆衰减加速系数
    const isArchived = this.isArchived(memory);
    const archivedDecayMultiplier = isArchived ? 2.0 : 1.0;  // 归档记忆衰减翻倍

    // 有效重要性 = max(importance - days * decayRate * archivedDecayMultiplier, 0)
    const effectiveImportance = Math.max(
      memory.importanceScore - daysSinceRecalled * this.config.decayRate * archivedDecayMultiplier,
      0
    );

    // 有效作用域 = max(scope - days * decayRate * archivedDecayMultiplier, 0)
    const effectiveScope = Math.max(
      memory.scopeScore - daysSinceRecalled * this.config.decayRate * archivedDecayMultiplier,
      0
    );

    // AAAK 保护系数约束
    const clampedAAAKProtection = Math.max(0, Math.min(aaakProtection, AAAK_MAX_PROTECTION));

    const forgetScore =
      effectiveImportance * this.config.importanceWeight +
      effectiveScope * this.config.scopeWeight +
      clampedAAAKProtection;

    return forgetScore;
  }

  /**
   * 获取操作锁（防止并发 archive/delete 冲突）
   * 如果已有锁，等待其完成
   * @param uid 记忆UID
   * @param timeoutMs 超时时间（毫秒），默认5000ms
   * @returns 释放锁的函数，超时返回null
   */
  private async acquireOperationLock(uid: string, timeoutMs: number = 5000): Promise<(() => void) | null> {
    const startTime = Date.now();

    // 如果已有锁，等待其释放或超时
    while (this.operationLocks.has(uid)) {
      if (Date.now() - startTime > timeoutMs) {
        this.logger.warn('Failed to acquire operation lock (timeout)', { uid, timeoutMs });
        return null;
      }
      // 等待一小段时间后重试，避免CPU空转
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // 创建新锁
    let release: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.operationLocks.set(uid, lockPromise);

    return () => {
      this.operationLocks.delete(uid);
      release();
    };
  }

  /**
   * 判断记忆是否已归档
   */
  private isArchived(memory: MemoryMetaRecord): boolean {
    // 通过 tags 判断或通过 scope 判断
    return memory.tags?.includes('archived') ?? false;
  }

  // ============================================================
  // 作用域降级周期
  // ============================================================

  /**
   * 执行作用域降级周期
   * 扫描所有记忆，决定是否降级或升级
   */
  async runScopeDegradationCycle(): Promise<ScopeDegradationReport> {
    // 互斥锁：防止与遗忘周期并发执行
    if (this.isDegradationRunning) {
      this.logger.warn('Scope degradation cycle skipped (degradation already running)');
      return { scannedCount: 0, downgradedCount: 0, upgradedCount: 0, downgradedIds: [], upgradedIds: [], executedAt: Date.now() };
    }
    this.isDegradationRunning = true;

    // Clear scope change tracking for this cycle to prevent oscillation
    this.scopeChangedThisCycle.clear();

    const startTime = Date.now();

    const report: ScopeDegradationReport = {
      scannedCount: 0,
      downgradedCount: 0,
      upgradedCount: 0,
      downgradedIds: [],
      upgradedIds: [],
      executedAt: Date.now(),
    };

    if (!this.scopeConfig.enabled) {
      this.isDegradationRunning = false;
      return report;
    }

    try {
      const memories = await this.metaStore.query({
        isLatestVersion: true,
        limit: 10000,
      });

      report.scannedCount = memories.length;

      for (const memory of memories) {
        try {
          const action = this.evaluateScopeChange(memory);

          if (action === 'downgrade') {
            const newScope = this.getLowerScope(memory.scope);
            if (newScope) {
              await this.downgradeScope(memory.uid, newScope);
              report.downgradedCount++;
              report.downgradedIds.push(memory.uid);
            }
          } else if (action === 'upgrade') {
            const newScope = this.getHigherScope(memory.scope);
            if (newScope) {
              await this.upgradeScope(memory.uid, newScope);
              report.upgradedCount++;
              report.upgradedIds.push(memory.uid);
            }
          }
        } catch (error) {
          this.logger.warn('Scope change failed', {
            uid: memory.uid,
            error: String(error),
          });
        }
      }
    } finally {
      this.isDegradationRunning = false;
    }

    this.logger.info('Scope degradation cycle completed', {
      scanned: report.scannedCount,
      downgraded: report.downgradedCount,
      upgraded: report.upgradedCount,
    });

    return report;
  }

  /**
   * 评估作用域是否应该变更（双评分升级算法）
   *
   * 升级规则（基于双评分）：
   * - SESSION → AGENT: importance >= sessionToAgentImportance (默认5)
   * - AGENT → GLOBAL: scopeScore >= agentToGlobalScopeScore (默认6) AND importance >= agentToGlobalImportance (默认7)
   *
   * 降级规则（基于时间）：
   * - SESSION 超过 sessionToAgentDays 未访问 → AGENT
   * - AGENT 超过 agentToGlobalDays 未访问 → GLOBAL
   *
   * 注意：
   * - Profile 类型（IDENTITY/PREFERENCE/PERSONA）不自动变更作用域
   * - 归档记忆不参与作用域变更评估
   * - GLOBAL 作用域记忆不降级
   */
  private evaluateScopeChange(memory: MemoryMetaRecord): 'keep' | 'downgrade' | 'upgrade' {
    // Profile 类型不自动变更作用域
    if (isProfileType(memory.type)) {
      return 'keep';
    }

    // 归档记忆不参与作用域变更评估（将在遗忘周期被删除）
    if (this.isArchived(memory)) {
      return 'keep';
    }

    // 如果该 UID 在本周期内已经变更过作用域，跳过重新评估（防止降级后立即触发升级的震荡）
    if (this.scopeChangedThisCycle.has(memory.uid)) {
      return 'keep';
    }

    const now = Date.now();
    const lastRecalled = memory.lastRecalledAt ?? memory.updatedAt;
    const daysSinceRecalled = (now - lastRecalled) / (1000 * 60 * 60 * 24);

    // ========== 降级评估（基于时间）==========
    // 注意：GLOBAL 作用域记忆不降级 - 它们被认为是最重要的全局记忆
    if (memory.scope === MemoryScope.SESSION && daysSinceRecalled > this.scopeConfig.sessionToAgentDays) {
      return 'downgrade';
    }
    if (memory.scope === MemoryScope.AGENT && daysSinceRecalled > this.scopeConfig.agentToGlobalDays) {
      return 'downgrade';
    }

    // ========== 升级评估（基于双评分）==========
    // 使用与 block-utils.ts 中 shouldUpgradeScope 相同的逻辑
    const upgradeThresholds = {
      sessionToAgentImportance: this.scopeConfig.sessionUpgradeRecallThreshold, // 复用配置中的阈值
      agentToGlobalScopeScore: this.scopeConfig.upgradeScopeScoreMax,
      agentToGlobalImportance: this.scopeConfig.agentUpgradeRecallThreshold,
    };

    // SESSION → AGENT: importance >= sessionToAgentImportance
    if (memory.scope === MemoryScope.SESSION &&
        memory.importanceScore >= this.scopeConfig.sessionUpgradeRecallThreshold) {
      return 'upgrade';
    }

    // AGENT → GLOBAL: scopeScore >= agentToGlobalScopeScore AND importance >= agentToGlobalImportance
    if (memory.scope === MemoryScope.AGENT &&
        memory.scopeScore >= this.scopeConfig.upgradeScopeScoreMax &&
        memory.importanceScore >= this.scopeConfig.agentUpgradeRecallThreshold) {
      return 'upgrade';
    }

    return 'keep';
  }

  /**
   * 获取更低的作用域
   */
  private getLowerScope(scope: MemoryScope): MemoryScope | null {
    switch (scope) {
      case MemoryScope.GLOBAL:
        return MemoryScope.AGENT;
      case MemoryScope.AGENT:
        return MemoryScope.SESSION;
      default:
        return null;
    }
  }

  /**
   * 获取更高的作用域
   */
  private getHigherScope(scope: MemoryScope): MemoryScope | null {
    switch (scope) {
      case MemoryScope.SESSION:
        return MemoryScope.AGENT;
      case MemoryScope.AGENT:
        return MemoryScope.GLOBAL;
      default:
        return null;
    }
  }

  /**
   * 计算新的 PalaceLocation
   * 当作用域升级/降级时，需要重新计算 wingId
   */
  private calculateNewPalaceLocation(memory: MemoryMetaRecord, newScope: MemoryScope): PalaceLocation {
    // wingId 根据新作用域变化
    const wingId = this.calculateWingId(newScope, memory.agentId, memory.sessionId);

    return {
      wingId,
      hallId: memory.palace.hallId,
      roomId: memory.palace.roomId,
      closetId: memory.palace.closetId,
    };
  }

  /**
   * 计算 Wing ID
   */
  private calculateWingId(scope: MemoryScope, agentId: string, sessionId?: string): string {
    switch (scope) {
      case MemoryScope.SESSION:
        return `session_${sessionId || 'default'}`;
      case MemoryScope.AGENT:
        return `agent_${agentId}`;
      case MemoryScope.GLOBAL:
        return 'global';
      default:
        return `agent_${agentId}`;
    }
  }

  /**
   * 生成归档 palaceRef
   * 将 wingId 替换为 "archived"，保持其他部分不变
   * 格式: archived/{hallId}/{roomId}/closet_{uid}_v{version}
   * 如果 wingId 已经是 "archived"，直接返回原路径（避免重复归档）
   */
  private generateArchivePalaceRef(palaceRef: string): string {
    // palaceRef 格式: wingId/hallId/roomId/closet_uid_v{version}
    const parts = palaceRef.split('/');
    if (parts.length !== 4) {
      throw new Error(`Invalid palaceRef format: ${palaceRef}`);
    }
    const [wingId, hallId, roomId, closetFile] = parts;

    // 如果已经是 archived 路径，直接返回（避免重复归档）
    if (wingId === 'archived') {
      return palaceRef;
    }

    return `archived/${hallId}/${roomId}/${closetFile}`;
  }

  /**
   * 反向还原归档 palaceRef
   * 将 archived/{hallId}/{roomId}/closet_xxx_v{version}
   * 还原为 {originalWingId}/{hallId}/{roomId}/closet_xxx_v{version}
   */
  private reverseArchivePalaceRef(archivedPalaceRef: string, originalWingId: string): string {
    // archivedPalaceRef 格式: archived/{hallId}/{roomId}/closet_uid_v{version}
    const parts = archivedPalaceRef.split('/');
    if (parts.length !== 4) {
      throw new Error(`Invalid archived palaceRef format: ${archivedPalaceRef}`);
    }
    const [, hallId, roomId, closetFile] = parts;
    return `${originalWingId}/${hallId}/${roomId}/${closetFile}`;
  }

  /**
   * 降级作用域
   * 使用事务管理器确保 L2/L3/L4 层操作的原子性
   */
  private async downgradeScope(uid: string, newScope: MemoryScope): Promise<void> {
    // 获取操作锁，防止与 archive/delete 操作冲突
    const releaseLock = await this.acquireOperationLock(uid);
    if (!releaseLock) {
      throw new Error(`Failed to acquire lock for scope downgrade: ${uid}`);
    }

    try {
      const memory = await this.metaStore.getById(uid);
      if (!memory) {
        throw new Error(`Memory not found: ${uid}`);
      }

      const oldPalaceRef = memory.currentPalaceRef;
      const oldScope = memory.scope;
      const newPalaceLocation = this.calculateNewPalaceLocation(memory, newScope);
      const newPalaceRef = PalaceStore.generatePalaceRef(
        newPalaceLocation,
        uid,
        memory.version
      );

      // 计算降级后的 importanceScore（按 0.8 系数衰减）
      const degradedImportance = Math.max(
        1, // 最低保留下限
        Math.floor(memory.importanceScore * 0.8)
      );

      // 使用事务管理器确保原子性
      const txManager = new TransactionManager();
      const tx = txManager.beginTransaction();
      let migrationSucceeded = false;

      try {
        // 1. 迁移 palace 文件（事务外，带 try/catch）
        await this.palaceStore.move(oldPalaceRef, newPalaceRef);
        migrationSucceeded = true;

        // 2. 注册 metaStore 更新操作
        txManager.registerOperation(tx.id, {
          layer: 'meta',
          operation: 'update',
          targetId: uid,
          commit: async () => {
            await this.metaStore.update(uid, {
              scope: newScope,
              importanceScore: degradedImportance,
              scopeScore: Math.max(0, memory.scopeScore - 1),  // 降级时轻微降低 scopeScore
              palace: newPalaceLocation,
              currentPalaceRef: newPalaceRef,
              updatedAt: Date.now(),
              lastRecalledAt: Date.now(),  // 更新最后召回时间
            });
          },
          rollback: async () => {
            await this.metaStore.update(uid, {
              scope: oldScope,
              importanceScore: memory.importanceScore,
              scopeScore: memory.scopeScore,
              palace: memory.palace,
              currentPalaceRef: oldPalaceRef,
              updatedAt: Date.now(),
              lastRecalledAt: memory.lastRecalledAt,
            });
          },
        });

        // 3. 注册 vectorStore 元数据更新操作
        txManager.registerOperation(tx.id, {
          layer: 'vector',
          operation: 'update',
          targetId: uid,
          commit: async () => {
            await this.vectorStore.updateMetadata(uid, { palaceRef: newPalaceRef });
          },
          rollback: async () => {
            await this.vectorStore.updateMetadata(uid, { palaceRef: oldPalaceRef });
          },
        });

        // 4. 注册缓存失效操作
        txManager.registerOperation(tx.id, {
          layer: 'cache',
          operation: 'delete',
          targetId: uid,
          commit: async () => {
            await this.cacheManager.delete(uid);
          },
          rollback: async () => {
            // 缓存删除无回滚
          },
        });

        // 5. 提交事务
        await txManager.commit(tx.id);

        // 标记该 UID 在本周期内已变更过作用域（防止震荡）
        this.scopeChangedThisCycle.add(uid);

        this.logger.info('Memory scope downgraded', {
          uid,
          newScope,
          oldPalaceRef,
          newPalaceRef,
          oldImportance: memory.importanceScore,
          newImportance: degradedImportance,
        });
      } catch (error) {
        this.logger.error('Scope downgrade transaction failed, rolling back', {
          uid,
          oldPalaceRef,
          newPalaceRef,
          error: String(error),
        });

        // 回滚事务
        const rollbackResult = await txManager.rollback(tx.id);

        // 如果 palace 迁移已成功但后续失败，需要手动回滚 palace
        if (migrationSucceeded) {
          try {
            await this.palaceStore.move(newPalaceRef, oldPalaceRef);
            this.logger.info('Palace migration rolled back successfully', { uid, oldPalaceRef, newPalaceRef });
          } catch (rollbackError) {
            this.logger.error('CRITICAL: Palace migration rollback failed - manual intervention required', {
              uid,
              oldPalaceRef,
              newPalaceRef,
              error: String(rollbackError),
            });
          }
        }

        if (!rollbackResult.success) {
          this.logger.error('Transaction rollback had partial failures', {
            uid,
            failedOperations: rollbackResult.failedOperations,
          });
        }

        throw error;
      } finally {
        // 释放操作锁
        releaseLock();
      }
    } catch (error) {
      this.logger.error('Scope downgrade failed', error instanceof Error ? error : new Error(String(error)), { uid });
      throw error;
    }
  }

  /**
   * 升级作用域
   * 公开方法，供外部调用（如 StorageMemoryService）
   * 使用事务管理器确保 L2/L3/L4 层操作的原子性
   */
  async upgradeScope(uid: string, newScope: MemoryScope): Promise<void> {
    // 获取操作锁，防止与 archive/delete 操作冲突
    const releaseLock = await this.acquireOperationLock(uid);
    if (!releaseLock) {
      throw new Error(`Failed to acquire lock for scope upgrade: ${uid}`);
    }

    try {
      const memory = await this.metaStore.getById(uid);
      if (!memory) {
        throw new Error(`Memory not found: ${uid}`);
      }

      const oldPalaceRef = memory.currentPalaceRef;
      const oldScope = memory.scope;
      const newPalaceLocation = this.calculateNewPalaceLocation(memory, newScope);
      const newPalaceRef = PalaceStore.generatePalaceRef(
        newPalaceLocation,
        uid,
        memory.version
      );

      // 使用事务管理器确保原子性
      const txManager = new TransactionManager();
      const tx = txManager.beginTransaction();
      let migrationSucceeded = false;

      try {
        // 1. 迁移 palace 文件（事务外，带 try/catch）
        await this.palaceStore.move(oldPalaceRef, newPalaceRef);
        migrationSucceeded = true;

        // 2. 注册 metaStore 更新操作
        txManager.registerOperation(tx.id, {
          layer: 'meta',
          operation: 'update',
          targetId: uid,
          commit: async () => {
            // 计算升级时的 importance 强化幅度（与 applyReinforcement 一致）
            const importanceBoost = this.calculateImportanceBoost(memory.importanceScore);
            const newImportance = Math.min(
              memory.importanceScore + importanceBoost,
              this.reinforcementConfig.maxImportance
            );
            await this.metaStore.update(uid, {
              scope: newScope,
              importanceScore: newImportance,
              scopeScore: Math.min(10, memory.scopeScore + this.reinforcementConfig.scopeBoost),
              palace: newPalaceLocation,
              currentPalaceRef: newPalaceRef,
              updatedAt: Date.now(),
              lastRecalledAt: Date.now(),
            });
          },
          rollback: async () => {
            await this.metaStore.update(uid, {
              scope: oldScope,
              importanceScore: memory.importanceScore,
              scopeScore: memory.scopeScore,
              palace: memory.palace,
              currentPalaceRef: oldPalaceRef,
              updatedAt: Date.now(),
              lastRecalledAt: memory.lastRecalledAt,
            });
          },
        });

        // 3. 注册 vectorStore 元数据更新操作
        txManager.registerOperation(tx.id, {
          layer: 'vector',
          operation: 'update',
          targetId: uid,
          commit: async () => {
            await this.vectorStore.updateMetadata(uid, { palaceRef: newPalaceRef });
          },
          rollback: async () => {
            await this.vectorStore.updateMetadata(uid, { palaceRef: oldPalaceRef });
          },
        });

      // 4. 注册缓存失效操作
      txManager.registerOperation(tx.id, {
        layer: 'cache',
        operation: 'delete',
        targetId: uid,
        commit: async () => {
          await this.cacheManager.delete(uid);
        },
        rollback: async () => {
          // 缓存删除无回滚
        },
      });

      // 5. 提交事务
      await txManager.commit(tx.id);

      // 标记该 UID 在本周期内已变更过作用域（防止震荡）
      this.scopeChangedThisCycle.add(uid);

      this.logger.info('Memory scope upgraded', { uid, newScope, oldPalaceRef, newPalaceRef });
      } catch (error) {
        this.logger.error('Scope upgrade transaction failed, rolling back', {
          uid,
          oldPalaceRef,
          newPalaceRef,
          error: String(error),
        });

        // 回滚事务
        const rollbackResult = await txManager.rollback(tx.id);

        // 如果 palace 迁移已成功但后续失败，需要手动回滚 palace
        if (migrationSucceeded) {
          try {
            await this.palaceStore.move(newPalaceRef, oldPalaceRef);
            this.logger.info('Palace migration rolled back successfully', { uid, oldPalaceRef, newPalaceRef });
          } catch (rollbackError) {
            this.logger.error('CRITICAL: Palace migration rollback failed - manual intervention required', {
              uid,
              oldPalaceRef,
              newPalaceRef,
              error: String(rollbackError),
            });
          }
        }

        if (!rollbackResult.success) {
          this.logger.error('Transaction rollback had partial failures', {
            uid,
            failedOperations: rollbackResult.failedOperations,
          });
        }

        throw error;
      } finally {
        // 释放操作锁
        releaseLock();
      }
    } catch (error) {
      this.logger.error('Scope upgrade failed', error instanceof Error ? error : new Error(String(error)), { uid });
      throw error;
    }
  }

  // ============================================================
  // 记忆操作
  // ============================================================

  /**
   * 归档记忆
   *
   * 使用事务管理器确保 L2/L3/L4 层操作的原子性
   * 注意：不删除向量存储，保留恢复能力。归档记忆通过 recall 时过滤 archived 标签来排除
   */
  async archiveMemory(uid: string): Promise<void> {
    // 获取操作锁，防止与 delete 操作冲突
    const releaseLock = await this.acquireOperationLock(uid);
    if (!releaseLock) {
      throw new Error(`Failed to acquire lock for archive: ${uid}`);
    }

    // 注意：不在这里设置 isArchivationInProgress，由调用者管理
    const now = Date.now();

    // 获取记忆并检查是否已归档
    const memory = await this.metaStore.getById(uid);
    if (!memory) {
      releaseLock();
      throw new Error(`Memory not found: ${uid}`);
    }

    // 如果已经归档，直接返回避免重复标签
    if (this.isArchived(memory)) {
      releaseLock();
      this.logger.debug('Memory already archived, skipping', { uid });
      return;
    }

    const oldPalaceRef = memory.currentPalaceRef;

    // 生成归档 palaceRef（wingId 替换为 "archived"）
    const archivePalaceRef = this.generateArchivePalaceRef(oldPalaceRef);

    // 使用事务管理器确保原子性
    let tx: ReturnType<TransactionManager['beginTransaction']> | null = null;
    const allMigratedRefs: { oldRef: string; newRef: string }[] = [];

    try {
      tx = this.txManager.beginTransaction();

      // 1. 注册当前版本 palace 迁移操作（两阶段提交）
      //    prepare: 执行文件迁移
      //    commit: 无需操作（文件已迁移）
      //    rollback: 回滚文件到原位置
      this.txManager.registerOperation(tx.id, {
        layer: 'palace',
        operation: 'update',
        targetId: `${oldPalaceRef}:${archivePalaceRef}`,
        prepare: async () => {
          try {
            await this.palaceStore.move(oldPalaceRef, archivePalaceRef);
            allMigratedRefs.push({ oldRef: oldPalaceRef, newRef: archivePalaceRef });
            return true;
          } catch (moveErr) {
            this.logger.error('Failed to prepare palace migration', {
              uid,
              oldPalaceRef,
              archivePalaceRef,
              error: String(moveErr),
            });
            return false;
          }
        },
        commit: async () => {
          // 文件已迁移，无需额外操作
        },
        rollback: async () => {
          try {
            await this.palaceStore.move(archivePalaceRef, oldPalaceRef);
            this.logger.debug('Palace migration rolled back', { uid, oldPalaceRef, archivePalaceRef });
          } catch (rollbackErr) {
            this.logger.error('CRITICAL: Palace rollback failed', {
              uid,
              oldPalaceRef,
              archivePalaceRef,
              error: String(rollbackErr),
            });
          }
        },
      });

      // 2. 并行迁移历史版本的 palace 文件
      //    注意：并行执行，但全部在事务保护下
      const movePromises = memory.versionChain.map(async (versionInfo) => {
        const oldRef = versionInfo.palaceRef;
        const newRef = this.generateArchivePalaceRef(oldRef);
        try {
          await this.palaceStore.move(oldRef, newRef);
          return { success: true, versionInfo, oldRef, newRef };
        } catch (err) {
          // 移动失败，保留原路径（文件可能已不存在）
          this.logger.warn('Failed to archive version palace file, keeping original ref', { oldRef, error: String(err) });
          return { success: false, versionInfo, oldRef, newRef, error: err };
        }
      });

      const results = await Promise.all(movePromises);

      // 3. 收集成功迁移的版本引用
      for (const result of results) {
        if (result.success) {
          allMigratedRefs.push({ oldRef: result.oldRef, newRef: result.newRef });
        }
      }

      // 4. 构建归档后的 versionChain
      const archivedVersionChain: VersionInfo[] = results.map((result) => {
        if (result.success) {
          return { ...result.versionInfo, palaceRef: result.newRef };
        } else {
          return result.versionInfo;
        }
      });

      // 5. 添加归档标签和原始 palaceRef 标签（用于恢复）
      const newTags = [
        ...(memory.tags || []),
        'archived',
        `originalPalaceRef:${oldPalaceRef}`,
      ];

      // 6. 计算归档后的 palace location（wingId 替换为 "archived"）
      const archivedPalaceLocation: PalaceLocation = {
        wingId: 'archived',
        hallId: memory.palace.hallId,
        roomId: memory.palace.roomId,
        closetId: memory.palace.closetId,
      };

      // 7. 注册 metaStore 更新操作
      this.txManager.registerOperation(tx.id, {
        layer: 'meta',
        operation: 'update',
        targetId: uid,
        commit: async () => {
          await this.metaStore.update(uid, {
            tags: newTags,
            palace: archivedPalaceLocation,
            currentPalaceRef: archivePalaceRef,
            versionChain: archivedVersionChain,
            updatedAt: now,
          });
        },
        rollback: async () => {
          // 构建回滚用的 versionChain（恢复原始 palaceRef）
          const rollbackVersionChain = memory.versionChain.map((v) => v);
          await this.metaStore.update(uid, {
            tags: memory.tags,
            palace: memory.palace,
            currentPalaceRef: oldPalaceRef,
            versionChain: rollbackVersionChain,
            updatedAt: Date.now(),
          });
        },
      });

      // 8. 注册 vectorStore 元数据更新操作
      this.txManager.registerOperation(tx.id, {
        layer: 'vector',
        operation: 'update',
        targetId: uid,
        commit: async () => {
          await this.vectorStore.updateMetadata(uid, {
            palaceRef: archivePalaceRef,
            isLatestVersion: true,
          });
        },
        rollback: async () => {
          await this.vectorStore.updateMetadata(uid, { palaceRef: oldPalaceRef });
        },
      });

      // 9. 注册缓存失效操作
      this.txManager.registerOperation(tx.id, {
        layer: 'cache',
        operation: 'delete',
        targetId: uid,
        commit: async () => {
          await this.cacheManager.delete(uid);
        },
        rollback: async () => {
          // 缓存删除无回滚
        },
      });

      // 10. 注册图谱移除操作（归档记忆不再参与图谱计算）
      this.txManager.registerOperation(tx.id, {
        layer: 'graph',
        operation: 'delete',
        targetId: uid,
        commit: async () => {
          await this.graphStore.removeMemory(uid);
        },
        rollback: async () => {
          // 图谱移除无法回滚（但归档状态下的图谱移除影响较小）
        },
      });

      // 11. 提交事务
      await this.txManager.commit(tx.id);

      this.logger.info('Memory archived', { uid, oldPalaceRef, archivePalaceRef });
    } catch (error) {
      this.logger.error('Archive transaction failed, rolling back', error instanceof Error ? error : new Error(String(error)), { uid });

      // Determine if transaction still exists and needs rollback
      // Note: prepare() may have already rolled back and deleted the transaction
      const txId = tx?.id;
      let needsRollback = false;
      if (txId) {
        const existingTx = this.txManager.getTransaction(txId);
        needsRollback = !!existingTx && existingTx.status !== 'rolled_back';
      }

      const rollbackResult = needsRollback && txId
        ? await this.txManager.rollback(txId)
        : { success: true, failedOperations: [] };

      // 如果 palace 迁移已成功但后续失败，需要手动回滚所有 palace 文件
      if (allMigratedRefs.length > 0) {
        for (const { oldRef, newRef } of allMigratedRefs) {
          try {
            await this.palaceStore.move(newRef, oldRef);
          } catch (rollbackError) {
            this.logger.error('CRITICAL: Palace migration rollback failed - manual intervention required', {
              uid,
              oldRef,
              newRef,
              error: String(rollbackError),
            });
          }
        }
        this.logger.info('Palace migration rollback completed', { uid, rolledBackCount: allMigratedRefs.length });
      }

      if (!rollbackResult.success) {
        this.logger.error('Transaction rollback had partial failures', {
          uid,
          failedOperations: rollbackResult.failedOperations,
        });
      }

      throw error;
    } finally {
      // 释放操作锁
      releaseLock();
    }
    // 注意：isArchivationInProgress 由调用者管理，archiveMemory 本身不管理此状态
  }

  /**
   * 恢复记忆（从归档状态）
   * 使用事务管理器确保 L2/L3/L4 层操作的原子性
   * 恢复后：
   * - 移除 archived 标签和 originalPalaceRef 标签
   * - 重置 recallCount（避免恢复后立即触发作用域升级）
   * - 将 palace 文件从归档区域移回原始位置
   * - 重建图谱关联
   */
  async restoreMemory(uid: string): Promise<void> {
    // 获取操作锁，防止与 archive/delete 操作冲突
    const releaseLock = await this.acquireOperationLock(uid);
    if (!releaseLock) {
      throw new Error(`Failed to acquire lock for restore: ${uid}`);
    }

    // 注意：不在这里设置 isRestorationInProgress，由调用者管理

    // 获取记忆
    const memory = await this.metaStore.getById(uid);
    if (!memory) {
      releaseLock();
      throw new Error(`Memory not found: ${uid}`);
    }

    // 如果没有 archived 标签，无需恢复
    if (!this.isArchived(memory)) {
      releaseLock();
      this.logger.debug('Memory not archived, skipping restore', { uid });
      return;
    }

    // 从标签中解析原始 palaceRef
    const originalPalaceRefTag = (memory.tags || []).find((t) => t.startsWith('originalPalaceRef:'));
    if (!originalPalaceRefTag) {
      releaseLock();
      throw new Error(`Cannot restore memory: originalPalaceRef tag not found for ${uid}`);
    }
    const originalPalaceRef = originalPalaceRefTag.replace('originalPalaceRef:', '');

    // 解析原始 palaceRef 获取原始 wingId（用于恢复 palace 对象）
    const originalPalaceParsed = PalaceStore.parsePalaceRef(originalPalaceRef);
    if (!originalPalaceParsed) {
      releaseLock();
      throw new Error(`Cannot parse original palaceRef: ${originalPalaceRef}`);
    }

    // 保存归档路径（用于可能的回滚）
    const archivePalaceRef = memory.currentPalaceRef;

    // 使用事务管理器确保原子性
    let tx: ReturnType<TransactionManager['beginTransaction']> | null = null;
    const allMigratedRefs: { archivedRef: string; originalRef: string }[] = [];

    try {
      tx = this.txManager.beginTransaction();

      // 1. 注册当前版本 palace 恢复操作（两阶段提交）
      //    prepare: 执行文件迁移（从归档位置移回原始位置）
      //    commit: 无需操作（文件已迁移）
      //    rollback: 回滚文件到归档位置
      this.txManager.registerOperation(tx.id, {
        layer: 'palace',
        operation: 'update',
        targetId: `${archivePalaceRef}:${originalPalaceRef}`,
        prepare: async () => {
          try {
            await this.palaceStore.move(archivePalaceRef, originalPalaceRef);
            allMigratedRefs.push({ archivedRef: archivePalaceRef, originalRef: originalPalaceRef });
            return true;
          } catch (moveErr) {
            this.logger.error('Failed to prepare palace restore', {
              uid,
              archivePalaceRef,
              originalPalaceRef,
              error: String(moveErr),
            });
            return false;
          }
        },
        commit: async () => {
          // 文件已迁移，无需额外操作
        },
        rollback: async () => {
          try {
            await this.palaceStore.move(originalPalaceRef, archivePalaceRef);
            this.logger.debug('Palace restore rolled back', { uid, archivePalaceRef, originalPalaceRef });
          } catch (rollbackErr) {
            this.logger.error('CRITICAL: Palace restore rollback failed', {
              uid,
              archivePalaceRef,
              originalPalaceRef,
              error: String(rollbackErr),
            });
          }
        },
      });

      // 2. 恢复历史版本的 palace 文件（并行执行）
      const movePromises = memory.versionChain.map(async (versionInfo) => {
        const potentialArchivedRef = versionInfo.palaceRef;

        // 只有实际归档的版本才需要恢复（归档路径以 "archived/" 开头）
        if (!potentialArchivedRef.startsWith('archived/')) {
          return { success: true, versionInfo, skipped: true };
        }

        const originalRef = this.reverseArchivePalaceRef(potentialArchivedRef, originalPalaceParsed.location.wingId);
        try {
          await this.palaceStore.move(potentialArchivedRef, originalRef);
          return { success: true, versionInfo, archivedRef: potentialArchivedRef, originalRef };
        } catch (err) {
          this.logger.warn('Failed to restore version palace file, keeping archived ref', { archivedRef: potentialArchivedRef, originalRef, error: String(err) });
          return { success: false, versionInfo, archivedRef: potentialArchivedRef, originalRef, error: err };
        }
      });

      const results = await Promise.all(movePromises);

      // 3. 收集成功迁移的版本引用
      for (const result of results) {
        if (result.success && !result.skipped && result.archivedRef) {
          allMigratedRefs.push({ archivedRef: result.archivedRef, originalRef: result.originalRef! });
        }
      }

      // 4. 构建恢复后的 versionChain
      const restoredVersionChain: VersionInfo[] = results.map((result) => {
        if (result.skipped) {
          return result.versionInfo;
        } else if (result.success && result.originalRef) {
          return { ...result.versionInfo, palaceRef: result.originalRef };
        } else {
          return result.versionInfo;
        }
      });

      // 5. 移除归档标签和原始 palaceRef 标签
      const newTags = (memory.tags || []).filter(
        (t) => t !== 'archived' && !t.startsWith('originalPalaceRef:')
      );

      // 6. 恢复后的 palace location（wingId 还原为原始值）
      const restoredPalaceLocation: PalaceLocation = {
        wingId: originalPalaceParsed.location.wingId,
        hallId: memory.palace.hallId,
        roomId: memory.palace.roomId,
        closetId: memory.palace.closetId,
      };

      // 7. 注册 metaStore 更新操作
      this.txManager.registerOperation(tx.id, {
        layer: 'meta',
        operation: 'update',
        targetId: uid,
        commit: async () => {
          await this.metaStore.update(uid, {
            tags: newTags,
            palace: restoredPalaceLocation,
            currentPalaceRef: originalPalaceRef,
            versionChain: restoredVersionChain,
            updatedAt: Date.now(),
            recallCount: 0,
          });
        },
        rollback: async () => {
          // 回滚用的 versionChain（恢复归档路径）
          const rollbackVersionChain = memory.versionChain.map((v) => v);
          await this.metaStore.update(uid, {
            tags: memory.tags,
            palace: memory.palace,
            currentPalaceRef: archivePalaceRef,
            versionChain: rollbackVersionChain,
            updatedAt: Date.now(),
          });
        },
      });

      // 8. 注册 vectorStore 元数据更新操作
      this.txManager.registerOperation(tx.id, {
        layer: 'vector',
        operation: 'update',
        targetId: uid,
        commit: async () => {
          await this.vectorStore.updateMetadata(uid, {
            palaceRef: originalPalaceRef,
            isLatestVersion: true,
          });
        },
        rollback: async () => {
          await this.vectorStore.updateMetadata(uid, { palaceRef: archivePalaceRef });
        },
      });

      // 9. 注册缓存失效操作
      this.txManager.registerOperation(tx.id, {
        layer: 'cache',
        operation: 'delete',
        targetId: uid,
        commit: async () => {
          await this.cacheManager.delete(uid);
        },
        rollback: async () => {
          // 缓存删除无回滚
        },
      });

      // 10. 注册图谱重建操作
      // 创建副本以避免修改原始 memory 对象
      const memoryForGraph = { ...memory };
      this.txManager.registerOperation(tx.id, {
        layer: 'graph',
        operation: 'insert',
        targetId: uid,
        commit: async () => {
          // 先移除旧的图谱关联（如果存在）
          await this.graphStore.removeMemory(uid);
          // 使用副本设置正确的 palace 路径
          memoryForGraph.currentPalaceRef = originalPalaceRef;
          memoryForGraph.palace = restoredPalaceLocation;
          await this.rebuildMemoryGraph(memoryForGraph, newTags);
        },
        rollback: async () => {
          // 图谱无法回滚到之前的状态（需要完整内容才能重建）
        },
      });

      // 11. 提交事务
      await this.txManager.commit(tx.id);

      this.logger.info('Memory restored from archive', { uid, originalPalaceRef });
    } catch (error) {
      this.logger.error('Restore transaction failed, rolling back', error instanceof Error ? error : new Error(String(error)), { uid });

      // 回滚事务
      const rollbackResult = await this.txManager.rollback(tx!.id);

      // 如果 palace 迁移已成功但后续失败，需要手动回滚所有 palace 文件
      if (allMigratedRefs.length > 0) {
        for (const { archivedRef, originalRef } of allMigratedRefs) {
          try {
            await this.palaceStore.move(originalRef, archivedRef);
          } catch (rollbackError) {
            this.logger.error('CRITICAL: Palace migration rollback failed - manual intervention required', {
              uid,
              archivedRef,
              originalRef,
              error: String(rollbackError),
            });
          }
        }
        this.logger.info('Palace migration rollback completed', { uid, rolledBackCount: allMigratedRefs.length });
      }

      if (!rollbackResult.success) {
        this.logger.error('Transaction rollback had partial failures', {
          uid,
          failedOperations: rollbackResult.failedOperations,
        });
      }

      throw error;
    } finally {
      // 释放操作锁
      releaseLock();
    }
    // 注意：isRestorationInProgress 由调用者管理，restoreMemory 本身不管理此状态
  }

  /**
   * 重建记忆的图谱关联
   * 从 palace 获取内容，构建实体和边，然后添加到图谱
   */
  private async rebuildMemoryGraph(memory: MemoryMetaRecord, tags: string[]): Promise<void> {
    const memoryUid = memory.uid;

    try {
      // 从 palace 获取记忆内容
      const content = await this.palaceStore.retrieve(memory.currentPalaceRef);
      if (!content) {
        this.logger.warn('restoreMemory: could not retrieve content from palace', { uid: memoryUid, palaceRef: memory.currentPalaceRef });
        return;
      }

      const entities: GraphNodeRecord[] = [];
      const edges: GraphEdgeRecord[] = [];

      // 1. 记忆本身作为实体节点
      entities.push({
        id: memoryUid,
        entity: content.substring(0, 100),
        type: 'entity',
        uid: memoryUid,
        memoryIds: [memoryUid],
        properties: {
          memoryType: memory.type,
          scope: memory.scope,
          importance: memory.importanceScore,
          createdAt: memory.createdAt,
        },
      });

      // 2. 标签作为概念节点，建立 has_tag 边
      // 注意：使用与 _addMemoryToGraph 相同的编码格式，确保 tag 实体 ID 一致
      const validTags = tags.filter(t => t !== 'archived');
      for (const tag of validTags) {
        const tagEntityId = StringUtils.encodeTagEntityId(tag);
        entities.push({
          id: tagEntityId,
          entity: tag,
          type: 'concept',
          uid: '',
          memoryIds: [],
          properties: {},
        });
        edges.push({
          id: `edge_${memoryUid}_${tagEntityId}`,
          sourceId: memoryUid,
          targetId: tagEntityId,
          relation: 'has_tag',
          weight: 1.0,
        });
      }

      // 3. 通过共享标签建立共现边（查询有相同标签的记忆）
      if (validTags.length > 0) {
        const relatedMemoryIds = await this.graphStore.findMemoriesByTags(validTags);
        for (const relatedId of relatedMemoryIds) {
          if (relatedId !== memoryUid) {
            edges.push({
              id: `edge_${memoryUid}_${relatedId}`,
              sourceId: memoryUid,
              targetId: relatedId,
              relation: 'co_occurs_with',
              weight: 0.8,
            });
          }
        }
      }

      // 添加到图谱
      await this.graphStore.addMemory(memoryUid, entities, edges);
      this.logger.debug('Memory graph rebuilt', { uid: memoryUid, entityCount: entities.length, edgeCount: edges.length });
    } catch (error) {
      this.logger.error('Failed to rebuild memory graph', error instanceof Error ? error : new Error(String(error)), { uid: memoryUid });
      // 不抛出错误，避免影响恢复流程
    }
  }

  /**
   * 永久删除记忆（删除所有版本）
   */
  async deleteMemory(uid: string): Promise<void> {
    // 获取操作锁，防止与 archive/restore 操作冲突
    const releaseLock = await this.acquireOperationLock(uid);
    if (!releaseLock) {
      throw new Error(`Failed to acquire lock for delete: ${uid}`);
    }
    try {
      // 检查是否有其他操作正在进行
      if (this.isArchivationInProgress) {
        throw new Error('Cannot delete memory while archivation is in progress');
      }
      if (this.isRestorationInProgress) {
        throw new Error('Cannot delete memory while restoration is in progress');
      }

      // 如果在降解周期外部调用删除，且周期正在运行，记录警告
      if (!this.isDeletionInProgress && this.isDegradationRunning) {
        this.logger.warn('deleteMemory called externally while degradation cycle is running', { uid });
      }

      // 1. 获取记忆信息，找到 versionGroupId
      const memory = await this.metaStore.getById(uid);
      if (!memory) {
        this.logger.warn('Memory not found for deletion', { uid });
        return;
      }

      // 2. 找到所有相关版本（同一 versionGroupId 的所有记忆）
      const versionGroupId = memory.versionGroupId || uid;

      // 直接通过 versionGroupId 查询（数据库层过滤，更高效）
      const allMetas = await this.metaStore.query({
        versionGroupId,
        limit: 10000,
      });
      const uidsToDelete = allMetas.map(m => m.uid);

      this.logger.info('Deleting memory and all versions', {
        uid,
        versionGroupId,
        versionsToDelete: uidsToDelete.length,
      });

      // 3. 收集所有 palaceRef（使用 Set 去重）
      const palaceRefsSet = new Set<string>();
      for (const m of allMetas) {
        if (m.versionChain) {
          for (const v of m.versionChain) {
            palaceRefsSet.add(v.palaceRef);
          }
        }
        if (m.currentPalaceRef) {
          palaceRefsSet.add(m.currentPalaceRef);
        }
      }
      const palaceRefs = Array.from(palaceRefsSet);

      // 4. 使用事务删除所有层
      const tx = this.txManager.beginTransaction();

      // 注册 Cache 删除操作
      for (const id of uidsToDelete) {
        this.txManager.registerOperation(tx.id, {
          layer: 'cache',
          operation: 'delete',
          targetId: id,
          commit: async () => { await this.cacheManager.delete(id); },
          rollback: async () => { /* 删除操作无法回滚 */ },
        });
      }

      // 注册 VectorDB 删除操作
      for (const id of uidsToDelete) {
        this.txManager.registerOperation(tx.id, {
          layer: 'vector',
          operation: 'delete',
          targetId: id,
          commit: async () => { await this.vectorStore.delete(id); },
          rollback: async () => { /* 删除操作无法回滚 */ },
        });
      }

      // 注册 MetaStore 删除操作
      for (const id of uidsToDelete) {
        this.txManager.registerOperation(tx.id, {
          layer: 'meta',
          operation: 'delete',
          targetId: id,
          commit: async () => { await this.metaStore.delete(id); },
          rollback: async () => { /* 删除操作无法回滚 */ },
        });
      }

      // 注册 Palace 删除操作
      for (const ref of palaceRefs) {
        this.txManager.registerOperation(tx.id, {
          layer: 'palace',
          operation: 'delete',
          targetId: ref,
          commit: async () => { await this.palaceStore.delete(ref); },
          rollback: async () => { /* 删除操作无法回滚 */ },
        });
      }

      // 注册 Graph 删除操作
      for (const id of uidsToDelete) {
        this.txManager.registerOperation(tx.id, {
          layer: 'graph',
          operation: 'delete',
          targetId: id,
          commit: async () => { await this.graphStore.removeMemory(id); },
          rollback: async () => { /* 删除操作无法回滚 */ },
        });
      }

      try {
        await this.txManager.commit(tx.id);
      } catch (error) {
        this.logger.error('Memory deletion transaction failed', error instanceof Error ? error : new Error(String(error)), { uid });
        throw error;
      } finally {
        // 释放操作锁
        releaseLock();
      }

      this.logger.info('Memory permanently deleted', {
        uid,
        versionsDeleted: uidsToDelete.length,
        palaceRefsDeleted: palaceRefs.length,
      });
    } catch (error) {
      // 外层捕获：确保锁释放
      this.logger.error('Memory deletion failed', error instanceof Error ? error : new Error(String(error)), { uid });
      releaseLock();
      throw error;
    }
  }

  // ============================================================
  // 强化机制
  // ============================================================

  /**
   * 强化记忆（被召回时调用）
   *
   * 强化规则：
   * - 低重要性 (<3): +0.5
   * - 中重要性 (3-6): +0.3
   * - 高重要性 (>=6): +0.1
   */
  async applyReinforcement(
    uid: string,
    memory: MemoryMetaRecord,
    currentAgentId: string
  ): Promise<{ newImportance: number; newScopeScore: number }> {
    if (!this.reinforcementConfig.enabled) {
      return {
        newImportance: memory.importanceScore,
        newScopeScore: memory.scopeScore,
      };
    }

    // 不对已归档记忆进行强化（归档记忆在遗忘周期会被删除）
    if (this.isArchived(memory)) {
      this.logger.debug('Skipping reinforcement for archived memory', { uid });
      return {
        newImportance: memory.importanceScore,
        newScopeScore: memory.scopeScore,
      };
    }

    // 检查冷却
    const cooldownCheck = this.checkCooldown(uid);
    if (!cooldownCheck.allowed) {
      return {
        newImportance: memory.importanceScore,
        newScopeScore: memory.scopeScore,
      };
    }

    const now = Date.now();

    // 计算 importance 强化幅度
    const importanceBoost = this.calculateImportanceBoost(memory.importanceScore);

    // 计算 scopeScore 强化幅度（仅当被其他Agent召回时）
    let scopeBoost = 0;
    if (memory.agentId !== currentAgentId) {
      scopeBoost = this.reinforcementConfig.scopeBoost;
    }

    const newImportance = Math.min(
      memory.importanceScore + importanceBoost,
      this.reinforcementConfig.maxImportance
    );
    const newScopeScore = Math.min(memory.scopeScore + scopeBoost, 10);

    // 使用事务保证 metaStore 和 cache 的一致性
    const txManager = new TransactionManager();
    const tx = txManager.beginTransaction();

    let success = false;
    try {
      // 注册 metaStore 更新操作
      txManager.registerOperation(tx.id, {
        layer: 'meta',
        operation: 'update',
        targetId: uid,
        commit: async () => {
          await this.metaStore.update(uid, {
            importanceScore: newImportance,
            scopeScore: newScopeScore,
            lastRecalledAt: now,
          });
        },
        rollback: async () => {
          // 回滚：恢复原始值
          this.logger.warn('applyReinforcement 回滚：恢复原始评分', { uid });
          await this.metaStore.update(uid, {
            importanceScore: memory.importanceScore,
            scopeScore: memory.scopeScore,
            lastRecalledAt: memory.lastRecalledAt ?? now,
          });
        },
      });

      // 注册 cache 删除操作
      txManager.registerOperation(tx.id, {
        layer: 'cache',
        operation: 'delete',
        targetId: uid,
        commit: async () => {
          await this.cacheManager.delete(uid);
        },
        rollback: async () => {
          // Cache 删除无法回滚，仅记录
          this.logger.warn('applyReinforcement 回滚：Cache 删除无法恢复', { uid });
        },
      });

      // 执行事务
      await txManager.commit(tx.id);
      success = true;

      // 记录强化时间
      this.recordReinforce(uid);

      this.logger.debug('Reinforcement applied', {
        uid,
        previousImportance: memory.importanceScore,
        newImportance,
        scopeBoost,
      });
    } catch (error) {
      this.logger.error('applyReinforcement failed', {
        uid,
        error: error instanceof Error ? error.message : String(error),
      });
      // 事务已自动回滚
    } finally {
      // 确保更新本地 memory 对象以反映新值（用于调用方）
      if (success) {
        memory.importanceScore = newImportance;
        memory.scopeScore = newScopeScore;
        memory.lastRecalledAt = now;
      }
    }

    return { newImportance, newScopeScore };
  }

  /**
   * 计算重要性强化幅度
   */
  private calculateImportanceBoost(currentImportance: number): number {
    if (currentImportance < this.reinforcementConfig.lowBoostThreshold) {
      return this.reinforcementConfig.lowBoost;
    }
    if (currentImportance < this.reinforcementConfig.mediumBoostThreshold) {
      return this.reinforcementConfig.mediumBoost;
    }
    if (currentImportance < this.reinforcementConfig.highBoostThreshold) {
      return this.reinforcementConfig.highBoost;
    }
    return this.reinforcementConfig.defaultBoost;
  }

  /**
   * 检查冷却
   */
  private checkCooldown(uid: string): { allowed: boolean; remaining: number } {
    const now = Date.now();

    // 检查全局冷却
    if (now - this.globalLastReinforceTime < this.reinforcementConfig.cooldownMs) {
      return {
        allowed: false,
        remaining: this.reinforcementConfig.cooldownMs - (now - this.globalLastReinforceTime),
      };
    }

    // 检查单个记忆冷却
    const lastTime = this.lastReinforceTime.get(uid);
    if (lastTime && now - lastTime < this.reinforcementConfig.cooldownMs) {
      return {
        allowed: false,
        remaining: this.reinforcementConfig.cooldownMs - (now - lastTime),
      };
    }

    return { allowed: true, remaining: 0 };
  }

  /**
   * 记录强化时间
   */
  private recordReinforce(uid: string): void {
    const now = Date.now();
    this.lastReinforceTime.set(uid, now);
    this.globalLastReinforceTime = now;
  }

  // ============================================================
  // 统计
  // ============================================================

  /**
   * 获取遗忘统计
   */
  async getDegradationStats(): Promise<DegradationStats> {
    const memories = await this.metaStore.query({
      isLatestVersion: true,
      limit: 10000,
    });

    let totalImportance = 0;
    let totalLastRecalled = 0;
    let hasRecalledCount = 0;
    const scopeDist = { session: 0, agent: 0, global: 0 };

    for (const memory of memories) {
      totalImportance += memory.importanceScore;

      // 安全地更新作用域分布
      const scopeKey = memory.scope.toLowerCase() as 'session' | 'agent' | 'global';
      if (scopeKey in scopeDist) {
        scopeDist[scopeKey]++;
      }

      if (memory.lastRecalledAt) {
        totalLastRecalled += memory.lastRecalledAt;
        hasRecalledCount++;
      }
    }

    const archivedCount = memories.filter((m) => this.isArchived(m)).length;

    return {
      totalMemories: memories.length,
      archivedMemories: archivedCount,
      deletedMemories: 0, // 已删除的不在数据库中
      scopeDistribution: scopeDist,
      avgImportance: memories.length > 0 ? totalImportance / memories.length : 0,
      avgLastRecalledAt: hasRecalledCount > 0 ? totalLastRecalled / hasRecalledCount : 0,
    };
  }

  // ============================================================
  // 配置更新
  // ============================================================

  /**
   * 更新配置
   */
  updateConfig(config: Partial<DegradationConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('Degradation config updated', this.config as unknown as Record<string, unknown>);
  }

  /**
   * 更新作用域降级配置
   */
  updateScopeConfig(config: Partial<ScopeDegradationConfig>): void {
    this.scopeConfig = { ...this.scopeConfig, ...config };
    this.logger.info('Scope degradation config updated', this.scopeConfig as unknown as Record<string, unknown>);
  }

  /**
   * 更新强化配置
   */
  updateReinforcementConfig(config: Partial<ReinforcementConfig>): void {
    this.reinforcementConfig = { ...this.reinforcementConfig, ...config };
    this.logger.info('Reinforcement config updated', this.reinforcementConfig as unknown as Record<string, unknown>);
  }

  /**
   * 获取当前配置
   */
  getConfig(): {
    degradation: DegradationConfig;
    scope: ScopeDegradationConfig;
    reinforcement: ReinforcementConfig;
  } {
    return {
      degradation: { ...this.config },
      scope: { ...this.scopeConfig },
      reinforcement: { ...this.reinforcementConfig },
    };
  }
}
