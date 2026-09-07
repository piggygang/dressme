import { useEffect, useMemo, useState } from "react";
import type { Equipped, ReadyCollection, WalletSource } from "@/lib/collections";
import { loadTokenIndex } from "@/lib/token-index";
import { useWallet } from "@/components/wallet/wallet-provider";
import { TokenImage } from "@/components/piggy/token-image";

const GHOST =
  "rounded-full border border-line px-3 py-1.5 text-xs text-ink-muted transition-colors hover:border-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";
const CELL =
  "flex w-full flex-col gap-1.5 rounded-xl border p-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

const selectedClass = (selected: boolean) =>
  selected
    ? "border-[var(--accent)] bg-[var(--accent)]/10"
    : "border-line bg-surface hover:border-ink-muted";

type Owned = { id: number; rank: number; address: string; equipped: Equipped };

/**
 * Tiles rendered before "Show more". Without a render bucket configured each
 * tile composites the piggy from its layers, so a wallet holding 162 of them
 * would otherwise put ~1,800 images on the page and take seconds to settle.
 */
const PAGE = 24;

/**
 * The piggies this holder owns in this collection.
 *
 * No request of its own: the provider read every collection's holdings once for
 * this address, and turning a held token id into a look is a slice of the
 * committed token index. Switching collections costs nothing on the network.
 */
export function MyPiggies({
  collection,
  source,
  selectedId,
  onLoad,
}: {
  collection: ReadyCollection;
  /** Passed in so the caller proves the collection has an ownership source. */
  source: WalletSource;
  selectedId: number | null;
  onLoad: (equipped: Equipped, token: { id: number; rank: number }) => void;
}) {
  const { address, holdings, reading, error: walletError, openModal, refresh } = useWallet();

  // One fresh object per provider read, which is what the resolved state below
  // is keyed on.
  const held = holdings?.bySlug[source.slug] ?? null;
  const unidentified = held?.skipped ?? 0;
  const truncated = holdings?.truncated ?? false;

  // Held against the read it was resolved from, so a new read derives back to
  // "not resolved yet" without a synchronous reset.
  const [resolved, setResolved] = useState<{ source: unknown; rows: Owned[] | null } | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const current = held && resolved?.source === held ? resolved : null;
  const owned = current?.rows ?? null;
  const shown = useMemo(() => owned?.slice(0, limit) ?? null, [owned, limit]);

  // The provider owns connection and read failures, but this panel is where a
  // holder is looking when a read fails, so it echoes them rather than sitting
  // on an empty grid. An all-unidentified wallet is a failure too: showing it
  // as "no piggies" would turn a naming drift into a convincing lie.
  const failure = current && !current.rows
    ? "Could not load the collection index."
    : !held
      ? walletError
      : owned?.length === 0 && unidentified > 0
        ? `This wallet's ${collection.name} assets could not be identified.`
        : null;

  useEffect(() => {
    if (!held) return;
    let live = true;
    loadTokenIndex(collection)
      .then((index) => {
        if (!live) return;
        const rows: Owned[] = [];
        // Ids arrive validated, range-checked and deduplicated from the
        // provider, so every one resolves in the token index.
        for (const { id, address: asset } of held.holdings) {
          const look = index.lookAt(id);
          if (look) rows.push({ id, rank: look.rank, address: asset, equipped: look.equipped });
        }
        setResolved({ source: held, rows });
      })
      .catch(() => live && setResolved({ source: held, rows: null }));
    return () => {
      live = false;
    };
  }, [collection, held]);

  return (
    <section aria-label="My piggies" className="rounded-card border border-line bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium tracking-[0.14em] text-ink-muted uppercase">My piggies</h2>
        {owned && owned.length > 0 && (
          <span className="font-mono text-xs text-ink-muted">{owned.length}</span>
        )}
      </div>

      {!address && (
        <p className="text-xs text-ink-muted">
          <button type="button" onClick={openModal} className="text-[var(--accent)] hover:underline">
            Connect a wallet
          </button>{" "}
          to dress the piggies you own.
        </p>
      )}

      {address && (
        <>
          {reading && <p className="text-xs text-ink-muted">Reading the wallet…</p>}

          {!reading && !owned && !failure && (
            <p className="text-xs text-ink-muted">Nothing read from this wallet yet.</p>
          )}

          {!reading && owned?.length === 0 && !failure && (
            <p className="text-xs text-ink-muted">
              {collection.swapHint ? (
                // Naming the sibling collection couples the copy to it, but the
                // copy is inherently about the swap relationship between the two.
                <>
                  No {collection.name} piggies in this wallet. Anything listed for sale or staked
                  is held elsewhere and will not show up here, and piggies not yet swapped to the
                  new art appear under Piggy SOL Gang.
                </>
              ) : (
                <>
                  No {collection.name} piggies in this wallet. Anything listed for sale or staked
                  is held elsewhere and will not show up here.
                </>
              )}
            </p>
          )}

          {!reading && shown && shown.length > 0 && (
            <ul className="grid grid-cols-3 gap-2.5">
              {shown.map((piggy) => {
                const selected = piggy.id === selectedId;
                return (
                  <li key={piggy.id}>
                    <button
                      type="button"
                      onClick={() => onLoad(piggy.equipped, { id: piggy.id, rank: piggy.rank })}
                      aria-pressed={selected}
                      title={`Piggy #${piggy.id} — rank ${piggy.rank}`}
                      className={`${CELL} ${selectedClass(selected)}`}
                    >
                      <span className="block overflow-hidden rounded-lg bg-surface-raised">
                        <TokenImage
                          collection={collection}
                          asset={piggy.address}
                          equipped={piggy.equipped}
                          alt={`Piggy #${piggy.id}`}
                        />
                      </span>
                      <span className="truncate font-mono text-xs font-medium">#{piggy.id}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {!reading && shown && shown.length > 0 && unidentified > 0 && (
            <p className="mt-2 text-xs text-ink-muted">
              {unidentified} held asset{unidentified === 1 ? "" : "s"} could not be identified.
            </p>
          )}

          {/* Kept apart from the line above: a truncated read drops whole
              trailing collections, which is not a naming problem. */}
          {!reading && owned && truncated && (
            <p className="mt-2 text-xs text-ink-muted">
              Showing the first {owned.length} — this wallet holds more than the list can page
              through.
            </p>
          )}

          <div className="mt-2 flex gap-2">
            {owned && owned.length > limit && (
              <button type="button" onClick={() => setLimit((n) => n + PAGE)} className={GHOST}>
                Show {Math.min(PAGE, owned.length - limit)} more
              </button>
            )}
            <button type="button" onClick={refresh} disabled={reading} className={GHOST}>
              {reading ? "Reading…" : "Refresh"}
            </button>
          </div>
        </>
      )}

      {failure && (
        <p role="alert" className="mt-2 text-xs text-brand">
          {failure}
        </p>
      )}
    </section>
  );
}
