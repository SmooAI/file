---
'@smooai/file': patch
---

Add the zero-byte case to the lazy-streaming contract, and give Go a way to say "size not measured".

`spec/lazy-stream-contract.json` pinned 1 KiB, 64 KiB and 1 MiB sources but not the 0-byte boundary, where "shorter than the detection head" degenerates. Empty S3 objects and zero-length uploads are real — this repo already ships `empty.txt` as a fixture.

Adding it immediately failed the Go loader, for a real reason: `Size() int64` cannot express "unknown". Go has no optional integer, so `Size() == 0` was doing double duty for an empty file and for a lazy stream whose tail nobody had counted — the other four ports say the latter with `nil` / `None` / `undefined`. New `(*File).SizeKnown() bool` separates them. Additive and non-breaking: the field's zero value means "known", so every eager constructor stays correct untouched.
