import {
  mainnet,
  polygon,
  bsc,
  arbitrum,
  optimism,
  base,
  avalanche,
} from "viem/chains";
import type { Chain as ViemChain } from "viem";

// Maps our numeric EVM chainId to the viem chain definition, which carries the
// native-currency metadata (e.g. POL on Polygon) and public RPC URLs that our
// own chains.ts intentionally omits but wallet_switchEthereumChain /
// wallet_addEthereumChain require.
export const viemChainById: Record<number, ViemChain> = {
  [mainnet.id]: mainnet,
  [polygon.id]: polygon,
  [bsc.id]: bsc,
  [arbitrum.id]: arbitrum,
  [optimism.id]: optimism,
  [base.id]: base,
  [avalanche.id]: avalanche,
};

export function getViemChain(chainId: number | null | undefined): ViemChain | undefined {
  if (chainId == null) return undefined;
  return viemChainById[chainId];
}

export function nativeSymbol(chainId: number | null | undefined): string {
  return getViemChain(chainId)?.nativeCurrency.symbol ?? "ETH";
}
