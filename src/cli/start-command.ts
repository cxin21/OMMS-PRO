/**
 * Start Command - 启动命令
 *
 * 提供 omms start 命令，启动统一服务器
 *
 * @module cli/start-command
 */

import type { UnifiedServer } from './unified-server';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function colorize(color: string, text: string): string {
  return `${color}${text}${colors.reset}`;
}

export interface StartCommandOptions {
  port?: number;
  host?: string;
  apiOnly?: boolean;
  withMCP?: boolean;
  development?: boolean;
  help?: boolean;
}

/**
 * 获取标志值
 */
function getFlag(args: string[], flags: string[]): string | undefined {
  for (const flag of flags) {
    const index = args.indexOf(flag);
    if (index !== -1 && index + 1 < args.length) {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) return undefined;
      return value;
    }
  }
  return undefined;
}

/**
 * 解析命令行参数
 */
function parseArgs(args: string[]): StartCommandOptions {
  const portStr = getFlag(args, ['--port', '-p']) || '3000';
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error('Invalid port number');
    process.exit(1);
  }
  return {
    port,
    host: getFlag(args, ['--host']) || '0.0.0.0',
    apiOnly: args.includes('--api-only'),
    withMCP: args.includes('--with-mcp'),
    development: args.includes('--development'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

/**
 * 打印帮助信息
 */
function printHelp(): void {
  console.log(`
${colorize(colors.bright, 'OMMS-PRO')} - 启动统一服务器

${colorize(colors.cyan, '用法:')}
  omms start [选项]

${colorize(colors.cyan, '选项:')}
  ${colorize(colors.green, '--port, -p')} <端口>    监听端口 (默认: 3000)
  ${colorize(colors.green, '--host')} <主机>        监听主机 (默认: 0.0.0.0)
  ${colorize(colors.green, '--api-only')}           仅启动 API 服务器，不启用 MCP 和 Web UI
  ${colorize(colors.green, '--with-mcp')}          启用 MCP 服务器
  ${colorize(colors.green, '--development')}      开发模式
  ${colorize(colors.green, '--help, -h')}          显示帮助

${colorize(colors.cyan, '示例:')}
  ${colorize(colors.green, 'omms start')}
  ${colorize(colors.green, 'omms start --port 8080 --host localhost')}
  ${colorize(colors.green, 'omms start --api-only')}
  ${colorize(colors.green, 'omms start --with-mcp --development')}
`);
}

/**
 * 设置优雅关闭处理器
 */
function setupGracefulShutdown(server: UnifiedServer): void {
  let shutdownInProgress = false;
  const shutdown = async (signal: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    console.log(`\n${colorize(colors.yellow, `收到 ${signal} 信号，开始关闭服务器...`)}`);
    try {
      await server.shutdown();
      console.log(colorize(colors.green, '服务器已成功关闭'));
      process.exit(0);
    } catch (error) {
      console.error(colorize(colors.yellow, `关闭服务器时出错: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // 处理未捕获的异常
  process.on('uncaughtException', (error) => {
    console.error(colorize(colors.yellow, `未捕获的异常: ${error.message}`));
    server.shutdown().then(() => process.exit(1)).catch(() => process.exit(1));
  });

  // 处理未拒绝的 Promise
  process.on('unhandledRejection', (reason) => {
    console.error(colorize(colors.yellow, `未处理的拒绝: ${reason}`));
    server.shutdown().then(() => process.exit(1)).catch(() => process.exit(1));
  });
}

/**
 * 启动命令
 */
export async function startCommand(args: string[]): Promise<void> {
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  // Import UnifiedServer dynamically to avoid circular deps
  const { UnifiedServer: Server } = await import('./unified-server');

  const server = new Server({
    port: options.port,
    host: options.host,
    enableMCP: options.withMCP || !options.apiOnly,
    enableWebUI: !options.apiOnly,
  });

  try {
    await server.start();
  } catch (error) {
    console.error(colorize(colors.yellow, `启动服务器失败: ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }

  // Setup graceful shutdown handlers
  setupGracefulShutdown(server);

  console.log(colorize(colors.green, `OMMS-PRO 已启动于 http://${options.host}:${options.port}`));
}
