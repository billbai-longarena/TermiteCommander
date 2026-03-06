---
name: termite-molt
description: Session-end handoff — write WIP and deposit pheromone
---

# Molt Procedure (Session End)

When you sense your session is ending (context getting long, task complete, or explicitly asked to stop):

## Step 1: Write WIP.md

```markdown
# WIP — Work In Progress

## What I Did
- [List completed work items]

## What Remains
- [List unfinished items with specific next steps]

## Key Decisions Made
- [Any architectural or design choices]

## Gotchas
- [Anything the next termite should know]
```

## Step 2: Deposit Pheromone

```bash
./scripts/field-deposit.sh \
  --pheromone \
  --caste <your-caste-from-.birth> \
  --completed "Brief summary of completed work" \
  --unresolved "Brief summary of remaining work"
```

## Step 3: Release Claims

If the signal is complete, mark it done:
```bash
./scripts/field-claim.sh complete <signal-id> work
```

If you have an active signal claim that isn't complete:
```bash
./scripts/field-claim.sh release <signal-id> work
```

The signal will return to 'open' status for the next termite to claim.
