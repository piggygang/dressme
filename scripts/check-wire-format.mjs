#!/usr/bin/env node
/**
 * Proves the Indexer still produces the committed look-code wire format.
 *
 *   node scripts/check-wire-format.mjs [--indexer <url>]
 *
 * Trait order inside a category IS the wire format: it decides every `?look=`
 * share code and every row of the committed tokens.txt. That order is
 * `sort(count desc, slug asc)` over trait counts which now come from a live,
 * continuously re-indexing service — and twelve adjacent pairs across the three
 * collections are one token apart or less. One re-indexed asset can flip a pair,
 * move `codeHash`, and silently repoint every shared link.
 *
 * Nothing else in the repo catches that: lib/token-index.ts compares tokens.txt's
 * header against lib/collections.generated.ts, but the importer writes both from
 * the same run, so they always agree; decodeLook() checks only length and range.
 *
 * This is the guard. Three `/facets` requests rebuild every category through the
 * same code the importer uses and assert the three hashes are unchanged. No art
 * tree, no `sips`, no macOS — so it is safe to run in CI, and it fails before
 * anyone runs an import that would bake the drift in.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COLLECTIONS,
  SEP,
  assert,
  attrsOf,
  buildCategory,
  codeHashOf,
  codeOrderOf,
  entryOf,
  fail,
} from "./collection-config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_INDEXER = "https://api.indexer.piggygang.net";

function parseArgs(argv) {
  const args = { indexer: DEFAULT_INDEXER };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--indexer") args.indexer = String(argv[++i] ?? "");
    else fail(`unknown argument: ${argv[i]}`);
  }
  assert(args.indexer, "--indexer needs a URL");
  return args;
}

/** The committed manifest, parsed out of the generated TypeScript. */
function readManifest() {
  const src = fs.readFileSync(path.join(ROOT, "lib", "collections.generated.ts"), "utf8");
  return JSON.parse(src.slice(src.indexOf("= {") + 2, src.lastIndexOf("};") + 1));
}

async function facets(indexer, slug, filters = {}) {
  const url = new URL(`${indexer}/v1/collections/${slug}/facets`);
  // URLSearchParams emits "+" for spaces, which the deepObject filter accepts
  // for trait type names as well as values ("Received Mud").
  for (const [type, value] of Object.entries(filters)) url.searchParams.append(`trait[${type}]`, value);
  const response = await fetch(url, { headers: { accept: "application/json" } });
  assert(response.ok, `${slug}: facets ${response.status} for ${url}`);
  const body = await response.json();
  return { total: body.total, by: new Map(body.facets.map((f) => [f.traitType, f.values])) };
}

/**
 * Map(metadata key tuple -> token count) for one category, from facet counts.
 *
 * A single-attribute category reads its facet straight off. A multi-attribute
 * one (Piggy Gang's Body is Body x Received Mud) needs the joint distribution,
 * which disjunctive faceting hands over for free: filtering on the trailing
 * attributes returns the leading one's counts conditioned on them.
 */
async function observe(indexer, slug, unfiltered, attrs) {
  if (attrs.length === 1) {
    const values = unfiltered.by.get(attrs[0]);
    assert(values, `${slug}: the index has no "${attrs[0]}" trait type`);
    return new Map(values.map((v) => [v.value, v.count]));
  }

  // Every combination of the trailing attributes' values, in attrs order.
  let combos = [[]];
  for (const attr of attrs.slice(1)) {
    const values = unfiltered.by.get(attr);
    assert(values, `${slug}: the index has no "${attr}" trait type`);
    combos = combos.flatMap((combo) => values.map((v) => [...combo, v.value]));
  }

  const observed = new Map();
  for (const combo of combos) {
    const filters = Object.fromEntries(attrs.slice(1).map((attr, i) => [attr, combo[i]]));
    const conditioned = await facets(indexer, slug, filters);
    for (const { value, count } of conditioned.by.get(attrs[0]) ?? []) {
      observed.set([value, ...combo].join(SEP), count);
    }
  }
  return observed;
}

function compare(config, manifest, categories, codeHash, supply) {
  const committed = manifest[config.slug];
  const problems = [];
  if (!committed) return [`${config.slug} is not in the committed manifest`];

  if (supply !== committed.supply) problems.push(`supply ${supply} != committed ${committed.supply}`);

  const byId = new Map(committed.categories.map((c) => [c.id, c]));
  for (const category of categories) {
    const was = byId.get(category.id);
    if (!was) {
      problems.push(`category "${category.id}" is not in the committed manifest`);
      continue;
    }
    if (category.optional !== was.optional) {
      problems.push(`${category.id}: optional ${category.optional} != committed ${was.optional}`);
    }
    if (category.noneCount !== was.noneCount) {
      problems.push(`${category.id}: noneCount ${category.noneCount} != committed ${was.noneCount}`);
    }
    const now = category.traits.map((t) => `${t.slug}=${t.count}`);
    const then = was.traits.map((t) => `${t.slug}=${t.count}`);
    for (let i = 0; i < Math.max(now.length, then.length); i += 1) {
      if (now[i] !== then[i]) problems.push(`${category.id}[${i}]: ${now[i] ?? "(none)"} != committed ${then[i] ?? "(none)"}`);
    }
  }
  for (const id of byId.keys()) {
    if (!categories.some((c) => c.id === id)) problems.push(`committed category "${id}" was not rebuilt`);
  }
  if (codeHash !== committed.codeHash) {
    problems.push(`codeHash ${codeHash} != committed ${committed.codeHash}`);
  }
  // The importer refuses to write unless it reproduces this too, so a pin that
  // has drifted from the manifest would let an import through on a stale hash.
  if (codeHash !== config.codeHash) {
    problems.push(`codeHash ${codeHash} != the pin in scripts/collection-config.mjs (${config.codeHash})`);
  }
  if (supply !== config.supply) {
    problems.push(`supply ${supply} != the pin in scripts/collection-config.mjs (${config.supply})`);
  }
  return problems;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = readManifest();

  // Piggy Gang re-skins SOL Gang's tokens, so two collections' facets build three.
  const cache = new Map();
  const unfilteredFor = async (slug) => {
    if (!cache.has(slug)) cache.set(slug, await facets(args.indexer, slug));
    return cache.get(slug);
  };

  let failed = 0;
  for (const config of COLLECTIONS) {
    const unfiltered = await unfilteredFor(config.source);
    const categories = [];
    for (const raw of config.categories) {
      const observed = await observe(args.indexer, config.source, unfiltered, attrsOf(entryOf(raw)));
      categories.push(buildCategory(config, raw, observed));
    }
    const codeHash = codeHashOf(categories, codeOrderOf(categories));
    const problems = compare(config, manifest, categories, codeHash, unfiltered.total);

    console.log(`${config.slug.padEnd(16)} ${codeHash}  ${problems.length === 0 ? "MATCH" : "DRIFT"}`);
    for (const problem of problems) console.log(`  ${problem}`);
    if (problems.length) failed += 1;
  }

  if (failed) {
    fail(`${failed} collection(s) drifted — the index no longer produces the committed wire format.\n`
      + "  Every ?look= link and every committed tokens.txt row depends on this order.\n"
      + "  Do NOT run pnpm assets:import until this is understood.");
  }
  console.log(`\nAll ${COLLECTIONS.length} collections still produce the committed wire format.`);
}

main();
