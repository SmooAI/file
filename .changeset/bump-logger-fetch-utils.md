---
'@smooai/file': patch
---

SMOODEV-928: Bump `@smooai/logger` to `^4.1.4`, `@smooai/utils` to `^1.3.3`, and `@smooai/fetch` to `^3.3.5` (major jump from prior `^2.1.0` range, but the TS API is unchanged from fetch 2.x to 3.x — the 3.0 major was for adding Python/Rust/Go ports). Picks up the ESM `__filename` TDZ fix from logger 4.1.4 transitively. Also drops deprecated `baseUrl: "./"` from tsconfig (TS 5.9+/6.x reject it with TS5101).
