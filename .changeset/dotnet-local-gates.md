---
'@smooai/file': patch
---

Make the .NET port visible to the local quality gates.

`package.json` had no `dotnet:*` scripts, so `pnpm test`, `pnpm build`, `pnpm format:check` and `pnpm check-all` — which CLAUDE.md calls "full CI parity" — all silently skipped one of the five ports. The only thing exercising .NET was a separate trailing step in `pr-checks.yml`, so a developer could run every local gate green and still break the port.

Adds `dotnet:build`, `dotnet:test`, `dotnet:format` and `dotnet:format:check`, wires them into `build`, `test`, `format` and `format:check`, and folds the per-language format checks into `format:check` so the local gate and CI cannot disagree about what "formatted" means. `check-all` gets shorter as a result, without losing coverage. The .NET SDK is now a prerequisite for `pnpm test` — documented in CLAUDE.md, which had no .NET section at all.
