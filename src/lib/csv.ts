import type { HolderResult } from "./balance";

function formatBalanceRaw(value: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = (value < 0n ? -value : value) % divisor;
  const fractionStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  if (fractionStr) {
    return `${whole}.${fractionStr}`;
  }
  return whole.toString();
}

export function exportCSV(
  results: HolderResult[],
  symbol: string,
  decimals: number,
  hasReward: boolean,
): string {
  const headers = hasReward
    ? ["Address", `Avg Balance (${symbol})`, "% of Total", "Reward"]
    : ["Address", `Avg Balance (${symbol})`, "% of Total"];

  const rows = results.map((r) => {
    const base = [
      r.address,
      formatBalanceRaw(r.avgBalance, decimals),
      (r.percentage * 100).toFixed(6),
    ];
    if (hasReward) base.push(r.reward.toFixed(6));
    return base;
  });

  const lines = [headers, ...rows].map((row) => row.join(","));
  return lines.join("\n");
}

export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
