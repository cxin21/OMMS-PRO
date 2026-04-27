/**
 * 配置验证器模块
 * 提供配置验证功能
 *
 * @module config/validator
 */
import type { OMMSConfig } from '@core/types/config';
import type { ValidationRule, ValidationResult } from './types';
/**
 * ConfigValidator - 配置验证器
 *
 * 负责验证配置的有效性
 */
export declare class ConfigValidator {
    private rules;
    constructor();
    /**
     * 注册内置验证规则
     */
    private registerBuiltinRules;
    /**
     * 注册验证规则
     *
     * @param path - 配置路径
     * @param rule - 验证规则
     */
    registerRule(path: string, rule: ValidationRule): void;
    /**
     * 移除验证规则
     *
     * @param path - 配置路径
     * @param ruleName - 规则名称
     */
    removeRule(path: string, ruleName: string): void;
    /**
     * 验证配置
     *
     * @param config - 配置对象
     * @returns 验证结果
     */
    validate(config: OMMSConfig): ValidationResult;
    /**
     * 验证特定路径的配置
     *
     * @param path - 配置路径
     * @param value - 配置值
     * @returns 验证结果
     */
    validatePath(path: string, value: unknown): ValidationResult;
    /**
     * 验证依赖关系
     */
    private validateDependencies;
    /**
     * 验证范围
     */
    private validateRanges;
    /**
     * 获取所有注册的规则
     */
    getRules(): Map<string, ValidationRule[]>;
    /**
     * 清除所有规则
     */
    clearRules(): void;
}
