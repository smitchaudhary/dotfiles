---
name: jj-hunks
description: Non-interactive selective hunk splitting for jj. This skill should be used when an agent needs to split working copy changes into separate jj commits by hunk, without interactive prompts.
---

# jj-hunks

A tool for non-interactive selective hunk splitting in jj. Used to programmatically split a working change's hunks into separate commits, similar to a non-interactive `jj split -i`.

## Installation

If not already installed, clone and install from the repository:

```sh
git clone git@github.com:smitchaudhary/jj-hunks.git
cd jj-hunks
make install
```

This installs `jj-hunks` to `/usr/local/bin/`. To install to a different prefix:

```sh
make PREFIX=~/.local install
```

## When to use

- A user has multiple unrelated changes in a single jj working change and wants them split into logical commits
- An AI agent made multiple changes and needs to organize them into separate commits
- A script needs deterministic, programmable hunk-level change splitting

## Commands

### List hunks

```sh
jj-hunks list
```

Lists all hunks with stable IDs. Each hunk is shown with its ID, `@@` header, and diff body.

### Split selected hunks

```sh
jj-hunks split [options] <hunk-id> [<hunk-id> ...]
```

Extract selected hunks into a new child change. The parent keeps the remaining hunks.

Options:
- `-m <msg>` — Set the description for the new child change

## Workflow

1. Agent makes changes to the working copy
2. Run `jj-hunks list` to see the hunks with their IDs
3. For each logical group of hunks, run `jj-hunks split -m "<description>" '<hunk-id>'`
4. Each split creates a child change with the selected hunks
5. Continue until all hunks are organized into appropriate changes
