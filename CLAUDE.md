# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Git rules

- NEVER commit or push. When work is ready, suggest a commit message and let the user run git themselves.
- Suggested commit messages must be a single line, with no Co-Authored-By trailer or any other Claude/AI attribution.

## Commands

Use pnpm (version pinned via `packageManager` in package.json; Node 24 via `.tool-versions`).

- `pnpm dev` — dev server at http://localhost:3000
- `pnpm build` — production build
- `pnpm start` — serve the production build
- `pnpm lint` — ESLint (flat config in `eslint.config.mjs`)
- `pnpm exec next typegen && pnpm exec tsc --noEmit` — typecheck (no package script exists for this; `next typegen` generates `next-env.d.ts` and route types first)

No test framework is configured.

## Architecture

Next.js 16.3.0 App Router project (fresh create-next-app) with TypeScript strict mode and React 19.

- Routes live in `app/` at the repo root (no `src/`). `app/layout.tsx` is the root layout; it loads Geist fonts via `next/font/google` and exposes them as CSS variables consumed in `app/globals.css`.
- Layouts/pages use Next 16's generated route-typed props (e.g. `LayoutProps<"/">`) as ambient globals — no import needed. These types are generated into `.next/types` and `.next/dev/types`, which tsconfig includes; `pnpm exec next typegen` generates them without a full build.
- Styling is Tailwind CSS v4 via the `@tailwindcss/postcss` plugin: there is no tailwind.config file; theme tokens are defined in `app/globals.css` using `@import "tailwindcss"` and `@theme inline`. Dark mode follows `prefers-color-scheme`.
- Path alias `@/*` maps to the repo root.
- `pnpm-workspace.yaml` exists only for pnpm settings (`allowBuilds`); this is not a monorepo. Note it disables the `sharp` build, so `next/image` optimisation is unavailable — trait layers use plain `<img>` with a scoped lint override in `eslint.config.mjs`.

## Trait art

`public/piggy/**` and `lib/collections.generated.ts` are **generated** by
`scripts/import-assets.mjs` and committed, because the sources do not exist on
the deploy host. Re-run only when the source art changes:

```
pnpm assets:import \
  --source ../../piggydao/piggy-image-composer \
  --art piggy-gang=~/Downloads/Piggy_Gang_New_Art_Files \
  --verify 8
```

Always pass every source: the manifest is rewritten wholesale, so a partial run
would drop the collections it skipped. `--source` is the composer repo, which
holds the layer art and the reference renders; `--art <slug>=<dir>` points at
layer PNGs delivered outside it. Per-token metadata is **not** read from disk —
it comes from the Indexer (`--indexer`, `--refresh`).

All three are metadata collections — real counts, rarity, ranks and a
`tokens.txt` index. **Piggy Gang is Piggy SOL Gang re-skinned**: the redrawn art
carries no metadata of its own, so its `source` is `piggy-sol-gang` too. They
differ only in how a metadata value finds its art, per category in `COLLECTIONS`
(`scripts/collection-config.mjs`):

- *implied* (SOL Gang, Girl Gang) — the value **is** the trait name and
  `kebabify(value)` **is** the filename.
- *declared* (Piggy Gang) — a `map` from old metadata value to new trait name,
  which is `Piggy Trait Mapping.xlsx` transcribed. `map` plus `empty` must
  partition the observed values exactly, so a renamed art file or a new metadata
  value is a hard error rather than a silently empty slot.

What `declared` buys, beyond renaming: `attrs` lets a category key on more than
one attribute (Piggy Gang's Body is `Body` × `Received Mud`, because the redraw
gives mud its own art — Pink+mud is Boar, Salmon+mud is Mud Splash), and two
categories can carve up one attribute (`Special` is five full-canvas props filed
under `Earring/`, each half declaring the other's values as `empty`, with its own
z-slot below `Body` so Angel Wings sits behind the shoulders).

Other per-collection knobs: `canvas` is both the expected source size and the
shipped full-tier size (Piggy Gang is 2000, the minted two 1080) and reaches the
app as `collection.canvas`, which sizes the PNG export — a hardcoded size would
silently crop it. `convert: true` runs Display P3 → sRGB through `sips`, which
Piggy Gang's art needs or the browser paints the wrong colours. `skipDirs` names
delivered folders that are deliberately not imported; anything else unexpected in
the tree fails the run. A category may hand-set `focus` when a union bounding box
would be useless — Piggy Gang's `Special` holds two full-canvas layers, so its
thumbnails would otherwise be un-zoomed and the small props illegible.

- Do not hand-edit `lib/collections.generated.ts`. Hand-authored copy (names, taglines, accents, tab order) lives in `lib/collections.ts`; shared types in `lib/collection-types.ts`.
- Layer paint order lives in the generated `stack`, not in code. `BodyHead`/`BodyLeftEar`/`BodyRightEar` are not traits — they are art keyed by the **Body** value, interleaved so ears sit correctly around clothes and hats. `layerSources()` in `lib/collections.ts` is the entire compositor and names no category explicitly.
- `--verify N` re-composites real tokens and pixel-diffs them against the official renders; it is what proves the layer order. It runs only where a collection declares `renders`. Piggy Gang declares none — `piggy-sol-gang-images/` renders the art it replaced — so its order was derived by eye; if that art is ever re-exported, check it visually again. Note the sol-gang renders on disk are stale placeholders and fail the diff: pass `--renders piggy-sol-gang=<dir>` pointing at files extracted from `piggy-sol-gang-images.zip`. macOS only (shells out to `sips`).
- Trait order inside a category is the wire format for `?look=` share codes and `tokens.txt`; `codeHash` guards against drift.
- Per-token metadata comes from the **Indexer**, not from a local file: `scripts/indexer-items.mjs` rebuilds the `{ name, mint, attributes }` array the build has always consumed, by paging the browse endpoint once per trait value (849 requests for 10,000 tokens rather than the 10,100 a request-per-asset would cost). `--source` still supplies the layer art and the reference renders. Results are cached under `.cache/indexer/` (gitignored); `--refresh` re-sweeps.
- **The look-code wire format is pinned.** `codeHash` and `supply` are declared per collection in `scripts/collection-config.mjs`, and the import refuses to write anything unless it reproduces them — `--accept-hash` is the override for a deliberate art change. This matters because trait order is `sort(count desc, slug asc)` over counts a live service now supplies, and twelve adjacent pairs across the three collections are one token apart or less: one re-indexed asset could flip a pair, move every trait index in that slot, and silently repoint every `?look=` link ever shared. `pnpm assets:check` (`scripts/check-wire-format.mjs`) proves the same thing from three `/facets` requests — no art tree, no `sips`, so it runs in CI.
- `scripts/collection-config.mjs` holds the registry and the pure part of the build (the trait resolver, category assembly, `codeHashOf`), so the importer and the checker derive the wire format through the same code and cannot disagree about it. `noneArt` declares that a category's empty value ships art of its own (Girl Gang's Clothes "None" is a censored bar) — declared rather than probed, because it decides a look-code slot's width; the importer asserts the file agrees.

## Wallet

Connecting is **read-only** — the app reads an address and never signs. Keep it that way; nothing here needs a transaction.

- `lib/wallet.ts` is Wallet Standard discovery via `@wallet-standard/app`, deliberately not `@solana/wallet-adapter-*` (deprecated per-wallet adapters, and a large tree for an app with three runtime deps).
- `components/wallet/wallet-provider.tsx` holds all wallet state and is mounted in `app/layout.tsx`, so the navbar, the landing cards and the editor read one connection. It **must not render a DOM element** — `<body>` is a flex column whose children have to stay the header, main and footer.
- **The wallet is read once per address, not per collection.** One unfiltered cursor chain over `/v1/wallets/{address}/nfts` returns every piggy the address holds in every collection at once, already keyed by token number. Consumers (`my-piggies.tsx`, `owned-count.tsx`) therefore never touch the network, and moving between collections costs nothing. Keep it that way. One chain rather than one per collection is measured, not assumed: the largest real wallet pages 3 times unfiltered against 5 filtered, and an ordinary holder once against three.
- `--accent` is a per-collection inline style on the editor root, so it does **not** reach the navbar or the modal — and `showModal()` promotes the dialog to the top layer, escaping it even when opened from the editor. Both use the global `--brand` vocabulary that `components/site-footer.tsx` establishes.
- The wallet chooser is a native `<dialog>`: top-layer rendering means the app still has exactly one z-index (`z-30`, the sticky header), and focus trapping, Escape and `::backdrop` come for free. It is the only overlay in the codebase; the `::backdrop` rule lives in `app/globals.css`.
- The landing cards show **live** supply and holder counts (`getCollectionStats`), which is the app's only server-side fetch: `app/page.tsx` is `async` with `export const revalidate = 3600`, so it stays prerendered (ISR) rather than going dynamic, needs no `<Suspense>`, and — being a leaf page — does not drag `/dress/[collection]` off static. The read resolves to `{}` rather than throwing, because a rejection here would fail `next build`; the cards then fall back to the shipped `supply` and look exactly as they did before.
- **Live supply is display-only and must stay that way.** `traitPercent()`, `lookScore()` and the editor's "rank N of ..." divide by `collection.supply`, the constant the committed trait counts were computed against. Those counts sum to exactly the shipped supply per category, so dividing them by a live total (8,131 rather than 10,000) makes a category's percentages sum to 123%.
- `lib/indexer.ts` is the entire remote-reading surface — plain `fetch`, no SDK, so `@solana/web3.js` and its Buffer polyfill stay out of the bundle. It speaks slugs and token ids, never the API's DTOs. Resist growing it. Two non-obvious details: the read's `nonce` rides along as an ignored query parameter because responses are `max-age=15, stale-while-revalidate=30` and these are GETs where the old read was an uncacheable POST — without it Refresh replays the browser cache and looks like it did nothing; and errors branch on the API's `error` code rather than the HTTP status, because the same mistake is 400 on one route and 422 on another.
- **The Indexer is trusted only for WHICH token ids a wallet holds, never for what they are.** A holding is a number, range-checked against the committed token index and deduplicated before React sees it; the traits, rarity and rank it resolves to come only from committed `tokens.txt`. So a wrong answer can change which piggies a holder is offered, never what one looks like. Ownership is no longer offline-verifiable the way an intersection against a committed `mints.txt` was — that is the deliberate trade for deleting the RPC layer, the mint indexes and the DAS dependency.
- Rows are keyed on `collection.slug`, never on an id range: `pig-mud` is indexed too and its token numbers overlap Piggy SOL Gang's. Rows also come grouped by collection but unordered within it (the cursor keys on an internal id), so the sort in `getWalletHoldings` is load-bearing.
- The Indexer reads re-hosted metadata buckets and its own `facet_exclude` config (see `indexer/config/collections.toml`), so its trait data is not simply "what is on chain" — which is exactly why `codeHash` is pinned rather than trusted.
- `NEXT_PUBLIC_INDEXER_URL` overrides the shipped endpoint (a local API or the Prism mock); unset, the production default means the app works with no configuration. Read it with `||`, never `??` — Next inlines an empty `NEXT_PUBLIC_` assignment as `""`, which `??` keeps, and every read would then hit a relative path on this app's own origin.
- Which Indexer collection a dressme collection resolves against is hand-authored (`indexer` in `PRESENTATION`) but **validated at module load** against `INDEXER_COLLECTIONS`, the registry the importer captured — an unknown slug is answered `200` with no rows, so a typo would otherwise show every holder "you own none" forever with a green build.
- Piggies that are listed for sale or staked are held by an escrow or program, not the wallet — true for the SPL collections and for Core assets on the major marketplaces alike — so they will not appear. The empty states say so; Piggy Gang's also points holders at Piggy SOL Gang for piggies not yet swapped to the new art (`swapHint` in `PRESENTATION`).
- `tokens.txt` is served under `/piggy/:path*`, which `next.config.ts` marks `immutable` for a year. Fine today, but a future wire-format change would strand year-cached copies on `"token index does not match this build"`; versioning that path is the fix if it ever happens.
- The official renders are **not** in this repo. `NEXT_PUBLIC_RENDER_BASE_URL` points at a bucket populated by `pnpm renders:upload`; unset, `components/piggy/token-image.tsx` composites the same look from layers, which is pixel-identical. The collections' original host (`shdw-drive.genesysgo.net`) no longer resolves, so those local files may be the only surviving copy of the official art.