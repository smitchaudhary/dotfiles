# TMUX Reference

## Core Concepts

**Session**: A TMUX session is a container for windows. Each project/repo typically has one session.
**Window**: Within a session, windows are like tabs. You might have Dev, Serve, Amp, Claude windows.
**Pane**: A window can contain multiple panes (split view).

## Common TMUX Commands

These are useful to know when working with TMUX programmatically.

### Listing

```bash
tmux list-sessions                          # List all sessions
tmux list-windows -t session-name           # List windows in a session
tmux list-panes -t session:window           # List panes in a window
```

### Sending Commands

```bash
tmux send-keys -t session:window "command" Enter    # Send command and press Enter
tmux send-keys -t session:window C-c                # Send Ctrl+C
tmux send-keys -t session:window C-u                # Send Ctrl+U (clear line)
```

### Capturing Output

```bash
tmux capture-pane -t session:window -p              # Print pane content
tmux capture-pane -t session:window -p -S -100      # Last 100 lines
```

### Session Management

```bash
tmux new-session -d -s session-name -n window-name          # Create session with window
tmux kill-session -t session-name                           # Kill entire session
tmux kill-window -t session:window-name                     # Kill a window
```

## Format Strings

TMUX supports format strings for introspection:

```bash
tmux list-sessions -F "#{session_name}"              # Just session names
tmux list-windows -t session -F "#{window_name}"     # Just window names
tmux list-panes -t session:window -F "#{pane_id}"    # Just pane IDs
```

## Special Keys

When sending keys via `send-keys`:

- `Enter` - Press Return
- `C-c` - Ctrl+C (interrupt)
- `C-d` - Ctrl+D (EOF/exit)
- `C-u` - Ctrl+U (clear line)
- `C-l` - Ctrl+L (clear screen)
- `Space` - Spacebar
- `Tab` - Tab key

Example:
```bash
tmux send-keys -t session:window C-c          # Stop a running process
tmux send-keys -t session:window "exit" Enter # Exit a prompt
```

## Target Specification

TMUX target format: `session:window.pane`

- `dev-project` - Session only
- `dev-project:Serve` - Session and window
- `dev-project:Serve.0` - Session, window, and pane (pane 0 is first)

If you don't specify a pane, TMUX uses the active pane in that window.

## Checking Command Success

After capturing output, look for:

### Server/Service Success
- "listening on" or "running on"
- "started" or "started successfully"
- Port number appears (e.g., ":3000")
- No error messages in first few lines

### Build/Test Success
- "✓" or "PASS"
- "0 failures" or "all tests passed"
- Exit code indicated as 0 (if visible)
- Completion message appears

### Build/Test Failure
- "✗" or "FAIL"
- "Error:" or "error:"
- Stack trace visible
- "X failures" or similar
- Exit code non-zero (if visible)

### Common Errors to Watch For

| Error | Meaning | Solution |
|-------|---------|----------|
| `EADDRINUSE: address already in use` | Port is already bound | Kill the existing process or use different port |
| `ERR! code ENOENT` | File or command not found | Check file paths and dependencies |
| `Connection refused` | Service not running | Start the service first |
| `Permission denied` | File permission issue | Check file permissions or use correct user |
| `command not found` | Command doesn't exist in PATH | Check shell environment or install |

## Multiple Panes in a Window

If a window has multiple panes, `tmux send-keys -t session:window` sends to the active pane. To target a specific pane:

```bash
tmux send-keys -t session:window.0 "command" Enter    # Pane 0
tmux send-keys -t session:window.1 "command" Enter    # Pane 1
```

Usually you won't need this, but it's available if needed.
