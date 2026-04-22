# Discord CLI Agent Integration Plan

## Goal Description
The objective is to allow users to spawn continuous, interactive conversations with CLI-based AI agents (such as the Claude CLI or Gemini CLI) directly from Discord. Each agent session will map to a dedicated Discord channel or thread.

### The Core Question: Continuous Session vs. Single Query
**Question**: *Can we drive a whole conversation with an agent process, or are we limited to a single query on a command line?*

**Answer**: **Yes, we can drive a whole continuous conversation.** We are NOT limited to single queries. 
By spawning the CLI as a persistent background process and keeping its standard input/output streams open, we can maintain the stateful context of the chat session exactly as if a human were typing in a terminal.

## Proposed Architecture

To achieve this, we need a system that maps **Discord Channel IDs** to **Persistent Processes**.

### 1. Process Manager (The Bridge)
We will create a new service (e.g., `CliAgentManager`) that manages the lifecycle of these CLIs.
- **Node `child_process.spawn`**: We will use `spawn` to start the CLI (e.g., `spawn('claude', ['chat'])`). 
- **`node-pty` (Alternative)**: If the CLI tools refuse to run interactively without a real terminal (TTY), we will use the `node-pty` library to spawn a pseudoterminal. This tricks the CLI into behaving identically to how it runs in a standard terminal application.

### 2. Channel & Thread Mapping
- When a user runs a command like `/agent start claude`, the bot will create a new Discord channel (or a private Thread).
- The `CliAgentManager` will spawn the CLI and store a mapping: `Map<ChannelID, Process>`.

### 3. Bidirectional Communication
- **Discord -> CLI**: When a user types a message in the mapped channel, the bot intercepts the `messageCreate` event, retrieves the mapped process, and writes the message to the process's standard input (`process.stdin.write(message + '\n')`).
- **CLI -> Discord**: We will listen to the process's standard output (`process.stdout.on('data')`). 

### 4. Output Buffering & Delimiters
CLIs often stream their output character-by-character or chunk-by-chunk. To avoid spamming Discord with tiny messages:
- We will buffer the `stdout` stream.
- We will use debouncing (e.g., send the buffer to Discord after 500ms of silence) OR look for specific prompt indicators (like `> ` or `? `) to know when the agent has finished speaking.
- We will strip ANSI color codes from the output so it renders cleanly in Discord.

## Implementation Steps

#### [NEW] `src/services/CliAgentManager.ts`
- Creates the `Map<string, ChildProcess>` store.
- Exports `spawnAgent(channelId, agentType)`, `sendInput(channelId, text)`, and `killAgent(channelId)`.
- Handles `stdout` buffering and formatting, emitting events when a full message is ready for Discord.

#### [NEW] `src/commands/agent.ts`
- Adds a slash command `/agent start <type>` to create a new thread and initialize the mapping.
- Adds `/agent stop` to kill the process and lock/close the thread.

#### [MODIFY] `src/events/messageCreate.ts`
- Checks if the incoming message's channel ID exists in the `CliAgentManager` map.
- If true, forwards the message content to the agent via `sendInput` instead of normal bot processing.

## Open Questions
- **Which CLIs exactly?** Do you have specific CLI packages in mind (e.g., `anthropic-cli`, Google's `gemini` python CLI)? We need to know the exact startup command and whether they require TTY.
- **Output Formatting:** Some CLIs output raw markdown, some use complex terminal UI (like `ncurses` or `charmbracelet` TUIs). If the CLI uses a complex TUI, we might need a headless API instead. Assuming these are simple text-stream CLIs, buffering will work well.
- **Channel vs Threads:** Should each agent process get a dedicated permanent Channel, or a temporary Discord Thread (which keeps the server cleaner)?
