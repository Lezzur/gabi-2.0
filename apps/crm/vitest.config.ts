import { defineConfig } from 'vitest/config'

export default defineConfig({
  envDir: '../../',
  test: {
    name: 'crm',
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'lib/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**', 'lib/**'],
      exclude: ['src/**/*.d.ts'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
  },
})
