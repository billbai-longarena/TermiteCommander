---
name: termite-arrive
description: Colony arrival procedure — run field-arrive.sh and read .birth
---

# Arrival Procedure

Run this sequence on every new session:

1. `./scripts/field-arrive.sh`
2. Read `.birth` — this is your ONLY required reading. It contains everything you need:
   - Your caste and permissions
   - The top priority signal to work on
   - Behavioral template (example of a good observation)
   - Recovery hints for common situations
3. If `PLAN.md` exists, skim the Signal Map section for overall context
4. If `ALARM.md` exists, read it immediately — you are a soldier
