/**
 * Shapes shared by the generated manifest (`collections.generated.ts`) and the
 * hand-authored presentation layer (`collections.ts`). Kept in their own module
 * so the generated file can import types without a cycle.
 */

export type CategoryId = string;
/** `${categoryId}:${traitSlug}` — unique across a collection. */
export type TraitId = string;

/** Normalised 0..1 crop used to frame a category's art in a thumbnail. */
export type Rect = { x: number; y: number; w: number; h: number };

export type GeneratedTrait = {
  name: string;
  slug: string;
  /** Tokens wearing it. Percentages are derived at render time so they cannot drift. */
  count: number;
  ext: string;
};

export type GeneratedCategory = {
  id: CategoryId;
  label: string;
  /**
   * Category name in the importer config. Usually the source metadata attribute
   * ("Head"); Piggy Gang's "Special" is carved out of the Earring attribute.
   */
  metaName: string;
  /** Path segment under public/piggy/<slug>/<tier>/. */
  dir: string;
  optional: boolean;
  /** Tokens with this slot empty. Drives the "None" tile's rarity badge. */
  noneCount: number;
  focus: Rect;
  traits: GeneratedTrait[];
};

/**
 * One entry in the paint stack, bottom first. A `derived` step is art keyed by
 * another category's value — the Body colour also paints BodyHead and both
 * ears, interleaved so they sit correctly around clothes and hats.
 */
export type LayerStep =
  | { kind: "category"; categoryId: CategoryId }
  | { kind: "derived"; dir: string; fromCategoryId: CategoryId };

export type GeneratedCollection = {
  slug: string;
  supply: number;
  /**
   * Native pixel size of one layer PNG, and therefore of an exported look.
   * Per-collection: the minted art is 1080, Piggy Gang's redraw is 2000.
   */
  canvas: number;
  bodyCategoryId: CategoryId;
  /** Body trait slug used as the mannequin behind trait thumbnails. */
  mannequinBody: string;
  categories: GeneratedCategory[];
  stack: LayerStep[];
  /** Fixed category order for look codes. Independent of tab order. */
  codeOrder: CategoryId[];
  /** Guards against trait-order drift silently repointing shared links. */
  codeHash: string;
  defaultLook: string;
  heroLook: string;
  /** 101 quantiles of -log10(product of trait frequencies) over real tokens. */
  rarityCurve: number[];
  tokens: { path: string; stride: number; firstId: number; count: number };
};
