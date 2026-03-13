import type { RawTransferEvent } from "./etherscan";

export interface BalanceChange {
  blockNumber: number;
  timestamp: number;
  balance: bigint;
}

export type BalanceTimelines = Map<string, BalanceChange[]>;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function buildBalanceTimelines(
  events: RawTransferEvent[],
): BalanceTimelines {
  // Sort by block number then log index
  const sorted = [...events].sort((a, b) => {
    const blockA = parseInt(a.blockNumber, 16);
    const blockB = parseInt(b.blockNumber, 16);
    if (blockA !== blockB) return blockA - blockB;
    return parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16);
  });

  const currentBalances = new Map<string, bigint>();
  const timelines: BalanceTimelines = new Map();

  for (const event of sorted) {
    const from = event.from;
    const to = event.to;
    const value = BigInt(event.value);
    const blockNumber = parseInt(event.blockNumber, 16);
    const timestamp = parseInt(event.timeStamp, 16);

    // Update sender balance
    if (from !== ZERO_ADDRESS) {
      const prevBalance = currentBalances.get(from) || 0n;
      const newBalance = prevBalance - value;
      currentBalances.set(from, newBalance);

      if (!timelines.has(from)) timelines.set(from, []);
      timelines.get(from)!.push({ blockNumber, timestamp, balance: newBalance });
    }

    // Update receiver balance
    if (to !== ZERO_ADDRESS) {
      const prevBalance = currentBalances.get(to) || 0n;
      const newBalance = prevBalance + value;
      currentBalances.set(to, newBalance);

      if (!timelines.has(to)) timelines.set(to, []);
      timelines.get(to)!.push({ blockNumber, timestamp, balance: newBalance });
    }
  }

  return timelines;
}

export interface HolderResult {
  address: string;
  avgBalance: bigint;
  percentage: number;
  reward: number;
}

export function computeTimeWeightedAverages(
  timelines: BalanceTimelines,
  startTime: number,
  endTime: number,
  excludedAddresses: Set<string>,
  totalReward: number,
  minBalanceThreshold: bigint,
): HolderResult[] {
  const totalDuration = BigInt(endTime - startTime);
  if (totalDuration <= 0n) return [];

  const results: HolderResult[] = [];
  let grandTotalWeighted = 0n;

  // First pass: compute time-weighted balances
  const weightedBalances = new Map<string, bigint>();

  for (const [address, changes] of timelines) {
    if (excludedAddresses.has(address)) continue;

    // Find the balance at startTime (last change at or before startTime)
    let balanceAtStart = 0n;
    let startIdx = 0;
    for (let i = 0; i < changes.length; i++) {
      if (changes[i].timestamp <= startTime) {
        balanceAtStart = changes[i].balance;
        startIdx = i + 1;
      } else {
        break;
      }
    }

    let weightedSum = 0n;
    let currentBalance = balanceAtStart;
    let currentTime = startTime;

    // Walk through changes within the window
    for (let i = startIdx; i < changes.length; i++) {
      const change = changes[i];
      if (change.timestamp >= endTime) break;

      const duration = BigInt(change.timestamp - currentTime);
      weightedSum += currentBalance * duration;
      currentBalance = change.balance;
      currentTime = change.timestamp;
    }

    // Account for remaining time until endTime
    const remainingDuration = BigInt(endTime - currentTime);
    weightedSum += currentBalance * remainingDuration;

    const avgBalance = weightedSum / totalDuration;
    if (avgBalance < minBalanceThreshold) continue;

    weightedBalances.set(address, avgBalance);
    grandTotalWeighted += avgBalance;
  }

  if (grandTotalWeighted === 0n) return [];

  // Second pass: compute percentages and rewards using BigInt precision
  // Scale factor for percentage: 10^18 gives 18 digits of precision
  const SCALE = 10n ** 18n;

  for (const [address, avgBalance] of weightedBalances) {
    // percentage as a scaled bigint: (avgBalance * SCALE) / grandTotal
    const scaledPct = (avgBalance * SCALE) / grandTotalWeighted;
    const percentage = Number(scaledPct) / Number(SCALE);
    const reward = totalReward * percentage;

    results.push({
      address,
      avgBalance,
      percentage,
      reward,
    });
  }

  // Sort by avg balance descending
  results.sort((a, b) => (b.avgBalance > a.avgBalance ? 1 : -1));

  return results;
}

export function formatBalance(
  value: bigint,
  decimals: number,
  maxDisplayDecimals?: number,
): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  const fractionStr = fraction.toString().padStart(decimals, "0");
  const limit = maxDisplayDecimals ?? 6;
  const trimmed = fractionStr.slice(0, limit).replace(/0+$/, "");
  if (trimmed) {
    return `${whole.toLocaleString()}.${trimmed}`;
  }
  return whole.toLocaleString();
}
