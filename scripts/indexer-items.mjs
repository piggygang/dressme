#!/usr/bin/env node
/**
 * Rebuilds a collection's per-token metadata from the PiggyGang Indexer, in the
 * shape the manifest build has always consumed:
 *
 *   [{ name: "#N", mint: "<base58>", attributes: [{ name, value }, ...] }]
 *
 * Replaces the HowRare JSON dumps, which only existed inside a private sibling
 * repo — so `pnpm assets:import` no longer needs anyone's local copy of them.
 *
 * ## Why a facet sweep rather than a request per asset
 *
 * `/v1/nfts/{address}` is the obvious source, but it costs one request per
 * token behind an enumeration pass that cannot be parallelised (keyset cursors,
 * no offset): 10,100 requests and ~91s for Piggy SOL Gang, measured.
 *
 * Filtering the browse endpoint instead returns 100 assets per request wearing
 * a known trait value, so the whole collection comes back in
 * `assets x traits / 100` pages — 849 requests and ~16s at concurrency 8, with
 * every stream independent. Both strategies were run to completion and
 * cross-checked over all 10,000 assets: zero attribute differences, and zero
 * differences against the HowRare dump they replace.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assert } from "./collection-config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, ".cache", "indexer");
const PAGE = 100;
const CONCURRENCY = 8;

async function json(url) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (response.ok) return await response.json();
      // 5xx is worth another go; a 4xx is our own mistake and will not improve.
      assert(response.status >= 500 && attempt < 3, `${url} -> HTTP ${response.status}`);
    } catch (cause) {
      if (attempt >= 3) throw cause;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
}

/** Runs `task` over `items` with a fixed pool, preserving input order. */
async function pooled(items, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) results[i] = await task(items[i], i);
  }));
  return results;
}

/** Every asset wearing one trait value, as a serial cursor chain. */
async function stream(indexer, slug, traitType, value) {
  const rows = [];
  let cursor = null;
  do {
    const params = new URLSearchParams({ sort: "number", limit: String(PAGE) });
    // URLSearchParams percent-encodes the brackets and emits "+" for spaces,
    // both of which the deepObject filter accepts — for trait type names
    // ("Received Mud") as well as values.
    params.append(`trait[${traitType}]`, value);
    if (cursor) params.set("cursor", cursor);
    const body = await json(`${indexer}/v1/collections/${slug}/nfts?${params}`);
    rows.push(...body.data);
    cursor = body.nextCursor;
  } while (cursor);
  return rows;
}

async function sweep(indexer, slug, traitTypes) {
  const [collection, facets] = await Promise.all([
    json(`${indexer}/v1/collections/${slug}`),
    json(`${indexer}/v1/collections/${slug}/facets`),
  ]);
  const indexed = collection.stats.indexed;

  const byType = new Map(facets.facets.map((f) => [f.traitType, f.values]));
  const streams = traitTypes.flatMap((traitType) => {
    const values = byType.get(traitType);
    assert(values, `${slug}: the index has no "${traitType}" trait type`);
    return values.map((v) => ({ traitType, value: v.value, expect: v.count }));
  });

  console.log(`  sweeping ${slug}: ${traitTypes.length} trait types, ${streams.length} streams`);
  const pages = await pooled(streams, async (s) => {
    const rows = await stream(indexer, slug, s.traitType, s.value);
    // The facet count and the rows it filters are the same query in the index,
    // so a disagreement means the collection changed underneath this run.
    assert(rows.length === s.expect,
      `${slug}: ${s.traitType}="${s.value}" returned ${rows.length} rows but facets say ${s.expect} — the index moved mid-sweep, re-run`);
    return rows;
  });

  const byNumber = new Map();
  streams.forEach((s, i) => {
    for (const row of pages[i]) {
      assert(Number.isInteger(row.number), `${slug}: asset ${row.address} has no token number`);
      let item = byNumber.get(row.number);
      if (!item) {
        item = { name: row.name, mint: row.address, attributes: [] };
        byNumber.set(row.number, item);
      }
      assert(item.mint === row.address,
        `${slug}: token #${row.number} is claimed by both ${item.mint} and ${row.address}`);
      assert(!item.attributes.some((a) => a.name === s.traitType),
        `${slug}: token #${row.number} has two "${s.traitType}" values`);
      item.attributes.push({ name: s.traitType, value: s.value });
    }
  });

  assert(byNumber.size === indexed,
    `${slug}: swept ${byNumber.size} tokens but the index reports ${indexed}`);
  for (const [number, item] of byNumber) {
    assert(item.attributes.length === traitTypes.length,
      `${slug}: token #${number} has ${item.attributes.length} of ${traitTypes.length} trait types`);
  }

  // Number order, so the build is a pure function of the collection rather than
  // of the order streams happened to finish in.
  const items = [...byNumber.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item);
  // Attributes in a fixed order too, for the same reason.
  for (const item of items) item.attributes.sort((a, b) => a.name.localeCompare(b.name));
  return { indexed, items };
}

/**
 * The collection's items, from the cache when it still describes the same
 * collection, otherwise swept fresh.
 *
 * The cache key is `stats.indexed`, which is `supply + burned` and therefore
 * frozen at 10,000 / 5,000 for these closed collections — so it validates that
 * the cache belongs to this collection, and does NOT detect a metadata refresh.
 * The freshness guard is the pinned `codeHash`, which fires on any change to
 * the trait distribution; `--refresh` forces a re-sweep.
 */
export async function loadItems(indexer, slug, traitTypes, { refresh = false } = {}) {
  const file = path.join(CACHE_DIR, `${slug}.json`);
  const wanted = [...traitTypes].sort();

  if (!refresh && fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    const collection = await json(`${indexer}/v1/collections/${slug}`);
    const sameTypes = JSON.stringify(cached.traitTypes) === JSON.stringify(wanted);
    if (cached.indexed === collection.stats.indexed && sameTypes) {
      console.log(`  ${slug}: ${cached.items.length} tokens from .cache (fetched ${cached.fetchedAt}, --refresh to re-sweep)`);
      return cached.items;
    }
    console.log(`  ${slug}: cache is stale, re-sweeping`);
  }

  const { indexed, items } = await sweep(indexer, slug, wanted);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({
    fetchedAt: new Date().toISOString(), indexer, slug, indexed, traitTypes: wanted, items,
  })}\n`);
  console.log(`  ${slug}: ${items.length} tokens swept`);
  return items;
}
