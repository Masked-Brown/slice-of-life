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
    BASE_PRICE: { S: 5, M: 8, L: 12 },        // £ by pizza size
    PRICE_PER_TOPPING_TYPE: 1.5,              // £ per topping TYPE on the order
    SAT_MULT_MIN: 0.4,                        // order value × this at 0 satisfaction
    SAT_MULT_MAX: 1.1,                        // ...× this at 100 satisfaction
    TIP_START_SAT: 55,                        // no tip below this satisfaction
    TIP_KNEE_SAT: 85,                         // tip curve steepens above this
    TIP_KNEE_FRAC: 0.08,                      // tip fraction AT the knee
    TIP_MAX_FRAC: 0.30,                       // tip fraction at 100 satisfaction
    RATING_PRICE_MULT: 0.08,                  // price ×(1 + (rating-3) × this)
  },

  // ---- Day structure ----------------------------------------------------
  DAYS: {
    BASE_CUSTOMERS: 5,                        // day 1 customer count
    CUSTOMERS_PER_DAY: 1,                     // +N customers per day number
    RATING_BONUS_MULT: 2,                     // + round((rating-3) × this)
    MIN_CUSTOMERS: 3,
    MAX_CUSTOMERS: 14,                        // V1 cap
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
    BANDS: { light: [25, 45], normal: [50, 75], heavy: [80, 110] },
    BAND_FALLOFF: 25,            // % outside a band where score reaches 0
    PERFECT_MARGIN: 0.2,         // inner (1-2×this) of band counts as "Perfect!"
    SPLAT_PENALTY: 1.5,          // sauce pts lost per counter splat...
    SPLAT_PENALTY_MAX: 6,        // ...capped here
    TOPPING_COUNT_PENALTY: 0.3,  // fraction of a type's pts lost per piece off
    TOPPING_SPREAD_WEIGHT: 0.25, // fraction of topping pts that come from spread
    EXTRA_TYPE_PENALTY: 8,       // flat pts lost per topping type NOT on the ticket
    BAKE_ADJACENT_CREDIT: 0.4,   // fraction of bake pts for one zone off
    BURNT_TOTAL_MULT: 0.6,       // total accuracy × this when burnt (heavy penalty)
    SPEED_FLOOR: 0.6,            // satisfaction × this at ≥2× par time
    PAR_BASE: 20,                // (s) par time base
    PAR_PER_TYPE: 6,             // (s) + per topping type
    PAR_FAIL_X: 2,               // speed bottoms out at par × this
    STAR_THRESHOLDS: [[95, 5], [80, 4], [60, 3], [40, 2], [0, 1]], // [minSat, stars]
    PREP_GRACE: 10,              // "Morning prep" accuracy bonus (pts)
  },

  // ---- Patience ------------------------------------------------------------
  PATIENCE: {
    FRONT_SECONDS: 75,           // full drain time at the front of the queue
    QUEUE_SECONDS: 110,          // full drain time while waiting behind
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
    SAUCE_BRUSH: [24, 29, 35, 42],            // ladle paint radius by tier
    SAUCE_RIM: 0.86,                          // sauceable radius as frac of pizza R
    CHEESE_SPREAD: [26, 34, 43, 52],          // sprinkle radius by shaker tier
    CHEESE_RATE: [55, 72, 92, 116],           // flecks/sec while held, by tier
    TOPPING_R: 15,                            // topping piece radius
    GRID_SNAP_DIST: 32,                       // tongs t2: ghost-grid snap radius
  },

  // ---- Oven -------------------------------------------------------------
  OVEN: {
    BAKE_TIME: [13, 12.1, 11.2, 10.4],        // (s) raw→fully burnt, by oven tier
    // zone upper bounds as bake progress 0..1 (burnt ≥ well bound)
    ZONES: { raw: 0.32, light: 0.5, normal: 0.68, well: 0.86 },
    ZONE_WIDEN: 0.022,           // each zone grows this much per side per tier
    URGENCY_FROM: 0.08,          // urgency ticks start this close to burnt
  },

  // ---- Upgrades (equipment tab) -----------------------------------------
  // costs: tier1, tier2, tier3 (≈ ×2.2 per tier; tier1 ≈ one good day)
  UPGRADES: {
    oven:   { name: 'Stone Oven',   costs: [50, 110, 245],
              tiers: ['Wider perfect zones', 'Even wider zones, hotter', 'Master oven — huge zones'] },
    ladle:  { name: 'Sauce Ladle',  costs: [40, 90, 200],
              tiers: ['Bigger sauce trail', 'Even bigger trail', 'Pro ladle + coverage ring'] },
    shaker: { name: 'Cheese Shaker', costs: [40, 90, 200],
              tiers: ['Wider sprinkle', 'Faster dispense', 'Blizzard mode'] },
    tongs:  { name: 'Topping Tongs', costs: [55, 120, 265],
              tiers: ['Edge-save grip', 'Neat-grid snapping', 'Double-grab'] },
    decor:  { name: 'Counter & Decor', costs: [60, 130, 290],
              tiers: ['Fresh paint, +1 queue slot, patience +15%',
                      'Plants & art, +1 slot, patience +15%',
                      'Full refit, +1 slot, patience +15%'] },
  },

  // ---- Toppings (menu tab) — display order matters -----------------------
  TOPPINGS: {
    pepperoni: { label: 'Pepperoni', cost: 0,   dot: '#d8442e' },
    mushroom:  { label: 'Mushroom',  cost: 0,   dot: '#e8d9bd' },
    onion:     { label: 'Onion',     cost: 35,  dot: '#c39bd3' },
    olive:     { label: 'Olive',     cost: 50,  dot: '#3d4a26' },
    pepper:    { label: 'Pepper',    cost: 70,  dot: '#4caf50' },
    ham:       { label: 'Ham',       cost: 90,  dot: '#f48fb1' },
    pineapple: { label: 'Pineapple', cost: 115, dot: '#f6c945' },
    chilli:    { label: 'Chilli',    cost: 150, dot: '#e53935' },
  },
  SIZE_L_COST: 120,

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
