---
'@smooai/file': patch
---

Make the TypeScript S3 ingest tests actually run.

`src/File.integration.spec.ts` had `describe.skip('createFromS3')` with the note "Only works when logged in to AWS for smoo.dev" — seven tests that read as coverage while asserting nothing. `createFromS3` was the only ingest path in the TypeScript port with no executing test, while Python (`moto`) and .NET both test theirs.

The AWS SDK v3 speaks plain HTTPS, so the seven tests now run against MSW-intercepted S3 responses served from the same fixture files the local-file tests use. That exercises the real client — request signing, XML error parsing, streamed response body — with no AWS account, no credentials, and no container. `msw` was already a devDependency of this repo and already used in this file.
