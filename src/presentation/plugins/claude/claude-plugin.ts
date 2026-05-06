/**
 * Claude Plugin - Claude Code 插件实现
 *
 * @module presentation/plugins/claude
 */

import {
  IPlugin,
  PluginManifest,
  PluginState,
  PluginType,
  HookDefinition,
  HookEvent,
  ToolDefinition,
} from '../base/plugin';
import { createLogger, type ILogger } from '../../../shared/logging';
import { config } from '../../../shared/config';
import { FileUtils } from '../../../shared/utils/file';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Claude 插件配置
 */
export interface ClaudePluginConfig {
  /** 插件根目录 */
  rootDir: string;
  /** MCP 服务器端口 */
  mcpPort?: number;
  /** 是否启用 hooks */
  enableHooks?: boolean;
  /** API URL */
  apiUrl?: string;
  /** Agent ID */
  agentId?: string;
}

/**
 * Claude 插件
 */
export class ClaudePlugin implements IPlugin {
  private logger: ILogger;
  private state: PluginState = PluginState.UNINSTALLED;
  private config: Required<ClaudePluginConfig>;
  private pluginDir: string;
  private manifest: PluginManifest;

  constructor(userConfig?: Partial<ClaudePluginConfig>) {
    this.logger = createLogger('claude-plugin');

    // 从配置读取默认值
    const defaults = this.getDefaultsFromConfig();

    this.config = {
      rootDir: userConfig?.rootDir ?? join(defaults.rootDir, 'omms-pro'),
      mcpPort: userConfig?.mcpPort ?? defaults.mcpPort,
      enableHooks: userConfig?.enableHooks ?? true,
      apiUrl: userConfig?.apiUrl ?? defaults.apiUrl,
      agentId: userConfig?.agentId ?? defaults.agentId,
    };

    this.pluginDir = this.config.rootDir;
    this.manifest = this.loadManifest();
  }

  /**
   * 从 ConfigManager 读取默认配置
   */
  private getDefaultsFromConfig(): { rootDir: string; mcpPort: number; apiUrl: string; agentId: string } {
    try {
      const apiConfig = config.getConfig('api') as { port?: number; host?: string } | undefined;
      const agentId = config.getConfig('agentId') as string | undefined;

      const port = apiConfig?.port ?? 3000;
      const host = apiConfig?.host ?? 'localhost';

      return {
        rootDir: './plugins',
        mcpPort: port,
        apiUrl: `http://${host}:${port}/api/v1`,
        agentId: agentId ?? 'claude-code',
      };
    } catch {
      // 配置不可用时抛出错误，禁止使用硬编码 fallback
      throw new Error('ConfigManager not initialized and no plugins/agentId/api config available');
    }
  }

  /**
   * 加载插件清单
   */
  private loadManifest(): PluginManifest {
    const manifestPath = join(this.pluginDir, 'manifest.json');

    if (existsSync(manifestPath)) {
      try {
        const content = readFileSync(manifestPath, 'utf-8');
        return JSON.parse(content) as PluginManifest;
      } catch (error) {
        this.logger.warn('Failed to load manifest, using default', { error });
      }
    }

    // 默认清单
    return {
      id: 'omms-pro-claude-plugin',
      name: 'OMMS-PRO Memory System',
      version: '1.0.0',
      description: 'OMMS-PRO memory system integration for Claude Code',
      author: 'OMMS Team',
      type: PluginType.CLAUDE,
      entry: 'server/index.ts',
      hooks: [
        { name: 'init-session', event: HookEvent.SESSION_START, priority: 100 },
        { name: 'recall-memory', event: HookEvent.USER_PROMPT_SUBMIT, priority: 50 },
        { name: 'capture-session', event: HookEvent.SESSION_END, priority: 100 },
      ],
      tools: [
        { name: 'memory_recall', description: 'Recall relevant memories' },
        { name: 'memory_capture', description: 'Capture conversation as memory' },
        { name: 'memory_list', description: 'List all memories' },
        { name: 'profile_get', description: 'Get user profile' },
        { name: 'omms_record_context', description: 'Record user/assistant conversation to local JSONL file (MANDATORY after each response)' },
        { name: 'omms_capture_session', description: 'Capture full conversation memory at session end' },
      ],
    };
  }

  /**
   * 获取插件元信息
   */
  getManifest(): PluginManifest {
    return this.manifest;
  }

  /**
   * 获取当前状态
   */
  getState(): PluginState {
    return this.state;
  }

  /**
   * 获取配置
   */
  getConfig(): Record<string, unknown> {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Record<string, unknown>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('Plugin config updated', this.config);
  }

  /**
   * 初始化插件
   */
  async initialize(): Promise<void> {
    if (this.state === PluginState.INSTALLED || this.state === PluginState.ENABLED) {
      this.logger.debug('Plugin already initialized');
      return;
    }

    this.logger.info('Initializing Claude plugin...');

    // 检查插件目录是否存在
    if (!existsSync(this.pluginDir)) {
      this.logger.warn('Plugin directory not found, creating...', { dir: this.pluginDir });
      mkdirSync(this.pluginDir, { recursive: true });
    }

    // 检查必要文件
    await this.validateInstallation();

    this.state = PluginState.INSTALLED;
    this.logger.info('Claude plugin initialized', { dir: this.pluginDir });
  }

  /**
   * 验证插件安装完整性
   */
  private async validateInstallation(): Promise<void> {
    const requiredFiles = [
      'server/index.ts',
      'hooks/hooks.json',
      'mcp-wrapper.sh',
    ];

    for (const file of requiredFiles) {
      const filePath = join(this.pluginDir, file);
      if (!existsSync(filePath)) {
        this.logger.warn('Required file missing', { file, path: filePath });
      }
    }
  }

  /**
   * 启用插件
   */
  async enable(): Promise<void> {
    if (this.state === PluginState.ENABLED) {
      return;
    }

    if (this.state === PluginState.UNINSTALLED) {
      await this.initialize();
    }

    this.state = PluginState.ENABLED;
    this.logger.info('Claude plugin enabled');
  }

  /**
   * 禁用插件
   */
  async disable(): Promise<void> {
    if (this.state === PluginState.DISABLED) {
      return;
    }

    this.state = PluginState.DISABLED;
    this.logger.info('Claude plugin disabled');
  }

  /**
   * 卸载插件
   */
  async uninstall(): Promise<void> {
    if (this.state === PluginState.ENABLED) {
      await this.disable();
    }

    this.state = PluginState.UNINSTALLED;
    this.logger.info('Claude plugin uninstalled');
  }

  /**
   * 获取 MCP 服务器启动命令
   */
  getMCPCommand(): { command: string; args: string[] } {
    return {
      command: 'bash',
      args: [join(this.pluginDir, 'mcp-wrapper.sh')],
    };
  }

  /**
   * 获取 MCP 配置（用于 .mcp.json）
   */
  getMCPConfig(): { command: string; args: string[] } {
    return this.getMCPCommand();
  }

  /**
   * 获取 hooks 配置
   */
  getHooksConfig(): object | null {
    const hooksPath = join(this.pluginDir, 'hooks', 'hooks.json');
    if (existsSync(hooksPath)) {
      try {
        return JSON.parse(readFileSync(hooksPath, 'utf-8'));
      } catch {
        this.logger.warn('Failed to parse hooks.json');
      }
    }
    return null;
  }

  /**
   * 安装插件（生成 .claude-plugin/plugin.json、hooks/hooks.json 和 .mcp.json）
   *
   * Claude Code 插件标准结构:
   *   plugin-dir/
   *   ├── .claude-plugin/plugin.json   # 插件清单（必需）
   *   ├── hooks/hooks.json             # Hook 定义（${CLAUDE_PLUGIN_ROOT} 变量）
   *   ├── .mcp.json                    # MCP 服务器配置
   *   └── agents/                      # Agent 定义目录
   *
   * 安装后使用 `claude --plugin-dir <path>` 加载，或发布到 marketplace。
   * 运行 `/reload-plugins` 可热加载变更。
   */
  async install(targetDir: string = '.'): Promise<void> {
    this.logger.info('Installing Claude plugin...');

    // 1. 创建 .claude-plugin/plugin.json（Claude Code 插件清单）
    const pluginManifestDir = join(this.pluginDir, '.claude-plugin');
    if (!existsSync(pluginManifestDir)) {
      mkdirSync(pluginManifestDir, { recursive: true });
    }
    const pluginManifestPath = join(pluginManifestDir, 'plugin.json');
    if (!existsSync(pluginManifestPath)) {
      const pluginManifest = {
        name: 'omms-pro',
        description: 'OMMS-PRO memory system integration for Claude Code - enables cross-session memory recall and capture',
        version: '1.0.0',
        author: { name: 'OMMS Team' },
      };
      writeFileSync(pluginManifestPath, JSON.stringify(pluginManifest, null, 2));
      this.logger.info('Plugin manifest created', { path: pluginManifestPath });
    }

    // 2. 生成 hooks/hooks.json（使用 ${CLAUDE_PLUGIN_ROOT} 变量）
    const hooksDir = join(this.pluginDir, 'hooks');
    if (!existsSync(hooksDir)) {
      mkdirSync(hooksDir, { recursive: true });
    }
    const hooksConfig = this.buildHooksConfig();
    const hooksPath = join(hooksDir, 'hooks.json');
    writeFileSync(hooksPath, JSON.stringify(hooksConfig, null, 2));
    this.logger.info('hooks.json created', { path: hooksPath });

    // 3. 生成 .mcp.json（MCP 服务器配置）
    const mcpConfig = {
      mcpServers: {
        'omms-pro': this.getMCPCommand(),
      },
    };
    const mcpJsonPath = join(this.pluginDir, '.mcp.json');
    writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2));
    this.logger.info('.mcp.json created', { path: mcpJsonPath });

    // 4. 如果 targetDir 不是插件目录本身，也在目标目录生成 .mcp.json
    if (targetDir !== '.' && targetDir !== this.pluginDir) {
      const targetMcpPath = join(targetDir, '.mcp.json');
      writeFileSync(targetMcpPath, JSON.stringify(mcpConfig, null, 2));
      this.logger.info('Target .mcp.json created', { path: targetMcpPath });
    }

    this.state = PluginState.INSTALLED;
    this.logger.info('Claude plugin installed successfully', {
      pluginDir: this.pluginDir,
      usage: `claude --plugin-dir ${this.pluginDir}`,
    });
  }

  /**
   * 构建 Claude Code 标准 hooks 配置
   *
   * 格式参考: https://code.claude.com/docs/en/hooks
   * - SessionStart: matcher 支持 startup|resume|clear|compact
   * - UserPromptSubmit: 无 matcher，每次提交都触发
   * - SessionEnd: matcher 支持 clear|resume|logout|prompt_input_exit 等
   */
  private buildHooksConfig(): object {
    return {
      description: 'OMMS-PRO memory system hooks for automatic memory recall and capture',
      hooks: {
        SessionStart: [
          {
            matcher: 'startup',
            hooks: [
              {
                type: 'command',
                command: '${CLAUDE_PLUGIN_ROOT}/hooks/session-start/init-session',
                timeout: 30,
              },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: 'command',
                command: '${CLAUDE_PLUGIN_ROOT}/hooks/pre-response/recall-memory',
                timeout: 30,
              },
            ],
          },
        ],
        SessionEnd: [
          {
            hooks: [
              {
                type: 'command',
                command: '${CLAUDE_PLUGIN_ROOT}/hooks/session-end/capture-session',
                timeout: 60,
              },
            ],
          },
        ],
      },
    };
  }
}
