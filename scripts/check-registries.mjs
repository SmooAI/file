#!/usr/bin/env node

/**
 * Reports which of the five registries already carry package.json's version.
 *
 * The release used to gate PyPI, crates.io, the Go tag and NuGet on
 * `steps.changesets.outputs.published == 'true'` — on npm having published in
 * THAT run. If npm succeeded and a later step failed, the retry found nothing
 * new to publish on npm, so `published` was false, so all four skipped: a GREEN
 * run that published nothing, leaving four ports stranded on the old version
 * indefinitely. Gating each registry on what that registry actually has instead
 * makes a retry publish exactly what is missing.
 *
 * npm is the source of truth for "is this version released". The other four
 * never run ahead of it, so a version bumped on main but not yet published
 * can't leak out to PyPI while npm still shows the previous release.
 *
 * Usage:
 *   node scripts/check-registries.mjs               # human-readable report
 *   node scripts/check-registries.mjs --github      # also write GITHUB_OUTPUT flags
 *   node scripts/check-registries.mjs --expect-npm  # wait for npm's index to catch up first
 *   node scripts/check-registries.mjs --assert      # exit 1 if npm has it and others don't
 */

import { execFileSync } from 'child_process';
import { appendFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')).version;

const ok = async (url) => {
    try {
        // `smooai-parity-check` because crates.io rejects requests with no User-Agent.
        const response = await fetch(url, { headers: { 'User-Agent': 'smooai-release-check' } });
        return response.ok;
    } catch {
        return false;
    }
};

const goTagExists = () => {
    try {
        const out = execFileSync('git', ['ls-remote', '--tags', 'origin', `refs/tags/go/file/v${version}`], {
            cwd: rootDir,
            encoding: 'utf8',
        });
        return out.trim().length > 0;
    } catch {
        return false;
    }
};

const registries = {
    npm: () => ok(`https://registry.npmjs.org/@smooai/file/${version}`),
    pypi: () => ok(`https://pypi.org/pypi/smooai-file/${version}/json`),
    crates: () => ok(`https://crates.io/api/v1/crates/smooai-file/${version}`),
    nuget: () => ok(`https://api.nuget.org/v3-flatcontainer/smooai.file/${version}/smooai.file.${version}.nupkg`),
    go: async () => goTagExists(),
};

const probe = async () => Object.fromEntries(await Promise.all(Object.entries(registries).map(async ([name, check]) => [name, await check()])));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Registry indexes lag their upload by seconds to a couple of minutes. Reading
 * "missing" during that window would skip the very publish this run just earned,
 * and then report success — the same silent no-op, moved one step later.
 */
const until = async (satisfied, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    let result = await probe();
    while (!satisfied(result) && Date.now() < deadline) {
        await sleep(10_000);
        result = await probe();
    }
    return result;
};

let present;
if (process.argv.includes('--expect-npm')) {
    present = await until((r) => r.npm, 120_000);
} else if (process.argv.includes('--assert')) {
    present = await until((r) => !r.npm || Object.values(r).every(Boolean), 180_000);
} else {
    present = await probe();
}

console.log(`@smooai/file ${version}:`);
for (const [name, has] of Object.entries(present)) {
    console.log(`  ${has ? '✓' : '·'} ${name.padEnd(7)} ${has ? 'published' : 'missing'}`);
}

if (process.argv.includes('--github') && process.env.GITHUB_OUTPUT) {
    const lines = Object.entries(present).map(([name, has]) => `${name}_missing=${!has && present.npm}`);
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\nnpm_published=${present.npm}\n`);
}

if (process.argv.includes('--assert')) {
    // Only meaningful once npm carries the version — before that, nothing is
    // "stranded", the release simply hasn't happened.
    const stranded = present.npm ? Object.entries(present).filter(([, has]) => !has) : [];
    if (stranded.length > 0) {
        console.error(`\n✗ npm published ${version} but ${stranded.map(([n]) => n).join(', ')} did not.`);
        console.error(`  Those ports are still shipping the previous release. Re-run this workflow — each`);
        console.error(`  publish step is gated on its own registry, so a retry ships exactly what is missing.`);
        process.exit(1);
    }
}
