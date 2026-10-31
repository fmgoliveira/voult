import { defineConfig } from 'vitest/config';

/** Shared Vitest preset. Packages may pass `coverageThreshold` (NFR6: core >= 90%). */
export function vitestPreset({ coverageThreshold } = {}) {
  return defineConfig({
    test: {
      include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
      passWithNoTests: false,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts', 'src/**/*.testkit.ts'],
        thresholds: coverageThreshold
          ? {
              lines: coverageThreshold,
              functions: coverageThreshold,
              branches: coverageThreshold,
              statements: coverageThreshold,
            }
          : undefined,
      },
    },
  });
}
