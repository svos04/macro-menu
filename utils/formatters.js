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
