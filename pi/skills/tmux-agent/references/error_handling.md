# Error Handling Patterns

## Verification Workflow

After sending any command, follow this pattern:

1. **Capture output** - Use `send_and_capture.sh` or `wait_for_completion.sh`
2. **Check for errors** - Look for common error indicators
3. **Verify success** - Look for expected success indicators
4. **Report or retry** - Act based on findings

## Common Error Scenarios

### Server/Service Won't Start

**Symptoms**: Port already in use, permission denied, or module not found

**Recovery**:
```bash
# Kill the process using the port (example: port 3000)
bash send_and_capture.sh myproject Dev "lsof -ti:3000 | xargs kill -9" 2

# Then retry starting the service
bash send_and_capture.sh myproject Serve "npm start" 5
```

### Build/Test Failures

**Symptoms**: Tests failing, build errors, dependencies missing

**Recovery**:
```bash
# Check if dependencies are installed
bash send_and_capture.sh myproject Dev "npm ls" 3

# If needed, reinstall
bash send_and_capture.sh myproject Dev "npm install" 30

# Retry tests
bash send_and_capture.sh myproject Dev "npm test" 30
```

### Timeout Issues

**Problem**: Command takes longer than expected, output is incomplete

**Solution**: Use `wait_for_completion.sh` for longer commands

```bash
# Instead of assuming 5 seconds, wait until prompt appears
bash scripts/wait_for_completion.sh myproject Dev 30
```

### Window Doesn't Exist

**Symptoms**: "Window not found" error

**Recovery**:
```bash
# List available windows
bash scripts/list_tmux_state.sh

# Ask user to clarify which window to use
```

## Handling Interactive Commands

Some commands require input or interaction:

**Problem**: Command is waiting for input and won't complete

**Examples**:
- `npm init` - asks questions
- `git commit` - opens editor
- Database prompts asking for password

**Solutions**:

1. **Avoid interactive commands** - Use flags to skip prompts
   ```bash
   # Good: npm init with defaults
   tmux send-keys -t session:window "npm init -y" Enter
   
   # Bad: npm init without flags (requires interaction)
   tmux send-keys -t session:window "npm init" Enter
   ```

2. **Provide input upfront** - Send answer before expecting it
   ```bash
   # If command asks a question, send the answer on same line
   tmux send-keys -t session:window "git config user.name 'Agent'" Enter
   ```

3. **Use environment variables** - Set context before command
   ```bash
   tmux send-keys -t session:window "export PASSWORD=secret && command" Enter
   ```

## Parsing Output for Confidence

### High Confidence Success
- Explicit success message appears
- Expected file/output created
- Prompt returns to shell
- Exit code 0 (if shown)

**Example**:
```
$ npm start
> project@1.0.0 start /home/user/project
> node server.js

Server listening on http://localhost:3000
$
```

### Medium Confidence Success
- No error messages visible
- Output seems reasonable
- Timeout expired but last line looks normal

**Action**: Verify independently (e.g., curl the server, check file exists)

### Low Confidence (Uncertain)
- Output is truncated
- Mixed success/error messages
- Timeout occurred without clear completion

**Action**: Ask user to check manually or increase timeout and retry

## Detecting Server Ready

For servers and services, common readiness patterns:

```bash
# Look for these patterns in output
"listening on"
"running on"
"started successfully"
"Server ready"
"ready on port"
":3000" or ":5000" (port numbers)
```

If you see these, server is likely running.

## Cleanup on Failure

If a command fails, consider cleanup:

```bash
# Kill a problematic process
bash send_and_capture.sh myproject Dev "pkill node" 2

# Clear terminal and retry
bash send_and_capture.sh myproject Dev "clear && npm start" 5
```

## When to Ask the User

Ask for help when:
- Window name is unclear
- Recovery strategy is ambiguous
- Output is confusing or contradictory
- Multiple courses of action exist
- Safety concern (e.g., destructive command)

Example message:
```
I encountered an issue: "Port 3000 already in use"
Current options:
1. Kill the process and retry
2. Start on a different port (e.g., 3001)
3. Check if another process is using the port

Which would you prefer?
```
