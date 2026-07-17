// test/scoring.test.js
// Run with: npm test   (node --test, no dependencies)
//
// These tests are deliberately weighted toward INVARIANTS over exact numbers.
// Asserting "Grilled Chicken Bowl scores 91" would freeze a tuning decision you
// may still want to change; asserting "an explanation never contradicts the
// item's own macros" pins a property that must hold no matter how you tune.
//
// Exact-value assertions appear only where the requirement is about ordering.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  rankMeals,
  scoreMeal,
  BADGES,
  GOAL_PRESETS,
  GUARDRAILS
} from "../services/scoringService.js";
import { SAMPLE_MENU } from "../data/sampleMenu.js";

const GOALS = ["cut", "maintain", "bulk"];

// --- fixtures ---------------------------------------------------------------
// Purpose-built so each test isolates one variable.
const meal = (name, calories, protein_g, carbs_g, fat_g) => ({
  id: name.toLowerCase().replace(/\s+/g, "-"),
  name,
  description: "",
  category: "entree",
  calories,
  protein_g,
  carbs_g,
  fat_g,
  source: "Mock data",
  confidence: "high",
  estimated: false
});

const HIGH_PROTEIN_MODERATE = meal("High Protein Bowl", 500, 45, 45, 15);
const LOW_PROTEIN_SALAD = meal("Garden Salad", 320, 8, 30, 18);

// Same protein, very different calories — isolates protein-to-calorie ratio.
const LEAN_40G = meal("Lean 40g", 500, 40, 45, 15);
const HEAVY_40G = meal("Heavy 40g", 900, 40, 90, 40);

// Big plate, weak protein. Must not win a bulk on calories alone.
const CALORIE_BOMB = meal("Calorie Bomb", 1000, 18, 120, 45);
const SOLID_BULK = meal("Solid Bulk Plate", 750, 45, 70, 25);

const scoreOf = (m, goal) => scoreMeal(m, goal).score;
const rankNames = (meals, goal) => rankMeals(meals, goal).map((m) => m.name);

// ---------------------------------------------------------------------------
describe("ranking: the required behaviors", () => {
  test("a high-protein moderate-calorie meal ranks above a low-protein salad", () => {
    for (const goal of GOALS) {
      const order = rankNames([LOW_PROTEIN_SALAD, HIGH_PROTEIN_MODERATE], goal);
      assert.equal(order[0], "High Protein Bowl", `failed for goal=${goal}`);
    }
  });

  test("for cut, 40g/500cal ranks above 40g/900cal", () => {
    const order = rankNames([HEAVY_40G, LEAN_40G], "cut");
    assert.deepEqual(order, ["Lean 40g", "Heavy 40g"]);
    assert.ok(
      scoreOf(LEAN_40G, "cut") > scoreOf(HEAVY_40G, "cut"),
      "identical protein, fewer calories must score higher on a cut"
    );
  });

  test("bulk does not simply reward the highest-calorie item", () => {
    const order = rankNames([CALORIE_BOMB, SOLID_BULK], "bulk");
    assert.equal(order[0], "Solid Bulk Plate");

    // And against the real menu: the highest-calorie entree must not win bulk.
    const ranked = rankMeals(SAMPLE_MENU, "bulk");
    const fattest = [...SAMPLE_MENU].sort((a, b) => b.calories - a.calories)[0];
    assert.notEqual(
      ranked[0].name,
      fattest.name,
      "highest-calorie meal should not be the top bulk pick"
    );
  });

  test("low-protein meals are capped", () => {
    const sneaky = meal("Sneaky Low Protein", 600, 12, 60, 25);
    for (const goal of GOALS) {
      const result = scoreMeal(sneaky, goal);
      assert.ok(
        result.score <= 45,
        `goal=${goal}: expected <=45 (very-low-protein cap), got ${result.score}`
      );
      assert.ok(result.caps.includes("veryLowProtein"));
    }

    // Between the two thresholds: capped, but less aggressively.
    const mid = meal("Mid Low Protein", 600, 18, 60, 22);
    const midResult = scoreMeal(mid, "maintain");
    assert.ok(midResult.caps.includes("lowProtein"));
    assert.ok(midResult.score <= 65, `expected <=65, got ${midResult.score}`);
  });

  // The test above passes even with the cap removed, because 12g of protein
  // already tanks the weighted base score — it never proves the ceiling exists.
  // This fixture has an EXCELLENT protein ratio (14g / 150cal = 0.093), so its
  // base score clears 80. Only the cap can bring it down, and the proof that a
  // cap *binds* is that the score lands exactly on the ceiling.
  test("the very-low-protein cap actually binds on a protein-efficient item", () => {
    const tinyButEfficient = meal("Small Protein Plate", 150, 14, 10, 3);
    const result = scoreMeal(tinyButEfficient, "cut");

    assert.ok(result.caps.includes("veryLowProtein"), "cap should be recorded");
    assert.equal(
      result.score,
      GUARDRAILS.VERY_LOW_PROTEIN_CAP,
      "a high-base, very-low-protein meal must be pinned at the ceiling"
    );
  });

  test("the under-15g cap is strictly more aggressive than the under-20g cap", () => {
    // Identical apart from protein, both otherwise strong.
    const a = meal("18g", 600, 18, 55, 20);
    const b = meal("12g", 600, 12, 55, 20);
    assert.ok(scoreOf(a, "maintain") > scoreOf(b, "maintain"));
  });

  test("very low calories for an entree are treated cautiously", () => {
    // Excellent ratio (0.156, near the 0.16 efficiency ceiling), but 180 cal
    // is not a meal, and its protein (28g) is below the strong-protein
    // exemption. Its base score is well above 75, so landing exactly on the
    // ceiling proves the cap binds rather than just happening to match.
    const tiny = meal("Tiny Plate", 180, 28, 5, 4);
    const result = scoreMeal(tiny, "cut");

    assert.ok(result.caps.includes("lowCalorieForEntree"));
    assert.equal(
      result.score,
      GUARDRAILS.LOW_CALORIE_CAP,
      "a strong-but-tiny plate must be pinned at the low-calorie ceiling"
    );
  });

  // A meal light enough to trip the calorie floor should still be exempt from
  // the cap once its protein alone is a full meal's worth — the cap exists to
  // catch sides/snacks masquerading as entrees, not genuinely efficient ones.
  test("the low-calorie cap is skipped when protein already clears the bar", () => {
    const smallButStrong = meal("Small Protein Plate", 290, 36, 10, 6);
    const result = scoreMeal(smallButStrong, "cut");

    assert.ok(
      !result.caps.includes("lowCalorieForEntree"),
      "30g+ protein should exempt the meal from the low-calorie cap"
    );
    assert.ok(
      result.score > GUARDRAILS.LOW_CALORIE_CAP,
      `expected the meal to score above the cap (${GUARDRAILS.LOW_CALORIE_CAP}), got ${result.score}`
    );
  });

  // Directly pins the protein gate inside bulk's goalFit. Without the gate, a
  // 750 cal plate with 15g protein has a PERFECT calorie fit and adequate carbs,
  // so goalFit would be ~1.0 — calories alone buying a top-tier component score.
  test("bulk goal fit is gated on protein, not calories alone", () => {
    const bigWeak = meal("Big Weak Plate", 750, 15, 90, 25);
    const bigStrong = meal("Big Strong Plate", 750, 45, 70, 25);

    const weakFit = scoreMeal(bigWeak, "bulk").components.goalFit;
    const strongFit = scoreMeal(bigStrong, "bulk").components.goalFit;

    assert.ok(
      weakFit <= 0.75,
      `low-protein plate should not ace bulk goal fit, got ${weakFit.toFixed(2)}`
    );
    assert.ok(
      strongFit >= 0.9,
      `high-protein plate should ace bulk goal fit, got ${strongFit.toFixed(2)}`
    );
    assert.ok(strongFit > weakFit);
  });

  test("high calorie with weak protein is penalized", () => {
    const result = scoreMeal(CALORIE_BOMB, "bulk");
    assert.ok(result.penalties.includes("highCalorieWeakProtein"));
    assert.ok(result.penalties.includes("poorProteinRatio"));
  });

  // Naming a penalty is not applying one. These two meals straddle the 800 cal
  // threshold and are otherwise near-identical (same protein, ratio still under
  // 0.05, no caps triggered), so the score gap is the penalty and nothing else.
  test("the high-calorie weak-protein penalty actually lowers the score", () => {
    const justUnder = meal("Just Under", 790, 35, 90, 30);
    const justOver = meal("Just Over", 810, 35, 92, 31);

    const under = scoreMeal(justUnder, "bulk");
    const over = scoreMeal(justOver, "bulk");

    assert.deepEqual(under.penalties, [], "control meal must be unpenalized");
    assert.deepEqual(over.penalties, ["highCalorieWeakProtein"]);
    assert.deepEqual(under.caps, [], "control meal must be uncapped");
    assert.deepEqual(over.caps, []);

    assert.ok(
      over.score < under.score * 0.85,
      `penalty should visibly suppress the score: ${over.score} vs ${under.score}`
    );
  });

  // Same idea for the poor-ratio penalty. protein_g is exactly 20 in both, so
  // neither meal trips a protein cap; only the 0.04 ratio boundary differs.
  test("the poor protein-to-calorie penalty actually lowers the score", () => {
    const ratioOk = meal("Ratio OK", 480, 20, 55, 18); // ratio 0.0417
    const ratioPoor = meal("Ratio Poor", 520, 20, 60, 20); // ratio 0.0385

    const ok = scoreMeal(ratioOk, "maintain");
    const poor = scoreMeal(ratioPoor, "maintain");

    assert.deepEqual(ok.penalties, [], "control meal must be unpenalized");
    assert.deepEqual(poor.penalties, ["poorProteinRatio"]);
    assert.deepEqual(ok.caps, []);
    assert.deepEqual(poor.caps, []);

    assert.ok(
      poor.score < ok.score * 0.9,
      `penalty should visibly suppress the score: ${poor.score} vs ${ok.score}`
    );
  });

  test("rankings change correctly across goals", () => {
    const cut = rankNames(SAMPLE_MENU, "cut");
    const maintain = rankNames(SAMPLE_MENU, "maintain");
    const bulk = rankNames(SAMPLE_MENU, "bulk");

    assert.notDeepEqual(cut, bulk, "cut and bulk must not rank identically");
    assert.notDeepEqual(cut, maintain);

    // The lean, protein-dense bowl should rank strictly better on cut than bulk.
    const rank = (list, name) => list.indexOf(name);
    assert.ok(
      rank(cut, "Grilled Chicken Bowl") < rank(bulk, "Grilled Chicken Bowl"),
      "a 480 cal protein-dense bowl should rank higher for cut than for bulk"
    );

    // A big, carb-heavy, protein-adequate plate should do better on bulk.
    assert.ok(
      rank(bulk, "BBQ Pulled Pork Bowl") < rank(cut, "BBQ Pulled Pork Bowl"),
      "a 720 cal plate should rank higher for bulk than for cut"
    );
  });

  // The original reported bug: a meal with the better protein-to-calorie
  // ratio was losing to a less-efficient meal purely because it had more fat,
  // even though its fat_to_protein_ratio (0.91) never crossed cut's extreme
  // threshold (1.2).
  test("cut: a genuinely more efficient meal is not reversed by moderate fat", () => {
    const kaleCaesar = meal("Kale Caesar", 490, 35, 14, 32);
    const chickenPestoParm = meal("Chicken Pesto Parm", 525, 35, 38, 23);

    const order = rankNames([chickenPestoParm, kaleCaesar], "cut");
    assert.deepEqual(order, ["Kale Caesar", "Chicken Pesto Parm"]);
    assert.ok(
      scoreOf(kaleCaesar, "cut") > scoreOf(chickenPestoParm, "cut"),
      "better protein-to-calorie ratio should win when fat is below the extreme threshold"
    );
  });

  // Below the extreme fat_to_protein_ratio threshold, fat should not create a
  // meaningful score gap between two meals with identical calories/protein —
  // that's the point of a threshold instead of a continuous fat penalty.
  test("cut: fat below the extreme threshold doesn't create a big score gap", () => {
    const salmonPlate = meal("Salmon Plate", 550, 40, 19, 35); // fat_to_protein 0.875
    const chickenPlate = meal("Chicken Plate", 550, 40, 64, 15); // fat_to_protein 0.375

    const salmonScore = scoreOf(salmonPlate, "cut");
    const chickenScore = scoreOf(chickenPlate, "cut");

    assert.ok(
      Math.abs(salmonScore - chickenScore) <= 5,
      `expected scores within 5 points, got salmon=${salmonScore} chicken=${chickenScore}`
    );
  });

  test("maintain: a protein-forward meal is not penalized as unbalanced", () => {
    const proteinForward = meal("Protein Forward", 550, 45, 40, 18);
    const evenSplit = meal("Even Split", 550, 30, 55, 20);

    const order = rankNames([evenSplit, proteinForward], "maintain");
    assert.deepEqual(order, ["Protein Forward", "Even Split"]);
  });

  test("bulk: a stronger protein-to-calorie ratio beats carb adequacy alone", () => {
    const proteinDense = meal("Protein Dense", 900, 60, 20, 55);
    const carbForward = meal("Carb Forward", 900, 45, 110, 20);

    const order = rankNames([carbForward, proteinDense], "bulk");
    assert.deepEqual(order, ["Protein Dense", "Carb Forward"]);
  });

  // Reported bug: two meals both cleared the old 0.1 efficiency ceiling
  // (0.101 and 0.119), so both scored a flat 1.0 on the highest-weighted
  // component and the ranking fell through to calorie-fit and balance
  // tie-breakers — which favored the WORSE-ratio sandwich. The better ratio
  // must decide it.
  test("cut: a clearly better protein-to-calorie ratio wins even when both meals are 'excellent'", () => {
    const turkeySandwich = meal("Grilled Turkey & Cheddar Sandwich", 445, 45, 31, 15);
    const thaiMangoSalad = meal("Thai Mango Salad", 395, 47, 40, 5);

    assert.ok(
      45 / 445 < 47 / 395,
      "fixture sanity check: sandwich ratio must be worse than salad ratio"
    );

    const order = rankNames([turkeySandwich, thaiMangoSalad], "cut");
    assert.deepEqual(order, ["Thai Mango Salad", "Grilled Turkey & Cheddar Sandwich"]);
    assert.ok(
      scoreOf(thaiMangoSalad, "cut") > scoreOf(turkeySandwich, "cut"),
      "the better protein-to-calorie ratio should win the ranking"
    );
  });
});

// ---------------------------------------------------------------------------
describe("scoring mechanics", () => {
  test("scores are integers in 0..100 for every meal and goal", () => {
    for (const goal of GOALS) {
      for (const m of rankMeals(SAMPLE_MENU, goal)) {
        assert.ok(Number.isInteger(m.score), `${m.name}: not an integer`);
        assert.ok(m.score >= 0 && m.score <= 100, `${m.name}: ${m.score}`);
      }
    }
  });

  test("ranking is sorted descending and deterministic", () => {
    for (const goal of GOALS) {
      const scores = rankMeals(SAMPLE_MENU, goal).map((m) => m.score);
      const sorted = [...scores].sort((a, b) => b - a);
      assert.deepEqual(scores, sorted);

      // Same input, same output — no reliance on original array order.
      const a = rankNames(SAMPLE_MENU, goal);
      const b = rankNames([...SAMPLE_MENU].reverse(), goal);
      assert.deepEqual(a, b, `goal=${goal} ranking depends on input order`);
    }
  });

  test("drinks are dropped; a side is kept but ranked below every meal and labeled", () => {
    const lobster = { ...meal("Lobster Tail", 170, 25, 1, 7), category: "side" };
    const withNoise = [
      ...SAMPLE_MENU,
      { ...meal("Soda", 150, 0, 39, 0), category: "drink" },
      lobster
    ];
    const ranked = rankMeals(withNoise, "cut");
    const names = ranked.map((m) => m.name);

    // A drink is not food we rank; it never appears.
    assert.ok(!names.includes("Soda"));

    // The side is kept — the user asked to still see it — but it lands after
    // every real meal, even though its lean macros would otherwise top the list.
    assert.equal(names.length, SAMPLE_MENU.length + 1);
    assert.equal(ranked[ranked.length - 1].name, "Lobster Tail");

    const side = ranked.find((m) => m.name === "Lobster Tail");
    assert.ok(side.badges.includes(BADGES.SIDE), "a side is labeled as a side");
    assert.ok(!side.badges.includes(BADGES.BEST_MATCH), "a side is never the Best Match");
  });

  test("Best Match goes to a real meal even when a side out-scores it", () => {
    // A lean lobster tail would score very high on protein-per-calorie.
    const withSide = [...SAMPLE_MENU, { ...meal("Lobster Tail", 120, 26, 0, 2), category: "side" }];
    const ranked = rankMeals(withSide, "cut");
    const best = ranked.find((m) => m.badges.includes(BADGES.BEST_MATCH));
    assert.ok(best);
    assert.notEqual(best.name, "Lobster Tail");
    assert.equal(best.category, "entree");
  });

  test("a zero-calorie item does not divide by zero", () => {
    const broken = meal("Broken", 0, 0, 0, 0);
    for (const goal of GOALS) {
      const result = scoreMeal(broken, goal);
      assert.ok(Number.isFinite(result.score));
      assert.ok(result.score >= 0);
    }
  });

  test("goal presets stay data-driven (future custom priorities)", () => {
    for (const goal of GOALS) {
      assert.ok(GOAL_PRESETS[goal].idealCalories > 0);
      assert.ok(GOAL_PRESETS[goal].minProtein > 0);
    }
    assert.ok(GOAL_PRESETS.cut.idealCalories < GOAL_PRESETS.bulk.idealCalories);
  });
});

// ---------------------------------------------------------------------------
describe("explanations", () => {
  test("every meal gets a non-empty explanation", () => {
    for (const goal of GOALS) {
      for (const m of rankMeals(SAMPLE_MENU, goal)) {
        assert.ok(m.explanation?.length > 10, `${m.name} (${goal})`);
      }
    }
  });

  // The bug class that has bitten this file repeatedly: prose that contradicts
  // the very numbers printed next to it.
  test("an explanation never contradicts the meal's own macros", () => {
    for (const goal of GOALS) {
      const preset = GOAL_PRESETS[goal];
      for (const m of rankMeals(SAMPLE_MENU, goal)) {
        const e = m.explanation.toLowerCase();
        const where = `${m.name} (${goal}): "${m.explanation}"`;

        if (e.includes("higher-calorie") || e.includes("calorie dense")) {
          assert.ok(
            m.calories > preset.idealCalories,
            `${where} — claims high calorie at ${m.calories} vs target ${preset.idealCalories}`
          );
        }
        if (e.includes("light on calories") || e.includes("lean pick")) {
          assert.ok(
            m.calories <= preset.idealCalories + preset.calorieTolerance / 2,
            `${where} — claims light at ${m.calories} cal`
          );
        }
        if (e.includes("balanced macros")) {
          assert.ok(m.components.balance >= 0.85, `${where} — balance=${m.components.balance}`);
        }
        if (e.includes("strong protein-to-calorie ratio")) {
          assert.ok(
            m.protein_g / m.calories >= 0.08,
            `${where} — ratio=${(m.protein_g / m.calories).toFixed(3)}`
          );
        }
        if (e.includes("strong protein")) {
          assert.ok(m.protein_g >= 35, `${where} — protein=${m.protein_g}g`);
        }
        if (e.includes("lower protein than ideal")) {
          assert.ok(m.protein_g < 20, `${where} — protein=${m.protein_g}g`);
        }
        if (e.includes("lean toward fat") || e.includes("fat-forward")) {
          const fatCal = m.fat_g * 9;
          const total = m.protein_g * 4 + m.carbs_g * 4 + fatCal;
          assert.ok(fatCal / total > 0.45, `${where} — fat share`);
        }
      }
    }
  });

  test("explanations use no diet-shaming language", () => {
    const banned = ["bad food", "cheat", "guilt-free", "guilt free", "clean only", "unhealthy", "junk"];
    for (const goal of GOALS) {
      for (const m of rankMeals(SAMPLE_MENU, goal)) {
        for (const word of banned) {
          assert.ok(
            !m.explanation.toLowerCase().includes(word),
            `${m.name} (${goal}) contains "${word}"`
          );
        }
      }
    }
  });

  test("explanations discriminate between meals", () => {
    // A per-meal "why" that is identical for most of the list is not a reason.
    for (const goal of GOALS) {
      const ranked = rankMeals(SAMPLE_MENU, goal);
      const distinct = new Set(ranked.map((m) => m.explanation)).size;
      assert.ok(
        distinct >= 5,
        `goal=${goal}: only ${distinct} distinct explanations across ${ranked.length} meals`
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe("badges", () => {
  test("exactly one Best Match per ranking, and it is the top result", () => {
    for (const goal of GOALS) {
      const ranked = rankMeals(SAMPLE_MENU, goal);
      const withBest = ranked.filter((m) => m.badges.includes(BADGES.BEST_MATCH));
      assert.equal(withBest.length, 1, `goal=${goal}`);
      assert.equal(withBest[0].name, ranked[0].name);
    }
  });

  test("badges are capped so a card stays readable", () => {
    for (const goal of GOALS) {
      for (const m of rankMeals(SAMPLE_MENU, goal)) {
        assert.ok(m.badges.length <= 3, `${m.name}: ${m.badges.length} badges`);
      }
    }
  });

  test("every badge is justified by the macros", () => {
    for (const goal of GOALS) {
      for (const m of rankMeals(SAMPLE_MENU, goal)) {
        const fatCal = m.fat_g * 9;
        const total = m.protein_g * 4 + m.carbs_g * 4 + fatCal;
        const where = `${m.name} (${goal})`;

        if (m.badges.includes(BADGES.HIGH_PROTEIN)) {
          assert.ok(m.protein_g >= 40, `${where}: High Protein at ${m.protein_g}g`);
        }
        if (m.badges.includes(BADGES.PROTEIN_EFFICIENT)) {
          assert.ok(m.protein_g / m.calories >= 0.085, `${where}: Protein Efficient`);
        }
        if (m.badges.includes(BADGES.LEAN_PICK)) {
          assert.ok(m.calories <= 500 && fatCal / total <= 0.3, `${where}: Lean Pick`);
        }
        if (m.badges.includes(BADGES.CALORIE_DENSE)) {
          assert.ok(m.calories >= 750, `${where}: Calorie Dense at ${m.calories}`);
        }
        if (m.badges.includes(BADGES.BALANCED)) {
          assert.ok(m.components.balance >= 0.85, `${where}: Balanced`);
        }
      }
    }
  });

  test("Better for Bulk never appears on the bulk goal", () => {
    for (const m of rankMeals(SAMPLE_MENU, "bulk")) {
      assert.ok(!m.badges.includes(BADGES.BETTER_FOR_BULK), m.name);
    }
    // ...but it does appear somewhere on cut, otherwise the badge is dead code.
    const onCut = rankMeals(SAMPLE_MENU, "cut").some((m) =>
      m.badges.includes(BADGES.BETTER_FOR_BULK)
    );
    assert.ok(onCut, "Better for Bulk never fires on cut");
  });

  test("badges are stable for the same meal and goal", () => {
    const a = scoreMeal(HIGH_PROTEIN_MODERATE, "cut").badges;
    const b = scoreMeal(HIGH_PROTEIN_MODERATE, "cut").badges;
    assert.deepEqual(a, b);
  });

  test("a low-protein salad earns no protein badges", () => {
    const result = scoreMeal(LOW_PROTEIN_SALAD, "cut");
    assert.ok(!result.badges.includes(BADGES.HIGH_PROTEIN));
    assert.ok(!result.badges.includes(BADGES.PROTEIN_EFFICIENT));
  });
});
