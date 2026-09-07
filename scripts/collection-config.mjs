/**
 * The collection registry and the pure part of the manifest build.
 *
 * Split out of import-assets.mjs so `check-wire-format.mjs` can recompute the
 * look-code wire format from nothing but trait counts — no art tree, no `sips`,
 * no macOS. Everything here is a pure function of config plus a per-category
 * tally of metadata keys, so both scripts derive `codeHash` through the same
 * code and cannot disagree about it.
 *
 * Nothing in this file touches the filesystem or the network.
 */

import { createHash } from "node:crypto";

/** Look-code alphabet: 64 chars, every one unreserved in RFC 3986. */
export const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

/** Joins a multi-attribute lookup key. Asserted absent from every value. */
export const SEP = " | ";

/**
 * Piggy Gang is Piggy SOL Gang re-skinned — the delivered art carries no
 * metadata of its own, and `Piggy Trait Mapping.xlsx` is what ties it back to
 * the mint. These tables are that spreadsheet: old SOL Gang metadata value on
 * the left, new trait name on the right.
 *
 * SOL Gang's single Earring slot splits in two. The five in PG_SPECIAL are
 * full-canvas companions and props — wings, smoke, a shotgun, an owl, a
 * gangster — not ear jewellery; the sheet marks them "Category change", and
 * they need their own z-slot to sit behind the body. Each half declares the
 * other half's values as `empty`, which is what lets the partition assertion
 * prove the split is exact.
 */
const PG_EARRING = {
  Amulet: "Diamond",
  "Gold Ring": "Gold Ring",
  Palette: "Ear Tag",
  "Red Diamond": "Pink Diamond",
  Solana: "Solana",
};
const PG_SPECIAL = {
  Earth: "Wingman",
  Gun: "Shotgun",
  Kiss: "Angel Wings",
  Weed: "Smoke",
  Western: "Mr. Lovo",
};

export const COLLECTIONS = [
  {
    slug: "piggy-sol-gang",
    // Pinned wire format. Trait order inside a category decides every ?look=
    // code and every committed tokens.txt row, and it is derived from trait
    // counts a live service now supplies — twelve adjacent pairs across these
    // collections are one token apart or less. The import asserts these before
    // it writes anything; `--accept-hash` is how a deliberate art change gets
    // through. `pnpm assets:check` checks the same thing in three requests.
    codeHash: "c4f45d9df696",
    supply: 10000,
    source: "piggy-sol-gang",
    layers: "piggy-sol-gang-layers",
    renders: "piggy-sol-gang-images",
    canvas: 1080,
    stack: [
      "Background",
      "Body",
      "Clothes",
      "BodyRightEar",
      "BodyHead",
      "Head",
      "BodyLeftEar",
      "Eyes",
      "Earring",
      "Mouth",
    ],
    derived: { BodyHead: "Body", BodyLeftEar: "Body", BodyRightEar: "Body" },
    categories: ["Background", "Body", "Clothes", "Eyes", "Mouth", "Head", "Earring"],
    labels: { Body: "Skin", Head: "Headwear" },
    // A stale near-duplicate of Head/ that the composer's layer order never
    // reads. Named here so the "nothing goes silently unimported" scan passes.
    skipDirs: ["Head Accesories"],
    expectedDead: [
      "Body/outline",
      "BodyHead/outline",
      "BodyRightEar/outline",
      "Head/blue",
      "Head/green",
      "Head/outline",
      "Head/pink",
      "Head/purple",
      "Head/salmon",
      "Head/solana",
      "Head/yellow",
    ],
  },
  {
    slug: "piggy-girl-gang",
    // Pinned wire format. Trait order inside a category decides every ?look=
    // code and every committed tokens.txt row, and it is derived from trait
    // counts a live service now supplies — twelve adjacent pairs across these
    // collections are one token apart or less. The import asserts these before
    // it writes anything; `--accept-hash` is how a deliberate art change gets
    // through. `pnpm assets:check` checks the same thing in three requests.
    codeHash: "d32e1940ec8b",
    supply: 5000,
    source: "piggy-girl-gang",
    layers: "piggy-girl-gang-layers",
    renders: "piggy-girl-gang-images",
    canvas: 1080,
    stack: [
      "Background",
      "Body",
      "Clothes",
      "BodyRightEar",
      "BodyHead",
      "Hair",
      "Hats",
      "BodyLeftEar",
      "Eyes",
      "Earring",
      "Mouth",
    ],
    derived: { BodyHead: "Body", BodyLeftEar: "Body", BodyRightEar: "Body" },
    categories: ["Background", "Body", "Clothes", "Eyes", "Mouth", "Hair", "Hats", "Earring"],
    labels: { Body: "Skin", Hats: "Hat" },
    // Clothes "None" HAS art in this collection (a censored bar), so it is a
    // real trait rather than an empty slot. Declared, because that decides a
    // look-code slot's width; the importer asserts the file is really there.
    noneArt: ["Clothes"],
    traitLabels: { Clothes: { None: "Censored" } },
    skipDirs: [],
    expectedDead: [],
  },
  {
    slug: "piggy-gang",
    // Pinned wire format. Trait order inside a category decides every ?look=
    // code and every committed tokens.txt row, and it is derived from trait
    // counts a live service now supplies — twelve adjacent pairs across these
    // collections are one token apart or less. The import asserts these before
    // it writes anything; `--accept-hash` is how a deliberate art change gets
    // through. `pnpm assets:check` checks the same thing in three requests.
    codeHash: "f4bbbfabaa6d",
    supply: 10000,
    // The same 10,000 tokens as SOL Gang, wearing redrawn art. There is no
    // separate metadata export and none is needed: the token -> trait
    // assignment IS SOL Gang's, translated by the `map` tables below, so this
    // reads SOL Gang's metadata and its own art.
    source: "piggy-sol-gang",
    // Delivered outside the composer repo, as the folder of category dirs
    // itself — hence `--art piggy-gang=<dir>`.
    layers: ".",
    externalArt: true,
    // 2000px Display P3 at 300dpi. Converted to sRGB or the browser paints the
    // wrong colours; shipped at native size.
    canvas: 2000,
    convert: true,
    // Named after the UI name, apostrophes written as "_".
    fileOf: (name) => `${name.replace(/'/g, "_")}.PNG`,
    // No `renders`: piggy-sol-gang-images/ renders the OLD art, so there is
    // nothing here a pixel-diff could prove. The order was derived by eye —
    // Special under Body so Angel Wings sits behind the shoulders, the rest
    // following the verified SOL order with the derived ear layers dropped
    // (Body here is one flat sprite already containing the head and both ears).
    stack: ["Background", "Special", "Body", "Clothes", "Head", "Eyes", "Earring", "Mouth"],
    derived: {},
    categories: [
      {
        name: "Background",
        map: { Blue: "Blue", Cyan: "Cyan", Green: "Green", Orange: "Orange",
          Purple: "Purple", Red: "Red", Yellow: "Yellow" },
      },
      {
        name: "Special",
        from: "Earring",
        attrs: ["Earring"],
        map: PG_SPECIAL,
        empty: ["None", ...Object.keys(PG_EARRING)],
        // Smoke and Angel Wings are full-canvas, so the union bbox this would
        // otherwise compute is the whole frame and the small props render as
        // smudges. Framed on those props instead; the full tier is untouched.
        focus: { x: 0, y: 0.4, w: 0.55, h: 0.55 },
      },
      {
        name: "Body",
        label: "Skin",
        // "Received Mud" is a SOL Gang trait its art never drew. Here it does,
        // so the body is keyed on both. Spelled out rather than wildcarded, so
        // you can read off that mud only changes Pink and Salmon.
        attrs: ["Body", "Received Mud"],
        map: {
          "Alien | No": "Alien", "Alien | Yes": "Alien",
          "Solana | No": "Solana", "Solana | Yes": "Solana",
          "Zombie | No": "Zombie", "Zombie | Yes": "Zombie",
          "Purple | No": "Dino", "Purple | Yes": "Dino",
          "Yellow | No": "Leopard", "Yellow | Yes": "Leopard",
          "Pink | No": "Pink", "Pink | Yes": "Boar",
          "Salmon | No": "Salmon", "Salmon | Yes": "Mud Splash",
        },
      },
      {
        name: "Clothes",
        empty: ["None"],
        map: {
          "Artist Apron": "Butcher's Apron", Blanket: "Blanket",
          "Bone Necklace": "Bone Necklace", "Fancy Sweater": "Tux",
          "Piggy Tee": "Hoodie", "Pink Leather Jacket": "Biker Leather Jacket",
          "Pocket Watch": "Cyberpunk Jacket", "Purple Shirt": "Prison Suit",
          "Red Jacket": "Tracksuit", "Rich Jacket": "Pimp Coat",
          Singlet: "Singlet", "Solana Tee": "Solana Tee", "Star Tee": "Hawaiian Tee",
        },
      },
      {
        name: "Head",
        label: "Headwear",
        empty: ["None"],
        map: {
          "Afro Hair": "Hawk's Nest", "Afro Tail": "Dreads", Beanie: "Beanie",
          Beret: "Chef's Hat", "Cowboy Hat": "Cowboy Hat", "Elf Hat": "Trucker Hat",
          Fedora: "Cap", Fez: "Durag", "Fisherman Hat": "Straw Hat", Halo: "Halo",
          "Ice Cream": "Ice Cream", "Leprechaun Hat": "Pimp Hat",
          "Mohawk Hair": "Mohawk", Mushroom: "Fly Halo", "Officer Cap": "Pork Patrol",
          "Party Hat": "Bucket Hat", "Propeller Hat": "Propeller Hat",
          "Red Hair": "Medusa", "Royal Crown": "Royal Crown", "Sailor Cap": "Pirate Hat",
          "Santa Cap": "Biker Hat", "Spiky Hair": "Robohawk", Unicorn: "Unicorn",
        },
      },
      {
        name: "Eyes",
        map: {
          "3d Glasses": "Oinkulus", Beaten: "Scar", Closed: "Pimp Glasses",
          Coin: "Coin", Crying: "Tear Drop Tattoos",
          "Dollar Sign Googles": "Dollar Sign Glasses",
          // The artist typed "Focuses" on the file. Ship the real name.
          Focused: { name: "Focused", file: "Focuses.PNG" },
          "Heart Eyes": "Urban Frames Glasses", High: "High", Hypnotize: "White Glow",
          Laser: "Laser", Monocle: "Terminator", Open: "Open",
          Sleeping: "Viper Glasses", "Star Eyes": "Pork Patrol", Wink: "Wink",
        },
      },
      {
        name: "Earring",
        map: PG_EARRING,
        empty: ["None", ...Object.keys(PG_SPECIAL)],
      },
      {
        name: "Mouth",
        map: {
          Annoyed: "Nose Ring", Beaten: "Muzzle", "Biting Brush": "Butcher's Knife",
          "Bubble Gum": "Apple", Braces: "Diamond Grills", Cigarette: "Cigarette",
          "Golden Teeth": "Golden Teeth", Lick: "Coin", Neutral: "Neutral",
          "Party Horn": "Pipe", Smiling: "Smiling", Weed: "Blunt",
        },
      },
    ],
    // `Other /` (note the trailing space) is an uncategorised drawer of loose
    // extras and alternate takes with camera-roll filenames. Left out until
    // someone names and files them.
    skipDirs: ["Other "],
    // The classic piggy, rather than the modal Salmon, behind trait thumbnails.
    mannequin: "pink",
    expectedDead: [],
  },
];

// ---------------------------------------------------------------- utilities

export function fail(message) {
  console.error(`\n  ERROR  ${message}\n`);
  process.exit(1);
}

export function assert(condition, message) {
  if (!condition) fail(message);
}

/** Byte-for-byte port of kebabify() in the composer's src/main.rs. */
export function kebabify(value) {
  let out = "";
  let lastDash = false;
  for (const ch of value) {
    const c = ch.toLowerCase();
    if (/[a-z0-9]/.test(c) && c.charCodeAt(0) < 128) {
      out += c;
      lastDash = false;
    } else if (!lastDash) {
      out += "-";
      lastDash = true;
    }
  }
  return out.endsWith("-") ? out.slice(0, -1) : out;
}

export const isNone = (value) => value === "None" || value === "No";

/** PascalCase source dir -> lowercase kebab public path segment. */
export const dirSlug = (name) => kebabify(name.replace(/([a-z0-9])([A-Z])/g, "$1-$2"));

// -------------------------------------------------------------------- build

/** The metadata-attribute tuple a category keys on, joined into one string. */
export function keyOf(config, item, attrs) {
  const by = new Map((item.attributes ?? []).map((attr) => [attr.name, attr.value]));
  return attrs
    .map((name) => {
      const value = by.get(name);
      assert(value !== undefined, `${config.slug}: token ${item.name} has no "${name}" attribute`);
      assert(!value.includes(SEP), `${config.slug}: value "${value}" contains the key separator`);
      return value;
    })
    .join(SEP);
}

/** A category entry, which the config may write as a bare attribute name. */
export const entryOf = (raw) => (typeof raw === "string" ? { name: raw } : raw);

/** The metadata attributes a category keys on. */
export const attrsOf = (entry) => entry.attrs ?? [entry.name];

/** Does this category's empty value ship art of its own? Declared, not probed. */
export const hasNoneArt = (config, entry) => Boolean(config.noneArt?.includes(entry.name));

/**
 * Per-category lookup from a metadata key to the art it wears, or null for an
 * empty slot. Two flavours:
 *
 *   declared — `map` names, for every value the metadata can hold, the new
 *     display name (and the file, where the artist misspelled it); `empty`
 *     names the values that deliberately have no art. Between them they must
 *     partition the observed values exactly, so a new or misspelt value is a
 *     hard error rather than a silently empty slot.
 *   implied — no `map`: the value IS the display name and kebabify(value) IS
 *     the file stem, with "None"/"No" empty unless the config declares art.
 *     What the minted collections have always done.
 *
 * The two key the slug differently, deliberately. Implied slugs come from the
 * raw metadata value, so a display-name override can never repoint a shared
 * link. Declared slugs come from the new name, because for redrawn art the new
 * name is the public identity and the old value is only a join key.
 */
export function traitResolver(config, entry) {
  if (entry.map) {
    const fileOf = config.fileOf ?? ((name) => `${kebabify(name)}.png`);
    const declared = new Map(Object.entries(entry.map).map(([key, value]) => {
      const art = typeof value === "string" ? { name: value } : value;
      return [key, { name: art.name, slug: kebabify(art.name), file: art.file ?? fileOf(art.name) }];
    }));
    return {
      declared: new Set([...declared.keys(), ...(entry.empty ?? [])]),
      of: (key) => declared.get(key) ?? null,
    };
  }

  // Without a table there is nothing to join a tuple on, so a multi-attribute
  // category would silently kebabify "Pink | No" into a nonsense filename.
  assert(!entry.attrs || entry.attrs.length === 1,
    `${config.slug}: ${entry.name} keys on ${entry.attrs?.length} attributes but has no map`);

  // Girl Gang's Clothes "None" paints a censored bar, and the shipped renders
  // prove it (the composer's current None-skip postdates them). Declared in
  // `noneArt` rather than probed for, because whether "None" is a real trait
  // decides a look-code slot's width — the importer asserts the file agrees.
  const noneArt = hasNoneArt(config, entry);
  return {
    declared: null,
    of: (value) => (isNone(value) && !noneArt ? null : {
      name: config.traitLabels?.[entry.name]?.[value] ?? value,
      slug: kebabify(value),
      file: `${kebabify(value)}.png`,
    }),
  };
}

/**
 * One category, from a tally of the metadata keys its attributes take.
 *
 * `observed` is Map(key tuple -> token count); several keys can land on one
 * trait (Purple|No and Purple|Yes both wear Dino), which is why the tally comes
 * first and the resolve second.
 */
export function buildCategory(config, raw, observed) {
  const entry = entryOf(raw);
  const attrs = attrsOf(entry);
  const resolver = traitResolver(config, entry);

  if (resolver.declared) {
    for (const key of observed.keys()) {
      assert(resolver.declared.has(key),
        `${config.slug}: ${entry.name} — metadata value "${key}" is in neither map nor empty`);
    }
    for (const key of resolver.declared) {
      assert(observed.has(key),
        `${config.slug}: ${entry.name} — "${key}" is declared but no token wears it`);
    }
  }

  const bySlug = new Map();
  let noneCount = 0;
  for (const [key, count] of observed) {
    const art = resolver.of(key);
    if (!art) {
      noneCount += count;
      continue;
    }
    const row = bySlug.get(art.slug) ?? { ...art, count: 0, ext: "png" };
    row.count += count;
    bySlug.set(art.slug, row);
  }

  // Deterministic order — this IS the wire format for look codes.
  const traits = [...bySlug.values()]
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
  assert(traits.length > 0, `${config.slug}: category ${entry.name} has no traits`);
  assert(traits.length + 1 <= ALPHABET.length,
    `${config.slug}: category ${entry.name} has ${traits.length} traits, over the ${ALPHABET.length}-char alphabet`);

  return {
    id: dirSlug(entry.name),
    name: entry.name,
    metaName: attrs.join(SEP),
    label: entry.label ?? config.labels?.[entry.name] ?? entry.name,
    dir: dirSlug(entry.name),
    srcDir: entry.from ?? entry.name,
    attrs,
    resolve: (key) => resolver.of(key)?.slug ?? null,
    focus: entry.focus,
    noneCount,
    optional: noneCount > 0,
    traits,
  };
}

/** Fixed category order for look codes. Independent of tab order. */
export const codeOrderOf = (categories) => categories.map((category) => category.id).sort();

/**
 * Guards against trait-order drift silently repointing shared links. Covers
 * exactly what decides a look code: which slots exist, whether each has an
 * empty value, and the order of the traits inside it.
 */
export function codeHashOf(categories, codeOrder) {
  return createHash("sha256")
    .update(JSON.stringify(codeOrder.map((id) => {
      const category = categories.find((c) => c.id === id);
      return [id, category.optional, category.traits.map((trait) => trait.slug)];
    })))
    .digest("hex")
    .slice(0, 12);
}
