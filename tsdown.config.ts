import { defineConfig, type Options } from 'tsdown';

export default defineConfig((options: Options) => ({
    entry: ['src/index.ts', 'src/errors.ts', 'src/File.ts'],
    clean: true,
    dts: true,
    format: ['cjs', 'esm'],
    sourcemap: true,
    target: 'es2022',
    treeShaking: true,
    ...options,
}));
