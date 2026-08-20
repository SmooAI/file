/**
 * The single list of version-bearing files in this repo.
 *
 * `sync-versions.mjs` writes them; `check-versions.mjs` asserts them. Both read
 * this table, so a target added here is automatically both synced and guarded.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export const version = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')).version;

const major = Number(version.split('.')[0]);

const GO_MODULE_BASE = 'github.com/SmooAI/file/go/file';

/** Go requires a `/vN` module-path suffix for major >= 2, and none for 0/1. */
export const goModulePath = major >= 2 ? `${GO_MODULE_BASE}/v${major}` : GO_MODULE_BASE;

export const targets = [
    {
        path: join(rootDir, 'python', 'pyproject.toml'),
        pattern: /^version = ".*"$/m,
        replacement: `version = "${version}"`,
    },
    {
        path: join(rootDir, 'rust', 'file', 'Cargo.toml'),
        pattern: /^version = ".*"$/m,
        replacement: `version = "${version}"`,
    },
    {
        // Name-targeted so a same-versioned DEPENDENCY is never touched. Without this
        // the lock pins the old version and `cargo publish --locked` rejects the
        // mismatch — which is why the release used to reach for `--allow-dirty`.
        path: join(rootDir, 'rust', 'file', 'Cargo.lock'),
        pattern: /(name = "smooai-file"\nversion = )"[^"]*"/,
        replacement: `$1"${version}"`,
    },
    {
        path: join(rootDir, 'go', 'file', 'version.go'),
        pattern: /const Version = ".*"/,
        replacement: `const Version = "${version}"`,
    },
    {
        // A major bump that leaves the module suffix behind makes every tagged
        // version unresolvable through the module proxy — that is how the
        // `go/file/v2.2.x` tags resolved nothing for months. A bad rewrite here
        // fails loudly in CI, because `go build`/`go vet` resolve the imports.
        path: join(rootDir, 'go', 'file', 'go.mod'),
        pattern: /^module github\.com\/SmooAI\/file\/go\/file(\/v\d+)?$/m,
        replacement: `module ${goModulePath}`,
    },
    {
        path: join(rootDir, 'dotnet', 'src', 'SmooAI.File', 'SmooAI.File.csproj'),
        pattern: /<Version>.*<\/Version>/,
        replacement: `<Version>${version}</Version>`,
    },
    {
        path: join(rootDir, 'dotnet', 'src', 'SmooAI.File.S3', 'SmooAI.File.S3.csproj'),
        pattern: /<Version>.*<\/Version>/,
        replacement: `<Version>${version}</Version>`,
    },
];
