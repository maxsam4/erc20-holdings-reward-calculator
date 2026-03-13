import { useState, useMemo, useEffect } from "react";
import type { HolderResult } from "../lib/balance";
import { formatBalance } from "../lib/balance";

interface ResultsTableProps {
  results: HolderResult[];
  symbol: string;
  decimals: number;
  hasReward: boolean;
  explorerUrl: string;
}

type SortKey = "address" | "avgBalance" | "percentage" | "reward";

const PAGE_SIZE = 50;

export default function ResultsTable({
  results,
  symbol,
  decimals,
  hasReward,
  explorerUrl,
}: ResultsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("avgBalance");
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!search) return results;
    const q = search.toLowerCase();
    return results.filter((r) => r.address.includes(q));
  }, [results, search]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "address":
          cmp = a.address.localeCompare(b.address);
          break;
        case "avgBalance":
          cmp = a.avgBalance > b.avgBalance ? 1 : a.avgBalance < b.avgBalance ? -1 : 0;
          break;
        case "percentage":
          cmp = a.percentage - b.percentage;
          break;
        case "reward":
          cmp = a.reward - b.reward;
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortAsc]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

  // Clamp page when results shrink
  useEffect(() => {
    if (totalPages > 0 && page >= totalPages) {
      setPage(totalPages - 1);
    }
  }, [totalPages, page]);

  const clampedPage = totalPages > 0 ? Math.min(page, totalPages - 1) : 0;
  const pageResults = sorted.slice(
    clampedPage * PAGE_SIZE,
    (clampedPage + 1) * PAGE_SIZE,
  );

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
    setPage(0);
  }

  const sortIcon = (key: SortKey) =>
    sortKey === key ? (sortAsc ? " \u25B2" : " \u25BC") : "";

  return (
    <div>
      <input
        type="text"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
        placeholder="Search by address..."
        className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      />

      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th
                onClick={() => handleSort("address")}
                className="cursor-pointer px-4 py-2 text-left font-medium text-gray-600"
              >
                Address{sortIcon("address")}
              </th>
              <th
                onClick={() => handleSort("avgBalance")}
                className="cursor-pointer px-4 py-2 text-right font-medium text-gray-600"
              >
                Avg Balance{sortIcon("avgBalance")}
              </th>
              <th
                onClick={() => handleSort("percentage")}
                className="cursor-pointer px-4 py-2 text-right font-medium text-gray-600"
              >
                % of Total{sortIcon("percentage")}
              </th>
              {hasReward && (
                <th
                  onClick={() => handleSort("reward")}
                  className="cursor-pointer px-4 py-2 text-right font-medium text-gray-600"
                >
                  Reward{sortIcon("reward")}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {pageResults.map((r) => (
              <tr key={r.address} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-xs">
                  <a
                    href={`${explorerUrl}/address/${r.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline break-all"
                  >
                    {r.address}
                  </a>
                </td>
                <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                  {formatBalance(r.avgBalance, decimals, 2)} {symbol}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {(r.percentage * 100).toFixed(4)}%
                </td>
                {hasReward && (
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                    {r.reward.toFixed(2)}
                  </td>
                )}
              </tr>
            ))}
            {pageResults.length === 0 && (
              <tr>
                <td
                  colSpan={hasReward ? 4 : 3}
                  className="px-4 py-8 text-center text-gray-400"
                >
                  No results
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
          <span>
            Showing {clampedPage * PAGE_SIZE + 1}–
            {Math.min((clampedPage + 1) * PAGE_SIZE, sorted.length)} of{" "}
            {sorted.length.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="rounded border px-3 py-1 disabled:opacity-30"
            >
              Prev
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="rounded border px-3 py-1 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
