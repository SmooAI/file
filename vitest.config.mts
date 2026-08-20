import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        // Deliberately NOT `passWithNoTests: true`. This repo has tests; the flag
        // only ever turns "vitest matched nothing" — a broken glob, a moved
        // directory, a renamed extension — into a green run.
        include: ['src/**/*.spec.ts'],
    },
});
