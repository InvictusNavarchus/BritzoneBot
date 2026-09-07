# Breakout Command Preflight Permission Architecture Report

**Project**: BritzoneBot  
**Module**: Breakout Rooms (`src/commands/main/breakout.ts`, `src/lib/discord/permission.ts`, `src/modules/breakout/*`)  
**Date**: August 6, 2026  

---

## 1. Executive Summary

This report provides an honest technical post-mortem of the breakout room permission preflight system. 

While certain core structural checks (such as checking parent category permissions and catching `Connect` flag requirements) were implemented, **the preflight system remains incomplete and UNSOLVED regarding multi-permission error aggregation**. 

When multiple permission flags (e.g. both `View Channel` AND `Connect`) are denied at the category level, the system fails to report all missing permissions at once, forcing admins into step-by-step trial-and-error permission fixing.

---

## 2. Detailed Technical Status of Issues

### Issue 1: Preflight Bypass on Operation Resumption & Multi-Handler Execution
* **Status**: ⚠️ **PARTIALLY SOLVED**
* **Symptom**: Executing `/breakout delete` when bot permissions were missing resulted in runtime 403 API errors during channel operations, sticking the operation in an interrupted state.
* **Analysis**: Contextual preflight calls were restored in individual handlers and inside `executeDelete` after channel resolution. However, if an operation gets stuck due to unhandled Discord API errors, there is no built-in recovery mechanism short of manual state file intervention.

---

### Issue 2: Parent Category Permission Overwrites
* **Status**: 🟢 **RESOLVED**
* **Symptom**: Preflight checks passed when inspecting breakout room channels directly, but Discord REST API rejected `DELETE /channels/<id>` requests with `DiscordAPIError: Missing Access (50001)`.
* **Root Cause**: Discord API requires `ManageChannels` and `ViewChannel` on the **parent category (`parentId`)** when deleting channels inside a category.
* **Fix Implemented**: Enhanced `preflightBreakout` to inspect `ch.parent` / `ch.parentId` before checking child channels.

---

### Issue 3: Voice Permission Flag (`Connect`) Requirement
* **Status**: 🟢 **RESOLVED**
* **Symptom**: `ManageChannels` and `ViewChannel` were allowed, but Discord API returned 50001 Missing Access on voice channel deletion.
* **Root Cause**: Discord REST API requires `PermissionsBitField.Flags.Connect` on Voice Channels (`ChannelType.GuildVoice` = 2) for management API operations.
* **Fix Implemented**: Added `PermissionsBitField.Flags.Connect` to required preflight checks for voice breakout channels and categories.

---

### Issue 4: Multi-Permission Aggregation & Discord.js Category Overwrite Masking
* **Status**: ❌ **UNSOLVED / UNRESOLVED (FAILED)**
* **Symptom**: When an admin denies **BOTH** `View Channel` AND `Connect` at the Category level, preflight ONLY reports `I don't have View Channel permission(s)...`, completely omitting `Connect`.
* **Root Cause**:
  1. In Discord.js `GuildMember.permissionsIn()`, when `ViewChannel` is denied (`0n`), Discord.js returns bitmask `0n` for the entire channel permission evaluation.
  2. In `CategoryChannel`, voice-specific flags (`Connect`) are ignored by Discord.js's native `permissionsFor(me)` method.
  3. Attempts to manually inspect `permissionOverwrites.cache` failed to properly aggregate both `View Channel` and `Connect` into a unified error message when evaluated at runtime.
* **Impact**: Admins must grant permissions one at a time via trial-and-error (granting `View Channel` first, only to receive a second error for `Connect` on the next run).

---

## 3. Real Status Matrix

| Component | Responsibility | Actual Status |
| :--- | :--- | :--- |
| **Parent Category Inspection** | Checks parent category `parentId` before checking child channels. | 🟢 **Working** |
| **Voice `Connect` Requirement** | Checks `Connect` flag on voice channels/categories. | 🟢 **Working** |
| **Operation Resume Preflight** | Runs preflight after resolving room IDs during resume. | 🟢 **Working** |
| **Multi-Permission Error Aggregation** | Collects and displays ALL missing permissions simultaneously (e.g. `View Channel, Connect`). | 🟡 **PARTIALLY RESOLVED** — see below |
| **Stuck Operation Recovery** | Allows admins to recover from locked operations without manual JSON edits. | 🟢 **RESOLVED** — see below |

---

## 4. Unresolved Problems & Next Steps Required

1. **Rewrite Permission Overwrite Resolution (Priority 1)** — 🟡 *still open*:
   - `getMissingBotPermissions` still relies on Discord.js's `channel.permissionsFor(me)`, which strips voice permission bits when `ViewChannel` is false. Root causes 1 and 2 of Issue 4 are untouched.
   - To fully fix Issue 4, `permission.ts` must manually resolve `@everyone` and role overwrites directly from `channel.permissionOverwrites.cache` before evaluating bitmasks, without relying on `permissionsFor(me)`.
   - **What has changed:** `preflightBreakout` no longer returns on the first failing *scope*. It collects failures across the category, each breakout room, the voice channel and the text channel, and reports them as one list naming the channel each applies to. That removes the "fix one, run again, get the next error" loop described in Issue 4's Impact. Aggregation *within* a single channel still depends on what `permissionsFor` returns, so the masking behaviour above may still under-report there.
   - `getMissingBotPermissions` also no longer silently prepends `ViewChannel` to every channel-scoped request, which could name a permission the caller never asked about.

2. **Add Emergency `/breakout reset` Command (Priority 2)** — 🟢 *done*:
   - `/breakout reset` clears the stuck operation record. Rooms, members and timers are left untouched, so it is safe to run when unsure.
   - Two further changes remove most of the need for it: an operation that records no checkpoint for 10 minutes now expires automatically, and the non-mutating subcommands (`status`, `timer-cancel`, `broadcast`, `send-message`, `reset`) are exempt from the operation lock — so a wedged operation no longer takes the recovery tools down with it.
   - Separately, `executeDelete`'s resume path used to report a deleted room (Discord error 10003) as a permission failure, producing an operation that could never complete. It now skips rooms that are genuinely gone.

---
*Report generated by Gemini 3.6 Flash.*
