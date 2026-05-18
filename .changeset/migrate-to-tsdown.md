---
'@smooai/file': patch
---

Migrate build tooling from tsup to tsdown — faster, oxc-based, drop-in replacement. Output extensions shift from `.js`/`.mjs`/`.d.ts` to `.cjs`/`.mjs`/`.d.cts`/`.d.mts` (tsdown defaults); the `exports` map is updated to match, so subpath imports continue to resolve transparently. Also bumps `@smooai/utils` to ^1.3.4 to pick up the tsdown-aware `create-entry-points` CLI. No public API change.
