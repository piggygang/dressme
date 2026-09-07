"use client";

import type { ReadyCollection } from "@/lib/collections";
import { useWallet } from "./wallet-provider";

/**
 * How many of this collection the connected wallet holds.
 *
 * Costs no request of its own: the provider read every collection's holdings
 * once for this address. Renders nothing until there is something true to say.
 *
 * `reported` rather than the row count, so the badge is right from the first
 * page — the Indexer returns the per-collection totals unpaginated on every
 * page, while the rows themselves may still be paging in.
 */
export function OwnedCount({ collection }: { collection: ReadyCollection }) {
  const { holdings } = useWallet();
  const source = collection.wallet;
  const count = source ? (holdings?.bySlug[source.slug]?.reported ?? null) : null;

  if (!count) return null;

  return (
    <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 font-mono text-[11px] text-[var(--accent)]">
      {count} yours
    </span>
  );
}
