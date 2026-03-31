#!/bin/bash

# List all TMUX sessions with their windows and current content
# Shows which window is current, what's running in each window, and safety info

echo "=== TMUX Sessions and Windows ===" 
echo ""

if ! tmux list-sessions &>/dev/null; then
    echo "No TMUX sessions currently running."
    exit 0
fi

# Get current session and window
CURRENT_SESSION=$(tmux display-message -p '#{session_name}' 2>/dev/null)
CURRENT_WINDOW=$(tmux display-message -p '#{window_name}' 2>/dev/null)

# List each session with its windows
tmux list-sessions -F "#{session_name}" | while read session_name; do
    # Mark current session
    if [ "$session_name" = "$CURRENT_SESSION" ]; then
        echo "📁 $session_name ← CURRENT SESSION"
    else
        echo "📁 $session_name"
    fi
    
    # List windows in this session with their content
    tmux list-windows -t "$session_name" -F "#{window_name}:#{pane_id}" | while read window_info; do
        window_name="${window_info%:*}"
        pane_id="${window_info#*:}"
        
        # Get last line of pane content
        last_line=$(tmux capture-pane -t "$session_name:$window_name" -p | tail -1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | cut -c1-60)
        
        # Mark current window
        if [ "$session_name" = "$CURRENT_SESSION" ] && [ "$window_name" = "$CURRENT_WINDOW" ]; then
            echo "  → $window_name (current window)"
        else
            echo "  - $window_name"
        fi
        
        # Show last line of content
        if [ -n "$last_line" ]; then
            echo "    └─ $last_line"
        fi
    done
    
    echo ""
done

echo "=== How to use this ===" 
echo "SAFE to target: Windows showing shell prompt ($, >, #) or service messages"
echo "UNSAFE to target: Windows running Amp, agents, editors, or showing ongoing output"
echo ""
echo "Send command to window: bash send_and_capture.sh <window-name> \"<command>\""
echo "Example: bash send_and_capture.sh Serve \"npm start\""
echo ""
echo "To target a different session: bash send_and_capture.sh -s <session> <window> \"<command>\""
