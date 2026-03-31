#!/bin/bash

# Send a command to a TMUX window and capture output
# Usage: send_and_capture.sh <window> "<command>" [timeout]
# Optional: send_and_capture.sh -s <session> <window> "<command>" [timeout]

OVERRIDE_SESSION=""

# Check for session override flag
if [ "$1" = "-s" ]; then
    OVERRIDE_SESSION="$2"
    WINDOW="$3"
    COMMAND="$4"
    TIMEOUT="${5:-5}"
    shift 4
else
    WINDOW="$1"
    COMMAND="$2"
    TIMEOUT="${3:-5}"
fi

if [ -z "$WINDOW" ] || [ -z "$COMMAND" ]; then
    echo "Usage: send_and_capture.sh <window> \"<command>\" [timeout_seconds]"
    echo "       send_and_capture.sh -s <session> <window> \"<command>\" [timeout_seconds]"
    echo ""
    echo "Examples:"
    echo "  send_and_capture.sh Serve \"npm start\" 5              # Uses current session"
    echo "  send_and_capture.sh -s myproject Serve \"npm start\" 5 # Override session"
    exit 1
fi

# Detect current session if not overridden
if [ -z "$OVERRIDE_SESSION" ]; then
    SESSION=$(tmux display-message -p '#{session_name}' 2>/dev/null)
    if [ -z "$SESSION" ]; then
        echo "ERROR: Not in a TMUX session and no session specified with -s"
        exit 1
    fi
else
    SESSION="$OVERRIDE_SESSION"
fi

# Verify session exists
if ! tmux list-sessions -F "#{session_name}" | grep -q "^${SESSION}$"; then
    echo "ERROR: Session '$SESSION' not found"
    echo "Available sessions:"
    tmux list-sessions -F "  - #{session_name}" 2>/dev/null || echo "  (none)"
    exit 1
fi

# Verify window exists in this session
if ! tmux list-windows -t "$SESSION" -F "#{window_name}" | grep -q "^${WINDOW}$"; then
    echo "ERROR: Window '$WINDOW' not found in session '$SESSION'"
    echo "Available windows in '$SESSION':"
    tmux list-windows -t "$SESSION" -F "  - #{window_name}" 2>/dev/null || echo "  (none)"
    exit 1
fi

# Send the command
tmux send-keys -t "${SESSION}:${WINDOW}" "$COMMAND" Enter

# Wait for command to execute
sleep "$TIMEOUT"

# Capture and output the pane content
echo "=== Output from ${SESSION}:${WINDOW} ==="
tmux capture-pane -t "${SESSION}:${WINDOW}" -p
echo ""
echo "=== End of output ==="
