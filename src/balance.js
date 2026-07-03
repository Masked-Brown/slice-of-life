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
    WRONG_SAUCE_MULT: 0.35,      // sauce station credit × this on wrong variant
    CRUST_WRONG_PENALTY: 8,      // flat accuracy pts lost for the wrong crust
    GRADE_BONUS_MIN: -6,         // grade satisfaction bonus clamp
    GRADE_BONUS_MAX: 8,
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
    decor:  { name: 'Counter & Decor', costs: [110, 300, 690, 1200, 2000, 3200],
              tiers: ['Fresh paint, +1 queue slot, patience +15%',
                      'Plants & art, +1 slot, patience +15%',
                      'Full refit, +1 slot, patience +15%',
                      'Gallery wall — warmer light, tips +4%',
                      'Terrazzo & brass — +1 customer a day',
                      'The Landmark — tips +10% total, +2 customers'] },
    supply: { name: 'Supply Deals', costs: [70, 195, 460, 980],
              tiers: ['Bulk paper: restock −10%', 'Local farm deal: restock −20%',
                      'Wholesale account: restock −35%', 'Importer contract: restock −50%'] },
  },
  SUPPLY_DISCOUNTS: [0, 0.10, 0.20, 0.35, 0.50],  // restock discount by supply tier
  // decor buffs by tier: queue/patience stack for the first three tiers,
  // then the shop starts earning on charm instead
  DECOR: {
    QUEUE_PATIENCE_TIERS: 3,     // +1 slot & +15% patience apply up to here
    TIP_FRAC: [0, 0, 0, 0, 0.04, 0.04, 0.10],   // flat tip multiplier bonus
    FOOTFALL: [0, 0, 0, 0, 0, 1, 2],            // + customers per day
  },

  // ---- Toppings (menu tab) — display order matters -----------------------
  // cost = unlock price · unit = restock £/piece (before supply discount)
  // shelf = days a batch keeps before spoiling (V3) · tier = rarity band
  TOPPINGS: {
    pepperoni: { label: 'Pepperoni', cost: 0,   unit: 0.10, dot: '#d8442e', shelf: 6, tier: 'common' },
    mushroom:  { label: 'Mushroom',  cost: 0,   unit: 0.09, dot: '#e8d9bd', shelf: 3, tier: 'common' },
    onion:     { label: 'Onion',     cost: 60,  unit: 0.08, dot: '#c39bd3', shelf: 5, tier: 'common' },
    olive:     { label: 'Olive',     cost: 95,  unit: 0.12, dot: '#3d4a26', shelf: 8, tier: 'common' },
    pepper:    { label: 'Pepper',    cost: 130, unit: 0.12, dot: '#4caf50', shelf: 3, tier: 'common' },
    ham:       { label: 'Ham',       cost: 170, unit: 0.16, dot: '#f48fb1', shelf: 4, tier: 'common' },
    pineapple: { label: 'Pineapple', cost: 220, unit: 0.18, dot: '#f6c945', shelf: 3, tier: 'premium' },
    chilli:    { label: 'Chilli',    cost: 280, unit: 0.20, dot: '#e53935', shelf: 5, tier: 'premium' },
    // V3 expansion — commons are workhorses, premiums are margin plays,
    // exotics are fragile darlings that only pay at volume
    sweetcorn:  { label: 'Sweetcorn',  cost: 105,  unit: 0.07, dot: '#f7de6b', shelf: 6, tier: 'common' },
    bacon:      { label: 'Bacon',      cost: 340,  unit: 0.22, dot: '#c96a52', shelf: 4, tier: 'premium' },
    spinach:    { label: 'Spinach',    cost: 400,  unit: 0.16, dot: '#3e7d3a', shelf: 2, tier: 'premium' },
    meatball:   { label: 'Meatball',   cost: 470,  unit: 0.28, dot: '#8a4b32', shelf: 3, tier: 'premium' },
    anchovy:    { label: 'Anchovy',    cost: 540,  unit: 0.24, dot: '#7c93a6', shelf: 7, tier: 'premium' },
    prosciutto: { label: 'Prosciutto', cost: 650,  unit: 0.45, dot: '#e88f9c', shelf: 3, tier: 'exotic' },
    artichoke:  { label: 'Artichoke',  cost: 720,  unit: 0.38, dot: '#93a45a', shelf: 4, tier: 'exotic' },
    goatcheese: { label: 'Goat Cheese', cost: 800, unit: 0.42, dot: '#f4f0e3', shelf: 2, tier: 'exotic' },
    sundried:   { label: 'Sun-dried Tom.', cost: 880, unit: 0.36, dot: '#b23c22', shelf: 8, tier: 'exotic' },
    truffle:    { label: 'Truffle',    cost: 1000, unit: 0.60, dot: '#4d4038', shelf: 2, tier: 'exotic' },
    // seasonal rotators — lent free while their season runs, then they
    // cycle out (and back next year). Never purchasable; stock restockable.
    basil:        { label: 'Basil',         cost: 0, unit: 0.14, dot: '#4e9b40', shelf: 2, tier: 'premium', seasonal: 'spring' },
    cherrytomato: { label: 'Cherry Tomato', cost: 0, unit: 0.13, dot: '#e04c30', shelf: 3, tier: 'premium', seasonal: 'summer' },
    pumpkin:      { label: 'Pumpkin',       cost: 0, unit: 0.15, dot: '#e07b39', shelf: 4, tier: 'premium', seasonal: 'spooky' },
    cranberry:    { label: 'Cranberry',     cost: 0, unit: 0.16, dot: '#8e2440', shelf: 5, tier: 'premium', seasonal: 'winter' },
  },
  // exotic pieces charge more per topping TYPE on the ticket
  TIER_PRICE_ADD: { common: 0, premium: 0.8, exotic: 2.2 },
  SIZE_L_COST: 220,

  // ---- Sauce variants & crusts (ticket dimensions) --------------------------
  // Variants share the sauce-base stock pool; the pot cycles on click.
  SAUCES: {
    tomato: { label: 'Tomato', color: '#c23a1c', hi: '#d64822', cost: 0 },
    bbq:    { label: 'BBQ',    color: '#7a4526', hi: '#8f5430', cost: 260 },
    white:  { label: 'White',  color: '#efe6cf', hi: '#f7f0de', cost: 420 },
  },
  CRUSTS: {
    classic: { label: 'Classic', cost: 0,   bakeMult: 1.0,  priceAdd: 0 },
    thin:    { label: 'Thin',    cost: 300, bakeMult: 0.85, priceAdd: 1.0 },
    stuffed: { label: 'Stuffed', cost: 520, bakeMult: 1.15, priceAdd: 2.5 },
  },
  TICKET_WEIGHTS: {
    SAUCE_DEFAULT: 2.2,          // tomato this × more likely than each variant
    CRUST_DEFAULT: 2.2,          // classic likewise
  },

  // ---- Specialty pizzas — named recipes at a premium -------------------------
  // A specialty appears on tickets once its level unlock fires AND every
  // component (toppings, sauce, crust, size) is owned. The ticket shows the
  // name and the fixed build; the customer pays the premium.
  RECIPE_CHANCE: 0.16,           // chance an eligible ticket becomes a specialty
  RECIPES: {
    doubledouble:  { name: 'Double Double',   premium: 0.22,
      build: { size: 'M', crust: 'classic', sauceType: 'tomato', sauce: 'heavy', cheese: 'heavy', bake: 'normal',
               toppings: [{ type: 'pepperoni', count: 8 }] } },
    meatfeast:     { name: 'Meat Feast',      premium: 0.28,
      build: { size: 'M', crust: 'classic', sauceType: 'tomato', sauce: 'normal', cheese: 'normal', bake: 'well',
               toppings: [{ type: 'pepperoni', count: 5 }, { type: 'ham', count: 5 }] } },
    veggiesupreme: { name: 'Veggie Supreme',  premium: 0.26,
      build: { size: 'M', crust: 'classic', sauceType: 'tomato', sauce: 'normal', cheese: 'light', bake: 'normal',
               toppings: [{ type: 'mushroom', count: 4 }, { type: 'pepper', count: 4 }, { type: 'sweetcorn', count: 4 }] } },
    hawaiian:      { name: 'Hawaiian Classic', premium: 0.28,
      build: { size: 'M', crust: 'classic', sauceType: 'tomato', sauce: 'normal', cheese: 'normal', bake: 'light',
               toppings: [{ type: 'ham', count: 5 }, { type: 'pineapple', count: 5 }] } },
    firebreather:  { name: 'Fire Breather',   premium: 0.32,
      build: { size: 'M', crust: 'classic', sauceType: 'bbq', sauce: 'heavy', cheese: 'normal', bake: 'well',
               toppings: [{ type: 'chilli', count: 5 }, { type: 'pepperoni', count: 4 }, { type: 'onion', count: 4 }] } },
    farmhouse:     { name: 'Farmhouse',       premium: 0.32,
      build: { size: 'M', crust: 'classic', sauceType: 'white', sauce: 'normal', cheese: 'normal', bake: 'normal',
               toppings: [{ type: 'bacon', count: 4 }, { type: 'mushroom', count: 4 }, { type: 'sweetcorn', count: 4 }] } },
    oceancatch:    { name: 'Ocean Catch',     premium: 0.36,
      build: { size: 'M', crust: 'classic', sauceType: 'tomato', sauce: 'light', cheese: 'light', bake: 'normal',
               toppings: [{ type: 'anchovy', count: 4 }, { type: 'olive', count: 5 }, { type: 'artichoke', count: 3 }] } },
    latruffa:      { name: 'La Truffa',       premium: 0.45,
      build: { size: 'M', crust: 'thin', sauceType: 'white', sauce: 'light', cheese: 'normal', bake: 'light',
               toppings: [{ type: 'truffle', count: 3 }, { type: 'goatcheese', count: 4 }, { type: 'spinach', count: 4 }] } },
    // seasonal specialties — on the menu only while their season runs
    margheritafresca: { name: 'Margherita Fresca', premium: 0.24, seasonal: 'spring',
      build: { size: 'M', crust: 'classic', sauceType: 'tomato', sauce: 'normal', cheese: 'heavy', bake: 'light',
               toppings: [{ type: 'basil', count: 5 }] } },
    estiva:           { name: 'Estiva',            premium: 0.26, seasonal: 'summer',
      build: { size: 'M', crust: 'thin', sauceType: 'tomato', sauce: 'light', cheese: 'normal', bake: 'normal',
               toppings: [{ type: 'cherrytomato', count: 5 }, { type: 'olive', count: 4 }] } },
    jackolantern:     { name: "Jack o'Lantern",    premium: 0.28, seasonal: 'spooky',
      build: { size: 'M', crust: 'classic', sauceType: 'bbq', sauce: 'normal', cheese: 'normal', bake: 'well',
               toppings: [{ type: 'pumpkin', count: 5 }, { type: 'onion', count: 4 }] } },
    festivefeast:     { name: 'Festive Feast',     premium: 0.30, seasonal: 'winter',
      build: { size: 'M', crust: 'classic', sauceType: 'tomato', sauce: 'normal', cheese: 'heavy', bake: 'normal',
               toppings: [{ type: 'cranberry', count: 4 }, { type: 'ham', count: 5 }] } },
  },

  // ---- Sides — rhythm breakers, not a second game ----------------------------
  // Both reuse the learned hold-release-in-the-band skill.
  SIDES: {
    garlicbread: { name: 'Garlic Bread', price: 3.4, stockKey: 'gbread', cost: 150,
                   verb: 'Butter it', toastTime: 3.2 },
    drinks:      { name: 'Fizzy Drink', price: 1.9, stockKey: 'cans', cost: 120,
                   verb: 'Pour to the line' },
  },
  SIDE_STOCK: {
    gbread: { label: 'Bread loaves', unit: 0.45, dot: '#e8c88a', shelf: 2 },
    cans:   { label: 'Drink cans',   unit: 0.35, dot: '#6fb3d9', shelf: 10 },
  },
  SIDE_CHANCE: 0.30,             // chance a ticket adds a side (once owned)
  SIDE_RATE: 0.55,               // fill fraction/sec while holding
  SIDE_BAND: [58, 82],           // release band (% full) for side quality
  SIDE_SAT: { PERFECT: 3, SLOPPY: -2, MISSING: -5 },
  SIDE_PAY_FLOOR: 0.55,          // side price × (floor + (1-floor) × quality)

  // ---- Order modifiers — small twists that punish autopilot ------------------
  // Implemented as band/zone overrides; the scoring engine is unchanged.
  MODIFIER_CHANCE: 0.18,         // chance a plain ticket carries one (once unlocked)
  MODIFIERS: {
    nocheese:    { set: 'modsA', label: 'NO cheese',          chip: 'none!',   band: { cheese: [0, 6] } },
    easysauce:   { set: 'modsA', label: 'easy on the sauce',  chip: 'easy!',   band: { sauce: [10, 32] } },
    doublesauce: { set: 'modsB', label: 'DOUBLE sauce',       chip: 'double!', band: { sauce: [88, 112] } },
    extrawell:   { set: 'modsB', label: 'extra well-done',    chip: 'extra!',  bakeDeep: true },
  },
  BAKE_DEEP_FRAC: 0.5,           // extra well-done: pull in the deep half of WELL

  // ---- Half-and-half ----------------------------------------------------------
  HALFHALF_CHANCE: 0.14,         // chance a 2-type ticket splits (once unlocked)

  // ---- Group orders -------------------------------------------------------------
  GROUP: {
    CHANCE: 0.10,                // chance a customer brings a group ticket
    THREE_CHANCE: 0.35,          // …of those, chance it's 3 pizzas (once unlocked)
    PREMIUM: 0.12,               // group total pays this much extra
    PATIENCE_MULT: 1.9,          // their patience pool scales to the workload
  },

  // ---- Customer archetypes (V3 — the queue reads at a glance) -----------------
  ARCHETYPES: {
    impatient: { chance: 0.13, drain: 1.4 },              // taps a foot, drains fast
    easygoing: { chance: 0.13, drain: 0.62 },             // coffee in hand, all day
    tourist:   { chance: 0.10, payMult: 1.1, specialtyBias: 0.5 },  // camera, loves the menu
    vip:       { chance: 0.06, drain: 1.55, payMult: 1.7, tipMult: 2.2, ratingWeight: 2 },
  },

  // ---- Events — announced on the board, never a surprise ----------------------
  EVENTS: {
    BASE_CHANCE: 0.38,           // daily roll once any event type is unlocked
    PITY_MAX_DRY: 4,             // guaranteed event within this many dry days
    DEFS: {
      rush:      { label: 'Rush Hour',        icon: '🔥',
                   blurb: 'A mid-day surge — quicker arrivals, thinner patience, +25% on every order.',
                   payMult: 1.25, patienceMult: 0.72, gapMult: 0.55, extraCustomers: 3 },
      critic:    { label: 'Food Critic',      icon: '🧐',
                   blurb: 'A reviewer eats here today. Their write-up moves stars — both ways.',
                   graceSat: 90, failSat: 60, reward: 45, footfallBoost: 2 },
      shortage:  { label: 'Supply Shortage',  icon: '📦',
                   blurb: 'The market ran dry — one ingredient restocks at triple price tonight.',
                   priceMult: 3 },
      festival:  { label: 'Street Festival',  icon: '🎪',
                   blurb: 'Crowds, music, appetites. More customers, more sides, party prices.',
                   extraCustomers: 4, sideChanceAdd: 0.25, recipeChanceAdd: 0.12, payMult: 1.1 },
      slow:      { label: 'Slow Morning',     icon: '🌤',
                   blurb: 'A quiet one: few customers, deep patience, big fussy orders that pay.',
                   customersMult: 0.55, patienceMult: 1.5, payMult: 1.15, bigOrders: true },
      inspector: { label: 'Health Inspector', icon: '📋',
                   blurb: 'An audit mid-service: counter mess and empty bins go in the report.',
                   maxSplats: 4, reward: 40 },
      nonna:     { label: "Nonna's Visit",    icon: '👵',
                   blurb: 'Nonna is coming. She judges kindly, tips like a legend, misses nothing.',
                   graceSat: 85, tipMult: 3 },
      delivery:  { label: 'Surprise Delivery', icon: '🚚',
                   blurb: 'A supplier mix-up in your favour: free stock this morning. It won’t keep forever.',
                   kinds: 3, unitsMin: 8, unitsMax: 14 },
    },
    // seasonal mood: multiplies an event's roll weight during a season
    SEASON_WEIGHTS: {
      spring: { critic: 1.6, delivery: 1.4 },
      summer: { festival: 2.2, rush: 1.4 },
      spooky: { slow: 1.6, shortage: 1.5 },
      winter: { nonna: 1.8, delivery: 1.4 },
    },
  },

  // ---- Seasons — a rolling year; everything comes back --------------------------
  SEASONS: {
    LENGTH: 9,                   // days per season → 36-day year
    ORDER: ['spring', 'summer', 'spooky', 'winter'],
    LIST: {
      spring: { label: 'Spring Bloom',  icon: '🌸', accent: '#e8b4c8', toppings: ['basil'],       recipe: 'margheritafresca' },
      summer: { label: 'Summer Fest',   icon: '🌞', accent: '#f5c542', toppings: ['cherrytomato'], recipe: 'estiva' },
      spooky: { label: 'Spooky Season', icon: '🎃', accent: '#e07b39', toppings: ['pumpkin'],     recipe: 'jackolantern' },
      winter: { label: 'Winter Lights', icon: '❄️', accent: '#9fc6e8', toppings: ['cranberry'],   recipe: 'festivefeast' },
    },
    LENT_STOCK: 10,              // seasonal toppings arrive with this much stock
  },

  // ---- Phone pre-orders -----------------------------------------------------------
  PREORDER: {
    PREMIUM: 0.25,               // pre-orders pay this much extra
    OFFER_CHANCE: 0.85,          // chance each unlocked slot gets an offer today
    DUE_AFTER: [3, 6, 9],        // due after this many customers (slot 1/2/3)
    GRACE: 22,                   // (s) at the counter before lateness stings
    LATE_SAT_PER_SEC: 0.7,       // satisfaction lost per second past grace
    LATE_SAT_MAX: 22,            // …capped here
    PATIENCE_SCALE: 0.85,        // they expected it ready — slightly less patient
  },

  // ---- Basics (dough / sauce base / cheese) — V3 stocked ingredients ------
  // Consumed 1 unit per pizza (flat, any size — forecasting stays "units ≈
  // pizzas"). Never block the build: at 0 stock each use auto-charges an
  // emergency corner-shop run at EMERGENCY_MULT × unit price.
  BASICS: {
    dough:  { label: 'Dough',      unit: 0.30, dot: '#f5e2b4', shelf: 3 },
    sauce:  { label: 'Sauce base', unit: 0.18, dot: '#c23a1c', shelf: 5 },
    cheese: { label: 'Mozzarella', unit: 0.26, dot: '#f7d774', shelf: 4 },
  },

  // ---- Quality grades (V3) -------------------------------------------------
  // Chosen per graded ingredient in the restock screen; stamps the batches
  // bought (batches remember their grade — no retroactive switching).
  // satBonus = satisfaction points per order that consumed that grade.
  // shelfDelta = premium perishables spoil sooner.
  GRADES: {
    budget:   { label: 'Budget',   costMult: 0.7, satBonus: -2, shelfDelta: 0 },
    standard: { label: 'Standard', costMult: 1.0, satBonus: 0,  shelfDelta: 0 },
    premium:  { label: 'Premium',  costMult: 1.6, satBonus: 3,  shelfDelta: -1 },
  },
  GRADED: ['cheese', 'sauce', 'pepperoni', 'mushroom'],  // which keys have grades

  // ---- Chef XP & levels (V3 progression spine) -----------------------------
  XP: {
    BASE: 6,                        // per served order
    PER_TYPE: 2,                    // + per topping type on the ticket
    SIZE_BONUS: { S: 0, M: 1, L: 3 },
    ACC_FLOOR: 0.25,                // xp mult at 0 accuracy…
    ACC_CURVE: 2.2,                 // …rising as (acc/100)^curve to 1
    PERFECT_BONUS: 6,               // flat, on a perfect pizza
    SIDE_BONUS: 3,                  // a served side adds a little
    GOAL: 14, MILESTONE: 20, EVENT: 18, PREORDER: 8, CRITIC_A: 30,
    // XP needed to go from level n to n+1 (index 0 = L1→L2). 29 steps → L30.
    CURVE: [35, 55, 70, 85, 95, 105, 115, 125, 135, 145,
            155, 160, 165, 170, 175, 180, 185, 190, 195, 200,
            205, 210, 215, 220, 225, 230, 235, 240, 245],
    LEVEL_CASH_BASE: 6,             // level-up cash bonus = base + per × level
    LEVEL_CASH_PER: 2,
  },

  // ---- The unlock table — V3's drip-feed engine -----------------------------
  // XP unlocks the RIGHT to buy; money still does the buying. One declarative
  // list: level → what opens. kinds: topping | sizeL | side | sauce | crust |
  // recipe | upgradeTier (tier N of an equipment line) | equipment (new gear)
  // | grades | event | customer | modifier | halfhalf | group | preorder |
  // decorTier | system | capstone. Anything NOT in this table is open at L1
  // (pepperoni, mushroom, S/M, tomato sauce, classic crust, tier-1 tools).
  UNLOCKS: [
    { level: 2,  kind: 'topping', id: 'onion',        label: 'Onion',            blurb: 'A new bin on the counter — buy it in the shop.' },
    { level: 3,  kind: 'side', id: 'garlicbread',     label: 'Garlic Bread',     blurb: 'A toaster for the counter: quick, high-margin add-on orders.' },
    { level: 3,  kind: 'upgradeTier', id: 'supply', tier: 1, label: 'Supply Deals I', blurb: 'Bulk paper — restock discounts open up.' },
    { level: 4,  kind: 'topping', id: 'olive',        label: 'Olive',            blurb: 'Hardy, keeps for ages — a forgiving bin to manage.' },
    { level: 5,  kind: 'sizeL',  id: 'sizeL',         label: 'Large Pizzas',     blurb: 'The big dough. Large orders pay the most.' },
    { level: 5,  kind: 'customer', id: 'moods',       label: 'New Faces',        blurb: 'Impatient and easy-going locals start queuing — read the queue at a glance.' },
    { level: 6,  kind: 'grades', id: 'grades',        label: 'Supplier Grades',  blurb: 'Budget / Standard / Premium supply for key ingredients — margins vs. delight.' },
    { level: 6,  kind: 'system', id: 'loyalty',       label: 'Loyalty Cards',    blurb: 'Regulars now carry a stamp card. Nail their order to fill it.' },
    { level: 7,  kind: 'topping', id: 'pepper',       label: 'Green Pepper',     blurb: 'Fresh and fussy — spoils fast, sells well.' },
    { level: 7,  kind: 'upgradeTier', id: 'oven',   tier: 2, label: 'Stone Oven II',    blurb: 'Second oven tier is on the market.' },
    { level: 7,  kind: 'upgradeTier', id: 'ladle',  tier: 2, label: 'Sauce Ladle II',   blurb: 'Steadier pour near the band.' },
    { level: 7,  kind: 'upgradeTier', id: 'shaker', tier: 2, label: 'Cheese Shaker II', blurb: 'Steadier hand near the band.' },
    { level: 7,  kind: 'upgradeTier', id: 'tongs',  tier: 2, label: 'Topping Tongs II', blurb: 'Neat-grid snapping.' },
    { level: 7,  kind: 'event', id: 'rush',           label: 'Rush Hour',        blurb: 'Some days bring a surge — tighter patience, fatter payouts.' },
    { level: 8,  kind: 'topping', id: 'sweetcorn',    label: 'Sweetcorn',        blurb: 'Cheap, cheerful, keeps well.' },
    { level: 8,  kind: 'upgradeTier', id: 'decor', tier: 2, label: 'Decor: Plants & Art', blurb: 'The shop can grow warmer.' },
    { level: 8,  kind: 'recipe', id: 'doubledouble',  label: 'Specialty: Double Double', blurb: 'Your first named pizza — a pepperoni monument. Specialties pay a premium.' },
    { level: 8,  kind: 'system', id: 'mastery',       label: 'Recipe Mastery',   blurb: 'Perfect a specialty enough times and it earns stars — and charges more.' },
    { level: 9,  kind: 'sauce', id: 'bbq',            label: 'BBQ Sauce',        blurb: 'A second base — click the pot to switch. Watch the ticket.' },
    { level: 9,  kind: 'upgradeTier', id: 'supply', tier: 2, label: 'Supply Deals II', blurb: 'Local farm deal.' },
    { level: 9,  kind: 'event', id: 'critic',         label: 'The Food Critic',  blurb: 'A sharp-eyed visitor whose review swings your stars — both ways.' },
    { level: 9,  kind: 'customer', id: 'tourist',     label: 'Tourists',         blurb: 'Camera-toting visitors who pay a little extra and love specialties.' },
    { level: 9,  kind: 'system', id: 'seasons',       label: 'The Calendar',     blurb: 'Seasons turn: rotating ingredients and moods. Everything comes back around.' },
    { level: 10, kind: 'topping', id: 'ham',          label: 'Ham',              blurb: 'A deli staple with steady demand.' },
    { level: 10, kind: 'side', id: 'drinks',          label: 'Drinks Fridge',    blurb: 'Pour to the line. Pure margin.' },
    { level: 10, kind: 'recipe', id: 'meatfeast',     label: 'Specialty: Meat Feast', blurb: 'The carnivore classic.' },
    { level: 11, kind: 'crust', id: 'thin',           label: 'Thin Crust',       blurb: 'Bakes faster — watch the meter.' },
    { level: 11, kind: 'modifier', id: 'modsA',       label: 'Special Requests', blurb: '“No cheese”, “easy on the sauce” — read the ticket twice.' },
    { level: 11, kind: 'preorder', id: 'preorder1',   label: 'Phone Pre-orders', blurb: 'Accept a known ticket at day start, due mid-service, at a premium.' },
    { level: 12, kind: 'topping', id: 'pineapple',    label: 'Pineapple',        blurb: 'Divisive. Profitable.' },
    { level: 12, kind: 'recipe', id: 'veggiesupreme', label: 'Specialty: Veggie Supreme', blurb: 'The garden, delivered.' },
    { level: 13, kind: 'upgradeTier', id: 'oven',   tier: 3, label: 'Master Oven',      blurb: 'Huge zones.' },
    { level: 13, kind: 'upgradeTier', id: 'ladle',  tier: 3, label: 'Pro Ladle',        blurb: 'Pinpoint control.' },
    { level: 13, kind: 'upgradeTier', id: 'shaker', tier: 3, label: 'Blizzard Shaker',  blurb: 'Fast & precise.' },
    { level: 13, kind: 'upgradeTier', id: 'tongs',  tier: 3, label: 'Master Tongs',     blurb: 'Double-grab.' },
    { level: 13, kind: 'equipment', id: 'proofer',    label: 'Dough Proofer',    blurb: 'The next base proofs itself while you work — dough becomes one click.' },
    { level: 13, kind: 'event', id: 'festival',       label: 'Street Festival',  blurb: 'Festival days: big crowds, party mood, sides flying.' },
    { level: 14, kind: 'topping', id: 'chilli',       label: 'Chilli',           blurb: 'Heat sells to the brave.' },
    { level: 14, kind: 'halfhalf', id: 'halfhalf',    label: 'Half-and-Half',    blurb: 'Two tastes, one pizza — placement counts per side.' },
    { level: 14, kind: 'upgradeTier', id: 'decor', tier: 3, label: 'Decor: Full Refit', blurb: 'The big renovation.' },
    { level: 15, kind: 'topping', id: 'bacon',        label: 'Bacon',            blurb: 'Smoky, popular, premium-tier margins.' },
    { level: 15, kind: 'upgradeTier', id: 'supply', tier: 3, label: 'Supply Deals III', blurb: 'Wholesale account.' },
    { level: 15, kind: 'recipe', id: 'hawaiian',      label: 'Specialty: Hawaiian Classic', blurb: 'Ham. Pineapple. Courage.' },
    { level: 16, kind: 'sauce', id: 'white',          label: 'White Base',       blurb: 'Garlic cream — a third pot on the counter.' },
    { level: 16, kind: 'event', id: 'shortage',       label: 'Supply Shortages', blurb: 'Some mornings the market runs dry — forecast around it.' },
    { level: 16, kind: 'modifier', id: 'modsB',       label: 'Fussier Requests', blurb: '“Double sauce”, “extra well-done” — autopilot beware.' },
    { level: 17, kind: 'topping', id: 'spinach',      label: 'Spinach',          blurb: 'Delicate — barely keeps two days.' },
    { level: 17, kind: 'group', id: 'group2',         label: 'Group Orders',     blurb: 'One ticket, two pizzas, one big payout.' },
    { level: 18, kind: 'equipment', id: 'dispenser',  label: 'Sauce Auto-Dispenser', blurb: 'Calibrate it each morning; it pours, you confirm.' },
    { level: 18, kind: 'upgradeTier', id: 'decor', tier: 4, label: 'Decor: Gallery Wall', blurb: 'Neighbourhood art, warmer light — and better tips.' },
    { level: 18, kind: 'recipe', id: 'firebreather',  label: 'Specialty: Fire Breather', blurb: 'BBQ base, chilli, no survivors.' },
    { level: 19, kind: 'topping', id: 'meatball',     label: 'Meatball',         blurb: 'Hearty pieces, heavyweight margins.' },
    { level: 19, kind: 'customer', id: 'vip',         label: 'VIP Guests',       blurb: 'Gold coats, short tempers, enormous tips. Their word carries.' },
    { level: 20, kind: 'crust', id: 'stuffed',        label: 'Stuffed Crust',    blurb: 'Slower bake, premium price.' },
    { level: 20, kind: 'preorder', id: 'preorder2',   label: 'Second Phone Line', blurb: 'Take two pre-orders per day.' },
    { level: 21, kind: 'topping', id: 'anchovy',      label: 'Anchovy',          blurb: 'Loved by the few, loudly.' },
    { level: 21, kind: 'recipe', id: 'farmhouse',     label: 'Specialty: Farmhouse', blurb: 'White base, bacon, mushroom, sweetcorn.' },
    { level: 22, kind: 'equipment', id: 'hopper',     label: 'Cheese Hopper',    blurb: 'Calibrated cheese, hands-free — you confirm.' },
    { level: 22, kind: 'upgradeTier', id: 'supply', tier: 4, label: 'Supply Deals IV', blurb: 'Importer contract.' },
    { level: 22, kind: 'event', id: 'slow',           label: 'Slow Mornings',    blurb: 'Quiet days: fewer, patient customers with big fussy orders.' },
    { level: 23, kind: 'topping', id: 'prosciutto',   label: 'Prosciutto',       blurb: 'Exotic tier: fragile, expensive, glorious.' },
    { level: 23, kind: 'group', id: 'group3',         label: 'Bigger Groups',    blurb: 'Three-pizza tickets for the brave.' },
    { level: 23, kind: 'upgradeTier', id: 'decor', tier: 5, label: 'Decor: Terrazzo & Brass', blurb: 'The shop starts looking like an institution.' },
    { level: 24, kind: 'topping', id: 'artichoke',    label: 'Artichoke',        blurb: 'The connoisseur’s choice.' },
    { level: 24, kind: 'event', id: 'inspector',      label: 'Health Inspector', blurb: 'Mess and empty bins get audited. Keep the counter clean.' },
    { level: 25, kind: 'equipment', id: 'oven2',      label: 'THE SECOND OVEN',  blurb: 'Two slots. Build the next while one bakes. Everything changes.' },
    { level: 25, kind: 'recipe', id: 'oceancatch',    label: 'Specialty: Ocean Catch', blurb: 'Anchovy, olive, artichoke — the harbour on a base.' },
    { level: 26, kind: 'topping', id: 'goatcheese',   label: 'Goat Cheese',      blurb: 'Tangy dollops, tiny shelf life.' },
    { level: 26, kind: 'event', id: 'nonna',          label: 'Nonna’s Visit',    blurb: 'She judges kindly, tips like a legend, and misses nothing.' },
    { level: 27, kind: 'topping', id: 'sundried',     label: 'Sun-dried Tomato', blurb: 'Intense little suns.' },
    { level: 27, kind: 'equipment', id: 'rail',       label: 'Ticket Rail',      blurb: 'See the NEXT order coming — plan two moves ahead.' },
    { level: 27, kind: 'upgradeTier', id: 'decor', tier: 6, label: 'Decor: The Landmark', blurb: 'People photograph the front door now.' },
    { level: 28, kind: 'topping', id: 'truffle',      label: 'Truffle',          blurb: 'The crown jewel. Handle with reverence.' },
    { level: 28, kind: 'recipe', id: 'latruffa',      label: 'Specialty: La Truffa', blurb: 'Truffle, goat cheese, spinach on white. The endgame pizza.' },
    { level: 29, kind: 'preorder', id: 'preorder3',   label: 'Third Phone Line', blurb: 'Three pre-orders a day, for the fearless forecaster.' },
    { level: 29, kind: 'event', id: 'delivery',       label: 'Surprise Deliveries', blurb: 'Free stock some mornings… use it before it turns.' },
    { level: 30, kind: 'capstone', id: 'goldenbell',  label: 'The Golden Bell',  blurb: 'A gilded bell for a proven chef. Rings a little richer (+2% tips).' },
  ],
  CAPSTONE_TIP_BONUS: 0.02,        // golden bell: flat tip-fraction bonus

  // ---- Stock / restock -----------------------------------------------------
  STOCK: {
    START: 24,                   // starting stock per starter topping
    START_BASICS: 40,            // starting dough/sauce/cheese units
    NEW_TOPPING_INCLUDED: 20,    // stock included when a topping is unlocked
    LOW_AT: 6,                   // low-stock warning threshold (amber)
    LOW_AT_BASICS: 8,            // basics warn a little earlier
    BUY_AMOUNTS: [5, 20],        // restock button quantities (toppings)
    BUY_AMOUNTS_BASICS: [10, 30],// restock button quantities (basics)
    EMERGENCY_MULT: 2.5,         // basics at 0 stock: auto-charge unit × this
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
    { id: 'toppings8',   label: 'Stock 8 topping bins',       stat: 'toppingsOwned', target: 8,    reward: 110 },
    { id: 'allToppings', label: 'Unlock every topping',       stat: 'toppingsOwned', target: 18,   reward: 420 },
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

// Any stocked ingredient's definition (toppings, basics, side stock…)
export function ING(key) {
  return BAL.TOPPINGS[key] || BAL.BASICS[key] || (BAL.SIDE_STOCK && BAL.SIDE_STOCK[key]) || null;
}
