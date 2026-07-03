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
  },
  SIZE_L_COST: 220,

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
    BUY_AMOUNTS: [5, 20],        // restock button quantities
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

// Any stocked ingredient's definition (toppings, basics, side stock…)
export function ING(key) {
  return BAL.TOPPINGS[key] || BAL.BASICS[key] || (BAL.SIDE_STOCK && BAL.SIDE_STOCK[key]) || null;
}
