import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    // 测试环境
    environment: 'node',

    // 测试文件匹配模式
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'e2e/**/*.test.ts'],

    // 排除目录
    exclude: ['node_modules', '**/node_modules/**', 'dist', 'src/presentation/web-ui', 'src/presentation/plugins/**'],

    // 全局设置
    globals: true,

    // 超时时间（记忆操作可能涉及 LLM 调用，设置较长）
    testTimeout: 60000,
    hookTimeout: 30000,

    // 序列化运行（避免 SQLite/LanceDB 并发冲突）
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },

    // 覆盖率配置
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/*.d.ts',
        'src/presentation/web-ui/**',
      ],
    },
  },

  // 路径别名（与 tsconfig.json 中 paths 对应）
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@core': resolve(__dirname, 'src/core'),
      '@infrastructure': resolve(__dirname, 'src/infrastructure'),
      '@services': resolve(__dirname, 'src/services'),
      '@api': resolve(__dirname, 'src/api'),
      '@presentation': resolve(__dirname, 'src/presentation'),
      '@config': resolve(__dirname, 'src/config'),
      '@logging': resolve(__dirname, 'src/shared/logging'),
      '@types': resolve(__dirname, 'src/types'),
      '@utils': resolve(__dirname, 'src/shared/utils'),
    },
  },
});
