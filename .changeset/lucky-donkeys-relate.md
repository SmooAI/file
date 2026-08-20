---
'@smooai/file': patch
---

Fix the release pipeline so version metadata stops drifting, and give the Go module a resolvable path.

`version:sync` used to run _after_ `changeset publish`, mutating manifests in a CI workspace that nobody committed — so every git tag shipped stale version constants (`go/file/v2.2.12` contained `Version = "1.1.5"`) and `cargo publish` needed `--allow-dirty` to paper over the difference. The sync now runs in the changesets `version` lifecycle, where the action commits the result into the release commit.

- `scripts/version-targets.mjs` is now the single list of version-bearing files; `sync-versions.mjs` writes it and the new `sync-versions` guard (`pnpm version:check`) asserts it, in both PR checks and release. A pattern that matches nothing is now an error instead of a silent "already up to date".
- `rust/file/Cargo.lock` is stamped alongside `Cargo.toml`, so `cargo publish` runs `--locked` with no `--allow-dirty`.
- The Go module path is now `github.com/SmooAI/file/go/file/v2`, which is what Go requires for major >= 2 — the existing `go/file/v2.x` tags resolved nothing without it. The suffix is derived from `package.json`, checked by `version:check`, and re-asserted immediately before the release tag is pushed.

No TypeScript API change.
