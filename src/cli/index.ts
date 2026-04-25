/**
 * OMMS-CLI - 命令行工具
 *
 * 提供 list / search / stats / extract 四条命令
 *
 * @module cli/index
 */

import { OMMS } from '../index';
import { createLogger } from '../shared/logging';
import { config } from '../shared/config';

const logger = createLogger('cli');

// CLI 颜色
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

/**
 * 打印帮助信息
 */
function printHelp(): void {
  console.log(`
${colorize(colors.bright, 'OMMS-CLI')} - 记忆管理系统命令行工具

${colorize(colors.cyan, '用法:')}
  omms <命令> [选项]

${colorize(colors.cyan, '命令:')}
  ${colorize(colors.green, 'list')} [选项]      列出记忆
  ${colorize(colors.green, 'search')} <query>   搜索记忆
  ${colorize(colors.green, 'stats')}            显示统计信息
  ${colorize(colors.green, 'extract')} <文本>   从文本提取记忆
  ${colorize(colors.green, 'start')} [选项]     启动 All-in-One 服务器

${colorize(colors.cyan, '选项:')}
  --limit, -n <数量>     结果数量限制 (默认：10)
  --type <类型>          按类型过滤 (fact/event/decision/error/learning/relation)
  --wing <wingId>        按 Wing 过滤
  --agent <agentId>      Agent ID (默认：default)
  --help, -h             显示帮助
  --version, -v          显示版本

${colorize(colors.cyan, '示例:')}
  ${colorize(colors.green, 'omms list -n 5')}
  ${colorize(colors.green, 'omms search "昨天的会议"')}
  ${colorize(colors.green, 'omms stats')}
  ${colorize(colors.green, 'omms extract "今天学习了 TypeScript"')}
`);
}

/**
 * 列出记忆
 */
async function listMemories(args: string[]): Promise<void> {
  const limit = parseInt(getFlag(args, ['--limit', '-n']) || '10', 10);
  const typeFilter = getFlag(args, ['--type']);
  const wingFilter = getFlag(args, ['--wing']);
  const agentId = getFlag(args, ['--agent']) || 'default';

  const omms = new OMMS();
  await omms.initialize();

  try {
    // 使用 memoryService 召回记忆
    const recallResult = await omms.memoryService.recall({
      query: '*',
      limit,
      minImportance: 0,
    });

    let memories = recallResult.memories;

    // 按类型过滤
    if (typeFilter) {
      memories = memories.filter(m => m.type === typeFilter);
    }

    if (memories.length === 0) {
      console.log(colorize(colors.yellow, '没有找到记忆'));
      return;
    }

    console.log(colorize(colors.bright, `\n找到 ${memories.length} 条记忆:\n`));

    for (let i = 0; i < memories.length; i++) {
      const m = memories[i];
      console.log(`${colorize(colors.dim, `${i + 1}.`)} [${colorize(colors.cyan, m.type)}] ${m.content}`);
      console.log(`   重要性：${(m as any).importance || 'N/A'}`);
    }
  } finally {
    await omms.shutdown();
  }
}

/**
 * 搜索记忆
 */
async function searchMemories(args: string[]): Promise<void> {
  const query = args.join(' ');
  if (!query) {
    console.error(colorize(colors.yellow, '错误：请提供搜索关键词'));
    process.exit(1);
  }

  const limit = parseInt(getFlag(args, ['--limit', '-n']) || '10', 10);
  const agentId = getFlag(args, ['--agent']) || 'default';

  const omms = new OMMS();
  await omms.initialize();

  try {
    // 使用向量搜索
    const recallResult = await omms.memoryService.recall({
      query,
      limit,
    });

    if (recallResult.memories.length === 0) {
      console.log(colorize(colors.yellow, '没有找到匹配的记忆'));
      return;
    }

    console.log(colorize(colors.bright, `\n找到 ${recallResult.memories.length} 条匹配记忆:\n`));

    for (let i = 0; i < recallResult.memories.length; i++) {
      const m = recallResult.memories[i];
      console.log(`${colorize(colors.dim, `${i + 1}.`)} [${colorize(colors.cyan, m.type)}] ${m.content}`);
      console.log(`   重要性：${(m as any).importance || 'N/A'}`);
    }
  } finally {
    await omms.shutdown();
  }
}

/**
 * 显示统计信息
 */
async function showStats(args: string[]): Promise<void> {
  const omms = new OMMS();
  await omms.initialize();

  try {
    // 使用 palaceStore 获取宫殿信息（简化实现）
    const palaceRefs = await omms.palaceStore.getAllPalaceRefs();

    console.log(colorize(colors.bright, '\n=== OMMS 统计信息 ===\n'));

    console.log(colorize(colors.cyan, '宫殿:'));
    console.log(`  总宫殿引用：${palaceRefs.length}`);
    console.log(`  宫殿列表：${palaceRefs.slice(0, 5).join(', ')}${palaceRefs.length > 5 ? '...' : ''}`);

    console.log(colorize(colors.cyan, '\n系统:'));
    console.log(`  运行时间：${Math.floor(process.uptime() / 60)} 分钟`);
    const memUsage = process.memoryUsage();
    console.log(`  内存使用：${Math.floor(memUsage.heapUsed / 1024 / 1024)} MB`);
  } finally {
    await omms.shutdown();
  }
}

/**
 * 从文本提取记忆
 */
async function extractFromText(args: string[]): Promise<void> {
  const text = args.join(' ');
  if (!text) {
    console.error(colorize(colors.yellow, '错误：请提供要提取的文本'));
    process.exit(1);
  }

  const omms = new OMMS();
  await omms.initialize();

  // 获取默认 agentId（从命令行参数或 ConfigManager）
  let agentId = getFlag(args, ['--agent']);
  if (!agentId) {
    try {
      agentId = config.getConfig('agentId') as string;
    } catch {
      agentId = 'default';
    }
  }

  try {
    // 简单实现：直接存储为事实记忆
    const memory = await omms.memoryService.store({
      content: text,
      type: 'fact' as any,
      agentId: agentId,
      metadata: {
        source: 'cli-extract',
        extractedAt: Date.now(),
      },
    } as any);

    console.log(colorize(colors.green, `\n成功提取并存储 1 条记忆:`));
    console.log(`  [${memory.type}] ${memory.content.substring(0, 60)}...`);
  } finally {
    await omms.shutdown();
  }
}

/**
 * 获取标志值
 */
function getFlag(args: string[], flags: string[]): string | undefined {
  for (const flag of flags) {
    const index = args.indexOf(flag);
    if (index !== -1 && index + 1 < args.length) {
      return args[index + 1];
    }
  }
  return undefined;
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    return;
  }

  if (args[0] === '--version' || args[0] === '-v') {
    console.log('omms-pro v0.1.0');
    return;
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  try {
    switch (command) {
      case 'list':
        await listMemories(commandArgs);
        break;
      case 'search':
        await searchMemories(commandArgs);
        break;
      case 'stats':
        await showStats(commandArgs);
        break;
      case 'extract':
        await extractFromText(commandArgs);
        break;
      case 'start':
        const { startCommand } = await import('./start-command');
        await startCommand(commandArgs);
        break;
      default:
        console.error(colorize(colors.yellow, `未知命令：${command}`));
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    logger.error('CLI 执行错误', { error });
    console.error(colorize(colors.yellow, `执行错误：${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
}

// 导出
export { main };

// 如果直接运行则执行
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
