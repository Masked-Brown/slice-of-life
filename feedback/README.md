# feedback/ — the iteration brain

Playtest signal lands here. Two kinds of file, both dated and tagged:

## 1. Telemetry exports

In-game: **Ctrl+Shift+D** opens the dev panel → **EXPORT JSON**
downloads a `slice-of-life-telemetry-*.json` file (local ring buffer,
no PII, no network — the player hands it over themselves).

File it as:

```
feedback/telemetry/YYYY-MM-DD-<who>-<tag>.json
```

e.g. `feedback/telemetry/2026-07-10-rosa-day12-waste-heavy.json`

Tags are free-form but prefer: `fresh` (new player), `migrated`
(V2 save), `dayN` (how deep), plus whatever the session was about
(`waste-heavy`, `no-purchases`, `bounced-early`).

## 2. Written playtest notes

```
feedback/notes/YYYY-MM-DD-<who>.md
```

Structure loosely as: what they played (fresh/migrated, days, level
reached) → what delighted → what confused → what they said unprompted
→ tuner's hunches. Quote the player verbatim where possible.

## How it gets used

Before any balance pass, sweep this directory: telemetry answers
*what happened* (purchase order, waste %, stockouts, where sessions
end); notes answer *how it felt*. A tuning change should cite at
least one file from here in its commit message when it can.
