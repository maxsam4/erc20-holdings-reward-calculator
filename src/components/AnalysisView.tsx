import { useState, useMemo, useCallback } from "react";
import type { BalanceTimelines } from "../lib/balance";
import { computeTimeWeightedAverages } from "../lib/balance";
import type { TokenInfo } from "../lib/etherscan";
import { exportCSV, downloadCSV } from "../lib/csv";
import ResultsTable from "./ResultsTable";
import ExcludeAddresses from "./ExcludeAddresses";

interface AnalysisViewProps {
  timelines: BalanceTimelines;
  tokenInfo: TokenInfo;
  explorerUrl: string;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getPresetDates(preset: string): [string, string] {
  const now = new Date();
  switch (preset) {
    case "last30": {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      return [toDateInputValue(start), toDateInputValue(now)];
    }
    case "thisMonth": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return [toDateInputValue(start), toDateInputValue(now)];
    }
    case "lastMonth": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return [toDateInputValue(start), toDateInputValue(end)];
    }
    default:
      return ["", ""];
  }
}

export default function AnalysisView({
  timelines,
  tokenInfo,
  explorerUrl,
}: AnalysisViewProps) {
  const [preset, setPreset] = useState("last30");
  const defaultDates = getPresetDates("last30");
  const [startDate, setStartDate] = useState(defaultDates[0]);
  const [endDate, setEndDate] = useState(defaultDates[1]);
  const [totalReward, setTotalReward] = useState("");
  const [minBalance, setMinBalance] = useState("");
  const [excludedAddresses, setExcludedAddresses] = useState<string[]>([
    ZERO_ADDRESS,
  ]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  function handlePreset(value: string) {
    setPreset(value);
    if (value !== "custom") {
      const [s, e] = getPresetDates(value);
      setStartDate(s);
      setEndDate(e);
    }
  }

  const results = useMemo(() => {
    if (!startDate || !endDate) return [];
    const [sy, sm, sd] = startDate.split("-").map(Number);
    const startTime = Math.floor(
      new Date(sy, sm - 1, sd, 0, 0, 0).getTime() / 1000,
    );
    const [ey, em, ed] = endDate.split("-").map(Number);
    const endTime = Math.floor(
      new Date(ey, em - 1, ed, 23, 59, 59).getTime() / 1000,
    );
    const reward = parseFloat(totalReward) || 0;
    const minBal = minBalance
      ? BigInt(Math.floor(parseFloat(minBalance) * 10 ** tokenInfo.decimals))
      : 0n;
    const excluded = new Set(excludedAddresses);

    return computeTimeWeightedAverages(
      timelines,
      startTime,
      endTime,
      excluded,
      reward,
      minBal,
    );
  }, [
    timelines,
    startDate,
    endDate,
    totalReward,
    minBalance,
    excludedAddresses,
    tokenInfo.decimals,
  ]);

  const totalEffectiveBalance = useMemo(() => {
    let sum = 0n;
    for (const r of results) sum += r.avgBalance;
    return sum;
  }, [results]);

  const handleExport = useCallback(() => {
    const hasReward = !!totalReward && parseFloat(totalReward) > 0;
    const csv = exportCSV(
      results,
      tokenInfo.symbol,
      tokenInfo.decimals,
      hasReward,
    );
    downloadCSV(csv, `${tokenInfo.symbol}-rewards-${startDate}-${endDate}.csv`);
  }, [results, tokenInfo, totalReward, startDate, endDate]);

  const hasReward = !!totalReward && parseFloat(totalReward) > 0;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-800">
          Analysis Parameters
        </h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Date Range
            </label>
            <select
              value={preset}
              onChange={(e) => handlePreset(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              <option value="last30">Last 30 days</option>
              <option value="thisMonth">This month</option>
              <option value="lastMonth">Last month</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {preset === "custom" && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Total Reward
            </label>
            <input
              type="number"
              value={totalReward}
              onChange={(e) => setTotalReward(e.target.value)}
              placeholder="Optional"
              min="0"
              step="any"
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs font-medium text-blue-600 hover:text-blue-800"
          >
            {showAdvanced ? "Hide" : "Show"} Advanced Filters
          </button>
        </div>

        {showAdvanced && (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Min Avg Balance ({tokenInfo.symbol})
              </label>
              <input
                type="number"
                value={minBalance}
                onChange={(e) => setMinBalance(e.target.value)}
                placeholder="0"
                min="0"
                step="any"
                className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <ExcludeAddresses
              addresses={excludedAddresses}
              onChange={setExcludedAddresses}
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          <span className="font-medium">{results.length.toLocaleString()}</span>{" "}
          holders &middot; Total effective balance:{" "}
          <span className="font-mono">
            {(
              Number(totalEffectiveBalance) /
              10 ** tokenInfo.decimals
            ).toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
            {tokenInfo.symbol}
          </span>
          {preset === "custom" && startDate && endDate && (
            <>
              {" "}
              &middot; {startDate} to {endDate}
            </>
          )}
        </div>
        <button
          onClick={handleExport}
          disabled={results.length === 0}
          className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      <ResultsTable
        results={results}
        symbol={tokenInfo.symbol}
        decimals={tokenInfo.decimals}
        hasReward={hasReward}
        explorerUrl={explorerUrl}
      />
    </div>
  );
}
