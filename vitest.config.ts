import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    // 测试文件匹配模式
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'electron/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'dist-electron', 'release'],

    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx', 'electron/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.d.ts',
        '**/*.stories.ts',
        '**/*.stories.tsx',
        'electron/main.ts',
      ],
    },

    // 环境：Node.js（主进程代码）和 jsdom（React 组件）
    environment: 'node',

    // 路径别名（与 vite.config.ts 保持一致）
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
  },
})
