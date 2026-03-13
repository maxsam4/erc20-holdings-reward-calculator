export const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api";

export interface Chain {
  id: string;
  name: string;
  chainId: number;
  blockExplorerUrl: string;
}

export const chains: Chain[] = [
  {
    id: "ethereum",
    name: "Ethereum",
    chainId: 1,
    blockExplorerUrl: "https://etherscan.io",
  },
  {
    id: "polygon",
    name: "Polygon",
    chainId: 137,
    blockExplorerUrl: "https://polygonscan.com",
  },
  {
    id: "bsc",
    name: "BSC",
    chainId: 56,
    blockExplorerUrl: "https://bscscan.com",
  },
  {
    id: "arbitrum",
    name: "Arbitrum",
    chainId: 42161,
    blockExplorerUrl: "https://arbiscan.io",
  },
  {
    id: "optimism",
    name: "Optimism",
    chainId: 10,
    blockExplorerUrl: "https://optimistic.etherscan.io",
  },
  {
    id: "base",
    name: "Base",
    chainId: 8453,
    blockExplorerUrl: "https://basescan.org",
  },
  {
    id: "avalanche",
    name: "Avalanche",
    chainId: 43114,
    blockExplorerUrl: "https://snowscan.xyz",
  },
];

export const defaultChain = chains[0];
