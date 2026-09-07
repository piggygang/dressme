/**
 * The PiggyGang Indexer — the only module in the app that knows the API exists.
 *
 * It speaks this app's vocabulary (collection slug + token id), never the API's
 * DTOs, so nothing downstream learns the wire shape. Reads are anonymous GETs;
 * the app never writes.
 *
 * **Trusted for WHICH token ids a wallet holds, never for what they are.** A
 * holding is a number, range-checked against the committed token index; the
 * traits, rarity and rank it resolves to still come only from `tokens.txt`.
 */

/**
 * `||`, not `??` — deliberately. Next inlines every NEXT_PUBLIC_ variable whose
 * value is not null (see next/dist/lib/static-env.js), so the empty assignment
 * that .env.example ships arrives here as "", which `??` would happily keep.
 * Every read would then hit the relative path /v1/... on this app's own origin
 * and get the 404 page back.
 */
export const INDEXER_URL = (
  process.env.NEXT_PUBLIC_INDEXER_URL?.trim() || "https://api.indexer.piggygang.net"
).replace(/\/+$/, "");

/** A collection to pick out of a wallet's holdings, and its valid id range. */
export type IndexerQuery = { slug: string; firstId: number; count: number };

export type Holding = {
  id: number;
  /** On-chain address: the mint for the SPL collections, the asset id for Core. */
  address: string;
};

export type CollectionHoldings = {
  holdings: Holding[];
  /** What the index says this wallet holds, from the unpaginated summary. */
  reported: number;
  /** Rows rejected because their name carried no id this collection could own. */
  skipped: number;
};

export type WalletHoldings = {
  /** One entry per queried collection, present even when the wallet holds none. */
  bySlug: Record<string, CollectionHoldings>;
  /** The page cap was hit, so trailing collections may be missing entirely. */
  truncated: boolean;
};

export class IndexerError extends Error {
  /** The API's own error code, which is stabler than the HTTP status. */
  readonly code: string | null;

  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "IndexerError";
    this.code = code;
  }
}

/** The API's maximum; 101 is an error rather than a silent clamp. */
const PAGE = 100;

/**
 * ~6,000 assets. The largest wallet in the index today holds 433, so this is
 * more than an order of magnitude of headroom — it exists to bound a runaway
 * cursor chain, not to trim real holders.
 */
const MAX_PAGES = 60;

async function get(path: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${INDEXER_URL}${path}`, { signal, headers: { accept: "application/json" } });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new IndexerError("Could not reach the piggy index.");
  }

  // The error body is JSON by contract, but a proxy in front of a cold service
  // answers with HTML, so parsing it must never be what surfaces to a holder.
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    if (response.ok) throw new IndexerError("The piggy index sent a malformed reply.");
  }

  if (!response.ok) {
    // Switch on the code, not the status: the same mistake is 400 on one route
    // and 422 on another, and `invalid_cursor` is a normal, recoverable 400.
    const code = typeof body.error === "string" ? body.error : null;
    throw new IndexerError(describe(code, response.status), code);
  }
  return body;
}

function describe(code: string | null, status: number): string {
  if (code === "invalid_parameter") return "The piggy index did not accept that wallet address.";
  if (code === "invalid_cursor") return "The piggy index moved on mid-read. Try again.";
  if (status >= 500) return "The piggy index is having trouble. Try again shortly.";
  return "Could not read this wallet's piggies.";
}

type Row = {
  number: number | null;
  address: string;
  collection: { slug: string };
};

/**
 * Every piggy a wallet holds, across every queried collection, in one keyed read.
 *
 * One unfiltered cursor chain rather than one per collection: the largest real
 * wallet pages 3 times unfiltered against 5 filtered, and an ordinary holder
 * once against three. The SPL/DAS split this replaces isolated two genuinely
 * independent methods; three chains against one host, one deploy and one edge
 * cache would fail together anyway.
 *
 * `nonce` rides along as an ignored query parameter. The API answers
 * `max-age=15, stale-while-revalidate=30`, and these are GETs where the old
 * read was an uncacheable JSON-RPC POST — without it, Refresh would replay the
 * browser's cached body for up to 45s and look like it had done nothing. A
 * request header cannot do this job: the CORS preflight allows only `accept`
 * and `if-none-match`.
 */
export async function getWalletHoldings(
  address: string,
  queries: readonly IndexerQuery[],
  { nonce, signal }: { nonce: number; signal?: AbortSignal },
): Promise<WalletHoldings> {
  const wanted = new Map(queries.map((query) => [query.slug, query]));
  // Seeded so a collection the wallet holds none of reads as an empty result
  // rather than as "not read yet".
  const bySlug: Record<string, CollectionHoldings> = Object.fromEntries(
    queries.map((query) => [query.slug, { holdings: [], reported: 0, skipped: 0 }]),
  );
  const seen = new Map<string, Set<number>>(queries.map((query) => [query.slug, new Set()]));

  let cursor: string | null = null;
  let pages = 0;
  let truncated = false;

  do {
    const params = new URLSearchParams({ limit: String(PAGE), _: String(nonce) });
    if (cursor) params.set("cursor", cursor);
    const body = await get(`/v1/wallets/${encodeURIComponent(address)}/nfts?${params}`, signal);

    // Unpaginated and repeated on every page, so it is the honest total even
    // when the row walk is capped.
    for (const entry of (body.collections ?? []) as { collection: { slug: string }; count: number }[]) {
      const held = bySlug[entry.collection?.slug];
      if (held) held.reported = entry.count;
    }

    const page = (body.nfts ?? {}) as { data?: Row[]; nextCursor?: string | null; hasMore?: boolean };
    for (const row of page.data ?? []) {
      // Keyed on the slug, never on the id range: pig-mud is indexed too and
      // its numbers overlap Piggy SOL Gang's.
      const query = wanted.get(row.collection?.slug);
      if (!query) continue;
      const held = bySlug[query.slug];
      const id = row.number;
      if (
        !Number.isInteger(id)
        || id === null
        || id < query.firstId
        || id >= query.firstId + query.count
        || seen.get(query.slug)?.has(id)
      ) {
        held.skipped += 1;
        continue;
      }
      seen.get(query.slug)?.add(id);
      held.holdings.push({ id, address: row.address });
    }

    cursor = page.nextCursor ?? null;
    pages += 1;
    // `hasMore` with no cursor is a dead end, not a completed walk.
    if (pages >= MAX_PAGES || (page.hasMore && !cursor)) {
      truncated = Boolean(cursor) || Boolean(page.hasMore);
      break;
    }
  } while (cursor);

  // Rows come grouped by collection but unordered within it — the cursor keys
  // on an internal id, not the token number. This sort is load-bearing.
  for (const held of Object.values(bySlug)) held.holdings.sort((a, b) => a.id - b.id);

  return { bySlug, truncated };
}
