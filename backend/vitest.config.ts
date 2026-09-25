import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.spec.ts', 'prisma/**/*.spec.ts'],
    coverage: { include: ['src/domain/**', 'src/application/**'] },
  },
});
