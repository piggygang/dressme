import { GENERATED, INDEXER_COLLECTIONS } from "./collections.generated";
import type {
  CategoryId,
  GeneratedCategory,
  GeneratedTrait,
  LayerStep,
  TraitId,
} from "./collection-types";
import type { IndexerQuery } from "./indexer";

export type { CategoryId, LayerStep, Rect, TraitId } from "./collection-types";

export type Trait = GeneratedTrait & { id: TraitId; categoryId: CategoryId };
export type Category = Omit<GeneratedCategory, "traits"> & { traits: Trait[] };

/** Equipped trait **slug** per category; `null` means the slot is empty. */
export type Equipped = Record<CategoryId, string | null>;

/**
 * Which Indexer collection answers "what does this wallet hold here", and the
 * id range an answer has to land in. All three resolve the same way now, so
 * there is nothing left to discriminate on.
 */
export type WalletSource = IndexerQuery;

export type ReadyCollection = {
  status: "ready";
  slug: string;
  name: string;
  tagline: string;
  accent: string;
  supply: number;
  /** Native pixel size of one layer, and of an exported look. */
  canvas: number;
  /** Tab order — presentation, deliberately not the paint order. */
  categories: Category[];
  bodyCategoryId: CategoryId;
  mannequinBody: string;
  stack: LayerStep[];
  codeOrder: CategoryId[];
  codeHash: string;
  defaultLook: string;
  heroLook: string;
  rarityCurve: number[];
  tokens: { path: string; stride: number; firstId: number; count: number };
  /** How a connected wallet's holdings resolve here; `null` disables the wallet UI. */
  wallet: WalletSource | null;
  /** Are the official minted renders published for this collection? */
  hasRenders: boolean;
  /** Does this collection have un-swapped siblings to point holders at? */
  swapHint: boolean;
};

export type ComingSoonCollection = {
  status: "coming-soon";
  slug: string;
  name: string;
  tagline: string;
  accent: string;
};

export type Collection = ReadyCollection | ComingSoonCollection;

/**
 * Hand-authored copy and ordering. Everything else about a collection is
 * derived from the source art by `scripts/import-assets.mjs`, so re-running
 * the importer never clobbers what is written here.
 */
const PRESENTATION: Record<
  string,
  {
    name: string;
    tagline: string;
    accent: string;
    tabOrder: CategoryId[];
    /**
     * The Indexer collection this one's holdings come from. Omit to disable the
     * wallet UI. Hand-authored, so `pnpm assets:check` asserts every slug named
     * here is one the Indexer actually serves — an unknown slug is answered
     * `200` with no rows, which would read as "you own none" forever.
     */
    indexer?: string;
    /** Are the official minted renders published? See scripts/upload-renders.mjs. */
    renders?: boolean;
    /** Point holders at the sibling collection their un-swapped piggies sit in. */
    swapHint?: boolean;
  }
> = {
  "piggy-sol-gang": {
    name: "Piggy SOL Gang",
    tagline: "Ten thousand piggies, straight off the chain.",
    accent: "#9945ff",
    tabOrder: ["body", "eyes", "mouth", "clothes", "head", "earring", "background"],
    indexer: "piggy-sol-gang",
    renders: true,
  },
  "piggy-girl-gang": {
    name: "Piggy Girl Gang",
    tagline: "Pretty, fierce and dressed for it.",
    accent: "#ff8ec4",
    tabOrder: ["body", "eyes", "mouth", "clothes", "hair", "hats", "earring", "background"],
    indexer: "piggy-girl-gang",
    renders: true,
  },
  "piggy-gang": {
    name: "Piggy Gang",
    tagline: "Same ten thousand piggies. Meaner art.",
    // Deliberately not #ffd166: that is the --gold token the Mythic rarity
    // badge uses, and an accent indistinguishable from a badge reads as a bug.
    accent: "#3ddad7",
    tabOrder: ["body", "eyes", "mouth", "clothes", "head", "earring", "special", "background"],
    // The Metaplex Core collection swapping mints into. Its assets are named
    // "#N" — the same token id tokens.txt already keys, which is why a live
    // lookup still resolves to committed trait data.
    indexer: "piggy-gang",
    // Deliberately no `renders`: the bucket holds the art this redraw replaced,
    // so every request would 404 before falling back to the compositor.
    swapHint: true,
  },
};

const COMING_SOON: ComingSoonCollection[] = [];

function hydrate(slug: string): ReadyCollection {
  const generated = GENERATED[slug];
  const presentation = PRESENTATION[slug];

  const categories: Category[] = generated.categories.map((category) => ({
    ...category,
    traits: category.traits.map((trait) => ({
      ...trait,
      id: `${category.id}:${trait.slug}`,
      categoryId: category.id,
    })),
  }));

  // indexOf returns -1 for a category the tab order forgot, which sorts it
  // *ahead* of everything and silently makes it the opening tab. Fail the build
  // instead — hydrate runs at module load, so this surfaces in `next build`.
  const order = presentation.tabOrder;
  const ids = categories.map((category) => category.id);
  const missing = ids.filter((id) => !order.includes(id));
  const unknown = order.filter((id) => !ids.includes(id));
  if (missing.length || unknown.length) {
    throw new Error(
      `${slug}: tabOrder must name every generated category exactly once — `
        + `missing [${missing}], unknown [${unknown}]`,
    );
  }
  categories.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  // An unknown collection slug is answered 200 with no rows, so a typo here
  // would show every holder "you own none of these" forever with a green build.
  // Checked against the registry the importer captured, like tabOrder above.
  if (presentation.indexer && !INDEXER_COLLECTIONS.includes(presentation.indexer)) {
    throw new Error(
      `${slug}: indexer collection "${presentation.indexer}" is not one the API serves `
        + `(${INDEXER_COLLECTIONS.join(", ")})`,
    );
  }

  // Holdings come back as token numbers, so the id range they must land in is
  // the committed token index's — never the other way round.
  const wallet: WalletSource | null = presentation.indexer
    ? {
      slug: presentation.indexer,
      firstId: generated.tokens.firstId,
      count: generated.tokens.count,
    }
    : null;

  return {
    status: "ready",
    slug,
    name: presentation.name,
    tagline: presentation.tagline,
    accent: presentation.accent,
    supply: generated.supply,
    canvas: generated.canvas,
    categories,
    bodyCategoryId: generated.bodyCategoryId,
    mannequinBody: generated.mannequinBody,
    stack: generated.stack,
    codeOrder: generated.codeOrder,
    codeHash: generated.codeHash,
    defaultLook: generated.defaultLook,
    heroLook: generated.heroLook,
    rarityCurve: generated.rarityCurve,
    tokens: generated.tokens,
    wallet,
    hasRenders: Boolean(presentation.renders),
    swapHint: Boolean(presentation.swapHint),
  };
}

const READY: ReadyCollection[] = Object.keys(GENERATED)
  .filter((slug) => PRESENTATION[slug])
  .map(hydrate);

export const COLLECTIONS: Collection[] = [...READY, ...COMING_SOON];

export function getCollection(slug: string): Collection | undefined {
  return COLLECTIONS.find((collection) => collection.slug === slug);
}

/** Only collections that actually have art — used by routing and metadata. */
export function getReadyCollection(slug: string): ReadyCollection | undefined {
  return READY.find((collection) => collection.slug === slug);
}

/**
 * Every Indexer collection the app resolves wallets against, with the id range
 * a holding has to land in. The wallet provider reads this once at module load,
 * so one read covers every collection and moving between them costs nothing.
 */
export function walletQueries(): WalletSource[] {
  const seen = new Map<string, WalletSource>();
  for (const collection of READY) {
    if (collection.wallet && !seen.has(collection.wallet.slug)) {
      seen.set(collection.wallet.slug, collection.wallet);
    }
  }
  return [...seen.values()];
}

export function categoryOf(collection: ReadyCollection, id: CategoryId): Category {
  const category = collection.categories.find((item) => item.id === id);
  if (!category) throw new Error(`${collection.slug} has no category "${id}"`);
  return category;
}

export function traitOf(
  collection: ReadyCollection,
  equipped: Equipped,
  categoryId: CategoryId,
): Trait | null {
  const slug = equipped[categoryId];
  if (!slug) return null;
  return categoryOf(collection, categoryId).traits.find((trait) => trait.slug === slug) ?? null;
}

// ------------------------------------------------------------- compositing

export type ResolvedLayer = { key: string; src: string };

/**
 * Turns an equipped map into the ordered list of images to paint.
 *
 * This is the whole compositor. It names no category explicitly — the paint
 * order and the derived Body layers (head and both ears, keyed by the Body
 * colour and interleaved so they sit correctly around clothes and hats) come
 * from `collection.stack`, which is generated from the source art and verified
 * pixel-exact against the official renders.
 */
export function layerSources(
  collection: ReadyCollection,
  equipped: Equipped,
  tier: "full" | "thumb",
): ResolvedLayer[] {
  const base = `/piggy/${collection.slug}/${tier}`;
  const layers: ResolvedLayer[] = [];

  for (const step of collection.stack) {
    if (step.kind === "derived") {
      const body = traitOf(collection, equipped, step.fromCategoryId);
      if (!body) continue;
      layers.push({ key: step.dir, src: `${base}/${step.dir}/${body.slug}.${body.ext}` });
    } else {
      const trait = traitOf(collection, equipped, step.categoryId);
      if (!trait) continue;
      const dir = categoryOf(collection, step.categoryId).dir;
      layers.push({ key: step.categoryId, src: `${base}/${dir}/${trait.slug}.${trait.ext}` });
    }
  }

  return layers;
}

export function describeLook(collection: ReadyCollection, equipped: Equipped): string {
  const worn = collection.categories
    .map((category) => traitOf(collection, equipped, category.id)?.name)
    .filter(Boolean);
  return `${collection.name} piggy wearing ${worn.join(", ")}`;
}

// -------------------------------------------------------------- look codes

/** 64 chars, every one unreserved in RFC 3986 — a look code never percent-encodes. */
export const LOOK_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const ALPHABET = LOOK_ALPHABET;

function slotValues(collection: ReadyCollection, categoryId: CategoryId): (Trait | null)[] {
  const category = categoryOf(collection, categoryId);
  return category.optional ? [null, ...category.traits] : [...category.traits];
}

export function encodeLook(collection: ReadyCollection, equipped: Equipped): string {
  return collection.codeOrder
    .map((categoryId) => {
      const values = slotValues(collection, categoryId);
      const index = values.findIndex((value) =>
        value === null ? equipped[categoryId] === null : value.slug === equipped[categoryId],
      );
      return ALPHABET[index === -1 ? 0 : index];
    })
    .join("");
}

/**
 * All-or-nothing: any bad character, wrong length or out-of-range index
 * rejects the whole code, so a hand-edited URL falls back to the default look
 * rather than rendering a half-broken piggy.
 */
export function decodeLook(collection: ReadyCollection, code: string): Equipped | null {
  if (code.length !== collection.codeOrder.length) return null;

  const equipped: Equipped = {};
  for (let i = 0; i < code.length; i += 1) {
    const index = ALPHABET.indexOf(code[i]);
    if (index === -1) return null;
    const categoryId = collection.codeOrder[i];
    const values = slotValues(collection, categoryId);
    if (index >= values.length) return null;
    equipped[categoryId] = values[index]?.slug ?? null;
  }
  return equipped;
}

export function defaultEquipped(collection: ReadyCollection): Equipped {
  return decodeLook(collection, collection.defaultLook) ?? emptyEquipped(collection);
}

export function emptyEquipped(collection: ReadyCollection): Equipped {
  const equipped: Equipped = {};
  for (const category of collection.categories) equipped[category.id] = null;
  return equipped;
}

/** Body only — the backdrop for a trait thumbnail. */
export function mannequinEquipped(collection: ReadyCollection): Equipped {
  return { ...emptyEquipped(collection), [collection.bodyCategoryId]: collection.mannequinBody };
}

// ----------------------------------------------------------------- rarity

export function traitPercent(collection: ReadyCollection, count: number): number {
  return (count / collection.supply) * 100;
}

/** Tokens with this slot filled by nothing — the "None" tile's own rarity. */
export function slotCount(
  collection: ReadyCollection,
  equipped: Equipped,
  category: Category,
): number {
  const trait = traitOf(collection, equipped, category.id);
  return trait ? trait.count : category.noneCount;
}

/** -log10 of the product of trait frequencies. Bigger is rarer. */
export function lookScore(collection: ReadyCollection, equipped: Equipped): number {
  let score = 0;
  for (const category of collection.categories) {
    const count = slotCount(collection, equipped, category);
    if (count > 0) score += -Math.log10(count / collection.supply);
  }
  return score;
}

/**
 * Where this look sits against every real token, 0-100. Raw scores run from
 * 1-in-378K to 1-in-31-billion, which means nothing to a reader; a percentile
 * against the actual collection does.
 */
export function rarityPercentile(collection: ReadyCollection, equipped: Equipped): number {
  const score = lookScore(collection, equipped);
  const curve = collection.rarityCurve;
  let percentile = 0;
  for (let i = 0; i < curve.length; i += 1) {
    if (curve[i] <= score) percentile = i;
    else break;
  }
  return percentile;
}

/** "1 in 4.2M" — the odds of rolling this look from the real trait pools. */
export function oneInOdds(collection: ReadyCollection, equipped: Equipped): string {
  const odds = 10 ** lookScore(collection, equipped);
  if (odds >= 1e9) return `1 in ${(odds / 1e9).toFixed(1)}B`;
  if (odds >= 1e6) return `1 in ${(odds / 1e6).toFixed(1)}M`;
  if (odds >= 1e3) return `1 in ${(odds / 1e3).toFixed(0)}K`;
  return `1 in ${Math.round(odds)}`;
}

/**
 * A random look weighted by real trait frequencies, flattened with a square
 * root. True odds would hand you the most common skin 38% of the time and feel
 * broken; uniform ignores the collection entirely.
 */
export function randomLook(collection: ReadyCollection, random: () => number = Math.random): Equipped {
  const equipped: Equipped = {};

  for (const category of collection.categories) {
    const options: { slug: string | null; weight: number }[] = category.traits.map((trait) => ({
      slug: trait.slug,
      weight: Math.sqrt(trait.count),
    }));
    if (category.optional && category.noneCount > 0) {
      options.push({ slug: null, weight: Math.sqrt(category.noneCount) });
    }

    const total = options.reduce((sum, option) => sum + option.weight, 0);
    let roll = random() * total;
    let chosen = options[options.length - 1];
    for (const option of options) {
      roll -= option.weight;
      if (roll <= 0) {
        chosen = option;
        break;
      }
    }
    equipped[category.id] = chosen.slug;
  }

  return equipped;
}
