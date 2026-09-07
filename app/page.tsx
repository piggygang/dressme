import { CollectionCard } from "@/components/collection-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { PiggyMark } from "@/components/brand/wordmark";
import { ConnectButton } from "@/components/wallet/connect-button";
import { COLLECTIONS } from "@/lib/collections";
import { getCollectionStats } from "@/lib/indexer";

/**
 * ISR. The cards carry live supply and holder counts, which move only as piggies
 * are traded or swapped, so an hour is plenty — and this keeps the page
 * prerendered rather than making it dynamic (only `revalidate = 0` would do
 * that). Scoped to this leaf page: the `/dress/[collection]` routes are not in
 * its segment chain and stay fully static.
 */
export const revalidate = 3600;

export default async function Home() {
  // The app's one server-side read. Resolves to {} if the index is unreachable,
  // so the cards fall back to their shipped numbers and the build still passes.
  const stats = await getCollectionStats();

  return (
    <>
      <SiteHeader>
        <ConnectButton />
      </SiteHeader>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-6xl px-5 pt-14 pb-12 text-center sm:pt-20">
          <PiggyMark className="mx-auto h-16 w-16" />
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Dress your piggy for any occasion
          </h1>
          <p className="mx-auto mt-4 max-w-md text-base text-ink-muted text-pretty sm:text-lg">
            Pick your collection, layer up the traits and take the look home as a
            PNG. Free — or connect a wallet to dress the piggies you own.
          </p>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 pb-16">
          <h2 className="mb-4 text-sm font-medium tracking-[0.14em] text-ink-muted uppercase">
            Collections
          </h2>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {COLLECTIONS.map((collection) => (
              <li key={collection.slug} className="flex">
                <CollectionCard collection={collection} stats={stats} />
              </li>
            ))}
          </ul>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
