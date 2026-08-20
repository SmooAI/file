---
'@smooai/file': patch
---

Stop making every consumer pay for the AWS SDK, and move `typescript` out of runtime dependencies.

`typescript` was an unconditional runtime `dependency` even though nothing under `src/` imports it — it is a build tool. Now a devDependency.

The two `@aws-sdk/*` packages were imported at the top of `src/File.ts`, and an `S3Client` was constructed as a class field on every `File` instance, including ones created from a local path. So `import File from '@smooai/file'` loaded 30 SDK modules whether or not you ever touched S3. They are now behind `import type` (erased at compile time) and `await import(...)` (memoised by the module system), and the instance client is built on first use.

Measured on the built package: **~180ms off a cold `import`, roughly 40% of the total.** `scripts/check-lazy-s3.mjs` runs as `postbuild` and fails if the SDK ever re-enters the import graph, which one `import { S3Client }` written without `import type` would do.

No API change. The SDKs stay in `dependencies` — making them optional peers would break existing consumers who use S3, so that is tracked separately.
