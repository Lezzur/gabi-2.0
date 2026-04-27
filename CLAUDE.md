# GAIA (gabi-2.0) — Session Instructions

## Manual Task Implementation Protocol

**CRITICAL — read before touching any barker task manually.**

When implementing a barker task by hand (because it keeps crashing, is rate-limited, or needs a fix):

1. **Stop barker first.** `Ctrl+C` the running `barker resume` process. Do NOT update `state.json` while barker is running — it has the old state loaded in memory and will ignore disk changes, wasting Opus usage on re-runs.
2. Implement the files in the main repo.
3. Commit using the barker format: `git commit -m "barker: {task-id} — {task-name}"`
4. Mark the task complete in `.barker/state.json`: set `status` to `"completed"` and `retries` to `0`.
5. Then restart: `barker resume --dir F:\claude-code\claude_projects\gabi-2.0`

Barker reads `state.json` only at startup. Any state changes made while barker is running are invisible to it.

---

## Project

**GAIA** — Philippine agrochemical traceability platform.
**Stack:** Turborepo + pnpm · Next.js 14 (website + CRM) · Expo SDK 51+ (mobile) · Supabase (Postgres 15 + Auth + RLS)
**Plan:** `barker-plan.md` — 60 tasks across phases 1–8
**State:** `.barker/state.json`

## Resuming Barker

```
barker resume --dir F:\claude-code\claude_projects\gabi-2.0
```

Check progress:

```
cat .barker/state.json | python -c "import json,sys; d=json.load(sys.stdin); t=d['tasks']; done=sum(1 for x in t.values() if x['status']=='completed'); print(f'{done}/{len(t)} done')"
```
