#!/usr/bin/env node

/**
 * Fails if importing the built package loads the AWS SDK.
 *
 * `require('@aws-sdk/client-s3')` costs ~110ms, and consumers who only ever read
 * local files should not pay it. Keeping the SDK behind a dynamic `import()` is
 * easy to undo by accident — one `import { S3Client } from '@aws-sdk/client-s3'`
 * added for a type, without `import type`, puts it back at the top of the graph.
 *
 * Runs as `postbuild`, because `dist/` is the only place this is observable:
 * asserting on the shape of `src/File.ts` instead would check a proxy for the
 * thing that matters rather than the thing itself.
 */

import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const entry = join(rootDir, 'dist', 'index.cjs');
const File = require(entry).default;

// Positive control: if the entry didn't actually load, "the SDK isn't loaded"
// would be trivially true and this check would pass while testing nothing.
if (typeof File?.createFromBytes !== 'function') {
    console.error(`✗ ${entry} did not export a usable File — this check cannot conclude anything.`);
    process.exit(1);
}

const eager = Object.keys(require.cache).filter((id) => id.includes('@aws-sdk'));

if (eager.length > 0) {
    console.error('✗ Importing @smooai/file loaded the AWS SDK:\n');
    for (const id of new Set(eager.map((id) => id.replace(/.*node_modules\//, '')))) {
        console.error(`    ${id}`);
    }
    console.error('\nUse `import type` for SDK types and `await import(...)` for its values.');
    process.exit(1);
}

console.log('✓ Importing @smooai/file does not load the AWS SDK.');
