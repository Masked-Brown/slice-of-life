# Slice of Life — V2 Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is executed in-session by its author; tasks share files and must run in order.

**Goal:** V2 of the pizza-shop game: hold-to-pour sauce/cheese, eased difficulty, richer backdrop, per-topping stock + restock screen, analytics tab, supply-cost upgrades, milestones & daily goals, day-start board with specials, and named regulars.

**Architecture:** Vanilla ES modules, no build step (unchanged). All new tunables go in `balance.js`. Persistent additions live in `state` (save version 2 with v1 migration). Two new pure modules: `src/goals.js` (milestone/daily-goal logic) and `src/analytics.js` (HTML builder used by both shop and day-end). Verification via two committed node tools: `tools/logic-test.mjs` (pure-logic assertions), `tools/economy-sim.mjs` (10-day simulation), plus `tools/smoke-test.mjs` (Playwright, plays a full order).

**Tech Stack:** HTML/CSS/JS ES modules, Canvas 2D, Web Audio, Playwright (from npx cache) for smoke test, Node 20 for sim/tests.

---

## Data shapes (referenced by every task)

```js
// state (version: 2) — additions over v1
{
  version: 2,
  stock: { pepperoni: 24, mushroom: 24 },        // per OWNED topping, persisted
  carriedRestockSpend: 0,                         // £ spent on restock for the upcoming day
  milestonesDone: {},                             // { milestoneId: true }
  nextDay: { day: 1, specials: ['mushroom'], goal: { id, desc, reward, target } },
  lastDay: null | {                               // written at dayEnd, read by analytics
    day, served, lost, sales, tips, bonus,        // bonus = goal + milestone cash that day
    restockSpend, satAvg, rating,
    used: { topping: count },                     // pieces consumed
    toppingRevenue: { topping: £ },               // attributed topping revenue
    goalHit: bool, goalDesc, goalReward,
  },
  stats: { lifetimeServed, lifetimeEarned,        // existing
           lifetimePerfects: 0, perfectStreak: 0, bestPerfectStreak: 0,
           bestDayProfit: 0 },
  upgrades: { ...v1, supply: 0 },
}

// ticket additions
{ ...v1, special: bool }                          // includes a special topping → price premium
// customer additions
{ ...v1, regular: null | { key, name } }          // fixed look + fixed favourite ticket

// service-scene per-day tracking (transient, on svc)
svc.usage = {}; svc.toppingRevenue = {};
svc.goal = { ...state.nextDay.goal, prog: 0, hit: false, failed: false };
svc.bonusEarned = 0;                              // goal + milestone cash this day
svc.largeSold = 0; svc.underPar = 0; svc.usedTypes = new Set();
svc.dayStarted = false;                           // day-start board gate
svc.lowWarned = {};                               // topping → true once warned this day
```

---

### Task 1: balance.js — V2 numbers + new config blocks

**Files:** Modify `src/balance.js`

- [ ] **Step 1: Difficulty easing (edit in place)**
  - `BASE_PRICE: { S: 6, M: 9, L: 14 }`, `PRICE_PER_TOPPING_TYPE: 2.0`, `SAT_MULT_MAX: 1.15`, `TIP_MAX_FRAC: 0.35`
  - `BANDS: { light: [22, 46], normal: [50, 76], heavy: [80, 112] }`, `BAND_FALLOFF: 30`, `PERFECT_MARGIN: 0.15`
  - `TOPPING_COUNT_PENALTY: 0.22`, `TOPPING_SPREAD_WEIGHT: 0.18`, `EXTRA_TYPE_PENALTY: 6`, `BAKE_ADJACENT_CREDIT: 0.5`
  - `SPEED_FLOOR: 0.7`, `PAR_BASE: 24`
  - `PATIENCE: FRONT_SECONDS: 90, QUEUE_SECONDS: 140`
  - `OVEN.ZONES: { raw: 0.30, light: 0.50, normal: 0.70, well: 0.88 }`, `ZONE_WIDEN: 0.025`
  - Upgrade costs +~15% (sim-tunable): oven [60,130,280], ladle [45,100,220], shaker [45,100,220], tongs [60,135,290], decor [70,150,320].
- [ ] **Step 2: Pour mechanic block**
  ```js
  POUR: {
    SAUCE_RATE: [0.34, 0.40, 0.46, 0.52],   // coverage fraction/sec by ladle tier
    CHEESE_RATE: [44, 52, 60, 70],          // flecks/sec by shaker tier (replaces PIZZA.CHEESE_RATE use)
    IN_BAND_SLOW: [0.8, 0.75, 0.62, 0.5],   // rate multiplier while inside the ticket band, by tier
    OVERPOUR_SPLAT_CD: 0.5,                 // s between counter splats when pouring past full
  },
  ```
  Ladle/shaker tier descriptions reworded (pour speed + control). Drop `PIZZA.SAUCE_BRUSH` use; keep `CHEESE_SPREAD` unused-removal.
- [ ] **Step 3: STOCK / SUPPLY / SPECIALS / REGULARS / MILESTONES / DAILY_GOALS blocks** — per-topping `unit` cost added to each TOPPINGS entry (0.10–0.22); `STOCK: { START: 24, NEW_TOPPING_INCLUDED: 15, LOW_AT: 6, BUY_AMOUNTS: [5, 20] }`; `UPGRADES.supply` 4 tiers, costs [45,100,220,480], `SUPPLY_DISCOUNTS: [0, .10, .20, .35, .50]`; `SPECIALS: { WEIGHT: 2.6, PRICE_PREMIUM: 0.12, TWO_FROM_DAY: 5 }`; `REGULARS` (5 named, fixed colors + favourite order + required toppings/size); `MILESTONES` (list per spec §9 with rewards + optional ratingBump); `DAILY_GOALS` (6 defs with reward, target, availability predicate keys).
- [ ] **Step 4: Verify** `node --input-type=module -e "import('./src/balance.js').then(m=>console.log(Object.keys(m.BAL)))"` from project root — no syntax errors, new keys present.
- [ ] **Step 5: Commit** `feat(balance): V2 tunables — easing, pour, stock, specials, regulars, goals`

### Task 2: state.js — save v2 + migration + helpers

**Files:** Modify `src/state.js`

- [ ] **Step 1:** `newGame()` returns version 2 with all new fields (stock seeded `STOCK.START` for starting toppings, `upgrades.supply: 0`, `nextDay: null` — filled by `ensureNextDay` on first use).
- [ ] **Step 2:** `loadGame()` accepts version 1 or 2; v1 saves are merged over `newGame()` (deep-merging `upgrades`, `stats`) and stamped version 2; any owned topping missing from `stock` gets `STOCK.START`.
- [ ] **Step 3:** Helpers:
  ```js
  export function unitCost(state, topping) {
    const disc = BAL.SUPPLY_DISCOUNTS[state.upgrades.supply] || 0;
    return BAL.TOPPINGS[topping].unit * (1 - disc);
  }
  ```
- [ ] **Step 4: Verify** in logic-test (Task 9) — migration of a fake v1 save keeps day/money and gains stock.
- [ ] **Step 5: Commit** `feat(state): save v2, migration, stock helpers`

### Task 3: Hold-to-pour sauce & cheese + band gauge (build.js)

**Files:** Modify `src/stations/build.js`, `src/scenes/service.js` (tutorial text), `src/audio.js` (pour swell, band tick)

- [ ] **Step 1: Replace drag-paint with hold-to-pour.** Remove `_paintTo`/`_lastPaint` path logic. New model on svc: `_pouring` (bool), pour target radius derived from coverage. Update loop while held:
  ```js
  // sauce: grow coverage at POUR.SAUCE_RATE[tier], slowed inside the ticket band
  const rate = P.SAUCE_RATE[tier] * (this._inTicketBand(svc, pz.sauceCoverage) ? P.IN_BAND_SLOW[tier] : 1);
  svc._pourCov = clamp(svc._pourCov + rate * 100 * dt, 0, 100);
  // stamp a ring of dabs at the growing rim so the wet-sauce canvas + coverage math stay identical
  const rim = pz.R * BAL.PIZZA.SAUCE_RIM;
  const targetR = rim * Math.sqrt(svc._pourCov / 100);
  for (let i = 0; i < 10; i++) {
    const a = rand(0, Math.PI * 2), r = targetR * Math.sqrt(rand(0.0, 1)) * 0.35 + targetR * 0.68;
    this._dabAt(pz, Math.cos(a) * r * rand(0.9, 1.02), Math.sin(a) * r * rand(0.9, 1.02), rim * 0.22);
  }
  // plus a few centre dabs early so the middle fills first
  ```
  `_dabAt(pz, lx, ly, brush)` = old `_dab` minus splat logic, clipped to rim. Recompute coverage on a 0.1s timer (existing `_covTimer`); held past ~99% → occasional counter splats (`OVERPOUR_SPLAT_CD`) + `splatCount++`.
  Press anywhere within `pz.R * 1.35` of pizza centre starts pour; release stops. Ladle art follows cursor unchanged; add a pour stream (2–3 falling sauce dots from ladle toward pizza centre) while pouring.
- [ ] **Step 2: Cheese hold-to-pour.** While held: flecks spawn at `POUR.CHEESE_RATE[tier]` (same in-band slowdown using cheesePct), positioned radially: `r = pz.R*0.85 * sqrt(rand()) * (0.35 + 0.65*fillFrac)` so cover grows from centre. Shaker art hovers over pizza centre-ish (keep cursor-follow). Flecks landing animation + `cheeseTick` unchanged.
- [ ] **Step 3: Band gauge** (all tiers, sauce + cheese stages): vertical meter right of the pizza (x ≈ pz.x + R + 34): 0–115% scale, three band segments coloured, ticket band outlined pulsing gold (like oven meter), needle at current %, green glow + one-shot `Sfx.bandTick()` when entering the ticket band. Remove ladle-t3-only coverage ring (gauge supersedes it).
- [ ] **Step 4: audio** — `Sfx.bandTick()` (soft single sine ~990Hz, vol .06); `Sfx.saucePourLevel(k)` optional gain swell on the existing sauce loop nodes (skip if fiddly — loop alone is acceptable).
- [ ] **Step 5: Tutorial text** in service.js TUTORIAL: sauce/cheese reworded to "Press & hold over the pizza to pour… release inside the gold band, then NEXT."
- [ ] **Step 6: Verify** via smoke test (Task 10) — hold over pizza raises coverage monotonically; release freezes it; grade pops still fire.
- [ ] **Step 7: Commit** `feat(build): hold-to-pour sauce & cheese with band gauge`

### Task 4: Stock system live in service (build.js, serve.js, service.js)

**Files:** Modify `src/stations/build.js`, `src/stations/serve.js`, `src/scenes/service.js`

- [ ] **Step 1: Bin stock flow.** Grab from bin: `if ((state.stock[type]|0) <= 0) → shake bin, floatText "Out of ${label}!", Sfx.popOff(), return`. Else `state.stock[type]--` (double-grab `-= 2` if available ≥2, else 1). Drop off-pizza (incl. failed double-grab second piece): `state.stock[type]++` (piece returns to bin; flourPuff feedback). Pick-up from pizza: no stock change. `_abortOrder`: refund `svc.held`.
- [ ] **Step 2: Bin visuals.** Stock chip drawn at bin bottom (`×14`); chip amber + pulsing amber bin outline when `stock <= LOW_AT`; red chip "OUT", faded heap, pulsing red outline at 0. Visible at all stages (bins already render always). First time a topping crosses LOW_AT in a day: `Juice.floatText` over the bin "Low on ${label}!" + `Sfx.warn()` (new soft low blip), `svc.lowWarned[type] = true`.
- [ ] **Step 3: Usage tracking.** On serve and on abort-with-pizza: tally `pz.toppings` by type into `svc.usage`. (Off-pizza returns already refunded, never counted.)
- [ ] **Step 4: Revenue attribution** in `Serve._payout`: for each ticket topping type: `svc.toppingRevenue[type] += E.PRICE_PER_TOPPING_TYPE * priceMultiplier(state) * lerp(SAT_MULT_MIN, SAT_MULT_MAX, sat/100)`.
- [ ] **Step 5: Verify** in smoke test: stock decrements when dragging a topping; logic-test covers refund math.
- [ ] **Step 6: Commit** `feat(stock): per-topping stock, bin counters, low/out warnings, usage tracking`

### Task 5: Specials + regulars (order.js, serve.js)

**Files:** Modify `src/stations/order.js`, `src/stations/serve.js`, `styles.css` (ticket regular row)

- [ ] **Step 1: Specials-weighted ticket gen.** `makeTicket(state, specials)`: build weighted pool — owned toppings, weight `SPECIALS.WEIGHT` if special else 1; sample without replacement by weight. Set `ticket.special = chosen.some(t => specials.includes(t))`. `generateDay` reads `state.nextDay.specials`.
- [ ] **Step 2: Special premium** in `Score.scoreOrder`: `if (ticket.special) price *= 1 + BAL.SPECIALS.PRICE_PREMIUM`. Ticket DOM: gold "★ special" chip row when set.
- [ ] **Step 3: Regulars.** Eligibility: all favourite toppings owned && (size !== 'L' || sizeL). In `generateDay`, per customer slot with prob `clamp(R.CHANCE + (rating-3)*R.RATING_CHANCE_BONUS, 0, R.MAX_CHANCE)`, replace with a not-yet-used eligible regular: fixed colors, `regular: {key, name}`, ticket = deep copy of favourite.
- [ ] **Step 4: Regular presentation.** Name tag (paper chip, name text) drawn above patience arc in `_drawCustomer`; pinned ticket shows `for ${name} ⭐`.
- [ ] **Step 5: Regular scoring** in `_payout`: `pushRating` twice (counts double both ways); if `sat >= REGULARS.SAT_THRESHOLD`: `tip += price * REGULARS.TIP_BONUS_FRAC`, floatText "${name} loves it!", extra sparkle; if sat < 50: floatText "${name} is let down…".
- [ ] **Step 6: Verify** logic-test: special topping appears ~2–2.6× baseline over 3000 tickets; regulars only appear when eligible.
- [ ] **Step 7: Commit** `feat(orders): daily specials shift demand; named regulars with signature orders`

### Task 6: goals.js + service hooks + HUD pill

**Files:** Create `src/goals.js`; Modify `src/scenes/service.js`, `src/stations/serve.js`, `index.html` (hud pill), `src/main.js` (dom ref), `src/audio.js` (goalDing, fanfare), `styles.css`

- [ ] **Step 1: goals.js API:**
  ```js
  export function ensureNextDay(state)        // fills state.nextDay for state.day if missing/stale: 1–2 specials (2 from day SPECIALS.TWO_FROM_DAY), feasible daily goal (rotates, seeded by day)
  export function metrics(state)              // { served, earned, rating(.len>=8), perfects, bestStreak, upgradesOwned, toppingsOwned, bestDayProfit }
  export function checkMilestones(state)      // newly-completed defs; marks milestonesDone, applies ratingBump via pushRating(state,5)
  export function goalProgress(goal, svc)     // {prog, target, done, failed} pure read of svc counters
  ```
- [ ] **Step 2: Service integration.** On each serve (after `_payout` returns res → callback into scene): update `perfectStreak`/`lifetimePerfects`/`usedTypes`/`largeSold`/`underPar`; evaluate daily goal — first time done: `svc.goal.hit = true`, `state.money += reward`, `svc.bonusEarned += reward`, stamp "GOAL COMPLETE! +£r", coinBurst, `Sfx.goalDing()`. Storm-out fails `noStorms` (pill shows ✗). Then `checkMilestones(state)` — each new one: `state.money += reward`, `svc.bonusEarned += reward`, stamp "MILESTONE! label +£r", coinBurst to HUD, `Sfx.fanfare()` (stagger if multiple).
- [ ] **Step 3: HUD goal pill** `#hud-goal`: `🎯 short-desc · n/N` (or ✓/✗); flash green on completion.
- [ ] **Step 4: Verify** logic-test: milestone triggers exactly once; daily goal rotation feasible (sellL never offered without sizeL).
- [ ] **Step 5: Commit** `feat(goals): lifetime milestones + rotating daily goal with payout moments`

### Task 7: Day flow — day-start board, dayEnd recording, restock/analytics/goals tabs

**Files:** Modify `src/scenes/service.js`, `src/scenes/dayEnd.js`, `src/scenes/shop.js`, `index.html` (`#ui-dayboard`), `src/main.js`, `styles.css`; Create `src/analytics.js`

- [ ] **Step 1: Day-start board.** `service.enter` no longer generates the day or consumes boosts; it shows `#ui-dayboard`: Day N title; specials row(s) (dot + "in demand today · +12% on orders"); daily goal card (desc + £reward); stock readiness (rows only for toppings ≤ LOW_AT, red if 0; else "Stock looks good ✓"); buttons BACK TO SHOP (day>1) and START DAY ➜. START DAY: consume boosts, `Orders.generateDay`, stamp "DAY N — OPEN!", `svc.dayStarted = true`. Update loop skips arrivals + day-end check until started.
- [ ] **Step 2: dayEnd records + generates.** On enter (before day++): build `state.lastDay` from svc-passed stats (incl. `used`, `toppingRevenue`, `restockSpend: state.carriedRestockSpend`, `bonus: svc.bonusEarned`, goal info); reset `carriedRestockSpend`; update `stats.bestDayProfit`; **then** day++, `ensureNextDay(state)`, dayEnd-time `checkMilestones` (bestDayProfit / upgrades cant fire here but earnings can) awarding onto receipt. Receipt gains lines: "Daily goal ✓ +£r" (or ✗ —), "Milestone bonus +£x" when nonzero, "Restock spend −£x" when nonzero. Add "📊 ANALYTICS" button that swaps receipt → analytics panel (same HTML as shop tab) with a back button.
- [ ] **Step 3: analytics.js** — `analyticsHTML(state)` returns panel markup: session summary grid (revenue, tips, bonuses, restock spend, **gross profit**, avg satisfaction, rating stars) + per-topping table sorted by margin: usage bar, used ×n, revenue £, supply cost £ (used × unitCost), margin £ green/red. Empty state: "Serve a day to see analytics."
- [ ] **Step 4: Shop tabs.** Tabs become Equipment / Menu / Restock / Analytics / Goals (Boosts cards move to bottom of Restock tab under "Tomorrow's boosts"). Shop head gains specials banner: "📌 Tomorrow: ${labels} on special — stock up!". Restock tab rows per owned topping: dot+label, stock ×n (amber/red when low/out), "used yesterday ×n" (from lastDay.used), unit cost after discount (struck-through base when discounted), +5/+20 buy buttons (disabled when can't afford); purchase: money−, stock+, `carriedRestockSpend +=`, tick SFX, row count pops. Goals tab: milestone cards with progress bars (metric/target), reward chip, done = gold ✓; daily goal preview card on top. Topping unlock purchase also seeds `stock[key] = NEW_TOPPING_INCLUDED`; shop-time `checkMilestones` (upgradesOwned/toppingsOwned) with DOM toast + chaChing.
- [ ] **Step 5: Verify** by smoke test (board shows, START DAY begins arrivals) + manual DOM checks in test.
- [ ] **Step 6: Commit** `feat(flow): day-start board, restock & analytics & goals tabs, day-end recording`

### Task 8: Background polish + station prompts (§3, §4)

**Files:** Modify `src/scenes/service.js`

- [ ] **Step 1: Backdrop.** Richer `_renderBackground`: warm two-tone wall with subtle vertical gradient; wooden shelf (right of door, above queue) with jars/oil bottles/flour sacks; framed window with sky + rooftops left-of-centre; hanging "MENU" board; string lights at decor tier ≥2 (tiny warm bulbs). All flat shapes + OUTLINE, drawn once per frame (cheap). Don't touch counter/station art.
- [ ] **Step 2: Station prompt line.** Persistent short hint under the stage rail for the current stage (all days, alpha ~0.75): dough "Click the dough size from the ticket", sauce/cheese "Hold over the pizza — release in the gold band", toppings "Drag pieces to match the ×counts", tooven "Slide the pizza into the oven", baking "Pull it in the ticket's zone!", serve "Ring the bell!".
- [ ] **Step 3: Commit** `feat(scene): pizzeria backdrop polish + persistent station prompts`

### Task 9: tools/logic-test.mjs + tools/economy-sim.mjs — run and tune

**Files:** Create `tools/logic-test.mjs`, `tools/economy-sim.mjs`; tune `src/balance.js`

- [ ] **Step 1: logic-test.mjs** (node-importable modules only: balance, state, goals, serve(Score), order(Orders)): asserts —
  v1→v2 migration; unitCost discounts; specials frequency ratio over 3000 tickets ≈ WEIGHT within tolerance; ticket.special premium applied in scoreOrder; milestone fires once; daily-goal feasibility; band math (amountFrac/amountGrade) on new bands; regular eligibility gating.
- [ ] **Step 2: economy-sim.mjs**: 10-day sim using real `Orders.makeTicket`, `Score.scoreOrder`, real state helpers. Player model ("reasonable effort"): sauce/cheese sampled N(band centre, band width·0.35); topping counts exact 85% / ±1 else; sunflower spread; bake perfect 72% / adjacent 24% / burnt 4%; elapsed ~ par·U(0.75,1.25); storms when queue overload modelled via served-rate vs arrival-rate (simplified: lose a customer when day's demand > 1.25× serve capacity). Restock policy: buy up to `ceil(lastUsed×1.3)+ (special? +10)` each topping. Greedy upgrade buyer (priority: oven→ladle→tongs→supply→decor→toppings→sizeL→shaker). Prints per-day table: customers, revenue, tips, bonuses, restock spend, net, money end, purchases; summary: upgrades/day pace, bonus share of income, stockout incidents.
- [ ] **Step 3: Run + tune** balance until: ~1 purchase/day (0.9–1.3), bonus share of total income ≤ ~20%, day-1 ends able to afford one tier-1, no death spiral with naive restocker.
- [ ] **Step 4: Commit** `test(tools): logic tests + 10-day economy sim; balance tuning`

### Task 10: tools/smoke-test.mjs (Playwright) — full-order playthrough

**Files:** Create `tools/smoke-test.mjs`

- [ ] **Step 1:** Script: start `python3 -m http.server` on a free port; launch chromium (resolve playwright from `~/.npm/_npx/*/node_modules/playwright`); console-error capture; NEW GAME → day board visible → START DAY → wait front customer → read `__game._svc.ticket` → click matching dough → hold mouse over pizza until sauceCoverage inside ticket band → release → NEXT → same for cheese (fleck %) → drag topping pieces bin→pizza to exact counts (assert stock decremented) → NEXT → click oven → poll bake progress, click to pull inside ticket zone → click bell → assert served=1, money>0, usage recorded, no console errors. Also assert: set a topping's stock to 1 via `__game.state`, grab twice → second grab blocked.
- [ ] **Step 2: Run; fix whatever it finds.**
- [ ] **Step 3: Commit** `test(tools): playwright smoke test — full order end-to-end`

### Task 11: README + final verification + report

- [ ] **Step 1:** README: new how-to-play rows (hold-to-pour, stock/restock, goals, specials, regulars), updated structure/balance notes, how to run tools.
- [ ] **Step 2:** Re-run logic-test, economy-sim, smoke-test — all green.
- [ ] **Step 3: Commit** `docs: V2 README` and report: what changed; new economy table; bonus share %; run-out warning visibility; specials demand-shift evidence.

## Self-review notes

- Spec coverage: §1 Task 3 · §2 Tasks 1+9 · §3 Task 8 · §4 Tasks 3 (gauge) + 8 (prompts) + 4 (warnings) · §5 Task 4 · §6 Task 7 · §7 Task 7 · §8 Tasks 1+2+7 · §9 Task 6 · §10 Task 7 · §11 Task 5. Out-of-scope list respected — no spoilage, staff, new foods.
- Boost consumption moved from `service.enter` to START DAY so BACK TO SHOP can't eat a booked boost.
- `nextDay` generated at dayEnd (so shop can show specials banner during restock); `ensureNextDay` fallback covers new games & migrated saves.
- Type consistency: `state.stock` (object keyed by topping), `unitCost(state, t)`, `svc.usage`, `svc.toppingRevenue`, `svc.bonusEarned`, `state.carriedRestockSpend`, `state.lastDay`, `state.nextDay`, `ticket.special`, `c.regular` — single names used throughout tasks.
