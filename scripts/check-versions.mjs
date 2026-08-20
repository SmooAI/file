#!/usr/bin/env node

/**
 * Fails if any version-bearing manifest has drifted from package.json.
 *
 * This is the check whose absence let `go/file/v2.2.12` ship a `Version = "1.1.5"`
 * constant and a module path with no `/v2` suffix. It must FAIL, never warn.
 */

import { readFileSync } from 'fs';
import { relative } from 'path';
import { rootDir, targets, version } from './version-targets.mjs';

const problems = [];

for (const target of targets) {
    const name = relative(rootDir, target.path);
    let content;
    try {
        content = readFileSync(target.path, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
    }

    if (!target.pattern.test(content)) {
        problems.push(`${name}: no version field matched ${target.pattern}`);
        continue;
    }

    if (content.replace(target.pattern, target.replacement) !== content) {
        const actual = content.match(target.pattern)[0].trim();
        problems.push(`${name}: has \`${actual}\`, expected \`${target.replacement.replace('$1', '')}\``);
    }
}

if (problems.length > 0) {
    console.error(`Version drift against package.json (${version}):\n`);
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    console.error(`\nRun \`pnpm version:sync\` and commit the result.`);
    process.exit(1);
}

console.log(`All ${targets.length} version-bearing files match package.json (${version}). ✓`);
