#!/usr/bin/env node

/**
 * Synchronizes version from package.json to all sub-package manifests.
 *
 * Runs from the changesets `version` lifecycle so the bumped manifests land in
 * the release commit. Running it after `changeset publish` (as this repo used
 * to) mutates a CI workspace nobody commits, which is why every git tag shipped
 * a stale version constant.
 */

import { readFileSync, writeFileSync } from 'fs';
import { relative } from 'path';
import { rootDir, targets, version } from './version-targets.mjs';

console.log(`Syncing version ${version} to all sub-packages...`);

for (const target of targets) {
    const name = relative(rootDir, target.path);
    let content;
    try {
        content = readFileSync(target.path, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`  Skipped (not found): ${name}`);
            continue;
        }
        throw error;
    }

    // A pattern that stopped matching (renamed field, reformatted file) would
    // otherwise look identical to "already correct" and silently ship drift.
    if (!target.pattern.test(content)) {
        throw new Error(`${name}: pattern ${target.pattern} matched nothing — the version field moved or was renamed.`);
    }

    const updated = content.replace(target.pattern, target.replacement);
    if (content === updated) {
        console.log(`  Already up to date: ${name}`);
    } else {
        writeFileSync(target.path, updated);
        console.log(`  Updated ${name}`);
    }
}

console.log('Done!');
