---
'@smooai/file': patch
---

Two ways the TypeScript suite could pass without testing anything, closed.

`server.listen()` used MSW's default `onUnhandledRequest: 'warn'`, which passes the request through to the real network — a typo in the S3 bucket or region would have sent a signed request to real AWS and printed a warning nobody reads. Now `'error'`.

`vitest.config.mts` set `passWithNoTests: true`, which turns "vitest matched no files" — a broken glob, a moved directory, a renamed extension — into a green run. Removed, with an explicit `include`.
