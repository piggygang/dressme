"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { walletQueries } from "@/lib/collections";
import { getWalletHoldings, type WalletHoldings } from "@/lib/indexer";
import {
  connect as connectWallet,
  disconnect as disconnectWallet,
  listWallets,
  onAccountsChange,
  onWalletsChange,
  type SolanaWallet,
} from "@/lib/wallet";
import { WalletModal } from "./wallet-modal";

/**
 * Everything wallet-shaped, held once for the whole app so the navbar, the
 * landing cards and the editor all read the same connection.
 *
 * Holdings are read **once per address**, not per collection: one cursor chain
 * over the Indexer's wallet endpoint returns every piggy the address holds in
 * every collection at once, already keyed by token id. Consumers therefore
 * never touch the network, and moving between collections costs nothing.
 */
type WalletState = {
  wallets: SolanaWallet[];
  wallet: SolanaWallet | null;
  address: string | null;
  /** Holdings per collection, or null before a successful read. */
  holdings: WalletHoldings | null;
  reading: boolean;
  error: string | null;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  connect: (wallet: SolanaWallet) => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => void;
};

const WalletContext = createContext<WalletState | null>(null);

// Which collections a connected address is read against is config, not state.
const QUERIES = walletQueries();

export function useWallet(): WalletState {
  const state = useContext(WalletContext);
  if (!state) throw new Error("useWallet must be used inside <WalletProvider>");
  return state;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<SolanaWallet[]>([]);
  const [wallet, setWallet] = useState<SolanaWallet | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [nonce, setNonce] = useState(0);

  // The read is stored against the inputs that produced it, so everything about
  // it can be *derived* rather than reset — which is what keeps the effect below
  // free of synchronous setState and its cascading renders.
  const [read, setRead] = useState<{
    key: string;
    holdings: WalletHoldings | null;
    error: string | null;
  } | null>(null);
  const key = address ? `${address}|${nonce}` : null;
  const current = read?.key === key ? read : null;
  const holdings = current?.holdings ?? null;
  const reading = key !== null && current === null;
  const error = connectionError ?? current?.error ?? null;

  // Wallets register asynchronously and localStorage is browser-only, so both
  // are read after hydration rather than during render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot hydration of browser-only state
    setWallets(listWallets());
    // Holders who once set their own RPC endpoint no longer have one to set.
    try {
      window.localStorage.removeItem("piggy.rpc-endpoint");
    } catch {
      // A browser with storage blocked has nothing to clean up.
    }
    return onWalletsChange(setWallets);
  }, []);

  // The one read. Re-runs when the address or an explicit refresh changes —
  // never when the visitor moves between collections. It aborts its in-flight
  // pagination when the address changes mid-read; the aborted rejection lands
  // in the catch, where the dead `live` flag swallows it.
  useEffect(() => {
    if (!key || !address) return;
    let live = true;
    const controller = new AbortController();
    getWalletHoldings(address, QUERIES, { nonce, signal: controller.signal })
      .then((result) => live && setRead({ key, holdings: result, error: null }))
      .catch((cause: unknown) => {
        if (!live) return;
        const message = cause instanceof Error ? cause.message : "Could not read the wallet.";
        setRead({ key, holdings: null, error: message });
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [key, address, nonce]);

  // The holder can switch or lock accounts inside the wallet while we are open.
  useEffect(() => {
    if (!wallet) return;
    return onAccountsChange(wallet, ([next]) => setAddress(next ?? null));
  }, [wallet]);

  const connect = useCallback(async (candidate: SolanaWallet) => {
    setConnectionError(null);
    try {
      const [first] = await connectWallet(candidate);
      if (!first) {
        setConnectionError("That wallet did not share an account.");
        return;
      }
      setWallet(candidate);
      setAddress(first);
    } catch {
      setConnectionError("Connection was declined.");
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (wallet) await disconnectWallet(wallet).catch(() => {});
    // Clearing the address invalidates the read's key, so `holdings` derives
    // back to null on its own.
    setWallet(null);
    setAddress(null);
    setConnectionError(null);
  }, [wallet]);

  const value = useMemo<WalletState>(
    () => ({
      wallets,
      wallet,
      address,
      holdings,
      reading,
      error,
      modalOpen,
      openModal: () => setModalOpen(true),
      closeModal: () => setModalOpen(false),
      connect,
      disconnect,
      refresh: () => setNonce((previous) => previous + 1),
    }),
    [wallets, wallet, address, holdings, reading, error, modalOpen, connect, disconnect],
  );

  // A fragment, deliberately: <body> is a flex column whose children are the
  // header, main and footer, and a wrapper element would break that. A closed
  // <dialog> is display:none, so the modal adds no layout either.
  return (
    <WalletContext value={value}>
      {children}
      <WalletModal />
    </WalletContext>
  );
}
