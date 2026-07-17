// services/scoringService.js
// Core ranking logic for MacroMenu.
//
// Design goals:
//   1. Simple and explainable. Every score can be described in plain English,
//      and no explanation may ever contradict the item's own macros.
//   2. Protein-to-calorie efficiency is the backbone of the score.
//   3. Structured so that future "custom macro priorities" (let the user weight
//      protein / carbs / fat / calories themselves) can be added without
//      rewriting the ranking engine — see WEIGHTS and GOAL_PRESETS.
//
// The public entry point is rankMeals(meals, goal).
//
// The score is built in three stages, in this order:
//
//   base score  =  50%  protein-to-calorie efficiency
//                  25%  goal fit
//                  12.5%  total protein
//                  12.5%  macro balance
//
//   penalties   =  multiplicative, for meals that are structurally poor fits
//                  (very high calorie with weak protein, poor protein ratio)
//
//   caps        =  hard ceilings, for meals that barely qualify as an entree
//                  (low protein, implausibly low calories)
//
// Penalties scale a score down proportionally; caps put a lid on it. Caps run
// last so that nothing can lift a 12g-protein item back over its ceiling.

// ---------------------------------------------------------------------------
// Tuning constants — the knobs you'd actually turn
// ---------------------------------------------------------------------------

// Ratio at which the efficiency SCORE maxes out at a perfect 1.0. Set above
// what a merely-good entree hits (~0.08-0.10) so two meals that are both
// "excellent" still separate on the highest-weighted component instead of
// both flattening to 1.0 — that flattening is exactly what let a
// 0.101-ratio sandwich outrank a 0.119-ratio salad on calorie-fit and
// balance tie-breakers alone, when the ratio itself should have decided it.
const EXCELLENT_PROTEIN_RATIO = 0.16;

// Ratio at which a meal earns the "Protein Efficient" badge. Kept separate
// from the scoring ceiling above so the badge still fires at a realistic,
// commonly-achievable bar rather than requiring a near-max ratio.
const PROTEIN_EFFICIENT_BADGE_RATIO = 0.085;

// Below this, the meal is mostly calories with protein as an afterthought.
const POOR_PROTEIN_RATIO = 0.04;

// Protein at or above this earns full marks on the total-protein component.
const FULL_PROTEIN_G = 50;

// Guardrail thresholds. See applyCaps().
const LOW_PROTEIN_G = 20; // "this is light on protein"
const VERY_LOW_PROTEIN_G = 15; // "this probably isn't a protein-forward meal"
const LOW_PROTEIN_CAP = 65;
const VERY_LOW_PROTEIN_CAP = 45;

// An "entree" under this many calories is more likely a side or a small salad
// than a meal. We don't exclude it, we just stop trusting it as a top pick —
// unless its protein already clears a full meal's worth, in which case the
// low-calorie count was never the problem it was flagging.
const LOW_CALORIE_ENTREE = 300;
const LOW_CALORIE_CAP = 75;
const LOW_CALORIE_PROTEIN_EXEMPTION_G = 30;

// Exported so tests can assert a capped meal sits exactly at its ceiling,
// rather than hardcoding the numbers in two places.
export const GUARDRAILS = {
  LOW_PROTEIN_G,
  VERY_LOW_PROTEIN_G,
  LOW_PROTEIN_CAP,
  VERY_LOW_PROTEIN_CAP,
  LOW_CALORIE_ENTREE,
  LOW_CALORIE_CAP,
  LOW_CALORIE_PROTEIN_EXEMPTION_G
};

// Penalty thresholds. See applyPenalties().
const HIGH_CALORIE = 800;
const HIGH_CAL_WEAK_PROTEIN_RATIO = 0.05;
const HIGH_CAL_WEAK_PROTEIN_PENALTY = 0.75;
const POOR_RATIO_PENALTY = 0.8;

// Fat Quality Guardrail — the only place fat affects the score (not Goal Fit;
// see scoreGoalFit's cut branch). Below the goal's threshold, fat costs
// nothing at all; above it, the penalty scales with how far over, capped at
// the Balance component's own weight so fat alone can never swing the score
// more than balance itself could.
const FAT_TO_PROTEIN_EXTREME = {
  cut: 1.2,
  maintain: 1.5,
  bulk: 1.8
};
const MAX_FAT_PENALTY = 0.125; // matches the balance component's weight
const FAT_PENALTY_FULL_AT_EXCESS = 1.0; // ratio-over-threshold that maxes out the penalty

// Bulk's Goal Fit blends "calories the protein earns" with carb adequacy.
// Carbs should nudge the score, not outweigh a real protein-efficiency edge —
// see the Efficiency Override Principle in the docs.
const BULK_CALORIE_PROTEIN_WEIGHT = 0.75;
const BULK_CARB_WEIGHT = 0.25;

// A `balance` sub-score at or above this reads as a genuinely even macro split.
const BALANCED_ENOUGH = 0.6;

// Higher bar for the "Balanced" badge than for the prose. At 0.75 the badge
// landed on two-thirds of the sample menu, which tells the user nothing.
const BALANCED_BADGE_MIN = 0.85;

// A meal only reads as "high calorie for this goal" once it clears the target
// by half the tolerance band. Anything closer is just "in range" — calling a
// 500 cal plate a higher-calorie choice for a 450 cal target is noise.
function notablyAboveTarget(meal, preset) {
  return meal.calories > preset.idealCalories + preset.calorieTolerance / 2;
}

// Protein that justifies the word "strong" rather than merely "adequate".
const STRONG_PROTEIN_G = 35;

// Macro shares past which a meal reads as fat- or carb-forward.
const FAT_FORWARD_SHARE = 0.45;
const CARB_FORWARD_SHARE = 0.5;

// ---------------------------------------------------------------------------
// Component weights
// ---------------------------------------------------------------------------
// These sum to 1.0 and are goal-independent: every goal cares most about
// protein efficiency. What changes per goal is the *goalFit* component itself.
//
// Protein efficiency is deliberately weighted at ~2x the next-largest
// component (not just "largest") — it should decide close calls, not merely
// tilt them. See EXCELLENT_PROTEIN_RATIO for the matching fix that stops the
// efficiency score itself from flattening two good-but-different ratios.
//
// This object is the seam for future custom macro priorities — a user profile
// would supply its own weights here without any change to scoreMeal().
export const WEIGHTS = {
  proteinEfficiency: 0.5,
  goalFit: 0.25,
  totalProtein: 0.125,
  balance: 0.125
};

// ---------------------------------------------------------------------------
// Goal presets
// ---------------------------------------------------------------------------
// Goals are data, not branches. Each supplies its calorie target and how
// asymmetric the miss is: overshooting hurts a cut, undershooting hurts a bulk.
export const GOAL_PRESETS = {
  cut: {
    label: "Cut",
    idealCalories: 450,
    calorieTolerance: 250,
    overPenalty: 1.4, // going over target is the failure mode when cutting
    underPenalty: 0.6,
    minProtein: 30
  },
  maintain: {
    label: "Maintain",
    idealCalories: 600,
    calorieTolerance: 250,
    overPenalty: 1.0, // drifting either way is equally off
    underPenalty: 1.0,
    minProtein: 25
  },
  bulk: {
    label: "Bulk",
    idealCalories: 750,
    calorieTolerance: 300,
    overPenalty: 0.6,
    underPenalty: 1.5, // falling short of calories is the failure mode
    minProtein: 30
  }
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// Ramp from 1 down to 0 as `value` travels from `good` to `bad`.
// Works in either direction (good may be above or below bad).
function ramp(value, good, bad) {
  if (good === bad) return value <= good ? 1 : 0;
  return clamp01((bad - value) / (bad - good));
}

function proteinRatio(meal) {
  return meal.calories > 0 ? meal.protein_g / meal.calories : 0;
}

function fatToProteinRatio(meal) {
  return meal.protein_g > 0 ? meal.fat_g / meal.protein_g : Infinity;
}

// Share of total calories contributed by each macro. Uses 4/4/9 kcal per gram.
// Derived from the macros, not from meal.calories, so the shares always sum to 1
// even when a menu's stated calorie count doesn't reconcile with its macros.
function macroShares(meal) {
  const p = meal.protein_g * 4;
  const c = meal.carbs_g * 4;
  const f = meal.fat_g * 9;
  const total = p + c + f;
  if (total <= 0) return { protein: 0, carbs: 0, fat: 0 };
  return { protein: p / total, carbs: c / total, fat: f / total };
}

// ---------------------------------------------------------------------------
// Components — each returns 0..1
// ---------------------------------------------------------------------------

// 50%. Protein per calorie, normalized against an excellent ratio. This is
// the backbone of the score — see EXCELLENT_PROTEIN_RATIO for why it isn't
// capped at a merely-good ratio.
function scoreProteinEfficiency(meal) {
  return clamp01(proteinRatio(meal) / EXCELLENT_PROTEIN_RATIO);
}

// 15%. Absolute protein, so a genuinely big protein plate is rewarded even if
// its ratio is unremarkable.
function scoreTotalProtein(meal) {
  return clamp01(meal.protein_g / FULL_PROTEIN_G);
}

// 15%. Rewards meals that aren't dominated by excess carbs or fat. A high
// protein share is never penalized here — protein dominance is the point of
// a protein-efficiency-first ranking, not an imbalance to correct for. Only
// a protein *shortfall*, or a carb/fat *excess*, counts against the score.
function scoreBalance(meal) {
  const shares = macroShares(meal);
  if (shares.protein === 0 && shares.carbs === 0 && shares.fat === 0) return 0;

  const ideal = 1 / 3;
  const proteinDeviation = Math.max(0, ideal - shares.protein);
  const carbDeviation = Math.max(0, shares.carbs - ideal);
  const fatDeviation = Math.max(0, shares.fat - ideal);
  const deviation = (proteinDeviation + carbDeviation + fatDeviation) / 3;
  return clamp01(1 - deviation / ideal);
}

// How close the calories are to the goal's target, with an asymmetric falloff.
function scoreCalorieFit(meal, preset) {
  const diff = meal.calories - preset.idealCalories;
  const direction = diff >= 0 ? preset.overPenalty : preset.underPenalty;
  const distance = Math.abs(diff) * direction;
  return clamp01(1 - distance / (preset.calorieTolerance * 2));
}

// 30%. Goal fit is the only component whose meaning changes per goal.
//
//   cut:      right calorie range only — fat is scored once, in the shared
//             Fat Quality Guardrail (applyPenalties), not here. Folding it
//             into Goal Fit too would double-penalize the same signal and
//             can override a real protein-efficiency advantage.
//   maintain: right calorie range + no extreme carb/fat share
//   bulk:     enough calories (gated on protein) + adequate carbs
function scoreGoalFit(meal, goal, preset) {
  const calorieFit = scoreCalorieFit(meal, preset);
  const shares = macroShares(meal);

  if (goal === "cut") {
    return calorieFit;
  }

  if (goal === "bulk") {
    // Calories only "count" for a bulk to the extent the meal carries protein.
    // This is what stops a 900 cal, 15g protein plate from acing goal fit.
    const proteinGate = clamp01(meal.protein_g / preset.minProtein);
    // Carbs at ~30%+ of calories are adequate to fuel training. Weighted
    // below calorieFit*proteinGate so carb adequacy can nudge close calls
    // but can't outweigh a meal that clearly delivers more protein.
    const carbScore = clamp01(shares.carbs / 0.3);
    return (
      BULK_CALORIE_PROTEIN_WEIGHT * (calorieFit * proteinGate) +
      BULK_CARB_WEIGHT * carbScore
    );
  }

  // maintain: avoid extremes, but only on carbs/fat — a high protein share is
  // never the "extreme" this guards against.
  const maxNonProteinShare = Math.max(shares.carbs, shares.fat);
  const noSingleMacroDominates = ramp(maxNonProteinShare, 0.4, 0.55);
  const adequateProteinShare = clamp01(shares.protein / 0.25);
  const noExtremes = 0.5 * noSingleMacroDominates + 0.5 * adequateProteinShare;
  return 0.6 * calorieFit + 0.4 * noExtremes;
}

// ---------------------------------------------------------------------------
// Penalties and caps
// ---------------------------------------------------------------------------

// Multiplicative. Applied to the weighted base score.
function applyPenalties(score, meal, goal) {
  const ratio = proteinRatio(meal);
  const applied = [];
  let out = score;

  // A big plate that doesn't deliver protein isn't a good pick for any goal —
  // including bulk, where calories alone must not buy a high score.
  if (meal.calories >= HIGH_CALORIE && ratio < HIGH_CAL_WEAK_PROTEIN_RATIO) {
    out *= HIGH_CAL_WEAK_PROTEIN_PENALTY;
    applied.push("highCalorieWeakProtein");
  }

  // Poor protein-to-calorie ratio, at any calorie level.
  if (ratio < POOR_PROTEIN_RATIO) {
    out *= POOR_RATIO_PENALTY;
    applied.push("poorProteinRatio");
  }

  // Fat Quality Guardrail. Below the goal's threshold, fat costs nothing —
  // two meals with the same calories and protein but very different fat
  // should score close to equal as long as neither is in extreme territory.
  const fatRatio = fatToProteinRatio(meal);
  const fatThreshold = FAT_TO_PROTEIN_EXTREME[goal] ?? FAT_TO_PROTEIN_EXTREME.maintain;
  if (fatRatio > fatThreshold) {
    const excess = fatRatio - fatThreshold;
    const penaltyFraction = Math.min(
      MAX_FAT_PENALTY,
      (excess / FAT_PENALTY_FULL_AT_EXCESS) * MAX_FAT_PENALTY
    );
    out *= 1 - penaltyFraction;
    applied.push("extremeFatToProtein");
  }

  return { score: out, applied };
}

// Hard ceilings. Run last so a penalty can't be "escaped" by a high base score.
//
// `applied` lists every ceiling this meal is SUBJECT TO, not merely the ones
// that happened to bind. A 12g-protein meal scoring 30 is still governed by the
// very-low-protein cap; reporting nothing there would make the guardrail
// invisible exactly when it matters most.
function applyCaps(score, meal) {
  const applied = [];
  let out = score;

  const cap = (limit, name) => {
    applied.push(name);
    out = Math.min(out, limit);
  };

  // Protein ceilings are mutually exclusive — the under-15g rule is the
  // stricter of the two, so it takes precedence.
  if (meal.protein_g < VERY_LOW_PROTEIN_G) cap(VERY_LOW_PROTEIN_CAP, "veryLowProtein");
  else if (meal.protein_g < LOW_PROTEIN_G) cap(LOW_PROTEIN_CAP, "lowProtein");

  // Suspiciously light for an entree — could be a side masquerading as a
  // meal. But if the protein already clears a full meal's worth, the low
  // calorie count isn't the problem this cap exists to catch.
  if (
    meal.calories < LOW_CALORIE_ENTREE &&
    meal.protein_g < LOW_CALORIE_PROTEIN_EXEMPTION_G
  ) {
    cap(LOW_CALORIE_CAP, "lowCalorieForEntree");
  }

  return { score: out, applied };
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------
// Short, factual tags. Each must be defensible straight from the macros — a
// badge that can't be justified by the numbers is worse than no badge.
// "Best Match" is not decided here; rankMeals awards it to the top result.

export const BADGES = {
  BEST_MATCH: "Best Match",
  SIDE: "Side dish",
  PROTEIN_EFFICIENT: "Protein Efficient",
  HIGH_PROTEIN: "High Protein",
  LEAN_PICK: "Lean Pick",
  BALANCED: "Balanced",
  BETTER_FOR_BULK: "Better for Bulk",
  CALORIE_DENSE: "Calorie Dense"
};

// Keep the card readable — show at most this many, in priority order.
const MAX_BADGES = 3;

function buildBadges(meal, goal, components) {
  const ratio = proteinRatio(meal);
  const shares = macroShares(meal);
  const badges = [];

  if (meal.protein_g >= 40) badges.push(BADGES.HIGH_PROTEIN);
  if (ratio >= PROTEIN_EFFICIENT_BADGE_RATIO) badges.push(BADGES.PROTEIN_EFFICIENT);
  if (meal.calories <= 500 && shares.fat <= 0.3) badges.push(BADGES.LEAN_PICK);
  if (components.balance >= BALANCED_BADGE_MIN) badges.push(BADGES.BALANCED);

  // Only suggest "Better for Bulk" when the user isn't already bulking —
  // on the bulk goal it would be noise.
  if (goal !== "bulk" && meal.calories >= 700 && meal.protein_g >= 30) {
    badges.push(BADGES.BETTER_FOR_BULK);
  }

  if (meal.calories >= 750) badges.push(BADGES.CALORIE_DENSE);

  return badges.slice(0, MAX_BADGES);
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------
// Rules:
//   - Never assert something the macros contradict. A 850 cal plate is not a
//     "lighter-calorie choice", however little protein it has.
//   - Describe the food, never judge the eater. No "bad", "cheat", "clean".

function buildExplanation(meal, goal, preset, components) {
  const ratio = proteinRatio(meal);
  const shares = macroShares(meal);
  const efficient = components.proteinEfficiency >= 0.85;
  const highCalories = notablyAboveTarget(meal, preset);
  const fatForward = shares.fat > FAT_FORWARD_SHARE;
  const carbForward = shares.carbs > CARB_FORWARD_SHARE;

  // Guardrail cases speak first — they're the reason the score is capped.
  if (meal.protein_g < LOW_PROTEIN_G) {
    if (meal.calories >= HIGH_CALORIE) {
      return "Calorie dense, with lower protein than ideal for this goal.";
    }
    return "Lower protein than ideal for this goal.";
  }

  if (meal.calories < LOW_CALORIE_ENTREE) {
    return "Light for a full meal — good protein, but you may want more with it.";
  }

  if (ratio < POOR_PROTEIN_RATIO) {
    return highCalories
      ? "Higher-calorie choice with a weak protein-to-calorie ratio."
      : "Modest protein for the calories it carries.";
  }

  if (goal === "cut") {
    if (efficient) return "High protein with a strong protein-to-calorie ratio.";
    if (fatForward) return "Solid protein, though it's fat-forward for a cut.";
    return highCalories
      ? "Good protein, but a higher-calorie choice for a cut."
      : "Lean pick with calories in a comfortable range for a cut.";
  }

  if (goal === "bulk") {
    const enoughCalories =
      meal.calories >= preset.idealCalories - preset.calorieTolerance / 2;
    if (enoughCalories) {
      // Don't call 34g at a 0.044 ratio "strong protein" just because the plate
      // is big. Adequate is the honest word there.
      return meal.protein_g >= STRONG_PROTEIN_G
        ? "Good bulk option with higher calories and strong protein."
        : "Good bulk option with plenty of calories and adequate protein.";
    }
    return efficient
      ? "Lean and protein-dense — pair it with a side to fuel a bulk."
      : "Solid protein, but light on calories for a bulk.";
  }

  // maintain. Ordered most-distinctive first so adjacent meals don't all get
  // the same sentence.
  if (efficient) return "High protein with a strong protein-to-calorie ratio.";
  if (components.balance >= BALANCED_BADGE_MIN) {
    return "Balanced macros with solid protein for maintaining.";
  }
  if (fatForward) return "Solid protein, though the macros lean toward fat.";
  if (carbForward) return "Solid protein with a carb-forward mix.";
  if (scoreCalorieFit(meal, preset) >= 0.8) {
    return "Calories sit near your baseline with solid protein.";
  }
  return components.balance >= BALANCED_ENOUGH
    ? "Reasonable maintain option with adequate protein."
    : "Reasonable maintain option, though the macros lean in one direction.";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score one meal for one goal.
 * @param {object} meal
 * @param {"cut"|"maintain"|"bulk"} goal
 * @param {object} [weights] override for future custom macro priorities
 * @returns {object} the meal plus { score, components, badges, explanation }
 */
export function scoreMeal(meal, goal, weights = WEIGHTS) {
  const preset = GOAL_PRESETS[goal] ?? GOAL_PRESETS.maintain;

  const components = {
    proteinEfficiency: scoreProteinEfficiency(meal),
    goalFit: scoreGoalFit(meal, goal, preset),
    totalProtein: scoreTotalProtein(meal),
    balance: scoreBalance(meal)
  };

  // Weighted base, 0..100.
  let score = 0;
  for (const key of Object.keys(weights)) {
    score += weights[key] * (components[key] ?? 0);
  }
  score *= 100;

  const penalties = applyPenalties(score, meal, goal);
  const caps = applyCaps(penalties.score, meal);

  return {
    ...meal,
    goal,
    score: Math.round(clamp01(caps.score / 100) * 100),
    components,
    penalties: penalties.applied,
    caps: caps.applied,
    badges: buildBadges(meal, goal, components),
    explanation: buildExplanation(meal, goal, preset, components)
  };
}

/**
 * Rank meals for a goal, best first. Drinks, desserts and pure condiments never
 * reach here (the extractor drops them). Sides/add-ons — a lobster tail, a
 * skewer of shrimp off an "elevate your plate" list — DO reach here, because a
 * lean one has genuinely good macros and the user asked to see them. They are
 * ranked among themselves and listed AFTER every real meal, each flagged with a
 * "Side dish" badge, so a side is never mistaken for the best meal.
 */
export function rankMeals(meals, goal) {
  // Deterministic ordering: score, then protein, then fewer calories.
  const byRank = (a, b) =>
    b.score - a.score || b.protein_g - a.protein_g || a.calories - b.calories;

  const scored = meals
    .filter((m) => m.category === "entree" || m.category === "side")
    .map((m) => scoreMeal(m, goal));

  const entrees = scored.filter((m) => m.category !== "side").sort(byRank);
  const sides = scored.filter((m) => m.category === "side").sort(byRank);

  // "Best Match" is a property of the ranking, not the meal — and only a real
  // meal can hold it.
  if (entrees.length > 0) {
    entrees[0].badges = [BADGES.BEST_MATCH, ...entrees[0].badges].slice(0, MAX_BADGES);
  }
  // Lead every side's badges with the label, so "this is a side, not a meal" is
  // the first thing read on the card.
  for (const side of sides) {
    side.badges = [BADGES.SIDE, ...side.badges].slice(0, MAX_BADGES);
  }

  return [...entrees, ...sides];
}
