# 🍕 Slice of Life

A first-person pizza shop game. You are the chef: read the ticket, build the
pizza by hand, bake it, ring the bell. Earn money, climb the star rating,
upgrade the shop, survive busier days.

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

Customers queue along the top. The front customer's **ticket pins to the left**
— it tells you size, sauce amount, cheese amount, exact topping counts, and
bake level. Build the pizza left to right along the counter:

| Station | Control |
|---|---|
| **Dough** | Click the S / M / L dough ball that matches the ticket |
| **Sauce** | Hold & drag the ladle over the base — coverage % is what counts (light ≈ 25–45%, normal ≈ 50–75%, heavy ≈ 80%+). Don't slop over the edge. Press **NEXT** when done |
| **Cheese** | Hold & drag to sprinkle — same light/normal/heavy bands. **NEXT** |
| **Toppings** | Drag pieces from the bins onto the pizza. Counts matter exactly; spread them out. Drag a piece off the pizza to remove it. **NEXT** |
| **Oven** | Drag (or click the oven to slide) the pizza in. Watch the meter — **click to pull** in the ticket's zone. Past WELL is burnt |
| **Serve** | Click the **bell** |

Each station pops **Perfect! / Good / Off…** the moment you commit, so you
learn the bands by feel.

**Patience**: every queued customer has a draining ring; the front of the queue
drains fastest. If it empties they storm out — no money, automatic 1★. There is
no game over, just a worse day.

**Money** = order value × satisfaction, plus a tip that climbs steeply above
85 satisfaction. Satisfaction = accuracy × speed. Your **star rating** is a
rolling average of the last 20 customers; more stars = more customers tomorrow
*and* higher prices.

At day end: receipt tally → **upgrade shop** (Equipment / Menu / Boosts) →
open the next day. The game auto-saves at end of day.

## What to playtest first

1. **The sauce drag** — it should feel like painting with a wet brush, sound
   included. This is the feel benchmark for everything else.
2. **The oven gamble** — push a well-done bake as close to BURNT as you dare.
   The urgency ticks should make your palms sweat slightly.
3. **A perfect pizza** — nail every station on a simple order: slow-mo, stamp,
   confetti, jingle. This should feel like an event.
4. **Day 1 economy** — you should finish with roughly enough for exactly one
   tier-1 upgrade. The Stone Oven is the most satisfying first buy (visibly
   wider zones on the bake meter).
5. **A backed-up queue** around day 4–5 — relaxed should turn spicy.

## Structure

```
index.html
styles.css            UI chrome: HUD, ticket, receipt, shop, tutorial
src/
  main.js             boot, rAF loop, scenes, input, scaling
  state.js            persistent state + save/load (localStorage)
  balance.js          EVERY tunable number — tweak the game here
  juice.js            tween utility, particles, screen shake, floating text
  audio.js            Web Audio synth SFX (zero audio files)
  scenes/
    title.js  service.js  dayEnd.js  shop.js
  stations/
    order.js          queue, tickets, patience
    build.js          dough, sauce, cheese, toppings
    oven.js           bake meter, zones, pull timing
    serve.js          scoring + handoff
```

All balance lives in `src/balance.js` with comments — prices, patience timers,
band widths, par times, upgrade costs. No magic numbers in gameplay code.
