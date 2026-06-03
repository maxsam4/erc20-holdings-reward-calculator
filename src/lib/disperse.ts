import { keccak256 } from "viem";
import type { Address, Chain, PublicClient, WalletClient } from "viem";

export type DisperseAsset =
  | { kind: "native" }
  | { kind: "token"; token: Address };

export const DISPERSE_ADDRESS: Address =
  "0xD152f549545093347A162Dce210e7293f1452150";

// keccak256 of the canonical Disperse runtime bytecode. The contract is
// deployed at the same address with identical bytecode across every supported
// chain (deterministic deployment); this hash was read from the live Polygon
// deployment. Used to verify the on-chain code before approving/sending.
export const DISPERSE_CODEHASH =
  "0x65660051e320731a70b9ddcd5ec9fd4f565cf85e2f6caf0eb71589fb544b9996";

export const disperseAbi = [
  {
    type: "function",
    name: "disperseEther",
    stateMutability: "payable",
    inputs: [
      { name: "recipients", type: "address[]" },
      { name: "values", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "disperseToken",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "recipients", type: "address[]" },
      { name: "values", type: "uint256[]" },
    ],
    outputs: [],
  },
] as const;

export const DEFAULT_BATCH_SIZE = 100;

/**
 * Confirm the Disperse contract at DISPERSE_ADDRESS on the connected chain has
 * exactly the expected runtime bytecode before approving tokens to it or
 * sending value through it. Guards against a wrong or malicious contract at the
 * same address on an unknown/spoofed chain.
 */
export async function verifyDisperse(client: PublicClient): Promise<boolean> {
  const code = await client.getCode({ address: DISPERSE_ADDRESS });
  if (!code || code === "0x") return false;
  return keccak256(code) === DISPERSE_CODEHASH;
}

// Gas estimate for a single disperse batch. Throws (caught by callers) if the
// call would revert — e.g. a contract recipient rejecting the 2300-gas native
// transfer, or insufficient balance/allowance.
export function estimateDisperseGas(
  client: PublicClient,
  account: Address,
  asset: DisperseAsset,
  recipients: Address[],
  values: bigint[],
): Promise<bigint> {
  if (asset.kind === "native") {
    return client.estimateContractGas({
      address: DISPERSE_ADDRESS,
      abi: disperseAbi,
      functionName: "disperseEther",
      args: [recipients, values],
      account,
      value: sumAmounts(values),
    });
  }
  return client.estimateContractGas({
    address: DISPERSE_ADDRESS,
    abi: disperseAbi,
    functionName: "disperseToken",
    args: [asset.token, recipients, values],
    account,
  });
}

export function sendDisperse(
  walletClient: WalletClient,
  account: Address,
  chain: Chain,
  asset: DisperseAsset,
  recipients: Address[],
  values: bigint[],
): Promise<`0x${string}`> {
  if (asset.kind === "native") {
    return walletClient.writeContract({
      address: DISPERSE_ADDRESS,
      abi: disperseAbi,
      functionName: "disperseEther",
      args: [recipients, values],
      account,
      chain,
      value: sumAmounts(values),
    });
  }
  return walletClient.writeContract({
    address: DISPERSE_ADDRESS,
    abi: disperseAbi,
    functionName: "disperseToken",
    args: [asset.token, recipients, values],
    account,
    chain,
  });
}

export function sumAmounts(amounts: bigint[]): bigint {
  let total = 0n;
  for (const a of amounts) total += a;
  return total;
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error(`chunk size must be >= 1, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Group `items` into batches that each fit under `gasCap`. Starts from
 * `maxSize`-sized chunks and binary-splits any chunk whose estimated gas
 * exceeds the cap (or whose estimation throws — e.g. a simulated revert).
 * A single item that still doesn't fit is returned on its own so the failure
 * surfaces at send time rather than silently dropping recipients. Order is
 * preserved.
 */
export async function splitToFittingBatches<T>(
  items: T[],
  estimate: (batch: T[]) => Promise<bigint>,
  gasCap: bigint,
  maxSize: number,
): Promise<T[][]> {
  async function fits(batch: T[]): Promise<boolean> {
    try {
      return (await estimate(batch)) <= gasCap;
    } catch {
      return false;
    }
  }

  async function fit(batch: T[]): Promise<T[][]> {
    if (batch.length <= 1 || (await fits(batch))) return [batch];
    const mid = Math.ceil(batch.length / 2);
    const left = await fit(batch.slice(0, mid));
    const right = await fit(batch.slice(mid));
    return [...left, ...right];
  }

  const result: T[][] = [];
  for (const c of chunk(items, maxSize)) {
    result.push(...(await fit(c)));
  }
  return result;
}

/**
 * Split `totalAtomic` across recipients proportionally to integer `weights`,
 * in exact base units. Uses floored proportional shares plus the
 * largest-remainder method so the returned amounts sum to *exactly*
 * `totalAtomic` with no dust loss. Ties in the fractional remainder are broken
 * by lower index for determinism.
 */
export function computeAtomicAmounts(
  weights: bigint[],
  totalAtomic: bigint,
): bigint[] {
  if (totalAtomic < 0n) throw new Error("totalAtomic must be >= 0");

  let W = 0n;
  for (const w of weights) {
    if (w < 0n) throw new Error("weights must be non-negative");
    W += w;
  }
  if (W <= 0n) throw new Error("total weight must be > 0");

  const amounts = new Array<bigint>(weights.length);
  const remainders: Array<{ index: number; rem: bigint }> = [];
  let distributed = 0n;

  for (let i = 0; i < weights.length; i++) {
    const numerator = totalAtomic * weights[i];
    const floor = numerator / W;
    amounts[i] = floor;
    distributed += floor;
    remainders.push({ index: i, rem: numerator % W });
  }

  // The leftover is strictly less than the number of recipients.
  let remainder = totalAtomic - distributed;
  remainders.sort((a, b) => {
    if (a.rem !== b.rem) return a.rem > b.rem ? -1 : 1;
    return a.index - b.index;
  });
  for (let k = 0; k < remainders.length && remainder > 0n; k++) {
    amounts[remainders[k].index] += 1n;
    remainder -= 1n;
  }

  return amounts;
}
