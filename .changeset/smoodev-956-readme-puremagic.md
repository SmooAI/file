---
'@smooai/file': patch
---

SMOODEV-956: Fix Python README — `python/README.md` listed `python-magic` as the magic-byte MIME detector, but the package actually ships `puremagic` (per `pyproject.toml` + `_detection.py`, and noted in the 2.0.0 changelog). Update the "Built With" entry so Python users don't pip-install the wrong library.
