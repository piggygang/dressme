#!/usr/bin/env node
/**
 * Imports trait layer art + collection metadata into this app.
 *
 *   node scripts/import-assets.mjs \
 *     --source <piggy-image-composer> \
 *     --art piggy-gang=<Piggy_Gang_New_Art_Files> \
 *     [--verify 8] [--renders piggy-sol-gang=<dir>]
 *     [--indexer <url>] [--refresh] [--accept-hash]
 *
 * All three collections are metadata collections: traits, names and per-token
 * looks come from the PiggyGang Indexer (see indexer-items.mjs), so all three
 * get real rarity and a token index. `--source` supplies the layer art and the
 * reference renders `--verify` diffs against, not the metadata.
 *
 * They differ in how a metadata value finds its art:
 *
 *   implied — the value IS the trait name and kebabify(value) IS the filename.
 *     The two minted collections, unchanged.
 *   declared — a per-category `map` from metadata value to the new trait name.
 *     Piggy Gang is Piggy SOL Gang re-skinned, so it reads the same metadata
 *     and the trait mapping spreadsheet lives in those tables.
 *
 * Writes (all committed, because the sources do not exist on the deploy host):
 *   public/piggy/<slug>/full/<category>/<slug>.png    preview + download
 *   public/piggy/<slug>/thumb/<category>/<slug>.png   trait grid + landing cards
 *   public/piggy/<slug>/tokens.txt                    per-token look codes
 *   lib/collections.generated.ts                      the manifest
 *
 * The script asserts rather than filters: if the source art changes shape, it
 * fails loudly instead of silently shipping something wrong.
 *
 * macOS only — uses `sips` to resample and to convert Display P3 to sRGB. PNG
 * *reading* is done here with node:zlib (encoding is the part that is easy to
 * get subtly wrong, so that is left to ImageIO).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import { loadItems } from "./indexer-items.mjs";
import {
  ALPHABET,
  COLLECTIONS,
  assert,
  attrsOf,
  buildCategory,
  codeHashOf,
  codeOrderOf,
  dirSlug,
  entryOf,
  fail,
  hasNoneArt,
  keyOf,
} from "./collection-config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const THUMB = 256;
const ALPHA_CUTOFF = 8;
const FOCUS_PAD = 0.12;
/**
 * Floor on the thumbnail crop, as a fraction of the canvas. A tiny trait like
 * an ear ring would otherwise zoom so far that the 256px thumb is upscaled
 * past legibility — Piggy Gang's Earring bbox is only 28% of the canvas.
 */
const FOCUS_MIN = 0.5;
const SRGB = "/System/Library/ColorSync/Profiles/sRGB Profile.icc";
const DEFAULT_INDEXER = "https://api.indexer.piggygang.net";

// ---------------------------------------------------------------- utilities

function parseArgs(argv) {
  const args = {
    source: null, art: {}, verify: 0, renders: {},
    indexer: DEFAULT_INDEXER, refresh: false, acceptHash: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--source") {
      // The composer repo. `meta` and `renders` always resolve under it.
      args.source = String(argv[++i]);
    } else if (argv[i] === "--art") {
      // Where one collection's layer PNGs live, when not in the composer repo.
      // Separate from --source because Piggy Gang needs both roots at once.
      const [slug, dir] = String(argv[++i]).split("=");
      args.art[slug] = dir;
    } else if (argv[i] === "--verify") {
      args.verify = Number(argv[++i] ?? 0);
    } else if (argv[i] === "--renders") {
      // Points verification at reference renders held elsewhere
      // (piggy-sol-gang-images/ on disk is all zero-byte files; the real ones
      // only survive inside piggy-sol-gang-images.zip).
      const [slug, dir] = String(argv[++i]).split("=");
      args.renders[slug] = dir;
    } else if (argv[i] === "--indexer") {
      // Where per-token metadata comes from. The default is production.
      args.indexer = String(argv[++i] ?? "");
    } else if (argv[i] === "--refresh") {
      // Ignore .cache/indexer and sweep the API again.
      args.refresh = true;
    } else if (argv[i] === "--accept-hash") {
      // Deliberately changing the look-code wire format — see the pins below.
      args.acceptHash = true;
    } else {
      fail(`unknown argument: ${argv[i]}`);
    }
  }
  assert(args.indexer, "--indexer needs a URL");
  return args;
}

// ------------------------------------------------------------- png decoding

/** Reads IHDR only — cheap, no inflate. */
function readHeader(file) {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(33);
  fs.readSync(fd, buf, 0, 33, 0);
  fs.closeSync(fd);
  assert(buf.readUInt32BE(0) === 0x89504e47, `not a PNG: ${file}`);
  assert(buf.subarray(12, 16).toString() === "IHDR", `no IHDR: ${file}`);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    depth: buf[24],
    colorType: buf[25],
    interlace: buf[28],
  };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Decodes an 8-bit RGBA non-interlaced PNG to a flat Uint8Array. */
function decodeRGBA(file) {
  const buf = fs.readFileSync(file);
  const head = readHeader(file);
  assert(head.depth === 8 && head.colorType === 6 && head.interlace === 0,
    `unsupported PNG (depth ${head.depth} colorType ${head.colorType} interlace ${head.interlace}): ${file}`);

  const idat = [];
  let offset = 8;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString();
    if (type === "IDAT") idat.push(buf.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
    if (type === "IEND") break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));

  const { width, height } = head;
  const bpp = 4;
  const stride = width * bpp;
  const out = new Uint8Array(width * height * bpp);

  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos++];
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[pos + x];
      const left = x >= bpp ? out[row + x - bpp] : 0;
      const up = y > 0 ? out[prev + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[prev + x - bpp] : 0;
      let restored;
      if (filter === 0) restored = value;
      else if (filter === 1) restored = value + left;
      else if (filter === 2) restored = value + up;
      else if (filter === 3) restored = value + ((left + up) >> 1);
      else if (filter === 4) restored = value + paeth(left, up, upLeft);
      else fail(`bad PNG filter ${filter} in ${file}`);
      out[row + x] = restored & 0xff;
    }
    pos += stride;
  }
  return { width, height, data: out };
}

/** Source-over in non-premultiplied space, matching the image crate's blend. */
function blendOver(dst, src) {
  for (let i = 0; i < dst.length; i += 4) {
    const sa = src[i + 3];
    if (sa === 0) continue;
    if (sa === 255) {
      dst[i] = src[i];
      dst[i + 1] = src[i + 1];
      dst[i + 2] = src[i + 2];
      dst[i + 3] = 255;
      continue;
    }
    const fg = sa / 255;
    const bg = dst[i + 3] / 255;
    const outA = bg + fg - bg * fg;
    if (outA === 0) {
      dst[i] = dst[i + 1] = dst[i + 2] = dst[i + 3] = 0;
      continue;
    }
    for (let c = 0; c < 3; c += 1) {
      const f = src[i + c] / 255;
      const b = dst[i + c] / 255;
      dst[i + c] = Math.round(((f * fg + b * bg * (1 - fg)) / outA) * 255);
    }
    dst[i + 3] = Math.round(outA * 255);
  }
}

// -------------------------------------------------------------------- build

function buildCollection(config, artDir, items) {
  const layersDir = path.join(artDir, config.layers);
  assert(fs.existsSync(layersDir), `missing layers dir: ${layersDir}`);
  const supply = items.length;

  const categories = config.categories.map((raw) => {
    const entry = entryOf(raw);
    const dir = path.join(layersDir, entry.from ?? entry.name);
    assert(fs.existsSync(dir), `${config.slug}: missing layer dir ${dir}`);

    // `noneArt` decides whether an empty value is a real trait, which sets a
    // look-code slot's width — so it is declared in config and merely checked
    // here. Probing for the file instead would let a deleted PNG silently
    // renumber every trait in the slot.
    const noneOnDisk = ["none", "no"]
      .some((stem) => fs.existsSync(path.join(dir, `${stem}.png`)));
    assert(entry.map || noneOnDisk === hasNoneArt(config, entry),
      `${config.slug}: ${entry.name} — noneArt says ${hasNoneArt(config, entry)} but `
        + `${noneOnDisk ? "none.png exists" : "there is no none.png"} in ${dir}`);

    // Tally the key tuples first, then resolve — several keys can land on one
    // trait (Purple|No and Purple|Yes both wear Dino).
    const observed = new Map();
    for (const item of items) {
      const key = keyOf(config, item, attrsOf(entry));
      observed.set(key, (observed.get(key) ?? 0) + 1);
    }

    return buildCategory(config, raw, observed);
  });

  const byName = new Map(categories.map((category) => [category.name, category]));

  const steps = config.stack.map((dirName) => {
    const source = config.derived[dirName] ?? dirName;
    const category = byName.get(source);
    assert(category, `${config.slug}: stack entry ${dirName} maps to unknown category ${source}`);
    const derived = Boolean(config.derived[dirName]);
    // Pinned to the category for a normal step: with Special carved out of the
    // Earring dir, dirSlug(stackEntry) would write full/earring/ under a
    // manifest that advertises special/.
    return {
      segment: derived ? dirSlug(dirName) : category.dir,
      srcDir: derived ? dirName : category.srcDir,
      category,
      derived,
    };
  });

  // Every file is claimed or declared dead. Accumulated per source dir, because
  // Earring feeds two categories and would otherwise flag each half as unclaimed.
  const claimedByDir = new Map();
  for (const step of steps) {
    const claimed = claimedByDir.get(step.srcDir) ?? new Set();
    // Derived layers are keyed by another category's value, so they are named
    // after the trait slug rather than carrying their own file.
    for (const trait of step.category.traits) {
      claimed.add(step.derived ? `${trait.slug}.png` : trait.file);
    }
    claimedByDir.set(step.srcDir, claimed);
  }
  const dead = new Set(config.expectedDead);
  for (const [srcDir, claimed] of claimedByDir) {
    for (const file of fs.readdirSync(path.join(layersDir, srcDir))) {
      if (!file.toLowerCase().endsWith(".png") || claimed.has(file)) continue;
      assert(dead.has(`${srcDir}/${file.slice(0, file.lastIndexOf("."))}`),
        `${config.slug}: unclaimed file ${srcDir}/${file} — add it to expectedDead or fix the map`);
    }
  }

  // And nothing in the delivery goes silently unimported.
  const skip = new Set(config.skipDirs);
  for (const entry of fs.readdirSync(layersDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || skip.has(entry.name)) continue;
    assert(steps.some((step) => step.srcDir === entry.name),
      `${config.slug}: directory "${entry.name}" is neither imported nor in skipDirs`);
  }

  return { config, supply, items, categories, steps, layersDir };
}

// -------------------------------------------------------------- copy + thumbs

/** Union alpha bounding box across a category's art, padded and squared. */
function focusRect(files, canvas) {
  let x0 = canvas;
  let y0 = canvas;
  let x1 = -1;
  let y1 = -1;
  for (const file of files) {
    const { data } = decodeRGBA(file);
    for (let y = 0; y < canvas; y += 1) {
      const row = y * canvas * 4;
      for (let x = 0; x < canvas; x += 1) {
        if (data[row + x * 4 + 3] <= ALPHA_CUTOFF) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: 1, h: 1 };

  const cx = (x0 + x1 + 1) / 2;
  const cy = (y0 + y1 + 1) / 2;
  let side = Math.max(x1 - x0 + 1, y1 - y0 + 1) * (1 + FOCUS_PAD * 2);
  side = Math.min(Math.max(side, canvas * FOCUS_MIN), canvas);
  const left = Math.max(0, Math.min(canvas - side, cx - side / 2));
  const top = Math.max(0, Math.min(canvas - side, cy - side / 2));
  const round = (n) => Math.round(n * 1e4) / 1e4;
  return { x: round(left / canvas), y: round(top / canvas), w: round(side / canvas), h: round(side / canvas) };
}

function resample(source, target, size, convert) {
  const args = ["-s", "format", "png"];
  if (convert) args.push("--matchTo", SRGB);
  args.push("-Z", String(size), source, "--out", target);
  execFileSync("sips", args, { stdio: "ignore" });
}

function copyAndThumb(built) {
  const { config, categories, steps, layersDir } = built;
  const canvas = config.canvas;
  const outRoot = path.join(ROOT, "public", "piggy", config.slug);
  fs.rmSync(outRoot, { recursive: true, force: true });

  let files = 0;
  for (const step of steps) {
    const srcDir = path.join(layersDir, step.srcDir);
    const fullDir = path.join(outRoot, "full", step.segment);
    const thumbDir = path.join(outRoot, "thumb", step.segment);
    fs.mkdirSync(fullDir, { recursive: true });
    fs.mkdirSync(thumbDir, { recursive: true });

    for (const trait of step.category.traits) {
      const source = path.join(srcDir, trait.file);
      const head = readHeader(source);
      assert(head.width === canvas && head.height === canvas && head.depth === 8 && head.colorType === 6,
        `${config.slug}: ${step.srcDir}/${trait.file} is ${head.width}x${head.height} depth ${head.depth} type ${head.colorType}`);

      // The full tier IS the native canvas, so there is never a resize here —
      // a byte-copy unless the source needs its colour space converted.
      const fullOut = path.join(fullDir, `${trait.slug}.png`);
      if (config.convert) resample(source, fullOut, canvas, true);
      else fs.copyFileSync(source, fullOut);

      resample(source, path.join(thumbDir, `${trait.slug}.png`), THUMB, config.convert);
      files += 1;
    }

    for (const trait of step.category.traits) {
      for (const [dir, size] of [[fullDir, canvas], [thumbDir, THUMB]]) {
        const out = readHeader(path.join(dir, `${trait.slug}.png`));
        assert(out.width === size && out.height === size && out.colorType === 6,
          `${config.slug}: ${step.segment}/${trait.slug}.png came out ${out.width}x${out.height} type ${out.colorType} — sips flattened it`);
      }
    }
  }

  for (const category of categories) {
    // A union bbox is dominated by its largest member, which is wrong wherever
    // one trait is full-canvas and the rest are props. Those categories set
    // `focus` by hand; this only crops the thumbnail, never the shipped art.
    if (category.focus) continue;
    // Every source dir that paints this category — for Body in the minted
    // collections that means BodyHead and the ears too, since the `Body` dir
    // alone is only the torso.
    const sources = steps
      .filter((step) => step.category === category)
      .flatMap((step) => category.traits.map((trait) => path.join(layersDir, step.srcDir, trait.file)));
    category.focus = focusRect(sources, canvas);
  }

  return { outRoot, files };
}

// -------------------------------------------------------------- look codes

function makeCodec(categories, codeOrder) {
  const slots = codeOrder.map((id) => {
    const category = categories.find((c) => c.id === id);
    return { category, values: category.optional ? [null, ...category.traits] : [...category.traits] };
  });

  const encode = (equipped) =>
    slots
      .map((slot) => {
        const index = slot.values.findIndex((value) => (value === null ? equipped[slot.category.id] === null : value.slug === equipped[slot.category.id]));
        assert(index >= 0, `cannot encode ${slot.category.id}=${equipped[slot.category.id]}`);
        return ALPHABET[index];
      })
      .join("");

  return { slots, encode };
}

/**
 * Look each token is actually wearing, as slug-per-category, through the same
 * resolver that built the counts — so a row and its trait's count can never
 * disagree. A slot is empty only when the collection ships no art for it, so
 * Girl Gang's Clothes "None" resolves to the censored-bar trait rather than to
 * nothing, and a Piggy Gang earring leaves the Special slot empty.
 */
function lookOf(config, item, categories) {
  const worn = {};
  for (const category of categories) {
    worn[category.id] = category.resolve(keyOf(config, item, category.attrs));
  }
  return worn;
}

function rarityScore(worn, categories, supply) {
  let score = 0;
  for (const category of categories) {
    const slug = worn[category.id];
    const count = slug === null
      ? category.noneCount
      : (category.traits.find((trait) => trait.slug === slug)?.count ?? 0);
    if (count > 0) score += -Math.log10(count / supply);
  }
  return score;
}

// ------------------------------------------------------------------ verify

function verifyRenders(built, sourceDir, sampleSize, override) {
  const { config, items, categories, layersDir, steps } = built;
  const rendersDir = override ? path.resolve(override) : path.join(sourceDir, config.renders);
  if (!fs.existsSync(rendersDir)) {
    console.log(`  verify: skipped, no ${config.renders}/`);
    return;
  }

  // Select from the references that actually exist rather than sampling by
  // index — a partial extraction may hold only a handful out of thousands.
  const usable = new Set(
    fs.readdirSync(rendersDir)
      .filter((file) => file.endsWith(".png") && fs.statSync(path.join(rendersDir, file)).size > 0)
      .map((file) => file.slice(0, -4)),
  );
  const candidates = items.filter((item) => usable.has(item.mint));
  const step = Math.max(1, Math.floor(candidates.length / sampleSize));
  const canvas = config.canvas;

  let checked = 0;
  let worstMae = 0;
  let worstDelta = 0;

  for (let i = 0; i < candidates.length && checked < sampleSize; i += step) {
    const item = candidates[i];
    const reference = path.join(rendersDir, `${item.mint}.png`);
    const worn = lookOf(config, item, categories);
    const composed = new Uint8Array(canvas * canvas * 4);
    for (const layer of steps) {
      const slug = worn[layer.category.id];
      if (slug === null) continue;
      // Derived dirs are keyed by the slug; a normal layer carries its own file.
      const trait = layer.category.traits.find((candidate) => candidate.slug === slug);
      const file = layer.derived ? `${slug}.png` : trait.file;
      blendOver(composed, decodeRGBA(path.join(layersDir, layer.srcDir, file)).data);
    }

    const expected = decodeRGBA(reference).data;
    let sum = 0;
    let maxDelta = 0;
    for (let p = 0; p < composed.length; p += 4) {
      for (let c = 0; c < 3; c += 1) {
        const delta = Math.abs(composed[p + c] - expected[p + c]);
        sum += delta;
        if (delta > maxDelta) maxDelta = delta;
      }
    }
    worstMae = Math.max(worstMae, sum / (canvas * canvas * 3));
    worstDelta = Math.max(worstDelta, maxDelta);
    checked += 1;
  }

  if (checked === 0) {
    console.log("  verify: skipped, no usable reference renders");
    return;
  }
  console.log(`  verify: ${checked} tokens, worst MAE ${worstMae.toFixed(4)}, worst channel delta ${worstDelta}`);
  assert(worstMae < 0.02 && worstDelta <= 2,
    `${config.slug}: recomposition does not match the reference renders — the layer order is wrong`);
}

// -------------------------------------------------------------------- main

/**
 * Every trait type the sweep has to fetch for one source collection: the union
 * across every config reading it, not just the one being built. Piggy SOL Gang
 * keys on seven attributes; Piggy Gang re-skins the same metadata and keys its
 * Body on "Received Mud" as well, so a per-config list would miss it.
 */
function traitTypesFor(source) {
  const types = new Set();
  for (const config of COLLECTIONS) {
    if (config.source !== source) continue;
    for (const raw of config.categories) for (const attr of attrsOf(entryOf(raw))) types.add(attr);
  }
  return [...types];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Every collection, every time: the manifest is rewritten wholesale, so a
  // partial run would silently drop the collections it skipped.
  assert(args.source, "pass --source <path-to-piggy-image-composer>");
  const sourceDir = path.resolve(args.source);
  assert(fs.existsSync(sourceDir), `no such directory: ${sourceDir}`);
  const manifest = {};

  // Per-token metadata, from the Indexer. Two collections' data builds three:
  // Piggy Gang re-skins Piggy SOL Gang's tokens.
  console.log(`reading metadata from ${args.indexer}`);
  // The enabled collections, emitted into the manifest so lib/collections.ts can
  // fail the build on a hand-authored `indexer` slug the API does not serve —
  // an unknown slug is answered 200-with-no-rows, which would otherwise read as
  // "you own none of these" forever.
  const registry = await (await fetch(`${args.indexer}/v1/collections`, {
    headers: { accept: "application/json" },
  })).json();
  const known = (registry.data ?? []).map((collection) => collection.slug).sort();
  assert(known.length > 0, `${args.indexer}: /v1/collections returned nothing`);
  for (const config of COLLECTIONS) {
    assert(known.includes(config.source),
      `${config.slug}: metadata source "${config.source}" is not served by ${args.indexer} (has ${known.join(", ")})`);
  }

  const itemsBySource = new Map();
  for (const source of new Set(COLLECTIONS.map((config) => config.source))) {
    itemsBySource.set(source, await loadItems(args.indexer, source, traitTypesFor(source), args));
  }

  for (const config of COLLECTIONS) {
    assert(!config.externalArt || args.art[config.slug],
      `${config.slug}: pass --art ${config.slug}=<dir> — its art is not in the composer repo`);
    const artDir = args.art[config.slug] ? path.resolve(args.art[config.slug]) : sourceDir;
    assert(fs.existsSync(artDir), `no such directory: ${artDir}`);

    console.log(`\n${config.slug}`);
    const built = buildCollection(config, artDir, itemsBySource.get(config.source));
    const { categories, items, supply } = built;
    assert(supply === config.supply,
      `${config.slug}: ${supply} tokens but the pin says ${config.supply}`);
    console.log(`  ${supply} tokens, ${categories.length} categories, ${categories.reduce((n, c) => n + c.traits.length, 0)} traits`);
    for (const category of categories) {
      console.log(`    ${category.id.padEnd(11)} ${String(category.traits.length).padStart(2)} traits`
        + `  empty ${String(category.noneCount).padStart(5)}  top ${category.traits[0].slug} (${category.traits[0].count})`);
    }

    const { files } = copyAndThumb(built);
    console.log(`  wrote ${files} layers + ${files} thumbs`);

    // Stable regardless of tab order, which is presentation and may change.
    const codeOrder = codeOrderOf(categories);
    const { encode } = makeCodec(categories, codeOrder);
    const codeHash = codeHashOf(categories, codeOrder);

    // Before any write. The trait counts this is derived from now come from a
    // live service, so an upstream re-index could reorder two adjacent traits
    // and silently repoint every ?look= link ever shared and every committed
    // tokens.txt row. Failing here is the guard; --accept-hash is the override.
    assert(codeHash === config.codeHash || args.acceptHash,
      `${config.slug}: codeHash ${codeHash} != the pinned ${config.codeHash}.\n`
        + "  The index no longer produces the committed trait order, so every ?look= link\n"
        + "  and every committed tokens.txt row would change meaning. Investigate with\n"
        + "  `pnpm assets:check`. Pass --accept-hash only for a deliberate art change.");

    const bodyCategory = categories.find((category) => category.name === "Body");
    assert(bodyCategory, `${config.slug}: no Body category`);
    const mannequin = config.mannequin ?? bodyCategory.traits[0].slug;
    assert(bodyCategory.traits.some((trait) => trait.slug === mannequin),
      `${config.slug}: mannequin "${mannequin}" is not a Body trait`);

    // Per-token rows: look code + 3-char rank. A row IS a look code.
    const scored = items.map((item) => {
      const worn = lookOf(config, item, categories);
      return {
        id: Number(String(item.name ?? "").replace("#", "")),
        mint: item.mint,
        worn,
        score: rarityScore(worn, categories, supply),
      };
    });
    const ids = scored.map((s) => s.id).sort((a, b) => a - b);
    const firstId = ids[0];
    assert(ids.every((id, i) => id === firstId + i), `${config.slug}: token ids are not contiguous`);

    const ranks = new Map();
    // Ties broken by id so the rank of an exact-score pair is a property of the
    // collection, not of the order the source happened to list them in.
    [...scored]
      .sort((a, b) => b.score - a.score || a.id - b.id)
      .forEach((s, position) => ranks.set(s.id, position + 1));

    const stride = codeOrder.length + 3;
    const rows = new Array(supply);
    for (const s of scored) {
      const rank = ranks.get(s.id);
      rows[s.id - firstId] = encode(s.worn)
        + ALPHABET[(rank >> 12) & 63] + ALPHABET[(rank >> 6) & 63] + ALPHABET[rank & 63];
    }
    assert(rows.every((row) => row?.length === stride), `${config.slug}: row length mismatch`);

    fs.writeFileSync(
      path.join(ROOT, "public", "piggy", config.slug, "tokens.txt"),
      `v1 ${config.slug} ${stride} ${firstId} ${supply} ${codeHash}\n${rows.join("")}\n`,
    );

    // No mint sidecar: which piggies a wallet holds is the Indexer's answer
    // now, and it returns token numbers directly. `mint` survives on `scored`
    // because verifyRenders() matches reference renders by filename.
    assert(new Set(scored.map((s) => s.mint)).size === supply, `${config.slug}: mints are not unique`);

    const curve = scored.map((s) => s.score).sort((a, b) => a - b);

    // Defaults: the modal look reads like a real piggy, unlike first-of-each.
    const modal = {};
    for (const category of categories) {
      modal[category.id] = category.noneCount > category.traits[0].count ? null : category.traits[0].slug;
    }

    // Hero: the most-dressed token, rarest among ties. Deterministic.
    const hero = [...scored].sort((a, b) => {
      const aw = Object.values(a.worn).filter(Boolean).length;
      const bw = Object.values(b.worn).filter(Boolean).length;
      return bw - aw || b.score - a.score || a.id - b.id;
    })[0];

    const entry = {
      slug: config.slug,
      supply,
      canvas: config.canvas,
      bodyCategoryId: bodyCategory.id,
      mannequinBody: mannequin,
      categories: categories.map((category) => ({
        id: category.id,
        label: category.label,
        metaName: category.metaName,
        dir: category.dir,
        optional: category.optional,
        noneCount: category.noneCount,
        focus: category.focus,
        traits: category.traits.map(({ name, slug, count, ext }) => ({ name, slug, count, ext })),
      })),
      stack: built.steps.map((step) => (step.derived
        ? { kind: "derived", dir: step.segment, fromCategoryId: step.category.id }
        : { kind: "category", categoryId: step.category.id })),
      codeOrder,
      codeHash,
      defaultLook: encode(modal),
      heroLook: encode(hero.worn),
      rarityCurve: Array.from({ length: 101 }, (_, i) =>
        Math.round(curve[Math.min(curve.length - 1, Math.floor((i / 100) * curve.length))] * 1e3) / 1e3),
      tokens: { path: `/piggy/${config.slug}/tokens.txt`, stride, firstId, count: supply },
    };

    manifest[config.slug] = entry;
    console.log(`  default ${entry.defaultLook}  hero ${entry.heroLook}  hash ${codeHash}`);
    // Gated on reference renders, not on the collection: Piggy Gang ships none,
    // because piggy-sol-gang-images/ renders the art it replaced.
    if (args.verify && config.renders) {
      verifyRenders(built, sourceDir, args.verify, args.renders[config.slug]);
    }
  }

  fs.writeFileSync(
    path.join(ROOT, "lib", "collections.generated.ts"),
    "// GENERATED by scripts/import-assets.mjs — do not edit by hand.\n"
      + 'import type { GeneratedCollection } from "./collection-types";\n\n'
      + "/** Collection slugs the Indexer serves, as of the last import. */\n"
      + `export const INDEXER_COLLECTIONS: string[] = ${JSON.stringify(known)};\n\n`
      + `export const GENERATED: Record<string, GeneratedCollection> = ${JSON.stringify(manifest, null, 2)};\n`,
  );
  console.log("\nwrote lib/collections.generated.ts\n");
}

main().catch((cause) => fail(cause instanceof Error ? cause.message : String(cause)));
