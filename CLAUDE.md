# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Use Context7 MCP server for up-to-date library documentation.**

## Project Overview

@smooai/file is a multi-language file handling library providing a unified interface for working with files from local filesystem, S3, URLs, and more. Built with streaming in mind, it handles file bytes lazily where possible to minimize memory usage and improve performance.

> **CRITICAL: All feature work MUST happen in a git worktree.** Never edit source code or commit directly on `main` in `~/dev/smooai/file/`. The main worktree stays on `main` and is only used for merging, pulling, and creating new worktrees. A `PreToolUse` hook enforces this — see `.claude/hooks/enforce-worktree.sh`.

---

## Git Workflow — Worktrees (MANDATORY for all feature work)

### Working directory structure

```
~/dev/smooai/
├── file/                              # Main worktree (ALWAYS on main)
├── file-SMOODEV-XX-short-desc/        # Feature worktree
└── ...
```

### Branch naming

Always prefix with the Jira ticket number:
```
SMOODEV-XX-short-description
```

### Commit messages

Always prefix with the Jira ticket:
```
SMOODEV-XX: Descriptive message explaining why
```

### Creating a worktree

```bash
cd ~/dev/smooai/file
git worktree add ../file-SMOODEV-XX-short-desc -b SMOODEV-XX-short-desc main
cd ../file-SMOODEV-XX-short-desc
pnpm install
cd python && uv sync && cd ..
```

### Merging to main

```bash
cd ~/dev/smooai/file
git checkout main && git pull --rebase
git merge SMOODEV-XX-short-desc --no-ff
git push
```

### Cleanup after merge

```bash
git worktree remove ~/dev/smooai/file-SMOODEV-XX-short-desc
git branch -d SMOODEV-XX-short-desc
```

---

## Build, Test, and Development Commands

### All languages

```bash
pnpm install              # Install TypeScript dependencies
pnpm build                # Build all languages
pnpm test                 # Run all tests
pnpm lint                 # Lint all languages
pnpm format               # Format all code
pnpm format:check         # Check formatting
pnpm typecheck            # Type check all languages
pnpm check-all            # Full CI parity (typecheck, lint, format, test, build)
```

### TypeScript

```bash
pnpm build:lib            # Build TypeScript library
pnpm test                 # Vitest
pnpm typecheck            # tsc
pnpm lint                 # oxlint
pnpm format               # oxfmt
```

### Python

```bash
cd python && uv sync --group dev   # Setup Python environment
poe build                          # Build wheel + sdist
poe test                           # pytest
poe lint                           # Ruff check
poe format                         # Ruff format
poe typecheck                      # BasedPyright

# Or from root:
pnpm python:build
pnpm python:test
pnpm python:lint
pnpm python:format
pnpm python:typecheck
```

### Rust

```bash
cd rust/file
cargo build --release
cargo test
cargo clippy --all-targets -- -D warnings
cargo fmt

# Or from root:
pnpm rust:build
pnpm rust:test
pnpm rust:lint
```

### Go

```bash
cd go/file
go build ./...
go test -v ./...
go vet ./...
gofmt -w .

# Or from root:
pnpm go:build
pnpm go:test
pnpm go:lint
```

---

## Testing

- **TypeScript**: Vitest for unit tests
- **Python**: pytest via `poe test`
- **Rust**: `cargo test` in `rust/file/`
- **Go**: `go test` in `go/file/`
- All tests must pass before merging

---

## CI / GitHub Actions

### PR Checks (`pr-checks.yml`)

Runs on every PR to `main`: typecheck, lint, format check, test, build (all languages)

### Release (`release.yml`)

Same checks + Changesets version/publish to npm, PyPI, crates.io, and Go module tagging.

---

## Changesets & Versioning

Always add changesets when the package changes:

```bash
pnpm changeset
```

---

## Coding Style

- TypeScript: oxlint + oxfmt
- Python: Ruff (lint + format) + BasedPyright (types)
- Rust: clippy + rustfmt
- Go: go vet + gofmt
