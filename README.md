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

Here’s your table split into two sections: one for commands with subcommands (`/breakout`) and another for standalone commands (`/utility`).  

---

## ⚙️ Command Reference  

BritzoneBot offers a suite of intuitive slash commands to manage breakout rooms effectively. Below is a detailed command reference.  

### 🏠 Breakout Commands  

These commands manage breakout voice channels and require the **Move Members** permission.  

| Command      | Subcommand     | Description                                                              | Options                                                                                                               |
|-------------|--------------|------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| `/breakout` | `create`       | Creates multiple breakout voice channels.                                  | `number`: *(Integer, Required)* - The number of breakout rooms to create. Must be a positive integer.              |
| `/breakout` | `distribute`   | Distributes users from a main voice channel into breakout rooms.           | `mainroom`: *(Voice/Stage Channel, Required)* - The main voice channel to distribute users from.                     |
|             |              |                                                                      | `facilitators`: *(String, Optional)* - User mentions to exclude from distribution (facilitators to remain in the main room). |
| `/breakout` | `end`          | Ends the breakout session, moves users back, and deletes breakout rooms.  | `main_room`: *(Voice Channel, Optional)* - The main voice channel to move users back to. If omitted, uses the previously set main room. |
| `/breakout` | `timer`        | Sets a timer for the breakout session.                                    | `minutes`: *(Integer, Required)* - Duration of the breakout session in minutes. Must be a positive integer.          |
| `/breakout` | `broadcast`    | Broadcasts a message to all active breakout rooms.                       | `message`: *(String, Required)* - The message content to broadcast.                                                 |
| `/breakout` | `send-message` | Sends a direct message to a specific voice channel.                      | `channel`: *(Voice Channel, Required)* - The target voice channel to send the message to.                             |
|             |              |                                                                      | `message`: *(String, Required)* - The message content to send.                                                        |

---

### 🛠️ Utility Commands  

These standalone commands provide general information and do not require special permissions.  

| Command      | Description                                        | Options       |
|-------------|------------------------------------------------|--------------|
| `/user`   | Provides information about the user executing the command.  | *No options.* |
| `/server` | Provides information about the Discord server.              | *No options.* |
| `/ping`   | Tests the bot's responsiveness. Replies with "Pong!".       | *No options.* |

This structure makes it clear that `/breakout` commands require subcommands, while `/utility` commands do not.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any changes or improvements.

