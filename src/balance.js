// =====================================================================
// balance.js — EVERY tunable number in the game lives here.
// Tweak freely; gameplay code reads these and never hardcodes values.
// =====================================================================

export const BAL = {

  // ---- Canvas / logical resolution -----------------------------------
  W: 1280,
  H: 720,

  // ---- Economy --------------------------------------------------------
  ECONOMY: {
    START_MONEY: 0,
    BASE_PRICE: { S: 6, M: 9, L: 14 },        // £ by pizza size
    PRICE_PER_TOPPING_TYPE: 2.0,              // £ per topping TYPE on the order
    SAT_MULT_MIN: 0.4,                        // order value × this at 0 satisfaction
    SAT_MULT_MAX: 1.12,                       // ...× this at 100 satisfaction
    TIP_START_SAT: 55,                        // no tip below this satisfaction
    TIP_KNEE_SAT: 85,                         // tip curve steepens above this
    TIP_KNEE_FRAC: 0.08,                      // tip fraction AT the knee
    TIP_MAX_FRAC: 0.30,                       // tip fraction at 100 satisfaction
    RATING_PRICE_MULT: 0.07,                  // price ×(1 + (rating-3) × this)
  },

  // ---- Day structure ----------------------------------------------------
  DAYS: {
    BASE_CUSTOMERS: 5,                        // day 1 customer count
    CUSTOMERS_PER_DAY: 1,                     // +N customers per day number
    RATING_BONUS_MULT: 2,                     // + round((rating-3) × this)
    MIN_CUSTOMERS: 3,
    MAX_CUSTOMERS: 14,                        // V2 cap
    GAP_BASE_MIN: 15,                         // arrival gap range (s), day 1
    GAP_BASE_MAX: 26,
    GAP_DAY_DECAY: 0.93,                      // gap range × this per day
    GAP_FLOOR: 7,                             // gaps never shrink below (s)
    RUSH_CHANCE: 0.18,                        // chance an arrival comes hot on the heels
    RUSH_GAP: 3,                              // (s) gap when rushed
    FIRST_ARRIVAL: 1.2,                       // (s) into the day
  },

  // ---- Order/ticket generation -----------------------------------------
  ORDERS: {
    TYPES_PER_TICKET_DAY_DIV: 2,              // maxTypes = 1 + floor((day-1)/this)
    MAX_TYPES_PER_TICKET: 3,
    COUNT_RANGE: { S: [3, 5], M: [4, 7], L: [5, 9] },  // pieces per topping type
    SIZE_L_CHANCE: 0.35,                      // chance of L once unlocked
  },

  // ---- Scoring -----------------------------------------------------------
  SCORE: {
    WEIGHTS: { size: 15, sauce: 20, cheese: 15, toppings: 30, bake: 20 },
    // sauce/cheese amount bands as % (coverage % / cheese-fullness %)
    BANDS: { light: [22, 46], normal: [50, 76], heavy: [80, 112] },
    BAND_FALLOFF: 30,            // % outside a band where score reaches 0
    PERFECT_MARGIN: 0.15,        // inner (1-2×this) of band counts as "Perfect!"
    SPLAT_PENALTY: 1.2,          // sauce pts lost per counter splat...
    SPLAT_PENALTY_MAX: 5,        // ...capped here
    TOPPING_COUNT_PENALTY: 0.22, // fraction of a type's pts lost per piece off
    TOPPING_SPREAD_WEIGHT: 0.18, // fraction of topping pts that come from spread
    EXTRA_TYPE_PENALTY: 6,       // flat pts lost per topping type NOT on the ticket
    BAKE_ADJACENT_CREDIT: 0.5,   // fraction of bake pts for one zone off
    BURNT_TOTAL_MULT: 0.6,       // total accuracy × this when burnt (heavy penalty)
    SPEED_FLOOR: 0.7,            // satisfaction × this at ≥2× par time
    PAR_BASE: 24,                // (s) par time base
    PAR_PER_TYPE: 6,             // (s) + per topping type
    PAR_FAIL_X: 2,               // speed bottoms out at par × this
    STAR_THRESHOLDS: [[95, 5], [80, 4], [60, 3], [40, 2], [0, 1]], // [minSat, stars]
    PREP_GRACE: 10,              // "Morning prep" accuracy bonus (pts)
  },

  // ---- Patience ------------------------------------------------------------
  PATIENCE: {
    FRONT_SECONDS: 90,           // full drain time at the front of the queue
    QUEUE_SECONDS: 140,          // full drain time while waiting behind
    DECOR_BONUS: 0.15,           // +15% patience per decor tier
    WARN_FRAC: 0.45,             // below: checking-watch face
    ANGRY_FRAC: 0.2,             // below: steaming face
  },
  QUEUE: { BASE_SLOTS: 4 },      // +1 per decor tier

  // ---- Star rating ------------------------------------------------------
  RATING: { WINDOW: 20, START: 3 },

  // ---- Pizza & tools ------------------------------------------------------
  PIZZA: {
    RADIUS: { S: 86, M: 106, L: 128 },        // px on the counter
    SIZE_FACTOR: { S: 0.72, M: 1, L: 1.4 },   // scales cheese "fullness"
    CHEESE_FULL: 110,                         // flecks = 100% on an M
    SAUCE_RIM: 0.86,                          // sauceable radius as frac of pizza R
    TOPPING_R: 15,                            // topping piece radius
    GRID_SNAP_DIST: 32,                       // tongs t2: ghost-grid snap radius
  },

  // ---- Hold-to-pour (sauce & cheese) --------------------------------------
  POUR: {
    SAUCE_RATE: [0.34, 0.40, 0.46, 0.52],     // coverage fraction/sec by ladle tier
    CHEESE_RATE: [44, 52, 60, 70],            // flecks/sec by shaker tier
    IN_BAND_SLOW: [0.8, 0.75, 0.62, 0.5],     // rate × this while inside the ticket band
    OVERPOUR_SPLAT_CD: 0.5,                   // (s) between counter splats past full
  },

  // ---- Oven -------------------------------------------------------------
  OVEN: {
    BAKE_TIME: [13, 12.1, 11.2, 10.4],        // (s) raw→fully burnt, by oven tier
    // zone upper bounds as bake progress 0..1 (burnt ≥ well bound)
    ZONES: { raw: 0.30, light: 0.50, normal: 0.70, well: 0.88 },
    ZONE_WIDEN: 0.025,           // each zone grows this much per side per tier
    URGENCY_FROM: 0.08,          // urgency ticks start this close to burnt
  },

  // ---- Upgrades (equipment tab) -----------------------------------------
  // costs: per tier (≈ ×2.2 per tier; tier1 ≈ one good day)
  UPGRADES: {
    oven:   { name: 'Stone Oven',   costs: [90, 260, 600],
              tiers: ['Wider perfect zones', 'Even wider zones, hotter', 'Master oven — huge zones'] },
    ladle:  { name: 'Sauce Ladle',  costs: [70, 200, 480],
              tiers: ['Faster pour', 'Steadier pour near the band', 'Pro ladle — pinpoint control'] },
    shaker: { name: 'Cheese Shaker', costs: [70, 200, 480],
              tiers: ['Faster sprinkle', 'Steadier hand near the band', 'Blizzard mode — fast & precise'] },
    tongs:  { name: 'Topping Tongs', costs: [90, 270, 630],
              tiers: ['Edge-save grip', 'Neat-grid snapping', 'Double-grab'] },
    decor:  { name: 'Counter & Decor', costs: [110, 300, 690],
              tiers: ['Fresh paint, +1 queue slot, patience +15%',
                      'Plants & art, +1 slot, patience +15%',
                      'Full refit, +1 slot, patience +15%'] },
    supply: { name: 'Supply Deals', costs: [70, 195, 460, 980],
              tiers: ['Bulk paper: restock −10%', 'Local farm deal: restock −20%',
                      'Wholesale account: restock −35%', 'Importer contract: restock −50%'] },
  },
  SUPPLY_DISCOUNTS: [0, 0.10, 0.20, 0.35, 0.50],  // restock discount by supply tier

  // ---- Toppings (menu tab) — display order matters -----------------------
  // cost = unlock price · unit = restock £/piece (before supply discount)
  TOPPINGS: {
    pepperoni: { label: 'Pepperoni', cost: 0,   unit: 0.10, dot: '#d8442e' },
    mushroom:  { label: 'Mushroom',  cost: 0,   unit: 0.09, dot: '#e8d9bd' },
    onion:     { label: 'Onion',     cost: 60,  unit: 0.08, dot: '#c39bd3' },
    olive:     { label: 'Olive',     cost: 95,  unit: 0.12, dot: '#3d4a26' },
    pepper:    { label: 'Pepper',    cost: 130, unit: 0.12, dot: '#4caf50' },
    ham:       { label: 'Ham',       cost: 170, unit: 0.16, dot: '#f48fb1' },
    pineapple: { label: 'Pineapple', cost: 220, unit: 0.18, dot: '#f6c945' },
    chilli:    { label: 'Chilli',    cost: 280, unit: 0.20, dot: '#e53935' },
  },
  SIZE_L_COST: 220,

  // ---- Stock / restock -----------------------------------------------------
  STOCK: {
    START: 24,                   // starting stock per starter topping
    NEW_TOPPING_INCLUDED: 20,    // stock included when a topping is unlocked
    LOW_AT: 6,                   // low-stock warning threshold (amber)
    BUY_AMOUNTS: [5, 20],        // restock button quantities
  },

  // ---- Daily specials --------------------------------------------------------
  SPECIALS: {
    WEIGHT: 2.6,                 // special toppings this × more likely on tickets
    PRICE_PREMIUM: 0.12,         // orders featuring a special pay +12%
    TWO_FROM_DAY: 5,             // two specials per day from this day on
  },

  // ---- Regulars ---------------------------------------------------------------
  REGULARS: {
    CHANCE: 0.12,                // base chance a customer slot becomes a regular
    RATING_CHANCE_BONUS: 0.06,   // + per star above 3
    MAX_CHANCE: 0.3,
    SAT_THRESHOLD: 85,           // satisfaction needed for the regular bonus
    TIP_BONUS_FRAC: 0.25,        // bonus tip as a fraction of order price
    // fixed look + signature order; they appear once their toppings (and size)
    // are unlocked, at most once per day each
    LIST: {
      marco: { name: 'Marco',    skin: '#e0a878', shirt: '#e2725b', hair: '#222',     hat: true,
               fav: { size: 'M', sauce: 'heavy',  cheese: 'normal', bake: 'well',
                      toppings: [{ type: 'pepperoni', count: 6 }] } },
      rosa:  { name: 'Rosa',     skin: '#f2c89c', shirt: '#d678c0', hair: '#6d4c2f',  hat: false,
               fav: { size: 'S', sauce: 'light',  cheese: 'heavy',  bake: 'light',
                      toppings: [{ type: 'mushroom', count: 4 }] } },
      stan:  { name: 'Stan',     skin: '#f7d9b4', shirt: '#5da9d6', hair: '#888',     hat: false,
               fav: { size: 'M', sauce: 'normal', cheese: 'light',  bake: 'normal',
                      toppings: [{ type: 'onion', count: 5 }, { type: 'olive', count: 4 }] } },
      priya: { name: 'Priya',    skin: '#c98c5e', shirt: '#9575cd', hair: '#3a2a1c',  hat: false,
               fav: { size: 'M', sauce: 'normal', cheese: 'normal', bake: 'well',
                      toppings: [{ type: 'pepper', count: 5 }, { type: 'mushroom', count: 4 }] } },
      tony:  { name: 'Big Tony', skin: '#f2c89c', shirt: '#4db6ac', hair: '#3a2a1c',  hat: true,
               fav: { size: 'L', sauce: 'heavy',  cheese: 'heavy',  bake: 'normal',
                      toppings: [{ type: 'pepperoni', count: 7 }, { type: 'ham', count: 6 }] } },
      nina:  { name: 'Nina',     skin: '#8d5a3b', shirt: '#f5b942', hair: '#d9534f',  hat: false,
               fav: { size: 'M', sauce: 'normal', cheese: 'normal', bake: 'light',
                      toppings: [{ type: 'pineapple', count: 5 }, { type: 'chilli', count: 4 }] } },
    },
  },

  // ---- Lifetime milestones (one-off cash bonuses) ---------------------------
  // stat: see goals.js metrics(). ratingBump: × five-star ratings pushed on hit.
  MILESTONES: [
    { id: 'serve25',     label: 'Serve 25 pizzas',            stat: 'served',        target: 25,   reward: 22 },
    { id: 'serve100',    label: 'Serve 100 pizzas',           stat: 'served',        target: 100,  reward: 70 },
    { id: 'serve250',    label: 'Serve 250 pizzas',           stat: 'served',        target: 250,  reward: 180 },
    { id: 'serve500',    label: 'Serve 500 pizzas',           stat: 'served',        target: 500,  reward: 380 },
    { id: 'earn250',     label: '£250 lifetime takings',      stat: 'earned',        target: 250,  reward: 18 },
    { id: 'earn1000',    label: '£1,000 lifetime takings',    stat: 'earned',        target: 1000, reward: 55 },
    { id: 'earn5000',    label: '£5,000 lifetime takings',    stat: 'earned',        target: 5000, reward: 220 },
    { id: 'stars3',      label: 'Hold a 3★ rating',           stat: 'rating',        target: 3,    reward: 12 },
    { id: 'stars4',      label: 'Reach a 4★ rating',          stat: 'rating',        target: 4,    reward: 40 },
    { id: 'stars5',      label: 'Reach a 5★ rating',          stat: 'rating',        target: 5,    reward: 130 },
    { id: 'perfect10',   label: '10 perfect pizzas',          stat: 'perfects',      target: 10,   reward: 32,  ratingBump: 1 },
    { id: 'perfect50',   label: '50 perfect pizzas',          stat: 'perfects',      target: 50,   reward: 130, ratingBump: 1 },
    { id: 'streak5',     label: '5 perfect pizzas in a row',  stat: 'bestStreak',    target: 5,    reward: 50,  ratingBump: 1 },
    { id: 'upgrades5',   label: 'Own 5 upgrade tiers',        stat: 'upgradesOwned', target: 5,    reward: 40 },
    { id: 'allToppings', label: 'Unlock every topping',       stat: 'toppingsOwned', target: 8,    reward: 110 },
    { id: 'profit100',   label: 'A £100-profit day',          stat: 'bestDayProfit', target: 100,  reward: 50 },
  ],
  MILESTONE_MIN_RATINGS: 12,     // star milestones need this many rated customers

  // ---- Daily goals (one rotating goal per day) ---------------------------------
  // needs: 'sizeL' | 'manyToppings' gate availability
  DAILY_GOALS: [
    { id: 'noStorms', desc: 'No walk-outs all day',                       short: 'No walk-outs',     reward: 11 },
    { id: 'sat90',    desc: 'Finish the day at 90%+ avg satisfaction',    short: '90% satisfaction', reward: 13 },
    { id: 'sellL',    desc: 'Sell 3 large pizzas',                        short: '3 large pizzas',   reward: 12, target: 3, needs: 'sizeL' },
    { id: 'perfect2', desc: 'Serve 2 perfect pizzas',                     short: '2 perfects',       reward: 14, target: 2 },
    { id: 'useAll',   desc: 'Use every topping at least once',            short: 'Use every topping', reward: 12, needs: 'manyToppings' },
    { id: 'fast5',    desc: 'Serve 5 orders under par time',              short: '5 fast orders',    reward: 12, target: 5 },
  ],
  DAILY_GOAL_MANY_TOPPINGS: 4,   // 'useAll' offered once you own this many

  // ---- Boosts (one-day consumables) ---------------------------------------
  BOOSTS: {
    prep: { name: 'Morning Prep', cost: 12,
            desc: 'First 3 pizzas tomorrow get +10% accuracy grace.' },
    ad:   { name: 'Local Ad', cost: 10,
            desc: '+2 customers tomorrow.' },
    AD_EXTRA_CUSTOMERS: 2,
    PREP_PIZZAS: 3,
  },
};

// Convenience: ordered topping keys (menu + bin display order)
export const TOPPING_ORDER = Object.keys(BAL.TOPPINGS);
