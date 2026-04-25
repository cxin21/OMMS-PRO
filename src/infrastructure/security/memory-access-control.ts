/**
 * MemoryAccessControl - 独立的访问控制系统
 *
 * 实现 Scope 解耦的访问控制
 * - 不依赖 MemoryScope 进行访问控制
 * - 支持基于 Agent、Session、Tags 的灵活策略
 * - 支持命名空间隔离
 *
 * @module storage/memory-access-control
 */

import { createLogger } from '../../shared/logging';
import type { ILogger } from '../../shared/logging';
import type { MemoryScope, MemoryType } from '../../core/types/memory';

export type AccessLevel = 'none' | 'read' | 'write' | 'delete' | 'admin';
export type AccessPrincipalType = 'agent' | 'session' | 'tag' | 'scope' | 'global';

export interface AccessPrincipal {
  type: AccessPrincipalType;
  id: string;
}

export interface AccessPolicy {
  id: string;
  name: string;
  description?: string;
  priority: number;  // Higher priority wins
  principals: AccessPrincipal[];
  conditions: AccessCondition[];
  effect: 'allow' | 'deny';
  createdAt: number;
  updatedAt: number;
}

export interface AccessCondition {
  type: 'scope' | 'type' | 'tag' | 'agent' | 'session' | 'time' | 'custom';
  operator: 'eq' | 'neq' | 'in' | 'nin' | 'gt' | 'lt' | 'between' | 'contains';
  field: string;
  value: unknown;
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  matchedPolicy?: string;
}

export interface MemoryAccessControlConfig {
  /** 默认访问级别（无匹配策略时） */
  defaultAccessLevel: AccessLevel;
  /** 是否启用审计日志 */
  auditEnabled: boolean;
  /** 策略缓存大小 */
  policyCacheSize: number;
  /** 系统代理 ID（拥有最高权限） */
  systemAgentId?: string;
}

interface AccessCheckContext {
  agentId: string;
  sessionId?: string;
  scope: MemoryScope;
  type: MemoryType;
  tags: string[];
  memoryOwnerAgentId?: string;
  customContext?: Record<string, unknown>;
}

/**
 * MemoryAccessControl
 *
 * 独立的访问控制系统，不依赖 MemoryScope 进行控制
 */
export class MemoryAccessControl {
  private logger: ILogger;
  private policies: Map<string, AccessPolicy> = new Map();
  private policyCache: Map<string, AccessDecision> = new Map();
  private auditLog: Array<{
    timestamp: number;
    decision: AccessDecision;
    context: AccessCheckContext;
    policyId?: string;
  }> = [];

  constructor(private config: MemoryAccessControlConfig) {
    this.logger = createLogger('MemoryAccessControl');
  }

  /**
   * 添加访问策略
   */
  async addPolicy(policy: AccessPolicy): Promise<void> {
    this.policies.set(policy.id, policy);
    this.clearCache();
    this.logger.debug('Access policy added', { policyId: policy.id, priority: policy.priority });
  }

  /**
   * 移除访问策略
   */
  async removePolicy(policyId: string): Promise<boolean> {
    const deleted = this.policies.delete(policyId);
    if (deleted) {
      this.clearCache();
      this.logger.debug('Access policy removed', { policyId });
    }
    return deleted;
  }

  /**
   * 更新访问策略
   */
  async updatePolicy(policyId: string, updates: Partial<AccessPolicy>): Promise<boolean> {
    const policy = this.policies.get(policyId);
    if (!policy) {
      return false;
    }

    const updated: AccessPolicy = {
      ...policy,
      ...updates,
      id: policyId,
      updatedAt: Date.now()
    };

    this.policies.set(policyId, updated);
    this.clearCache();
    this.logger.debug('Access policy updated', { policyId });
    return true;
  }

  /**
   * 检查访问权限
   */
  async checkAccess(
    principal: AccessPrincipal,
    action: AccessLevel,
    context: AccessCheckContext
  ): Promise<AccessDecision> {
    // System agent always has admin access
    if (this.config.systemAgentId && context.agentId === this.config.systemAgentId) {
      return { allowed: true, reason: 'System agent override' };
    }

    // Check cache first
    const cacheKey = this.buildCacheKey(principal, action, context);
    const cached = this.policyCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Find matching policies
    const matchingPolicies = this.findMatchingPolicies(principal, action, context);

    // Sort by priority (higher first)
    matchingPolicies.sort((a, b) => b.priority - a.priority);

    let decision: AccessDecision;

    if (matchingPolicies.length === 0) {
      decision = {
        allowed: this.config.defaultAccessLevel !== 'none',
        reason: 'No matching policy, using default access'
      };
    } else {
      // Apply first matching policy (highest priority)
      const matchedPolicy = matchingPolicies[0];
      decision = {
        allowed: matchedPolicy.effect === 'allow',
        reason: `Matched policy: ${matchedPolicy.name}`,
        matchedPolicy: matchedPolicy.id
      };
    }

    // Cache the decision
    this.cacheDecision(cacheKey, decision);

    // Audit log
    if (this.config.auditEnabled) {
      this.auditLog.push({
        timestamp: Date.now(),
        decision,
        context,
        policyId: decision.matchedPolicy
      });

      // Trim audit log if too large
      if (this.auditLog.length > 10000) {
        this.auditLog = this.auditLog.slice(-5000);
      }
    }

    return decision;
  }

  /**
   * 批量检查权限
   */
  async checkAccessBatch(
    principals: AccessPrincipal[],
    action: AccessLevel,
    contexts: AccessCheckContext[]
  ): Promise<AccessDecision[]> {
    const decisions: AccessDecision[] = [];
    for (const principal of principals) {
      for (const context of contexts) {
        decisions.push(await this.checkAccess(principal, action, context));
      }
    }
    return decisions;
  }

  /**
   * 检查记忆是否可被特定代理访问
   */
  async canAccessMemory(
    agentId: string,
    memory: {
      agentId: string;
      scope: MemoryScope;
      type: MemoryType;
      tags: string[];
      sessionId?: string;
    },
    action: AccessLevel = 'read'
  ): Promise<AccessDecision> {
    const principal: AccessPrincipal = { type: 'agent', id: agentId };
    const context: AccessCheckContext = {
      agentId,
      sessionId: memory.sessionId,
      scope: memory.scope,
      type: memory.type,
      tags: memory.tags,
      memoryOwnerAgentId: memory.agentId
    };

    return this.checkAccess(principal, action, context);
  }

  /**
   * 检查是否允许写入
   */
  async canWriteMemory(
    agentId: string,
    targetScope: MemoryScope,
    targetType: MemoryType
  ): Promise<AccessDecision> {
    const principal: AccessPrincipal = { type: 'agent', id: agentId };
    const context: AccessCheckContext = {
      agentId,
      scope: targetScope,
      type: targetType,
      tags: []
    };

    return this.checkAccess(principal, 'write', context);
  }

  /**
   * 获取审计日志
   */
  async getAuditLog(
    options?: {
      startTime?: number;
      endTime?: number;
      agentId?: string;
      limit?: number;
    }
  ): Promise<Array<{
    timestamp: number;
    decision: AccessDecision;
    context: AccessCheckContext;
    policyId?: string;
  }>> {
    let results = this.auditLog;

    if (options?.startTime) {
      results = results.filter(log => log.timestamp >= options.startTime!);
    }
    if (options?.endTime) {
      results = results.filter(log => log.timestamp <= options.endTime!);
    }
    if (options?.agentId) {
      results = results.filter(log => log.context.agentId === options.agentId);
    }
    if (options?.limit) {
      results = results.slice(-options.limit);
    }

    return results;
  }

  /**
   * 获取策略列表
   */
  async getPolicies(): Promise<AccessPolicy[]> {
    return Array.from(this.policies.values());
  }

  /**
   * 根据 ID 获取策略
   */
  async getPolicy(policyId: string): Promise<AccessPolicy | null> {
    return this.policies.get(policyId) || null;
  }

  /**
   * 创建默认策略
   */
  async createDefaultPolicies(): Promise<void> {
    // Agent can read/write its own memories
    const ownMemoryPolicy: AccessPolicy = {
      id: 'default_own_memory',
      name: 'Agent Own Memory Access',
      description: 'Agents can read and write their own memories',
      priority: 100,
      principals: [{ type: 'agent', id: '*' }],
      conditions: [
        { type: 'agent', operator: 'eq', field: 'memoryOwnerAgentId', value: '${agentId}' }
      ],
      effect: 'allow',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // Global agents can read all
    const globalReadPolicy: AccessPolicy = {
      id: 'default_global_read',
      name: 'Global Read Access',
      description: 'Global agents can read all memories',
      priority: 50,
      principals: [{ type: 'agent', id: 'global' }],
      conditions: [
        { type: 'scope', operator: 'eq', field: 'scope', value: 'global' }
      ],
      effect: 'allow',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // Session-scoped memory is accessible within session
    const sessionPolicy: AccessPolicy = {
      id: 'default_session_access',
      name: 'Session Access',
      description: 'Same session agents can access session memories',
      priority: 80,
      principals: [{ type: 'session', id: '*' }],
      conditions: [
        { type: 'session', operator: 'eq', field: 'sessionId', value: '${sessionId}' }
      ],
      effect: 'allow',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await this.addPolicy(ownMemoryPolicy);
    await this.addPolicy(globalReadPolicy);
    await this.addPolicy(sessionPolicy);

    this.logger.info('Default policies created');
  }

  /**
   * 清除策略缓存
   */
  clearCache(): void {
    this.policyCache.clear();
  }

  // Private helper methods

  private buildCacheKey(
    principal: AccessPrincipal,
    action: AccessLevel,
    context: AccessCheckContext
  ): string {
    return `${principal.type}:${principal.id}:${action}:${context.agentId}:${context.scope}:${context.type}`;
  }

  private cacheDecision(key: string, decision: AccessDecision): void {
    if (this.policyCache.size >= this.config.policyCacheSize) {
      // Remove oldest entry (first in map)
      const firstKey = this.policyCache.keys().next().value;
      if (firstKey) {
        this.policyCache.delete(firstKey);
      }
    }
    this.policyCache.set(key, decision);
  }

  private findMatchingPolicies(
    principal: AccessPrincipal,
    action: AccessLevel,
    context: AccessCheckContext
  ): AccessPolicy[] {
    const results: AccessPolicy[] = [];

    for (const policy of this.policies.values()) {
      // Check if principal matches
      const principalMatches = this.matchPrincipal(policy.principals, principal);
      if (!principalMatches) continue;

      // Check if action is covered
      if (!this.matchAction(policy, action)) continue;

      // Check all conditions
      const allConditionsMatch = policy.conditions.every(cond =>
        this.matchCondition(cond, context)
      );

      if (allConditionsMatch) {
        results.push(policy);
      }
    }

    return results;
  }

  private matchPrincipal(policyPrincipals: AccessPrincipal[], target: AccessPrincipal): boolean {
    for (const pp of policyPrincipals) {
      if (pp.type === 'global' && target.type === 'global') return true;
      if (pp.type === 'global' && target.id === '*') return true;
      if (pp.type === target.type && (pp.id === '*' || pp.id === target.id)) return true;
    }
    return false;
  }

  private matchAction(policy: AccessPolicy, action: AccessLevel): boolean {
    // For deny policies, they apply to the action
    // For allow policies, we check if the requested action is permitted
    const actionHierarchy: AccessLevel[] = ['none', 'read', 'write', 'delete', 'admin'];
    const policyAction = policy.effect === 'allow' ? 'admin' : 'none';

    // Simple check: if policy is allow, it allows all actions <= write
    if (policy.effect === 'allow') {
      return actionHierarchy.indexOf(action) <= actionHierarchy.indexOf('write');
    }

    // For deny policies, deny the action (return false)
    return false;
  }

  private matchCondition(condition: AccessCondition, context: AccessCheckContext): boolean {
    const { type, operator, field, value } = condition;

    let fieldValue: unknown;
    switch (type) {
      case 'scope':
        fieldValue = context.scope;
        break;
      case 'type':
        fieldValue = context.type;
        break;
      case 'tag':
        fieldValue = context.tags;
        break;
      case 'agent':
        fieldValue = field === 'memoryOwnerAgentId' ? context.memoryOwnerAgentId : context.agentId;
        break;
      case 'session':
        fieldValue = context.sessionId;
        break;
      default:
        fieldValue = context.customContext?.[field];
    }

    return this.evaluateOperator(operator, fieldValue, value);
  }

  private evaluateOperator(operator: AccessCondition['operator'], fieldValue: unknown, conditionValue: unknown): boolean {
    switch (operator) {
      case 'eq':
        return fieldValue === conditionValue;
      case 'neq':
        return fieldValue !== conditionValue;
      case 'in':
        return Array.isArray(conditionValue) && conditionValue.includes(fieldValue);
      case 'nin':
        return Array.isArray(conditionValue) && !conditionValue.includes(fieldValue);
      case 'contains':
        return Array.isArray(fieldValue) && fieldValue.includes(conditionValue);
      case 'gt':
        return typeof fieldValue === 'number' && typeof conditionValue === 'number' && fieldValue > conditionValue;
      case 'lt':
        return typeof fieldValue === 'number' && typeof conditionValue === 'number' && fieldValue < conditionValue;
      case 'between':
        if (typeof fieldValue === 'number' && Array.isArray(conditionValue) && conditionValue.length === 2) {
          return fieldValue >= conditionValue[0] && fieldValue <= conditionValue[1];
        }
        return false;
      default:
        return false;
    }
  }
}