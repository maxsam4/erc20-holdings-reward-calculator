import { erc20Abi } from "viem";
import type { Address, Chain, PublicClient, WalletClient } from "viem";

export interface TokenMeta {
  symbol: string;
  decimals: number;
  balance: bigint;
}

export async function readTokenMeta(
  client: PublicClient,
  token: Address,
  owner: Address,
): Promise<TokenMeta> {
  const [symbol, decimals, balance] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    }),
  ]);
  return { symbol, decimals, balance };
}

export function readAllowance(
  client: PublicClient,
  token: Address,
  owner: Address,
  spender: Address,
): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  });
}

// Sends an approve. Does not decode return data, so it tolerates non-standard
// tokens (e.g. USDT) that omit the bool return. The caller is responsible for
// the USDT-style "reset to 0 before raising a non-zero allowance" sequencing.
export function approve(
  walletClient: WalletClient,
  account: Address,
  chain: Chain,
  token: Address,
  spender: Address,
  amount: bigint,
): Promise<`0x${string}`> {
  return walletClient.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount],
    account,
    chain,
  });
}
