---
'@smooai/file': patch
---

SMOODEV-666: Multi-target the SmooAI.File and SmooAI.File.S3 NuGet packages to `net8.0;net9.0;net10.0` so consumers on every current .NET LTS + STS release get a native `lib/` folder match. Mime-Detective 25.8.1 and AWSSDK.S3 4.0.22 resolve cleanly on all three TFMs — no per-TFM conditionals needed. Also bumped the repo's `dotnet/global.json` rollForward from `latestFeature` to `latestMajor` so the SDK 10 runner can satisfy the 8.0.0 floor.
