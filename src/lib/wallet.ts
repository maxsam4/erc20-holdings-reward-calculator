import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, createWalletClient, custom, getAddress } from "viem";
import type { Address, PublicClient, WalletClient } from "viem";
import { getViemChain } from "./viemChains";

export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
}

export type WalletStatus = "disconnected" | "connecting" | "connected";

export interface WalletState {
  providers: EIP6963ProviderDetail[];
  status: WalletStatus;
  account: Address | null;
  chainId: number | null;
  error: string | null;
  walletClient: WalletClient | null;
  publicClient: PublicClient | null;
  connect: (uuid: string) => Promise<void>;
  disconnect: () => void;
  switchChain: (chainId: number) => Promise<void>;
}

// EIP-6963 multi-wallet discovery. Providers are keyed by the stable
// info.uuid; info.name/icon/rdns are display metadata only. Falls back to a
// legacy window.ethereum injection when no EIP-6963 wallet announces itself.
function useDiscoveredProviders(): EIP6963ProviderDetail[] {
  const [providers, setProviders] = useState<EIP6963ProviderDetail[]>([]);

  useEffect(() => {
    const byUuid = new Map<string, EIP6963ProviderDetail>();

    function onAnnounce(event: Event) {
      const detail = (event as CustomEvent<EIP6963ProviderDetail>).detail;
      if (detail?.info?.uuid && detail.provider) {
        byUuid.set(detail.info.uuid, detail);
        setProviders(Array.from(byUuid.values()));
      }
    }

    window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    // Legacy fallback: surface window.ethereum if nothing announced.
    const injected = (window as unknown as { ethereum?: EIP1193Provider & Record<string, unknown> }).ethereum;
    if (injected) {
      const name = injected.isRabby
        ? "Rabby"
        : injected.isMetaMask
          ? "MetaMask"
          : "Browser Wallet";
      if (![...byUuid.values()].some((p) => p.provider === injected)) {
        byUuid.set("injected", {
          info: { uuid: "injected", name, icon: "", rdns: "injected" },
          provider: injected,
        });
        setProviders(Array.from(byUuid.values()));
      }
    }

    return () =>
      window.removeEventListener("eip6963:announceProvider", onAnnounce as EventListener);
  }, []);

  return providers;
}

export function useWallet(): WalletState {
  const providers = useDiscoveredProviders();
  const [provider, setProvider] = useState<EIP1193Provider | null>(null);
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const disconnect = useCallback(() => {
    setProvider(null);
    setAccount(null);
    setChainId(null);
    setStatus("disconnected");
    setError(null);
  }, []);

  // Track wallet-side account/chain changes so the UI (and any in-flight send)
  // reacts immediately.
  useEffect(() => {
    if (!provider?.on) return;
    const handleAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      if (!accounts || accounts.length === 0) disconnect();
      else setAccount(getAddress(accounts[0]));
    };
    const handleChain = (...args: unknown[]) => {
      setChainId(parseInt(args[0] as string, 16));
    };
    provider.on("accountsChanged", handleAccounts);
    provider.on("chainChanged", handleChain);
    return () => {
      provider.removeListener?.("accountsChanged", handleAccounts);
      provider.removeListener?.("chainChanged", handleChain);
    };
  }, [provider, disconnect]);

  const connect = useCallback(
    async (uuid: string) => {
      const detail = providers.find((p) => p.info.uuid === uuid);
      if (!detail) {
        setError("Wallet not found");
        return;
      }
      setStatus("connecting");
      setError(null);
      try {
        const accounts = (await detail.provider.request({
          method: "eth_requestAccounts",
        })) as string[];
        const hexChain = (await detail.provider.request({
          method: "eth_chainId",
        })) as string;
        setProvider(detail.provider);
        setAccount(getAddress(accounts[0]));
        setChainId(parseInt(hexChain, 16));
        setStatus("connected");
      } catch (e) {
        setStatus("disconnected");
        setError(e instanceof Error ? e.message : "Failed to connect");
      }
    },
    [providers],
  );

  const switchChain = useCallback(
    async (target: number) => {
      if (!provider) return;
      const hexId = `0x${target.toString(16)}`;
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: hexId }],
        });
      } catch (e) {
        const code = (e as { code?: number })?.code;
        if (code === 4902) {
          const vc = getViemChain(target);
          if (!vc) {
            setError("Unsupported chain");
            return;
          }
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: hexId,
                chainName: vc.name,
                nativeCurrency: vc.nativeCurrency,
                rpcUrls: vc.rpcUrls.default.http,
                blockExplorerUrls: vc.blockExplorers
                  ? [vc.blockExplorers.default.url]
                  : [],
              },
            ],
          });
        } else if (code !== 4001) {
          setError(e instanceof Error ? e.message : "Failed to switch chain");
        }
      }
      // chainChanged fires on success and updates chainId.
    },
    [provider],
  );

  const { walletClient, publicClient } = useMemo<{
    walletClient: WalletClient | null;
    publicClient: PublicClient | null;
  }>(() => {
    if (!provider || !account) return { walletClient: null, publicClient: null };
    const chain = getViemChain(chainId);
    const transport = custom(provider);
    return {
      walletClient: createWalletClient({ account, chain, transport }),
      publicClient: createPublicClient({ chain, transport }) as PublicClient,
    };
  }, [provider, account, chainId]);

  return {
    providers,
    status,
    account,
    chainId,
    error,
    walletClient,
    publicClient,
    connect,
    disconnect,
    switchChain,
  };
}
