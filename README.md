# BritzoneBot

[![Project Status](https://img.shields.io/badge/Status-Stable-brightgreen.svg)](https://github.com/britzoneid/BritzoneBot)
[![version](https://img.shields.io/github/package-json/v/britzoneid/BritzoneBot)](https://github.com/britzoneid/BritzoneBot/blob/master/package.json)
[![License](https://img.shields.io/github/license/britzoneid/BritzoneBot)](https://github.com/britzoneid/BritzoneBot/blob/master/LICENSE)
[![Bun Version](https://img.shields.io/badge/Bun-%3E=v1.3.0-FBF0DF?logo=bun)](https://bun.sh)


BritzoneBot is a Discord bot designed to manage breakout rooms for voice channels in a Discord server. It provides commands to create, distribute users among, recall members from, and delete breakout sessions with robust error handling, operation checkpointing, and persistent state management.

## ✨ Features

- **Create Breakout Rooms**: Create multiple breakout voice channels in the same category as the invoking channel.
- **Distribute Users**: Preview and confirm distribution of users from a main voice channel into breakout rooms, with support for facilitators and excluded users.
- **Recall Members**: Move all users back to the main voice channel while keeping breakout rooms intact.
- **Delete Breakout Rooms**: Safely delete all breakout room channels (with member-presence protection).
- **Set & Cancel Timer**: Set a countdown timer for breakout sessions with periodic reminders, configurable auto-recall (with grace period countdowns), and the ability to cancel or update active timers.
- **Broadcast Message**: Broadcast a message to all active breakout rooms.
- **Send Message**: Send a message to a specific voice channel's text chat.
- **Safe Interaction Handling**: Built-in error handling for expired interactions, network issues, and timeouts.
- **Persistent State & Checkpointing**: File-based state management (`data/breakoutState.json`) enables resuming interrupted operations.
- **Structured Logging**: Pino-powered logging with pretty console output and daily-rotating file logs.

## 🏗️ Architecture

The project is written in **TypeScript** and follows a modular architecture:

```
src/
├── commands/          # Slash command definitions (main + utility)
├── events/            # Discord event handlers (interactionCreate, ready)
├── lib/               # Shared utilities (Discord helpers, logger)
├── modules/
│   └── breakout/
│       ├── handlers/  # Interaction-level handlers for each subcommand
│       ├── operations/# Orchestrated multi-step operations with checkpointing
│       ├── services/  # Domain logic (distribution, messaging, rooms, timer)
│       ├── state/     # Persistent state manager (file-backed)
│       └── utils/     # Distribution algorithm, embed builders
├── types/             # Shared TypeScript interfaces and type definitions
└── index.ts           # Entry point: client init, command/event loading, login
```

## 🛠️ Installation Guide

Follow these steps to deploy and configure BritzoneBot on your Discord server:

### 1. Clone the Repository

```sh
git clone https://github.com/britzoneid/BritzoneBot.git
cd BritzoneBot
```

### 2. Install Dependencies

Ensure you have [Bun](https://bun.sh) (≥ 1.3.0) installed, then run:

```sh
bun install
```

### 3. Configuration

#### Environment Variables

Copy `.env.example` to `.env` in the root directory:

```sh
cp .env.example .env
```

Fill in your bot credentials obtained from the [Discord Developer Portal](https://discord.com/developers/applications).

```env
BOT_ID=your-bot-id
TOKEN=your-bot-token

# Optional
NODE_ENV=production
LOG_LEVEL=info   # trace | debug | info | warn | error | fatal | silent
```

#### Guild Configuration

Create a `guildConfig.json` file in the root directory to map each guild ID to its server name and manager role ID. This file is required for both registering slash commands (`bun run deploy`) and enforcing permissions:

```sh
cp guildConfig.json.example guildConfig.json
```

Edit `guildConfig.json` with your Discord server IDs and manager role IDs:

```json
{
  "YourGuildID1": {
    "name": "YourServerName1",
    "managerRoleId": "YourManagerRoleID1"
  },
  "YourGuildID2": {
    "name": "YourServerName2",
    "managerRoleId": "YourManagerRoleID2"
  }
}
```

### 4. Bot Permissions & OAuth2 Setup

When inviting the bot or configuring its role in your Discord server, grant the following OAuth2 scopes and permissions to ensure all features (slash commands, breakout rooms, and distributed instance locking) function correctly.

#### OAuth2 Scopes
- `bot`
- `applications.commands`

#### Required Permissions

| Feature / Module | Permission | Why It Is Required |
|------------------|------------|---------------------|
| **General & Commands** | `View Channel` | View text channels to handle slash commands. |
| | `Send Messages` | Post command responses, confirmations, and announcements. |
| | `Embed Links` | Send rich status, distribution previews, and diagnostic embeds. |
| | `Read Message History` | Fetch messages and state verification. |
| **Distributed Lock** | `Manage Channels` | Auto-create the `#bot-instance-lock` channel if it does not exist. |
| | `Manage Roles` *(Manage Permissions)* | Configure private channel permission overwrites for `#bot-instance-lock`. |
| | `Manage Messages` | Delete stale lock records and collision notices during cleanup. |
| **Breakout Rooms** | `Manage Channels` | Dynamically create and delete breakout voice channels. |
| | `Move Members` | Move participants into breakout rooms and recall them to the main room. |
| | `Connect` | Manage voice channels within categories via Discord REST API. |
| | `Manage Messages` | Clean up active countdown and periodic reminder messages when expired or cancelled. |

> [!TIP]
> **Calculated Permission Integer**: `286349328` (`0x110FB410`)  
> **Invite URL Template**:  
> `https://discord.com/api/oauth2/authorize?client_id=YOUR_BOT_ID&permissions=286349328&scope=bot%20applications.commands`  
> *(For private development/staging servers, granting **Administrator** (`8`) is also sufficient).*

### 5. Build and Deploy

```sh
# Compile TypeScript → JavaScript
bun run build

# Register slash commands to all guilds in guildConfig.json
bun run deploy
```

### 6. Run the Bot

| Mode        | Command      | Notes                                        |
|-------------|--------------|----------------------------------------------|
| Production  | `bun start`  | Runs the compiled output. Use a process manager (`pm2`, `systemd`) for uptime. |
| Development | `bun dev`    | Live-reload via Bun's watch mode.            |

---

## ⚙️ Command Reference

BritzoneBot offers a suite of slash commands to manage breakout rooms. All breakout commands are restricted to members whose roles include the manager role configured for the current guild in `guildConfig.json`.

### 🏠 Breakout Commands

| Command      | Subcommand     | Description                                                        | Options |
|--------------|----------------|--------------------------------------------------------------------|---------|
| `/breakout`  | `create`       | Creates multiple breakout voice channels.                          | `number` *(Integer, Required)* – Number of rooms to create (≥ 1). |
| `/breakout`  | `distribute`   | Previews and distributes users from a main room into breakout rooms. Shows a confirmation prompt before moving. | `mainroom` *(Voice/Stage Channel, Required)* – The source voice channel. |
|              |                |                                                                    | `exclude` *(String, Optional)* – User mentions to keep in the main room. |
|              |                |                                                                    | `facilitators` *(String, Optional)* – User mentions to assign into breakout rooms first (one per room when possible). |
| `/breakout`  | `recall`       | Moves all members from breakout rooms back to the main voice channel. Breakout rooms remain intact. | `mainroom` *(Voice/Stage Channel, Required)* – The destination channel. |
| `/breakout`  | `delete`       | Deletes all breakout room channels.                                | None |
| `/breakout`  | `timer`        | Sets a countdown timer for the breakout session. Sends periodic reminders and handles auto-recall on expiration. | `minutes` *(String, Optional)* – Duration preset: 20, 30, 45, 60, 90 minutes, or 3 seconds (testing). |
|              |                |                                                                    | `custom_minutes` *(Integer, Optional)* – Custom duration, minimum 30 minutes. Takes precedence over `minutes`. |
|              |                |                                                                    | `auto_recall` *(Boolean, Optional)* – Automatically recall members to main room when time is up (default: `true`). |
|              |                |                                                                    | `grace_period` *(Integer, Optional)* – Grace period in seconds before auto-recalling members (0–300s, default: `60s`). |
| `/breakout`  | `timer-cancel` | Cancels the active breakout session timer.                         | None |
| `/breakout`  | `status`       | Displays current breakout rooms, timer state and any operation in progress. | None |
| `/breakout`  | `broadcast`    | Broadcasts a message to all active breakout rooms.                 | `message` *(String, Required)* – The message content. |
| `/breakout`  | `send-message` | Sends a message to a specific voice channel's text chat.           | `channel` *(Voice Channel, Required)* – Target channel. |
|              |                |                                                                    | `message` *(String, Required)* – The message content. |
| `/breakout`  | `reset`        | Clears a stuck operation record so other subcommands can run again. Rooms, members and timers are left untouched. | None |

### 🛠️ Utility Commands

| Command   | Description                                              | Permissions |
|-----------|----------------------------------------------------------|-------------|
| `/ping`    | Replies with "Pong!" and the bot's WebSocket latency.    | Send Messages |
| `/server`  | Displays the server name and member count.               | None        |
| `/user`    | Displays the invoking user's name and join date.         | None        |
| `/version` | Displays bot version, build metadata, and runtime info.  | None        |

---

## 🔄 Operation Lifecycle & Recovery

Every breakout operation (`create`, `distribute`, `recall`, `delete`) is tracked with **checkpoint-based progress** persisted to `data/breakoutState.json`. If the bot restarts or an operation is interrupted:

1. The state file records which steps have already completed.
2. Re-running the same subcommand **resumes** from the last checkpoint.
3. Running a *different* room-mutating subcommand (`create`, `distribute`, `recall`, `delete`, `timer`) while one is in progress is blocked with an explanatory message.
4. Completed operations are moved to history — without their step map — and the active operation slot is cleared.

This ensures no duplicate channels are created, no users are moved twice, and no rooms are double-deleted.

### Getting unstuck

An operation that is interrupted and never resumed would otherwise hold the
lock indefinitely. Three things prevent that from stranding a session:

- **Non-mutating subcommands are never blocked.** `status`, `timer-cancel`,
  `broadcast`, `send-message` and `reset` run regardless of what is in
  progress, so the tools you need to diagnose and recover stay available.
- **Abandoned operations expire.** An operation that records no checkpoint for
  10 minutes is discarded automatically on the next command. Staleness is
  measured from the last checkpoint, so a slow operation that is still making
  progress is never cut short.
- **`/breakout reset` clears it immediately** when you do not want to wait. It
  removes only the operation record — rooms, members and any active timer are
  untouched — so it is safe to run when unsure. Follow it with
  `/breakout status` to see what actually exists.

## 📋 Distribution Preview

When you run `/breakout distribute`, the bot:

1. Calculates a randomized round-robin assignment (facilitators first, then regular members).
2. Displays a **preview embed** showing exactly who will go to which room.
3. Presents **Confirm** / **Cancel** buttons (60-second timeout).
4. Only after confirmation does it begin moving members, with the handler's time budget restarted so a slow decision cannot make the move itself look like a failure.

`exclude` and `facilitators` accept both user mentions (`@someone`) and role
mentions (`@Facilitators`); a role expands to its members currently in voice.
Anything that is not a real mention — a name typed by hand, for instance — is
reported on the preview rather than silently ignored.

This prevents accidental mass-moves and gives moderators a chance to review the plan.

## ⏱️ Breakout Timer & Auto-Recall

The `/breakout timer` command provides automated schedule tracking and auto-recall for breakout sessions:

- **Presets & Periodic Reminders**: Choose from preset durations (20, 30, 45, 60, or 90 minutes, plus a 3-second preset for testing), or set any custom duration of 30 minutes or more with `custom_minutes`. The bot sends targeted reminder messages to each breakout channel at that preset's milestone thresholds (e.g. 15m, 5m remaining); custom durations get `[min(30, ⅔ D), 10m, 5m]`. Presets and their reminder schedules are defined in one lookup table, so the choices offered and the durations accepted cannot drift apart.
- **Auto-Recall & Grace Period**: When `auto_recall` is enabled (`true` by default), a live countdown timestamp (`<t:unix:R>`) is displayed in text channels during the grace period (default: `60s`) before members are moved back to the main voice channel.
- **Timer Cancellation & Replacement**: An active timer can be canceled manually with `/breakout timer-cancel`, or automatically when running `/breakout recall` or `/breakout delete`. Cancelling or replacing a timer clears its pending reminders and removes the live grace-period countdown, whose relative timestamp would otherwise be stale. Reminders already sent ("15 minutes remaining") stay in the rooms as a record of what participants were told.

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request for any changes or improvements.

## 📜 License

This project is licensed under the AGPLv3 License - see the [LICENSE](LICENSE) file for details.

