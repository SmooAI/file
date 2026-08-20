---
'@smooai/file': patch
---

Stop the integration tests from being able to reach real AWS.

`server.listen()` uses MSW's default `onUnhandledRequest: 'warn'`, which **passes the request through to the real network**. A typo in the bucket or region, or a change that reaches a different endpoint, would have sent a signed request to real AWS and printed a warning nobody reads. Now `'error'`, so an unintercepted request fails the test.

The fake AWS credentials are also assigned outright instead of defaulted with `??=`, so a developer with real credentials exported never has them used to sign anything — even against a mock that never sends the request.
