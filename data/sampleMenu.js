// data/sampleMenu.js
// Hardcoded sample menu for the MacroMenu prototype.
//
// This represents a fictional restaurant ("The Corner Kitchen").
// Only entrees / full meals are included here — no drinks, desserts,
// sides, or add-ons. That filtering is intentional for V1: the product
// ranks meals, not extras.
//
// Every item carries provenance fields (source, confidence, estimated)
// so the UI can be honest about where the numbers come from. In V1 they
// are all mock data with high confidence and estimated: false. Later,
// items that come from AI estimation would set estimated: true and a
// lower confidence.

export const SAMPLE_MENU = [
  {
    id: "grilled-chicken-bowl",
    name: "Grilled Chicken Bowl",
    description: "Grilled chicken breast over greens and brown rice.",
    category: "entree",
    calories: 480,
    protein_g: 44,
    carbs_g: 42,
    fat_g: 14,
    source: "Mock data",
    confidence: "high",
    estimated: false
  },
  {
    id: "salmon-plate",
    name: "Salmon Plate",
    description: "Roasted salmon fillet with quinoa and seasonal vegetables.",
    category: "entree",
    calories: 560,
    protein_g: 40,
    carbs_g: 34,
    fat_g: 26,
    source: "Mock data",
    confidence: "high",
    estimated: false
  },
  {
    id: "turkey-avocado-wrap",
    name: "Turkey Avocado Wrap",
    description: "Sliced turkey, avocado, and greens in a whole-wheat wrap.",
    category: "entree",
    calories: 520,
    protein_g: 32,
    carbs_g: 46,
    fat_g: 22,
    source: "Mock data",
    confidence: "high",
    estimated: false
  },
  {
    id: "steak-rice-bowl",
    name: "Steak Rice Bowl",
    description: "Seared steak strips over white rice with peppers and onions.",
    category: "entree",
    calories: 690,
    protein_g: 46,
    carbs_g: 58,
    fat_g: 28,
    source: "Mock data",
    confidence: "high",
    estimated: false
  },
  {
    id: "veggie-grain-bowl",
    name: "Veggie Grain Bowl",
    description: "Roasted vegetables, chickpeas, and farro with tahini drizzle.",
    category: "entree",
    calories: 540,
    protein_g: 18,
    carbs_g: 72,
    fat_g: 20,
    source: "Mock data",
    confidence: "high",
    estimated: false
  },
  {
    id: "chicken-caesar-wrap",
    name: "Chicken Caesar Wrap",
    description: "Grilled chicken, romaine, and parmesan with Caesar dressing.",
    category: "entree",
    calories: 610,
    protein_g: 36,
    carbs_g: 40,
    fat_g: 32,
    source: "Mock data",
    confidence: "high",
    estimated: false
  },
  {
    id: "tofu-power-bowl",
    name: "Tofu Power Bowl",
    description: "Marinated tofu, edamame, brown rice, and slaw.",
    category: "entree",
    calories: 500,
    protein_g: 26,
    carbs_g: 54,
    fat_g: 18,
    source: "Mock data",
    confidence: "high",
    estimated: false
  },
  {
    id: "cheeseburger",
    name: "Classic Cheeseburger",
    description: "Beef patty with cheddar, lettuce, and tomato on a brioche bun.",
    category: "entree",
    calories: 780,
    protein_g: 34,
    carbs_g: 44,
    fat_g: 48,
    source: "Mock data",
    confidence: "high",
    estimated: false
  },
  {
    id: "pasta-alfredo",
    name: "Pasta Alfredo",
    description: "Fettuccine tossed in a creamy parmesan Alfredo sauce.",
    category: "entree",
    calories: 850,
    protein_g: 22,
    carbs_g: 88,
    fat_g: 44,
    source: "Mock data",
    confidence: "high",
    estimated: false
  },
  {
    id: "shrimp-taco-plate",
    name: "Shrimp Taco Plate",
    description: "Three grilled shrimp tacos with slaw and black beans.",
    category: "entree",
    calories: 590,
    protein_g: 34,
    carbs_g: 56,
    fat_g: 22,
    source: "Mock data",
    confidence: "high",
    estimated: false
  },
  {
    id: "mediterranean-chicken-plate",
    name: "Mediterranean Chicken Plate",
    description: "Grilled chicken, hummus, cucumber salad, and pita.",
    category: "entree",
    calories: 620,
    protein_g: 48,
    carbs_g: 50,
    fat_g: 22,
    source: "Mock data",
    confidence: "high",
    estimated: false
  },
  {
    id: "bbq-pulled-pork-bowl",
    name: "BBQ Pulled Pork Bowl",
    description: "Slow-cooked pulled pork over rice with corn and slaw.",
    category: "entree",
    calories: 720,
    protein_g: 38,
    carbs_g: 66,
    fat_g: 30,
    source: "Mock data",
    confidence: "high",
    estimated: false
  }
];
