#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { extractMenu } from "../services/menuExtractionService.js";

const USAGE = `
Usage:
  npm run test:menu -- <menu.html|menu.pdf|menu.txt|url> [--all]

Examples:
  npm run test:menu -- ./menus/dinner.html
  npm run test:menu -- ./menus/dinner.pdf
  npm run test:menu -- ./menus/pasted-menu.txt --all

Options:
  --all   Keep low-confidence meal estimates instead of suppressing them.
`;

const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith("--"));
const keepAll = args.includes("--all");

if (!target || args.includes("--help") || args.includes("-h")) {
  console.log(USAGE.trim());
  process.exit(target ? 0 : 1);
}

const result = await extractMenu({
  ...(await inputFor(target)),
  minMacroConfidence: keepAll ? 0 : undefined,
  fetch: globalThis.fetch
});

printResult(result);

async function inputFor(target) {
  if (/^https?:\/\//i.test(target)) {
    if (typeof globalThis.fetch !== "function") {
      throw new Error("This Node version does not provide fetch. Download the menu and pass the file path.");
    }
    return { url: target };
  }

  const filePath = path.resolve(process.cwd(), target);
  const bytes = await readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".pdf" || looksLikePdf(bytes)) {
    return { pdfBytes: new Uint8Array(bytes) };
  }

  const text = bytes.toString("utf8");
  if (ext === ".html" || ext === ".htm" || /<\s*html[\s>]/i.test(text) || /<\s*body[\s>]/i.test(text)) {
    return { html: text, url: pathToFileURL(filePath).href };
  }

  return { text };
}

function printResult(result) {
  console.log(`Source: ${result.sourceType}`);
  if (result.restaurantName) console.log(`Restaurant: ${result.restaurantName}`);
  if (result.sourceUrl) console.log(`URL: ${result.sourceUrl}`);

  if (result.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of result.warnings) console.log(`- ${warning}`);
  }

  console.log(`\nExtracted meals (${result.items.length}):`);
  if (result.items.length === 0) {
    console.log("- None");
  } else {
    for (const [index, item] of result.items.entries()) {
      console.log(`${index + 1}. ${item.dishName}`);
      if (item.section) console.log(`   section: ${item.section}`);
      if (item.description) console.log(`   description: ${item.description}`);
      if (typeof item.price === "number") console.log(`   price: $${item.price.toFixed(2)}`);
      console.log(`   dish type: ${item.dishType}`);
      console.log(`   parse confidence: ${item.parseConfidence.toFixed(2)}`);
      console.log(`   macro confidence: ${item.macroConfidence.toFixed(2)}`);
      console.log(
        `   estimated macros: ${item.estimatedMacros.calories} cal, ` +
          `${item.estimatedMacros.protein_g}g protein, ` +
          `${item.estimatedMacros.carbs_g}g carbs, ` +
          `${item.estimatedMacros.fat_g}g fat`
      );
    }
  }

  console.log(`\nExcluded / ignored (${result.excludedItems.length}):`);
  if (result.excludedItems.length === 0) {
    console.log("- None");
  } else {
    for (const item of result.excludedItems) {
      console.log(`- ${item.dishName}: ${item.exclusionReason ?? "not included"}`);
      if (item.description) console.log(`  description: ${item.description}`);
    }
  }
}

function looksLikePdf(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}
