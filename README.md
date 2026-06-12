# 🍕 Slice of Life

A first-person pizza shop game. You are the chef: read the ticket, build the
pizza by hand, bake it, ring the bell. Earn money, climb the star rating,
manage your stock, upgrade the shop, survive busier days.

Vanilla HTML/CSS/JS (ES modules), Canvas + Web Audio. No frameworks, no build
step, no external assets of any kind — every pixel is drawn and every sound is
synthesized in code.

## Run it

Any static file server works. From this folder:

```bash
python3 -m http.server 8000
```

Then open **http://localhost:8000** in a desktop browser (Chrome/Firefox/Edge).
Mouse-first; pointer events mean touch mostly works too.

> ES modules don't load from `file://` — you do need the local server.

## How to play

Each day starts with the **day-start board**: today's special (extra demand,
+12% on those orders), the daily goal, and a stock check. Then customers queue
along the top. The front customer's **ticket pins to the left** — size, sauce
amount, cheese amount, exact topping counts, bake level. Build left to right:

| Station | Control |
|---|---|
| **Dough** | Click the S / M / L dough ball that matches the ticket |
| **Sauce** | Press & **hold** over the pizza — it pours from the centre. Release inside the ticket's band on the gauge (light / normal / heavy). Holding past full slops the counter. **NEXT** |
| **Cheese** | Same: **hold** to sprinkle, release in the band. **NEXT** |
| **Toppings** | Drag pieces from the bins. Counts matter exactly; spread them out. Each piece comes out of **stock** — the bin counter ticks down, amber when low, red `OUT` at zero. **NEXT** |
| **Oven** | Slide the pizza in. Watch the meter — **click to pull** in the ticket's zone. Past WELL is burnt |
| **Serve** | Click the **bell** |

Each station pops **Perfect! / Good / Off…** the moment you commit.

**Stock**: every topping has a stock count, and restocking only happens
between days (shop → **Restock** tab, per-unit prices in pennies). Run out
mid-service and the order goes out incomplete — accuracy takes the hit. The
bins warn you well in advance; the analytics tab shows yesterday's usage so
you can forecast, and the specials banner tells you what tomorrow wants.

**Regulars**: a handful of named locals (Marco, Rosa, Stan, Priya, Big Tony,
Nina) with signature orders. Nail their order for a fat bonus tip — their
word counts double in your rating, both ways.

**Goals**: one rotating daily goal pays a cash bonus the moment you hit it,
and lifetime milestones (serve totals, takings, stars, perfect streaks…) pay
out as you grow — progress lives in the shop's **Goals** tab.

**Patience**: every queued customer has a draining ring; if it empties they
storm out — no money, automatic 1★. No game over, just a worse day.

**Money** = order value × satisfaction, plus a tip that climbs steeply above
85 satisfaction. Your **star rating** is a rolling average of the last 20
customers; more stars = more customers tomorrow *and* higher prices.

At day end: receipt tally (with goal/milestone bonuses) → **analytics** →
shop: Equipment / Menu / **Restock** / **Analytics** / **Goals** → day-start
board → open the next day. Auto-saves at end of day; V1 saves migrate.

## What to playtest first

1. **The sauce pour** — hold, watch the gauge, release in the band. The
   in-band slowdown from ladle upgrades should make it feel buttery.
2. **Running low on the special** — let pepperoni dip under 6 on a pepperoni
   special day. The amber→red bin warnings should make the squeeze visible
   long before it bites.
3. **A milestone payout** — coins, confetti, fanfare. Getting paid should
   feel like getting paid.
4. **The analytics tab after a restock-heavy day** — margins should tell you
   something you didn't know about your menu.
5. **A regular's delight** — serve Marco a 90+ pizza.

## Structure

```
index.html
styles.css            UI chrome: HUD, ticket, receipt, shop, board, analytics
src/
  main.js             boot, rAF loop, scenes, input, scaling
  state.js            persistent state + save/load + migration (localStorage)
  balance.js          EVERY tunable number — tweak the game here
  goals.js            milestones, daily goals, next-day plan (specials)
  analytics.js        the per-topping P&L panel (shop + day end)
  juice.js            tween utility, particles, screen shake, floating text
  audio.js            Web Audio synth SFX (zero audio files)
  scenes/
    title.js  service.js  dayEnd.js  shop.js
  stations/
    order.js          queue, tickets, specials, regulars, patience
    build.js          dough, hold-to-pour sauce/cheese, toppings, stock bins
    oven.js           bake meter, zones, pull timing
    serve.js          scoring + handoff
tools/
  logic-test.mjs      headless assertions over the pure game logic
  economy-sim.mjs     10-day economy simulation (tuning instrument)
  smoke-test.mjs      Playwright: plays a full order in real Chromium
```

All balance lives in `src/balance.js` with comments — prices, patience
timers, band widths, pour rates, stock costs, milestone rewards, regulars.
No magic numbers in gameplay code.

```bash
node tools/logic-test.mjs     # pure-logic checks
node tools/economy-sim.mjs    # 10-day economy table + averages
node tools/smoke-test.mjs     # full-order browser playthrough
```
