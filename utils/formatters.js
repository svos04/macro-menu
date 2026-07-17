// utils/formatters.js
// Small, dependency-free formatting helpers shared across the UI.

// Format a macro value in grams, e.g. 44 -> "44g".
export function grams(value) {
  return `${Math.round(value)}g`;
}

// Format calories, e.g. 480 -> "480 cal".
export function calories(value) {
  return `${Math.round(value)} cal`;
}

// Format a score, e.g. 87 -> "87/100".
export function scoreOutOf100(value) {
  return `${Math.round(value)}/100`;
}

// Turn a stored goal key into its display label.
export function goalLabel(goal) {
  const map = { cut: "Cut", maintain: "Maintain", bulk: "Bulk" };
  return map[goal] || goal;
}

// Build a plain-text block of ranked results for the "Copy Results" button.
// Kept here (not in sidepanel.js) so the formatting stays testable and reusable.
export function resultsToPlainText(rankedMeals, goal) {
  const lines = [];
  lines.push(`MacroMenu — best fits for your goal (${goalLabel(goal)})`);
  lines.push("");

  rankedMeals.forEach((meal, i) => {
    lines.push(`${i + 1}. ${meal.name} — ${scoreOutOf100(meal.score)}`);
    if (meal.badges?.length) lines.push(`   ${meal.badges.join(" · ")}`);
    lines.push(
      `   ${calories(meal.calories)} · ${grams(meal.protein_g)} protein · ` +
        `${grams(meal.carbs_g)} carbs · ${grams(meal.fat_g)} fat`
    );
    lines.push(`   ${meal.explanation}`);
    lines.push(`   Source: ${meal.source} · Confidence: High confidence`);
    lines.push("");
  });

  return lines.join("\n").trimEnd();
}
