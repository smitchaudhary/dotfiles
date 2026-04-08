---
name: tmux-agent
description: Programmatically interact with TMUX sessions and windows to send commands and read output. Use this skill when needing to execute commands in separate TMUX windows (like serving, running background processes, or executing operations outside the current session) and verify their success by reading output.
---

# TMUX Agent Skill

## Overview

This skill enables Claude to interact with TMUX sessions and windows programmatically. Instead of running commands directly in the current session (which is inappropriate for long-running services or background processes), use TMUX to send commands to dedicated windows and read their output to verify success or failure.

Common use cases:
- Starting servers in the Serve window and verifying they started
- Running tests or builds in the Dev window while checking for errors
- Sending commands to coding agent windows (Amp, Claude, Opencode, etc.)
- Checking output from long-running processes

## Quick Start

The skill automatically works with the **current TMUX session**. No session specification required:

1. List available sessions and windows using the `list_tmux_state.sh` script
2. Identify the target window in the current session (e.g., "Serve", "Dev", "Amp")
3. Send a command using the `send_and_capture.sh` script with just the window name
4. Read and parse the output to determine success/failure

If you need to target a different session, use the `-s` flag. If unsure which window to use, ask the user for clarification with their window names.

## Core Capabilities

### 1. Discovering TMUX State

To understand what sessions and windows are available, execute the `list_tmux_state.sh` script:

```bash
bash scripts/list_tmux_state.sh
```

This outputs:
- **All TMUX sessions** and their windows
- **Current session and window** - marked with arrows
- **Last line of each window** - showing what's running (shell prompt, service output, agent status, etc.)
- **Safety guidance** - identifying which windows are safe to target

Example output:
```
📁 12 ← CURRENT SESSION
  → Dev (current window)
    └─ Amp agent running...
  - Serve
    └─ $ 
  - Amp
    └─ Server listening on port 3000
```

Use this to intelligently decide which window to target. Windows with shell prompts (`$`, `>`, `#`) are safe. Windows showing "running", "listening", or agent output are unsafe to interrupt.

### 2. Sending Commands and Capturing Output

To send a command to a specific window and capture its output, use the `send_and_capture.sh` script:

```bash
bash scripts/send_and_capture.sh <window-name> "<command>" [timeout-seconds]
```

The script automatically targets the **current TMUX session**. Examples:
```bash
bash scripts/send_and_capture.sh Serve "npm start" 5
bash scripts/send_and_capture.sh Dev "npm test" 30
bash scripts/send_and_capture.sh Amp "git status" 3
```

**Parameters:**
- `window-name`: Name of the window in the current session (e.g., "Serve", "Dev", "Amp")
- `command`: The command to execute (must be quoted)
- `timeout-seconds`: (Optional) How long to wait for command completion (default: 5 seconds)

**Optional session override:**
```bash
bash scripts/send_and_capture.sh -s <session-name> <window-name> "<command>" [timeout-seconds]
```

Use the `-s` flag only if you need to target a window in a different session:
```bash
bash scripts/send_and_capture.sh -s other-project Serve "npm start" 5
```

**Return value:** The script outputs the captured pane content after the command completes. Parse this to check for errors, success messages, or expected output.

### 3. Parsing Output for Success/Failure

After sending a command, analyze the captured output:

- **Success indicators**: Look for messages like "Server running on", "✓", "SUCCESS", exit code 0, or expected output
- **Error indicators**: Look for "ERROR", "FAILED", stack traces, port already in use, connection refused, etc.
- **Server/process indicators**: For servers, look for listening ports. For builds, look for completion messages.

Example: After running `npm start` in the Serve window:
```
> project@1.0.0 start
> node server.js

Server listening on http://localhost:3000
```

This indicates success. If output shows "EADDRINUSE" or "Error", that's a failure.

### 4. Handling Command Completion Uncertainty

The `send_and_capture.sh` script uses a timeout-based approach:

- Sends the command with Enter key
- Waits for the specified timeout duration (default 5 seconds)
- Captures current pane content

For long-running commands that don't show a new prompt, use `wait_for_completion.sh` instead:

```bash
bash scripts/wait_for_completion.sh <window-name> [max-wait-seconds]
```

This polls the window until it detects a shell prompt (indicating the command finished):

```bash
bash scripts/wait_for_completion.sh Dev 30  # Wait up to 30 seconds for prompt
```

With session override:
```bash
bash scripts/wait_for_completion.sh -s other-project Dev 30
```

### 5. Safe Window Selection

The `list_tmux_state.sh` output helps identify safe targets. Use this intelligence when deciding which window to send commands to:

**Safe windows** (showing shell prompt):
```
  - Serve
    └─ $
```
A shell prompt (`$`, `>`, `#`) means the window is idle and safe to receive commands.

**Unsafe windows** (showing active processes):
```
  → Dev (current window)
    └─ Amp agent running...
```
Windows showing "running", "listening", agent names, or other active output should NOT receive commands—sending them will interrupt the process and cause errors.

**Decision rule**: Check the last line output shown by `list_tmux_state.sh`:
- Shell prompt → Safe to target
- Agent/service name or "running" → Do NOT target
- Uncertain → Ask the user which window to use

Never send commands to the current window (marked with `→`) unless you're certain it's idle.

## References

Detailed reference material is available in `references/`:

- **tmux_reference.md**: TMUX command reference and patterns
- **error_handling.md**: Common errors and how to handle them
- **output_parsing.md**: Techniques for parsing command output

Load these as needed for specific patterns or troubleshooting.

## Common Workflow Example

**Goal: Start a development server and verify it's running**

1. List current state: `bash scripts/list_tmux_state.sh`
2. Verify you're in the correct session (marked as "← CURRENT SESSION")
3. Identify the Serve window in the output
4. Send command: `bash scripts/send_and_capture.sh Serve "npm start" 5`
5. Read captured output
6. If output shows "listening on", success. If shows "EADDRINUSE", port is in use - handle error
7. If you need to target a different session: `bash scripts/send_and_capture.sh -s other-session Serve "npm start" 5`
8. If unsure about anything, ask the user

---

## Scripts

### list_tmux_state.sh
Lists all TMUX sessions, windows, and pane information in a readable format. Use this to understand your current TMUX setup.

### send_and_capture.sh
Sends a command to a specific TMUX window and captures the output. Core utility for all TMUX interactions.

### wait_for_completion.sh
Polls a TMUX pane until it detects a command prompt, useful for verifying command completion without guessing timeouts.
