---
'@smooai/file': patch
---

SMOODEV-953: .NET — add Content-Disposition parser (RFC 6266 / RFC 5987) and wire it into the URL and S3 download flows so `SmooFile.Name` picks up server-suggested filenames (including UTF-8 encoded ones) instead of silently falling back to the URL basename or S3 key.
