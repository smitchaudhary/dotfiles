#!/bin/bash

# Wait for a command to complete in a TMUX pane by detecting shell prompt
# Usage: wait_for_completion.sh <window> [max_wait_seconds]
# Optional: wait_for_completion.sh -s <session> <window> [max_wait_seconds]

OVERRIDE_SESSION=""

# Check for session override flag
if [ "$1" = "-s" ]; then
    OVERRIDE_SESSION="$2"
    WINDOW="$3"
    MAX_WAIT="${4:-30}"
    shift 3
else
    WINDOW="$1"
    MAX_WAIT="${2:-30}"
fi

if [ -z "$WINDOW" ]; then
    echo "Usage: wait_for_completion.sh <window> [max_wait_seconds]"
    echo "       wait_for_completion.sh -s <session> <window> [max_wait_seconds]"
    echo ""
    echo "Examples:"
    echo "  wait_for_completion.sh Serve 30              # Uses current session"
    echo "  wait_for_completion.sh -s myproject Serve 30 # Override session"
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

# Verify session and window exist
if ! tmux list-sessions -F "#{session_name}" | grep -q "^${SESSION}$"; then
    echo "ERROR: Session '$SESSION' not found"
    exit 1
fi

if ! tmux list-windows -t "$SESSION" -F "#{window_name}" | grep -q "^${WINDOW}$"; then
    echo "ERROR: Window '$WINDOW' not found in session '$SESSION'"
    exit 1
fi

ELAPSED=0
POLL_INTERVAL=0.5

echo "Waiting for command completion in ${SESSION}:${WINDOW} (max ${MAX_WAIT}s)..."

while [ $ELAPSED -lt $MAX_WAIT ]; do
    # Capture current pane content
    PANE_CONTENT=$(tmux capture-pane -t "${SESSION}:${WINDOW}" -p)
    
    # Check if we see a shell prompt (basic heuristic - look for $ or >)
    # This is a simple check; adjust based on your shell prompt format
    if echo "$PANE_CONTENT" | tail -1 | grep -qE '[$#>]\s*$'; then
        echo "✓ Command completed (prompt detected)"
        echo ""
        echo "=== Output from ${SESSION}:${WINDOW} ==="
        echo "$PANE_CONTENT"
        echo "=== End of output ==="
        exit 0
    fi
    
    sleep "$POLL_INTERVAL"
    ELAPSED=$(echo "$ELAPSED + $POLL_INTERVAL" | bc)
done

echo "⚠ Timeout reached after ${MAX_WAIT}s. Showing current output:"
echo ""
echo "=== Output from ${SESSION}:${WINDOW} ==="
tmux capture-pane -t "${SESSION}:${WINDOW}" -p
echo "=== End of output ==="
exit 1
