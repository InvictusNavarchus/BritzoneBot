# BritzoneBot

BritzoneBot is a Discord bot designed to manage breakout rooms for voice channels in a Discord server. It provides commands to create, distribute users among, and end breakout sessions with robust error handling and state management.

## Features

- **Create Breakout Rooms**: Create multiple breakout voice channels.
- **Distribute Users**: Distribute users from a main voice channel into breakout rooms.
- **End Breakout Sessions**: Move users back to the main voice channel and delete breakout rooms.
- **Set Timer**: Set a timer for breakout sessions with reminders.
- **Broadcast Message**: Broadcast a message to all breakout rooms.
- **Send Message**: Send a message to a specific voice channel.
- **Safe Interaction Handling**: Built-in error handling for expired interactions and network issues.
- **State Management**: Persistent state management to recover from interruptions.

## Installation

1. Clone the repository:
    ```sh
    git clone https://github.com/InvictusNavarchus/BritzoneBot.git
    cd BritzoneBot
    ```

2. Install dependencies:
    ```sh
    npm install
    ```

3. Create a `.env` file in the root directory and add your bot token:
    ```env
    TOKEN=your-bot-token
    BOT_ID=your-bot-id
    ```

4. Create a `guildList.json` file in the root directory and add your guilds:
    ```json
    {
      "GuildName1": "GuildID1",
      "GuildName2": "GuildID2"
    }
    ```

## Usage

### Running the Bot

To start the bot, run:
```sh
node index.js
```

### Deploying Commands

To deploy commands locally, run:
```sh
node deployCommandsLocal.js
```

### Commands

#### `/breakout create`

Creates multiple breakout voice channels.

- **number**: Number of breakout rooms to create (required).

#### `/breakout distribute`

Distributes users from a main voice channel into breakout rooms.

- **mainroom**: The main voice channel where members are currently located (required).
- **facilitators**: List of users to be assigned as facilitators in each breakout room (optional).

#### `/breakout end`

Moves users back to the main voice channel and deletes breakout rooms.

- **main_room**: The main voice channel where users should be moved back (optional).

#### `/breakout timer`

Sets a timer for the breakout session.

- **minutes**: Duration of the breakout session in minutes (required).

#### `/breakout broadcast`

Broadcasts a message to all breakout rooms.

- **message**: The message to broadcast (required).

#### `/breakout send-message`

Sends a message to a specific voice channel.

- **channel**: The voice channel to send the message to (required).
- **message**: The message to send (required).

### Utility Commands

#### `/user`

Provides information about the user.

#### `/server`

Provides information about the server.

#### `/ping`

Replies with Pong!

## Helpers

The bot includes several helper functions for managing interactions, users, roles, and breakout rooms:

- **safeReply**: Handles Discord interactions with built-in error handling.
- **moveUser**: Moves a user to a specified voice channel.
- **isAdmin**: Checks if a user has admin privileges.
- **getUsers**: Gets all users in a voice channel.
- **getRoles**: Gets all roles for a user.
- **distributeUsers**: Distributes users among breakout rooms.
- **deleteChannel**: Safely deletes a voice channel.
- **createChannel**: Creates a new voice channel.
- **breakoutStateManager**: Manages state persistence for breakout room operations.
- **breakoutRoomManager**: In-memory storage for tracking breakout rooms per guild.
- **breakoutOperations**: Functions for creating, distributing, and ending breakout sessions with checkpointing.
- **breakoutTimerHelper**: Functions for managing breakout session timers.
- **broadcastToBreakoutRooms**: Broadcasts a message to all breakout rooms.
- **sendMessageToChannel**: Sends a message to a specific voice channel.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any changes or improvements.

