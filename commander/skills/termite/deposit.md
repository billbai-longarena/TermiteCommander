---
name: termite-deposit
description: How to deposit observations and pheromones correctly
---

# Depositing Observations

When you notice a recurring pattern, architectural insight, or potential issue:

```bash
./scripts/field-deposit.sh \
  --pattern "concise-pattern-name" \
  --context "src/path/to/relevant/code" \
  --confidence high \
  --detail "Detailed explanation of what you found, why it matters, and what action should be taken. Must be >20 characters and substantive."
```

## Quality Checklist

Before depositing, verify:
- [ ] Pattern name is specific (not "code pattern" or "observation")
- [ ] Context points to a real file or module
- [ ] Detail explains the WHY, not just the WHAT
- [ ] Detail is >20 characters with actionable content

## What NOT to deposit
- Signal IDs as patterns
- "I completed my task" (that's a pheromone, not an observation)
- Duplicate of an existing observation (check `.birth` for existing rules)
