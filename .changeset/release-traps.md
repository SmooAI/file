---
'@smooai/file': patch
---

Three release and test traps that each report success while doing nothing.

**`go test ./...` served a cached pass against a corrupted fixture.** Go's build cache doesn't invalidate on a file loaded from outside the package directory, which is exactly the shape of the shared contract fixtures under `spec/`. Verified: zeroing every `sha256` and setting `headBytes` to 999 still printed `ok (cached)`. `go:test` now passes `-count=1`, and the same corruption fails immediately. Until this, the Go quarter of the five-port lazy contract proved nothing.

**`release.yml` ran `pnpm format` in write mode.** Whatever it rewrote was either swept into the release commit unreviewed, or — in publish mode, where the changesets action commits nothing — left the tree dirty for `cargo publish --locked`, which would fail every release now that `--allow-dirty` is gone. The workflow now runs `format:check`, and the formatting the release genuinely needs runs inside `pnpm run version`, before the action commits. Changesets' generated `CHANGELOG.md` is confirmed not oxfmt-clean, so without that ordering `format:check` would redden every future release PR.

**Publishing to PyPI, crates.io, NuGet and the Go tag was gated on npm having published in the same run.** If npm succeeded and a later step failed, the retry found nothing new for npm, so all four skipped — a green run that published nothing, stranding four ports on the previous release indefinitely. Each step is now gated on whether its own registry carries `package.json`'s version, so a retry ships exactly what is missing, and a final step fails the run if npm published a version the others didn't.
