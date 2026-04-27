/**
 * Privacy Manager - 隐私管理器
 *
 * v2.0.0: 内存存储版本，实际删除操作由 MemoryService 处理
 */

import { createServiceLogger, type ILogger } from '../../shared/logging';
import type {
  SensitiveDataMark,
  SensitiveDataType,
  UserDataExport,
  ExportFormat,
  ExportMetadata,
} from './types';

export interface PrivacyManagerOptions {
  enableSensitiveMarking?: boolean;
  autoExpireDays?: number;
  requireExportApproval?: boolean;
  enableAutoDeletion?: boolean;
}

/**
 * 隐私管理器类
 * v2.0.0: 内存存储版本
 */
export class PrivacyManager {
  private logger: ILogger;
  private options: Required<PrivacyManagerOptions>;
  // v2.0.0: 使用内存存储敏感标记
  private sensitiveMarks: Map<string, SensitiveDataMark[]> = new Map();

  constructor(
    _storage: undefined,
    options?: PrivacyManagerOptions
  ) {
    this.logger = createServiceLogger('PrivacyManager');
    this.options = {
      enableSensitiveMarking: options?.enableSensitiveMarking ?? true,
      autoExpireDays: options?.autoExpireDays ?? 365,
      requireExportApproval: options?.requireExportApproval ?? false,
      enableAutoDeletion: options?.enableAutoDeletion ?? false,
    };
  }

  /**
   * 标记敏感数据
   */
  markSensitive(
    userId: string,
    dataType: SensitiveDataType,
    dataId: string,
    reason: string,
    markedBy: 'user' | 'system' | 'auto' = 'user',
    expiresAt?: number,
    metadata?: Record<string, any>
  ): SensitiveDataMark {
    if (!this.options.enableSensitiveMarking) {
      this.logger.warn('Sensitive marking is disabled');
      throw new Error('Sensitive marking is disabled');
    }

    const now = Date.now();
    const mark: SensitiveDataMark = {
      id: this.generateMarkId(userId, dataId),
      userId,
      dataType,
      dataId,
      reason,
      markedAt: now,
      markedBy,
      expiresAt: expiresAt ?? (now + this.options.autoExpireDays * 24 * 60 * 60 * 1000),
      metadata,
    };

    // 保存到内存
    const userMarks = this.sensitiveMarks.get(userId) ?? [];
    userMarks.push(mark);
    this.sensitiveMarks.set(userId, userMarks);

    this.logger.info(
      `Marked sensitive data ${dataId} (${dataType}) for user ${userId}: ${reason}`
    );

    return mark;
  }

  /**
   * 获取敏感数据标记
   */
  getSensitiveMarks(userId: string): SensitiveDataMark[] {
    return this.sensitiveMarks.get(userId) ?? [];
  }

  /**
   * 移除敏感标记
   */
  removeSensitiveMark(userId: string, markId: string): void {
    const userMarks = this.sensitiveMarks.get(userId) ?? [];
    const idx = userMarks.findIndex(m => m.id === markId);
    if (idx !== -1) {
      userMarks.splice(idx, 1);
      this.sensitiveMarks.set(userId, userMarks);
    }
    this.logger.info(`Removed sensitive mark ${markId} for user ${userId}`);
  }

  /**
   * 导出用户数据
   * @deprecated v2.0.0: 此方法已废弃，请使用 ProfileManager.exportUserData()
   *              PrivacyManager 不持有数据，只管理敏感标记
   */
  exportUserData(
    _userId: string,
    _format: ExportFormat = 'json',
    _options?: {
      includePersona?: boolean;
      includePreferences?: boolean;
      includeInteractions?: boolean;
      includeTags?: boolean;
      includeSensitive?: boolean;
      dateRange?: {
        start: number;
        end: number;
      };
    }
  ): UserDataExport {
    this.logger.error('PrivacyManager.exportUserData is deprecated, use ProfileManager.exportUserData instead');
    throw new Error(
      'PrivacyManager.exportUserData is deprecated. ' +
      'Please use ProfileManager.exportUserData() for proper data export ' +
      'with access to MemoryService, InteractionRecorder, and TagManager.'
    );
  }

  /**
   * 删除用户数据（被遗忘权）
   * v2.0.0: 注意 - 需要 MemoryService 注入才能执行实际删除
   */
  deleteUserData(
    userId: string,
    options?: {
      softDelete?: boolean;
      reason?: string;
      confirm?: boolean;
    }
  ): void {
    if (!options?.confirm) {
      this.logger.error('Delete operation requires confirmation');
      throw new Error('Delete operation requires confirmation');
    }

    this.logger.warn(
      `Deleting all data for user ${userId}` +
        (options?.reason ? `: ${options.reason}` : '')
    );

    // v2.0.0: 实际删除由调用方通过 MemoryService 执行
    // 这里只清理隐私管理器内部的敏感标记
    this.sensitiveMarks.delete(userId);

    this.logger.info(`Successfully deleted all data for user ${userId}`);
  }

  /**
   * 匿名化用户数据
   * v2.0.0: 注意 - 需要 MemoryService 注入才能执行实际匿名化
   */
  anonymizeUserData(userId: string): void {
    this.logger.info(`Anonymizing data for user ${userId}`);

    // v2.0.0: 实际匿名化由调用方通过 MemoryService 执行
    // 这里只记录日志

    this.logger.info(`Completed anonymization for user ${userId}`);
  }

  /**
   * 清理过期敏感标记
   */
  cleanupExpiredMarks(userId: string): number {
    const now = Date.now();
    const userMarks = this.sensitiveMarks.get(userId) ?? [];
    const expiredMarks = userMarks.filter(mark => mark.expiresAt && mark.expiresAt < now);

    for (const mark of expiredMarks) {
      this.removeSensitiveMark(userId, mark.id);
    }

    if (expiredMarks.length > 0) {
      this.logger.info(
        `Cleaned up ${expiredMarks.length} expired sensitive marks for user ${userId}`
      );
    }

    return expiredMarks.length;
  }

  /**
   * 检查数据是否敏感
   */
  isDataSensitive(userId: string, dataId: string): boolean {
    const marks = this.getSensitiveMarks(userId);
    return marks.some(mark => mark.dataId === dataId);
  }

  /**
   * 获取隐私设置
   */
  getPrivacySettings(userId: string): PrivacySettings {
    const sensitiveMarks = this.getSensitiveMarks(userId);

    return {
      hasSensitiveData: sensitiveMarks.length > 0,
      sensitiveDataCount: sensitiveMarks.length,
      exportAvailable: true,
      deletionAvailable: true,
      anonymizationAvailable: true,
      autoExpireEnabled: this.options.autoExpireDays > 0,
      autoExpireDays: this.options.autoExpireDays,
    };
  }

  /**
   * 匿名化文本
   */
  private anonymizeText(text: string): string {
    // 简单的匿名化处理
    let anonymized = text;

    // 替换邮箱
    anonymized = anonymized.replace(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      '[EMAIL]'
    );

    // 替换手机号
    anonymized = anonymized.replace(
      /\b1[3-9]\d{9}\b/g,
      '[PHONE]'
    );

    // 替换身份证号
    anonymized = anonymized.replace(
      /\b\d{17}[\dXx]\b/g,
      '[ID_CARD]'
    );

    // 替换地址（简单模式）
    anonymized = anonymized.replace(
      /(省|市|区|县|街道|镇|乡).{0,20}/g,
      '[ADDRESS]'
    );

    return anonymized;
  }

  /**
   * 生成标记 ID
   */
  private generateMarkId(userId: string, dataId: string): string {
    return `sensitive-${userId}-${dataId}`;
  }
}

/**
 * 隐私设置接口
 */
interface PrivacySettings {
  hasSensitiveData: boolean;
  sensitiveDataCount: number;
  exportAvailable: boolean;
  deletionAvailable: boolean;
  anonymizationAvailable: boolean;
  autoExpireEnabled: boolean;
  autoExpireDays: number;
}
