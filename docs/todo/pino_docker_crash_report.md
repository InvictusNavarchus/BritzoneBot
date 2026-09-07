# Docker / Pino Logging Crash Investigation Report

**Date:** 2026-02-17  
**Status:** Superseded — retained as background only (see *Current State* below)  

> **Current state (2026-09-07).** This report no longer describes the shipped
> configuration. Docker was deprecated and removed from the project in
> `ce4b8f9`, and the bot now runs under pm2 with Bun on Linux, where the worker
> thread instability documented here does not reproduce. The `pino-roll`
> transport is **enabled** in `src/lib/logger.ts` and working.
>
> The conclusion below stated that file logging had been "commented out/reverted",
> which contradicted the code for several releases. That claim is corrected in
> *Conclusion for this PR*. The analysis of the Docker/Alpine failure is kept
> because it stays relevant if the project is ever containerised again.

## Problem Statement

When running the Discord bot in a Docker container (powered by Bun and Alpine Linux), the application crashes immediately after the "Logging in..." phase if a file-based logging transport (`pino-roll` or `pino/file`) is enabled.

-   **Environment:** Docker (Alpine), Bun v1.3.x
-   **Library:** `pino` (v9+)
-   **Transports:** `pino-pretty` (working), `pino-roll` (failing), `pino/file` (failing)
-   **Error:** `error: script "start" exited with code 1` (no stack trace, no JS exception caught)

## Symptoms

1.  **Crash on File Write:** The bot starts successfully, logs initial messages to stdout via `pino-pretty`, but crashes silently as soon as it attempts to initialize or write to the log file via a worker thread transport.
2.  **Works without File Transport:** If the `pino-roll` or `pino/file` transport is removed (leaving only `pino-pretty`), the bot runs perfectly in Docker.
3.  **Works Locally:** The configuration works fine when running with `bun run start` on the host machine (Linux).
4.  **No Permissions Issue:** We verified volume mounts (`./log:/app/log`), permissions (`chown bun:bun`), and absolute paths. The directory exists and is writable.
5.  **No JS Error:** Catch blocks around `client.login()` and `process.on('uncaughtException')` are NOT triggered. This suggests a low-level crash in the Bun runtime or the worker thread handling the transport.

## Root Cause Analysis (Hypothesis)

The issue likely stems from an incompatibility between **Bun's implementation of Worker Threads** and **Pino's transport system** when running in a restrictive **Docker/Alpine** environment.

-   **Worker Thread Instability:** Pino runs transports in valid Worker Threads. Bun's support for Worker Threads is good but may have edge cases on Alpine Linux involving file descriptors or inter-thread communication that leads to a native crash (segfault or panic) which exits with code 1.
-   **SonicBoom/File System:** The underlying file writer (`sonic-boom`) uses specific FS flags. In combination with Bun/Alpine, this might be causing a silent failure.

## Attempted Fixes (Failed)

1.  **Permissions:** Checked and fixed ownership of `/app/log`.
2.  **Absolute Paths:** Switched from `./log` to `/app/log`.
3.  **Disable `read_only`:** Temporarily disabled `read_only: true` in `docker-compose.yml`.
4.  **Remove `mkdir: true`:** Tried disabling the directory creation logic in transports.
5.  **Switch Transport:** Switched from `pino-roll` (3rd party) to `pino/file` (built-in). Both failed identically.

## Recommended Next Steps (For Future Fix)

To resolve this without giving up on file logging:

1.  **Move to Main Thread:** Stop using `transport: { targets: [...] }` which forces worker threads. Instead, use `pino.multistream()` to run `pino-pretty` and a file stream on the **main thread**. This avoids the worker thread instability entirely.
2.  **Use Docker Standard Logging:** Abandon app-level file writing in Docker. Log only to stdout (`pino-pretty` or just JSON), and let Docker/AWS/CloudWatch handle log collection and rotation. This is the container-native best practice.
3.  **Upgrade/Change Base Image:** Test with a `debian` or `ubuntu-based` Bun image instead of `alpine` to see if it's a musl/libc compatibility issue with Bun workers.

## Conclusion for this PR

This PR successfully migrates the codebase from `console.log` to `pino`. At the
time, the file logging configuration was reverted to prevent crashes in
production Docker builds until the runtime instability could be addressed.

**This no longer holds.** Docker was dropped from the project, and on the
current pm2 + Bun + Linux target the `pino-roll` transport runs without issue.
File logging to `./log/app.log` (daily rotation, 7 files retained) is enabled in
`src/lib/logger.ts` and is the intended configuration. Option 2 above
(stdout-only, external rotation) remains the path to take if the bot is ever
containerised again.
