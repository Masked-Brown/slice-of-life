# Slice of Life — V3 "Foundations of an Empire" Design Notes

This file records every significant V3 design decision and the rationale.
It is the companion to `README.md` (player-facing) and `src/balance.js`
(the numbers themselves). V1/V2 history lives in git.

## The pillars, restated

Every V3 system must serve at least one of:
- **(a) tactile craft** — the hands-on feel of making the thing;
- **(b) business optimization** — forecasting, margins, purchase order;
- **(c) cozy compounding progress** — visible, gentle, weeks-long growth.

Soft-fail only. No energy gates, no FOMO, seasonal content cycles back.
Day 1 for a fresh player must feel like V2's Day 1 — the level spine drips
everything else in.

---

## 1. Save schema v3

```
{
  version: 3,
  phase, day, money,
  xp, level,                    // the new progression spine
  seenUnlocks: {},              // unlock ids already revealed (reveal cards fire once)
  recentRatings: [...],
  upgrades: { oven, ladle, shaker, tongs, decor, supply, proofer, oven2, rail },
  toppings: [...],  sizeL,
  sauces: ['tomato', ...],      // owned sauce variants
  crusts: ['classic', ...],     // owned crust types
  sides:  ['garlicbread', ...], // owned side stations
  grades: { cheese:'standard', sauce:'standard', pepperoni:'standard', mushroom:'standard' },
  boosts: { prep, ad },
  tutorialDone, muted,
  volumes: { music, sfx },
  stats:  { lifetimeServed, lifetimeEarned, lifetimePerfects, perfectStreak,
            bestPerfectStreak, bestDayProfit },
  lifetime: { earned, served, perfects, days, maxLevel },   // prestige scaffold
  meta: { currency: 0, mult: 1.0 },                          // prestige scaffold
  stock:     { key: totalCount },                 // gameplay-authoritative counts
  stockAges: { key: [{ age, n, grade }] },        // FIFO batches for spoilage
  loyalty:  { regularKey: { serves, tier } },     // original system #1
  mastery:  { recipeId: { perfects, stars } },    // original system #2
  eventPity: { sinceEvent, history },             // event scheduler state
  carriedRestockSpend, milestonesDone, nextDay, lastDay,
}
```

**Why `stock` stays a flat count with `stockAges` beside it:** every V2
gameplay path (bins, warnings, board chips, restock rows) reads
`stock[key]` as a number. Keeping that shape means spoilage bolts on
without touching rendering; the batch list is only consulted by the
stock helpers (`addStock` / `consumeStock` / `expireDay`) which keep the
two in sync. Single-writer discipline: gameplay code never mutates
`stock` directly in V3 — it calls the helpers.

**Migration:** V1→V2 logic retained; V2→V3 seeds `stockAges` (age 0,
grade standard), grants starter basics stock (dough/sauce/cheese — see
§3), defaults new blocks, and **backfills level** so nothing a returning
player owns is ever locked: level = max(level implied by lifetime XP
estimate, minimum level that covers owned content in the unlock table).

## 2. Basics become stock (dough / sauce base / cheese)

Quality grades ("choose supplier grade, better costs more per unit")
only mean something if cheese and sauce are *bought*. And the spoilage
spec explicitly gives dough/sauce shelf lives. So V3 stocks three
**basics**, consumed 1 unit per pizza each (flat regardless of size —
forecasting stays trivial: units ≈ pizzas expected):

- generous starting stock and cheap units, so early days feel like V2;
- **soft-fail on empty:** a basic never blocks the build. At 0 stock,
  each use auto-charges an "emergency corner-shop run" at ~2.5× unit
  price with a toast. Flow is never gated; the wallet takes the hit.
- Toppings keep V2 stockout behavior (order goes out incomplete).

## 3. XP & levels — the drip-feed engine

- **XP per order** = base (by size + topping types) × accuracy curve
  (quadratic — a perfect order pays ~3–4× a sloppy one), small bonuses
  for goals/milestones/events/pre-orders. Numbers in `BAL.XP`.
- **Level curve** `BAL.XP.CURVE` tuned by the 30-day sim: a new unlock
  every 1–2 days early, stretching to 3–4 by day ~20; level 30 ≈ day
  25–35.
- **The unlock table** `BAL.UNLOCKS` is a single declarative array:
  `{ level, kind, id, label, blurb }`. Kinds: topping, sizeL, side,
  sauce, crust, recipe, upgradeTier, equipment, event, customer,
  modifier, halfhalf, group, preorder, grades, decor tier. The table
  *gates the right to buy/see*; money still does the buying.
- Level-up: jingle + badge pop + "NEW UNLOCK" reveal card + small cash
  bonus (kept inside the ≤20% bonus-income envelope).
- V2 content is re-gated onto early levels so Day 1 = V2's Day 1
  (level 1 = pepperoni, mushroom, S/M, tomato sauce, classic crust).

## 4. Spoilage (the keystone of R3)

- Each stocked ingredient has `shelf` (days). Fresh-sensitive spoils
  fast (mushroom/spinach ~2–3), cured slow (pepperoni/olives ~6–8),
  basics generous (dough 3 — but cheap; sauce 5; cheese 4).
- Stock batches age +1 at day end; batches past shelf are binned:
  shown as a **waste** moment in the day-end flow, a per-ingredient
  waste line in analytics, and a session waste total. Waste is valued
  at what you paid (unit cost at current supply discount).
- Restock screen shows shelf life per row and flags stock expiring
  tomorrow, so over-buying is a *visible* mistake before it bites.
- Premium-grade perishables spoil one day sooner — the grade decision
  interacts with volume forecasting, which is the point.
- Target: a reasonable player wastes ~5–15% of stock spend (sim-tuned).

## 5. Ingredient roster (3 rarity tiers)

Common (cheap, hardy, early): pepperoni, mushroom, onion, olive,
pepper, sweetcorn, ham.
Premium (mid, fussier): pineapple, chilli, bacon, spinach, meatball,
anchovy.
Exotic (late, fragile, fat margins, visually loud): prosciutto,
artichoke, sun-dried tomato, goat cheese, truffle.

Exotics have short shelf lives and high unit costs — they only pay at
high volume/rating, which makes them a real decision, not an upgrade.

**Quality grades** (budget/standard/premium) apply to cheese, sauce,
pepperoni, mushroom. Grade is chosen per-ingredient in the restock
screen and stamps the *batches you buy* (no retroactive switching —
batches remember their grade, scoring reads the grade actually
consumed). Premium adds a small satisfaction bonus per order that uses
it; budget subtracts a little. Analytics answers "is premium worth it
at my volume?" with a margin-by-grade estimate.

## 6. Ticket dimensions: sauce variants & crusts

- Sauce variants: **tomato / BBQ / white** — chosen at the sauce pot
  (click the pot to cycle; the pot and pour recolor). Wrong variant
  halves the sauce station credit. Variants share the sauce-base stock
  pool — variety without another forecast row.
- Crusts: **classic / thin / stuffed** — chosen on the dough tray.
  Thin bakes ~12% faster, stuffed ~12% slower and charges a premium.
  Small scoring weight; mostly a bake-timing wrinkle.

## 7. Specialties (~8 named recipes)

Preset builds at a price premium, shown on the ticket by name with the
full fixed build. They appear once (a) unlocked by level and (b) all
component toppings are owned. Specialty demand biases ticket topping
weights (restock signal). Roster (see `BAL.RECIPES`): Double Double
(pepperoni), Meat Feast, Veggie Supreme, Hawaiian Classic, Fire
Breather (BBQ), Farmhouse (white), Ocean Catch, La Truffa (endgame).

## 8. Sides — rhythm breakers, not a second game

Both sides reuse the game's core learned skill (hold, watch the gauge,
release in the band) so they read instantly:

- **Garlic bread**: hold to spread butter into the band → short toast
  with a generous pull window in a side toaster.
- **Drinks**: hold to pour to the fill line. No bake.

Sides use their own stock (loaves spoil in ~2 days; drink cans keep
~10), appear on some tickets as add-ons, price high-margin, and get
their own analytics rows. One side is in flight at a time; it can be
prepared at any point before the bell.

## 9. Events (announced, never a surprise)

Framework: weighted-random with a pity timer (guaranteed event within
N days of a drought, never two heavy days back-to-back early),
level-gated introductions, each with distinct dressing + an end-of-day
report line. The *next day's* event is rolled at day end so both the
restock screen and the day-start board can announce it.

Roster: **Food Critic** (marked visitor, rating swing both ways, grade
A review pays and boosts tomorrow's footfall), **Rush Hour**
(compressed mid-day surge, tighter patience, +payout), **Supply
Shortage** (one ingredient priced up ~3× for tomorrow's restock —
forecast around it), **Festival** (footfall spike, sides/specialties
demanded, bunting), plus originals: **Slow Morning** (fewer, patient
customers with big fussy orders — an accuracy payday), **Health
Inspector** (counter mess and stockouts audited mid-day — makes splats
matter), **Nonna's Visit** (a kind critic; high sat = big tip + XP,
low sat = gentle, no rating sting — cozy, not punishing), **Surprise
Delivery** (free random stock at day open… that you now have to use
before it spoils — a waste-management puzzle disguised as a gift).

## 10. Customer variety

Archetypes with distinct silhouettes/read-at-a-glance cues:
normal, **regular** (V2), **impatient** (taps foot, drains 1.4×),
**easy-going** (slow drain), **VIP** (gold coat, pays & tips big,
patience 0.6×, rating counts double), **tourist** (camera, +10% pay,
loves specialties), **group leader** (clipboard — brings a group
ticket), **critic**/**inspector**/**nonna** (event-bound).

## 11. Advanced orders

- **Modifiers** (level-gated, gentle intro): "no cheese" (target = zero
  band), "double sauce" (band shifted above heavy), "easy sauce",
  "extra well-done" (pull window = deep half of WELL). Implemented as
  band/zone overrides on the ticket — the scoring engine is unchanged,
  which keeps modifiers cheap and consistent. Rendered as a bold "!"
  line on the ticket.
- **Half-and-half**: per-half topping lists scored by piece x-position
  vs the divider; faint divider drawn during the toppings stage.
- **Group orders**: one ticket, 2–3 pizzas built back-to-back (each
  goes to the pass), served together on one bell. Big payout, shared
  patience pool sized to the work.
- **Pre-orders**: at the day board, accept 0–3 known tickets due at
  fixed times, +25% premium. A due strip lives under the HUD; the
  pre-order customer walks in at the due time and expects the order
  *started* promptly — lateness decays their satisfaction cap. Turns
  the board into a real decision and rewards stock forecasting.

## 12. Automation arc (executor → strategist)

Bought relief that frees attention; agency is never removed:
- **Dough Proofer** (equipment): the ticket's base is pre-proofed —
  one confirm-click; manual picking still possible.
- **Sauce Auto-Dispenser** (ladle tier 4): calibrate light/normal/heavy
  default each morning; it pours to the calibrated point of the
  ticket's band, then waits — confirm, or hold to top up manually.
- **Cheese Hopper** (shaker tier 4): same pattern as the dispenser.
- **Second Oven** (flagship, late, expensive): two slots, per-slot
  meters and alarm chimes; while a pizza bakes you take the next
  order — the served customer waits at the pass. Deliberately breaks
  V1's "baking locks you out" rule and turns late-game rhythm into
  orchestration. The pass holds one pizza at a time (pulling a second
  finished pizza waits for the pass to clear — fair, readable limit).
- **Ticket Rail** (equipment, mine): shows the *next* customer's
  ticket in miniature — pure information, pure strategist fuel
  (pre-pour a base? save the last mushrooms?).

## 13. Seasons (low-FOMO calendar)

A rolling 36-day year: **Spring Bloom / Summer Fest / Spooky Season /
Winter Lights** (9 days each; the year loops forever, so everything
returns). Each season: subtle reskin (palette shift, window scene,
door wreath/bunting), 1–2 **rotating toppings** auto-lent while the
season runs (basil+cherry tomato / grilled corn+lime chicken? — see
`BAL.SEASONS` for the final roster), one seasonal specialty, and an
event-weight bias (Festival peaks in Summer, etc.). Rotating stock
left over when the season ends just spoils naturally — no confiscation.

## 14. Original systems (creative mandate)

**Loyalty Cards (regulars deepen).** Every regular carries a stamped
card: each 85+ serve of their signature order adds a stamp; at 3/6/10
stamps their loyalty tier rises — they visit more often, tip more, and
at top tier bring a friend (one extra customer) now and then. Serves
pillars (b) and (c): regulars become an *investment*, and letting one
storm out now has compounding cost. Cheap to build (rides the existing
regular system), reads warmly ("Marco's card is nearly full!").

**Recipe Mastery (craft compounds).** Each specialty tracks perfect
serves; at 5 and 15 perfects it earns a star (★/★★) shown on the menu
and tickets, raising that recipe's premium a notch. Serves (a) and (c):
the tactile skill of nailing a specific build accrues into a visible,
priced asset. Together with loyalty cards it gives the late game two
slow-burn collection tracks that are pure play, no FOMO.

## 15. Prestige scaffolding (invisible)

- `state.lifetime` accumulates earned/served/perfects/days/maxLevel and
  is never reset by anything in V3.
- `state.meta = { currency: 0, mult: 1.0 }`. The **single** economy
  touchpoint is in `Score.scoreOrder`: `price *= state.meta.mult` —
  pay, tips, and analytics all flow from price, so a future prestige
  multiplier needs zero refactor. Level-up cash bonuses also read it.
- A future prestige ("sell the shop, keep the recipes") would: bank
  `lifetime` → mint `meta.currency` → raise `meta.mult` → reset the
  run-state block. The save already separates run state from the two
  permanent blocks, so the reset is a field-list, not a migration.
- Nothing player-facing ships in V3.

## 16. Telemetry (local, private, exportable)

`src/telemetry.js` — ring buffer (600 events) in
`localStorage['slice-of-life-telemetry-v1']`, no network, no PII.
Logged: session start/end (+where the session ended: screen/day/
action), day start/end (money, level, waste, stockouts, event
outcome), purchases (order matters!), level-ups, goals/milestones,
pre-order outcomes. Dev panel on **Ctrl+Shift+D**: summary stats +
EXPORT (JSON download) + CLEAR. Exports get filed under `feedback/`
per its README.

## 17. Sim & balance targets (§13 of the brief)

30-day sim, multi-run averages, "reasonable effort" player model:
~1 purchase-equivalent/day early stretching later; unlock cadence
1–2 days early → 3–4 by day 20; level 30 ≈ day 25–35; bonus income
≤ ~20%; waste 5–15% of stock spend; stockouts ~1–3 affected
orders/day mid-game; premium grades profitable at volume, marginal
early; income and costs rise together. `tools/economy-sim.mjs` is the
instrument; results table lives in the final report.

---

## Decision log (running)

- **2026-07-03** Schema/migration designed before any feature code
  (above). Basics become stock with emergency-supply soft-fail.
  Grades stamp batches, not settings, to close the "buy budget, flip
  to premium" exploit. `meta.mult` applied at the single price
  computation point. Second oven's pass holds one pizza (readability
  over throughput). Seasons chosen at 36-day loop so a level-30 run
  (~day 25–35) sees ~3 seasons — enough to teach the loop cycles.
- **2026-07-03 (tuning pass, 30-day sim × 8 runs)** Final numbers:
  1.23 purchases/day, bonus share 20.9% (sim is a greedy completionist
  — real players land lower), waste 9.8% of restock spend, L10 at day
  ~8 / L20 at ~17.5 / L30 at ~28.6, premium grades net +£124/run once
  volume justifies them. Changes made to hit this: level-up cash
  trimmed (3+1×level), level milestones trimmed (they double-dip with
  level cash), patience +~15% over V2 (V3 days are busier and orders
  deeper: FRONT 90→100s, QUEUE 140→160s), arrival gap floor 7→8s,
  impatient/VIP drains 1.4/1.55→1.3/1.45, new-topping included stock
  20→24. Known near-misses, first things to tune with playtest data:
  (1) stockout orders ~3.8/day vs the 1–3 target mid-game — forecast
  UI could surface "expected use" per ingredient; (2) bonus share
  20.9% vs ≤20 — next lever is milestone rewards, not goals; (3)
  walk-outs ~1.7/day late game under a non-prioritizing player model —
  watch real players before touching patience again.
- **Automation honesty note.** The auto-dispenser reads the ticket's
  sauce *variant* (that's the bought relief) but pours to its dial,
  not the ticket's band — the amount decision stays with the player
  ("dial light, top up" is the intended strategy). The proofer removes
  size misreads entirely; that error simply stops existing, which is
  the point of buying it.
- **Second oven + groups.** Group tickets deliberately don't overlap
  (the leader stays at the counter) — two interleaved multi-pizza
  orders exceeded the readable complexity budget. The dual-slot flow
  is for singles, which is where the queue pressure actually lives.
