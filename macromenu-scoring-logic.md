# MacroMenu V1 Meal Scoring Logic

## Purpose

MacroMenu ranks restaurant meals based on how well they fit a user's macro goal. For V1, the product should prioritize entrees/meals only and rank options in a way that feels simple, useful, and consumer-friendly.

The main ranking philosophy is:

> The best meal is not just the highest-protein meal. It is the meal that gives the user the most useful protein for the calories, while still fitting their goal.

MacroMenu should therefore favor **protein-to-calorie efficiency**, while adjusting rankings for the user's selected goal:

- Cut
- Maintain
- Bulk

The scoring system should be transparent enough for development and testing, but simple enough that the UI can present the result as an easy-to-understand recommendation.

---

## Core Scoring Model

Each meal receives a score from 0 to 100.

The V1 score is composed of four weighted components:

| Component | Weight | Purpose |
|---|---:|---|
| Protein-to-calorie efficiency | 50% | Rewards meals that deliver more protein per calorie |
| Goal fit | 25% | Adjusts ranking based on cut, maintain, or bulk |
| Total protein | 12.5% | Ensures meals with meaningful absolute protein rank well |
| Macro balance / penalties | 12.5% | Prevents poor or misleading meals from ranking too highly |

Recommended formula:

```text
Meal Score =
  0.50 * Protein Efficiency Score
+ 0.25 * Goal Fit Score
+ 0.125 * Total Protein Score
+ 0.125 * Balance / Penalty Score
```

All component scores should be normalized to a 0–100 scale before applying weights.

Protein efficiency is weighted at roughly **2x** the next-largest component, not just the largest. Ratio is significantly the most important signal in this model: it should decide close calls, not merely tilt them. This has a direct consequence for how the efficiency score itself must be computed — see the note on normalization ceilings below.

---

## 1. Protein-to-Calorie Efficiency Score

Protein efficiency is the most important ranking signal in V1.

```text
protein_efficiency = protein_grams / calories
```

Example:

```text
Meal A: 40g protein / 500 calories = 0.080
Meal B: 40g protein / 900 calories = 0.044
```

Meal A should rank higher than Meal B for most goals, especially cut and maintain, because it provides the same amount of protein with fewer calories.

### Why this matters

Without this component, MacroMenu could over-rank meals that have high protein only because they are very large or very high calorie. The product should instead surface meals that are macro-efficient.

### Implementation guidance

Protein efficiency can be normalized across meals in the current menu set or against a predefined benchmark.

A practical V1 approach:

```text
protein_efficiency_score = normalize(protein_grams / calories)
```

If using benchmarks instead of menu-relative normalization, a strong protein efficiency range for restaurant entrees may look like:

```text
Excellent: 0.080+ protein per calorie
Good:      0.060–0.079
Okay:      0.040–0.059
Weak:      below 0.040
```

**The normalization ceiling must sit above the "Excellent" bucket, not at its entry point.** A meal at 0.101 and a meal at 0.119 are both "Excellent" by the table above, but they are not equally efficient — 0.119 is meaningfully better. If the efficiency score is computed as `protein_grams / calories` divided by a ceiling of ~0.08–0.10 and clamped to 1.0, both meals flatten to a perfect score and the model loses the exact signal it's supposed to prioritize. When that happens, the ranking silently falls through to Goal Fit and Balance as tie-breakers — which is how a 445-calorie sandwich with a *worse* ratio (0.101) outranked a 395-calorie salad with a *better* ratio (0.119): calorie-closeness-to-target and carb-share tie-breakers decided a comparison the ratio itself should have won.

V1 should normalize against a ceiling around **0.16** — high enough that two meals both above the "Excellent" bucket still separate — while keeping any badge/label threshold (e.g. "Protein Efficient") at the lower, more commonly-achievable ~0.085 bar. The scoring ceiling and the badge threshold are two different numbers and should not share a constant.

---

## 2. Goal Fit Score

Goal fit changes how meals are ranked based on what the user is trying to do.

For V1, the assumptions should remain generic. The app does not yet need user-specific calorie targets, body weight, training style, dietary restrictions, or exact macro prescriptions.

---

### Cut Goal

For cut, MacroMenu should favor meals that are:

- High in protein
- Lower to moderate in calories
- Efficient on protein-to-calorie ratio

A strong cut meal usually has:

```text
450–650 calories
35g+ protein
Strong protein-to-calorie ratio
```

Cut should penalize:

- Very high-calorie meals
- Meals with low protein
- Meals that sound healthy but do not provide enough protein

Fat is **not** scored here. It is evaluated exactly once, by the Fat Quality Guardrail in [§4 Macro Balance and Penalties](#4-macro-balance-and-penalties), which is goal-aware and uses cut's threshold. Scoring fat again in Goal Fit double-penalizes the same signal and can override a real protein-efficiency advantage — see the Efficiency Override Principle at the end of §4.

Example:

```text
540 calories, 44g protein = strong cut option
260 calories, 12g protein = not a strong meal, even if low calorie
950 calories, 40g protein = less ideal for cut
```

---

### Maintain Goal

For maintain, MacroMenu should favor balanced meals.

A strong maintain meal usually has:

```text
500–800 calories
30g+ protein
Balanced carbs and fat
No extreme macro profile
```

Maintain should not over-penalize calories as strongly as cut, but it should still avoid ranking meals highly when they are high calorie without sufficient protein.

Maintain should favor meals that feel sustainable, complete, and balanced.

"No extreme macro profile" means no excess of **carbs or fat**. A high protein share — even a meal that's 45%+ protein by calories — is never treated as an extreme to correct for. Protein dominance is the outcome a protein-efficiency-first product should want, not an imbalance; only a carb- or fat-dominant meal should read as unbalanced for maintain.

---

### Bulk Goal

For bulk, MacroMenu should allow higher-calorie meals to rank well, but only when they also provide strong protein.

A strong bulk meal usually has:

```text
700–1,100 calories
40g+ protein
Adequate carbs
Reasonable fat
```

Bulk should reward:

- Higher calories when paired with high protein
- Higher total protein
- Adequate carbohydrates
- Full, meal-like entrees

Bulk should not reward:

- High-calorie meals with weak protein
- Very high-fat meals with poor protein efficiency
- Large meals that are calorie dense but not useful for muscle-building goals

Carb adequacy should nudge the score, not decide it. When two meals sit at the same calories, the one with the clearly better protein-to-calorie ratio should win even if it's carb-light and the other is carb-forward — per the Efficiency Override Principle (§4), goal fit's carb term must be weighted low enough that it can't outweigh a real protein advantage on its own.

Example:

```text
950 calories, 55g protein = strong bulk option
1,200 calories, 25g protein = weak bulk option
```

---

## 3. Total Protein Score

Protein-to-calorie ratio is the top priority, but total protein still matters.

A small item with 12g of protein should not outrank a complete entree with 40g+ of protein just because it is low calorie.

The total protein score ensures that full meals with meaningful protein are rewarded.

Suggested V1 benchmarks:

```text
45g+ protein = excellent
35–44g protein = strong
25–34g protein = acceptable
15–24g protein = weak for a meal
Under 15g protein = poor for a meal
```

This component helps avoid the “salad problem,” where low-calorie but low-protein meals rank too highly.

---

## 4. Macro Balance and Penalties

This component exists to prevent misleading rankings.

A meal may have one strong metric but still be a poor overall recommendation. For example:

- Very high calories with only moderate protein
- Very low calories and too little protein to count as a real meal
- Weak protein-to-calorie ratio
- Items that appear to be sides, snacks, desserts, or drinks instead of entrees
- Fat that is extreme relative to the protein delivered (see Fat Quality Guardrail below)

For V1, the product should apply simple guardrails rather than complex nutritional rules.

Balance should only ever penalize a **protein shortfall** or a **carb/fat excess**. A meal that's unusually protein-forward should never lose balance points for it — that's true of the standalone balance sub-score as well as any goal-specific "no extreme macro" check (see the Maintain Goal note above).

### Fat Quality Guardrail

Fat is scored in exactly one place: here. No other component (Goal Fit included) should apply a separate fat penalty — doing so double-counts the same signal and can wrongly override a meal's protein-efficiency advantage (this caused Kale Caesar, a genuinely more efficient meal, to be outranked by a less efficient one — see Example 4 below).

```text
fat_to_protein_ratio = fat_grams / protein_grams
```

This is preferred over a raw "% of calories from fat" cutoff because it scales with how much protein the meal actually delivers, and it doesn't punish naturally low-carb meals (which push fat's *share* of calories up without the meal being a worse cut option).

V1 extreme thresholds by goal (only above these does a penalty apply):

```text
Cut:      fat_to_protein_ratio > 1.2
Maintain: fat_to_protein_ratio > 1.5
Bulk:     fat_to_protein_ratio > 1.8
```

When the ratio exceeds the threshold, apply a penalty scaled to how far over it is (e.g. linear deduction, capped at the full weight of this component). When the ratio is at or below the threshold, apply no fat penalty at all — a meal should never lose points here just for being the higher-fat option of two if it isn't actually in extreme territory.

### Efficiency Override Principle

Protein-to-Calorie Efficiency carries the largest single weight in the V1 model (50% — roughly double the next-largest component). Goal Fit and Balance/Penalty should not, between them, be able to reverse a meaningful efficiency advantage unless a defined guardrail is actually triggered (extreme fat-to-protein ratio, low-protein cap, non-entree filter, etc.). A meal with a clearly better protein-to-calorie ratio should not be outranked by a less efficient meal purely because it has moderately more fat, carbs, or calories that fall short of a guardrail threshold — that outcome contradicts the "most useful protein for the calories" philosophy this whole model is built on. This also means the efficiency score itself must not artificially flatten two different-but-both-good ratios into the same value (see §1 Implementation guidance) — a wide weight is pointless if the component it's weighting can't tell two meals apart.

---

## Guardrails and Score Caps

Guardrails should prevent poor-fit meals from ranking too highly.

Recommended V1 caps:

```text
If protein < 20g, cap score at 70.
If protein < 15g, cap score at 55.
If calories < 250, treat cautiously as likely not a full meal.
If calories are very high and protein is weak, apply a penalty.
If protein-to-calorie ratio is poor, apply a penalty.
If fat_to_protein_ratio exceeds the goal's extreme threshold, apply the scaled fat penalty defined in §4 — this is the only fat penalty in the model; do not add a second one here.
If calories < 300 AND protein < 30g, cap score at 75 — but skip this cap entirely when protein is 30g or more. A small, calorie-light meal that already delivers a full meal's worth of protein isn't the "side dish masquerading as an entree" this guardrail exists to catch.
```

These caps should be applied after the initial score is calculated.

Example:

```text
Initial score: 82
Protein: 14g
Final capped score: 55
```

This prevents low-protein meals from appearing as top recommendations.

---

## Handling the “Salad Problem”

A common issue with nutrition ranking systems is that low-calorie items can look better than they are.

Example:

```text
Salad: 260 calories, 12g protein
Chicken bowl: 540 calories, 44g protein
```

The salad is lower calorie, but it is not a better macro meal for most users. MacroMenu should rank the chicken bowl higher because it is more complete, more protein-rich, and more useful as an entree.

Rules that help prevent this:

```text
Low protein cap
Minimum meal viability check
Protein-to-calorie weighting
Total protein score
Goal-specific calorie interpretation
```

---

## Badges

Badges make the ranking easier to understand without exposing the full scoring formula.

A meal can receive one or more badges based on its strongest attributes.

Recommended V1 badges:

| Badge | Meaning |
|---|---|
| Best Match | Highest overall fit for the selected goal |
| Protein Efficient | Strong protein-to-calorie ratio |
| High Protein | Strong total protein grams |
| Lean Pick | High protein with lower calories/fat |
| Balanced | Good maintain-style macro profile |
| Better for Bulk | Higher-calorie, high-protein option |
| Calorie Dense | Higher-calorie option that may fit bulk better than cut |

For V1, avoid showing too many badges. A maximum of 2–3 badges per meal is enough.

Example:

```text
Grilled Chicken Bowl
520 calories · 44g protein
Badges: Best Match · Protein Efficient · Lean Pick
```

---

## Score Explanations

Each ranked meal should include a short explanation of why it scored the way it did.

The explanation should be consumer-friendly and avoid sounding overly technical.

Examples:

```text
High protein with a strong protein-to-calorie ratio.
```

```text
Good bulk option with higher calories and strong protein.
```

```text
Balanced meal with solid protein and moderate calories.
```

```text
Lower protein than ideal for this goal.
```

```text
High calorie option; better suited for bulk than cut.
```

These explanations make the score feel more trustworthy and personalized.

---

## Example Ranking Behavior

### Example 1: Same protein, different calories

```text
Meal A: 40g protein, 500 calories
Meal B: 40g protein, 900 calories
```

For cut, Meal A should rank higher because it has a much better protein-to-calorie ratio.

For maintain, Meal A may still rank higher, though Meal B may be acceptable depending on macro balance.

For bulk, Meal B may become more competitive, but it should not automatically win unless its calories support the goal without poor balance.

---

### Example 2: Low-calorie salad vs high-protein entree

```text
Salad: 260 calories, 12g protein
Chicken bowl: 540 calories, 44g protein
```

The chicken bowl should rank higher across most goals because it is a more complete macro meal.

The salad should be capped or penalized because it is too low in protein to be a strong entree recommendation.

---

### Example 3: Bulk comparison

```text
Meal A: 950 calories, 55g protein
Meal B: 1,200 calories, 25g protein
```

Meal A should rank higher for bulk because it provides high calories with strong protein.

Meal B should be penalized because it is high calorie without enough protein.

---

### Example 4: Protein efficiency vs. fat content

```text
Kale Caesar:         490 calories, 35g protein, 32g fat  (fat_to_protein_ratio = 0.91)
Chicken Pesto Parm:  525 calories, 35g protein, 23g fat  (fat_to_protein_ratio = 0.66)
```

Kale Caesar has the better protein-to-calorie ratio (0.0714 vs. 0.0667) and identical total protein. For cut, its fat_to_protein_ratio (0.91) is below the cut extreme threshold (1.2), so no fat penalty applies to either meal.

Kale Caesar should rank higher than Chicken Pesto Parm for cut. A meal should only lose to a less-efficient meal on fat grounds when its fat_to_protein_ratio actually crosses the goal's extreme threshold — not simply because it is the higher-fat option of the two being compared.

---

### Example 5: Protein-forward meal for maintain

```text
Meal A: 550 calories, 45g protein, 40g carbs, 18g fat  (protein ≈ 49% of calories)
Meal B: 550 calories, 30g protein, 55g carbs, 20g fat  (evenly split ≈ 33/40/27)
```

Meal A's protein share is well above a third of its calories, but that is not an "extreme macro" for maintain — only carb or fat dominance is. Meal A should rank clearly higher: it has the better protein-to-calorie ratio, more total protein, and its balance score should not be marked down for being protein-forward.

---

### Example 6: A small, high-protein meal shouldn't be capped as "too light"

```text
Meal A: 290 calories, 32g protein
Meal B: 480 calories, 34g protein
```

Meal A falls under the 300-calorie "likely not a full meal" threshold, but 32g of protein is already a full meal's worth. The low-calorie cap should not apply — Meal A should be scored on its (excellent) merits, not capped at 75 just for being calorie-light.

---

### Example 7: Bulk — protein efficiency over carb adequacy

```text
Meal A: 900 calories, 60g protein, 20g carbs, 55g fat
Meal B: 900 calories, 45g protein, 110g carbs, 20g fat
```

Meal A has the clearly better protein-to-calorie ratio at the same calories. Meal B's carb-forward profile is a legitimate plus for bulk, but it should only narrow the gap, not close it — Meal A should still rank higher.

---

### Example 8: A worse ratio must not win on tie-breakers

```text
Grilled Turkey & Cheddar Sandwich: 445 calories, 45g protein, 31g carbs, 15g fat  (ratio = 0.101)
Thai Mango Salad:                  395 calories, 47g protein, 40g carbs, 5g fat   (ratio = 0.119)
```

Both ratios clear the "Excellent" bucket (0.080+), which is exactly the trap: if the efficiency score's normalization ceiling sits at or near that same bucket boundary, both meals clamp to a perfect efficiency score and the ratio's real ~18% edge disappears from the model. The ranking then falls through to Goal Fit (the sandwich's 445 cal sits closer to cut's 450 target than the salad's 395 cal) and Balance (the salad's mango pushes its carb share up, denting its balance score) — neither of which should be allowed to overturn a real, sizeable efficiency advantage.

Thai Mango Salad should rank higher than the sandwich for cut. The normalization ceiling (see §1 Implementation guidance) must sit well above the "Excellent" entry point so this kind of comparison is decided by the ratio itself.

---

## Recommended Output Structure

Each ranked meal should include:

```text
Rank
Meal name
Calories
Protein
Carbs
Fat
Score
Badges
Explanation
```

Example:

```text
1. Grilled Chicken Bowl
520 cal · 44g protein · 48g carbs · 14g fat
Score: 92
Badges: Best Match · Protein Efficient · Lean Pick
Why it ranks well: High protein with a strong protein-to-calorie ratio.
```

---

## Testing Requirements

The scoring logic should include unit tests that verify ranking behavior.

Recommended V1 test cases:

### Test 1: High-protein entree beats low-protein salad

```text
Input:
- Salad: 260 calories, 12g protein
- Chicken bowl: 540 calories, 44g protein

Expected:
- Chicken bowl ranks higher than salad.
- Salad score is capped or penalized.
```

### Test 2: Protein efficiency matters

```text
Input:
- Meal A: 40g protein, 500 calories
- Meal B: 40g protein, 900 calories

Expected:
- Meal A ranks higher for cut.
- Meal A receives a better protein efficiency score.
```

### Test 3: Bulk does not simply reward highest calories

```text
Input:
- Meal A: 950 calories, 55g protein
- Meal B: 1,200 calories, 25g protein

Expected:
- Meal A ranks higher for bulk.
- Meal B is penalized for weak protein relative to calories.
```

### Test 4: Low-protein meals are capped

```text
Input:
- Meal with 14g protein and otherwise decent calories

Expected:
- Final score does not exceed the low-protein cap.
```

### Test 5: Rankings change by goal

```text
Input:
- Lean high-protein meal
- Balanced moderate-calorie meal
- Higher-calorie high-protein meal

Expected:
- Cut favors the lean high-protein meal.
- Maintain favors the balanced meal.
- Bulk favors the higher-calorie high-protein meal, assuming protein is strong.
```

### Test 6: Explanations and badges are generated

```text
Input:
- Meal with high protein efficiency
- Meal with high calories and high protein
- Meal with low protein

Expected:
- Correct badges are generated.
- Explanation text matches the main scoring reason.
```

### Test 7: A real efficiency advantage is not reversed by moderate fat

```text
Input (goal: cut):
- Kale Caesar: 490 calories, 35g protein, 32g fat (fat_to_protein_ratio 0.91)
- Chicken Pesto Parm: 525 calories, 35g protein, 23g fat (fat_to_protein_ratio 0.66)

Expected:
- Kale Caesar ranks higher (better protein-to-calorie ratio; fat is below the cut extreme
  threshold of 1.2, so no fat penalty applies to either meal).
- Fat is not scored in Goal Fit for either meal — only in the Balance/Penalty fat guardrail.
```

### Test 8: A protein-forward meal is not marked down as unbalanced

```text
Input (goal: maintain):
- Meal A: 550 calories, 45g protein, 40g carbs, 18g fat
- Meal B: 550 calories, 30g protein, 55g carbs, 20g fat

Expected:
- Meal A ranks clearly higher (better efficiency, more total protein).
- Meal A's balance score is not penalized for its high protein share.
- Only Meal B's carb excess should count against its balance score.
```

### Test 9: Low-calorie cap is skipped when protein is strong

```text
Input (goal: cut):
- Meal: 290 calories, 32g protein

Expected:
- The sub-300-calorie cap does not apply (protein ≥ 30g).
- The meal scores on its actual efficiency/protein/balance components.
```

### Test 10: Bulk doesn't let carb adequacy erase a protein-efficiency edge

```text
Input (goal: bulk):
- Meal A: 900 calories, 60g protein, 20g carbs, 55g fat
- Meal B: 900 calories, 45g protein, 110g carbs, 20g fat

Expected:
- Meal A ranks higher despite being carb-light.
- Meal B's carb-forward profile narrows the gap but does not close it.
```

### Test 11: The efficiency ceiling doesn't flatten two "excellent" ratios

```text
Input (goal: cut):
- Grilled Turkey & Cheddar Sandwich: 445 calories, 45g protein, 31g carbs, 15g fat (ratio 0.101)
- Thai Mango Salad: 395 calories, 47g protein, 40g carbs, 5g fat (ratio 0.119)

Expected:
- Thai Mango Salad ranks higher (better protein-to-calorie ratio).
- The two meals do NOT receive the same efficiency component score — the
  normalization ceiling must be high enough that 0.101 and 0.119 remain
  distinguishable rather than both clamping to a perfect score.
```

---

## Future Personalization

V1 uses generic assumptions for cut, maintain, and bulk.

In a later version, users should be able to specify which macronutrients they are prioritizing.

Examples:

```text
“I’m prioritizing protein.”
“I want lower carb options.”
“I need lower fat meals.”
“I’m trying to bulk but keep fat moderate.”
```

When this exists, the scoring weights can be adjusted dynamically.

Example future weighting for protein priority:

```text
Protein efficiency: 45%
Total protein: 25%
Goal fit: 20%
Penalties: 10%
```

Example future weighting for lower-carb priority:

```text
Protein efficiency: 35%
Carb control: 25%
Goal fit: 25%
Total protein: 10%
Penalties: 5%
```

This allows the V1 scoring foundation to evolve into a more personalized ranking system without needing to rebuild the core model.

---

## V1 Product Principle

The scoring logic should remain practical, explainable, and easy to tune.

MacroMenu should not feel like a complicated nutrition calculator. It should feel like a wellness product that quickly tells users:

```text
Here are the best meals for your goal, and here is why.
```

The backend can use weighted scoring, normalization, caps, and penalties, but the frontend should present simple recommendations, badges, and short explanations.

