# Output Parsing Patterns

When you capture output from TMUX, parse it systematically to extract meaning and determine success/failure.

## Basic Parsing Strategy

```
1. Get last few lines (usually contain final status)
2. Check for error keywords
3. Check for success keywords
4. Extract relevant information
5. Make decision
```

## Common Output Patterns

### NPM Commands

**npm start**
```
> project@1.0.0 start
> node server.js
Server listening on http://localhost:3000
```
✓ Success: "listening" appears

**npm install**
```
added 142 packages, and audited 143 packages in 5s
found 0 vulnerabilities
```
✓ Success: "added" or "found 0 vulnerabilities"

**npm test**
```
PASS  src/calculator.test.js
  Calculator
    ✓ adds numbers correctly (5ms)
    ✓ subtracts numbers correctly (3ms)

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
```
✓ Success: "PASS" and "passed"

```
FAIL  src/calculator.test.js
  ✗ divides by zero
  
Tests:       1 failed, 2 passed
```
✗ Failure: "FAIL" and "failed"

### Git Commands

**git status**
```
On branch main
Your branch is up to date with 'origin/main'.
nothing to commit, working tree clean
```
✓ Success: "working tree clean"

**git push**
```
Enumerating objects: 3, done.
Counting objects: 100% (3/3), done.
To github.com:user/repo.git
   abc1234..def5678  main -> main
```
✓ Success: branch name after "To github.com"

### Build Tools (Webpack, Vite, etc.)

**Webpack**
```
asset main.js 45.2 KiB [compared for emit] (name: main)
webpack 5.75.0 compiled successfully in 1234 ms
```
✓ Success: "compiled successfully"

**Vite**
```
  vite v4.2.0 dev server running at:

  ➜  Local:   http://localhost:5173/
  ➜  press h to show help
```
✓ Success: Local URL appears

### Docker Commands

**docker build**
```
[+] Building 2.3s (8/8) FINISHED
 => [internal] load build context
...
 => exporting to oci image format
```
✓ Success: "FINISHED"

**docker run**
```
Unable to find image 'nginx:latest' locally
```
✗ Failure: "Unable to find"

### Database/Service Commands

**PostgreSQL connection**
```
psql (14.5)
Type "help" for help.

mydb=#
```
✓ Success: Prompt appears (mydb=#)

**Redis connection**
```
Connected to Redis server
```
✓ Success: "Connected"

## Extraction Examples

### Extract Port Number from Server Output

```bash
PORT=$(echo "$OUTPUT" | grep -oP '(?<=:)[0-9]{4,5}' | head -1)
if [ -n "$PORT" ]; then
    echo "Server is on port $PORT"
fi
```

### Extract Error Message

```bash
ERROR_LINE=$(echo "$OUTPUT" | grep -i "error\|failed\|fatal" | head -1)
if [ -n "$ERROR_LINE" ]; then
    echo "Error detected: $ERROR_LINE"
fi
```

### Extract Test Statistics

```bash
PASSED=$(echo "$OUTPUT" | grep -oP '\d+(?= passed)' | head -1)
FAILED=$(echo "$OUTPUT" | grep -oP '\d+(?= failed)' | head -1)

if [ "$FAILED" -gt 0 ]; then
    echo "Tests failed: $FAILED failures"
elif [ "$PASSED" -gt 0 ]; then
    echo "Tests passed: $PASSED passed"
fi
```

### Check if Build Succeeded

```bash
if echo "$OUTPUT" | grep -qi "success\|complete\|ready\|listening"; then
    echo "Build/startup successful"
elif echo "$OUTPUT" | grep -qi "error\|fail\|fatal"; then
    echo "Build/startup failed"
else
    echo "Status unclear, check output manually"
fi
```

## Context-Specific Patterns

### For Development Servers

Key things to check:
- "listening on" or "running on" - means server started
- Port number visible - confirms listening port
- "ready" messages - means startup complete
- Error messages about ports - usually EADDRINUSE

### For Tests

Key things to check:
- "PASS" vs "FAIL" at top of output
- Number of passed/failed tests
- Stack traces - indicate which tests failed
- "Test Suites" line - overall summary

### For Builds

Key things to check:
- "error" or "warning" counts
- "compiled", "built", "succeeded" keywords
- Asset sizes generated
- Time taken to completion
- Entry/output file mentions

### For Database/API Operations

Key things to check:
- Connection confirmation
- Query completion messages
- Row counts returned
- No error/exception messages
- Prompt return indicates ready

## Distinguishing Warnings from Errors

**Warnings** (usually safe to proceed):
- "warning: something deprecated"
- "advisory" messages
- "warning:" prefix
- Build still succeeds

**Errors** (should not proceed):
- "error:" prefix
- Stack traces
- "Error:" with context
- Exit code non-zero (if visible)
- Build/test explicitly failed

## Timeout vs Completion Detection

Sometimes output is cut off by timeout. Look for:

**Clear completion** (safe to trust):
- Prompt returns (`$`, `>`, `#`)
- Message explicitly says "done", "complete", "ready"
- No ongoing indicators (`...`, spinning, progress bars)

**Unclear/Incomplete** (timeout may have cut output):
- Output ends mid-line
- Progress indicators visible
- No final message
- Prompt doesn't appear

In unclear cases, use `wait_for_completion.sh` with longer timeout.

## Building a Decision Tree

Example for "npm start":

```
1. Does output contain "error"? 
   → YES: Error occurred, report and don't proceed
   → NO: Continue
   
2. Does output contain "listening" or a port number?
   → YES: Server likely started, success
   → NO: Continue
   
3. Does shell prompt appear?
   → YES: Server not still running, check output for clues
   → NO: Server probably still running, assume success
```

Use these patterns to build confidence in your interpretation of output.
