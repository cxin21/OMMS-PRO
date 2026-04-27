/**
 * Configuration Manager Module - Unified Exports
 *
 * @module config
 * @since 0.1.0
 */
// Core classes
export { ConfigManager } from './config-manager.js';
export { ConfigLoader } from './loader.js';
export { ConfigValidator } from './validator.js';
export { PathUtils } from './path-utils.js';
// Singleton instance
import { ConfigManager } from './config-manager.js';
/**
 * Default configuration manager instance
 *
 * @example
 * ```typescript
 * import { config } from '@omms/config';
 *
 * await config.initialize('./config.json');
 * const level = config.get('logging.level');
 * ```
 */
export const config = ConfigManager.getInstance();
/**
 * Default export
 */
export default config;
