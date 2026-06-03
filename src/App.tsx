import { useState, useRef, useCallback } from "react";
import type { Chain } from "./lib/chains";
import type { RawTransferEvent, TokenInfo } from "./lib/etherscan";
import { fetchTransferEvents, fetchTokenInfo } from "./lib/etherscan";
import type { BalanceTimelines } from "./lib/balance";
import { buildBalanceTimelines } from "./lib/balance";
import {
  getCachedEvents,
  setCachedEvents,
  getLastCachedBlock,
  setLastCachedBlock,
  getCachedTokenInfo,
  setCachedTokenInfo,
} from "./lib/storage";
import ConfigForm from "./components/ConfigForm";
import FetchProgress from "./components/FetchProgress";
import AnalysisView from "./components/AnalysisView";

type AppState =
  | { step: "config" }
  | { step: "fetching"; count: number; status: string }
  | {
      step: "analysis";
      timelines: BalanceTimelines;
      tokenInfo: TokenInfo;
      tokenAddress: string;
      chain: Chain;
    }
  | { step: "error"; message: string };

export default function App() {
  const [state, setState] = useState<AppState>({ step: "config" });
  const abortRef = useRef<AbortController | null>(null);

  const handleFetch = useCallback(
    async (chain: Chain, tokenAddress: string, apiKey: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ step: "fetching", count: 0, status: "Detecting token..." });

      try {
        let tokenInfo = getCachedTokenInfo(chain.id, tokenAddress);
        if (!tokenInfo) {
          tokenInfo = await fetchTokenInfo(
            chain.chainId,
            tokenAddress,
            apiKey,
          );
          setCachedTokenInfo(chain.id, tokenAddress, tokenInfo);
        }

        setState({
          step: "fetching",
          count: 0,
          status: `Fetching ${tokenInfo.symbol} transfers...`,
        });

        // Check cache for incremental fetch
        const cachedEvents = await getCachedEvents(chain.id, tokenAddress);
        const lastBlock = await getLastCachedBlock(chain.id, tokenAddress);

        const fromBlock = lastBlock > 0 ? lastBlock + 1 : 0;
        let eventCount = cachedEvents.length;

        const newEvents = await fetchTransferEvents(
          chain.chainId,
          tokenAddress,
          apiKey,
          fromBlock,
          (count) => {
            eventCount = cachedEvents.length + count;
            setState({
              step: "fetching",
              count: eventCount,
              status: `Fetching ${tokenInfo.symbol} transfers...`,
            });
          },
          controller.signal,
        );

        // Merge and cache
        const allEvents: RawTransferEvent[] = [
          ...cachedEvents,
          ...newEvents,
        ];

        if (newEvents.length > 0) {
          const maxBlock = newEvents.reduce((max, e) => {
            const bn = parseInt(e.blockNumber, 16);
            return bn > max ? bn : max;
          }, lastBlock);

          await setCachedEvents(chain.id, tokenAddress, allEvents);
          await setLastCachedBlock(chain.id, tokenAddress, maxBlock);
        }

        setState({
          step: "fetching",
          count: allEvents.length,
          status: "Building balance timelines...",
        });

        const timelines = buildBalanceTimelines(allEvents);

        setState({ step: "analysis", timelines, tokenInfo, tokenAddress, chain });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({
          step: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [],
  );

  function handleReset() {
    abortRef.current?.abort();
    setState({ step: "config" });
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          ERC20 Holdings Reward Calculator
        </h1>
        <p className="text-sm text-gray-500">
          Calculate time-weighted average holdings and distribute rewards
          proportionally
        </p>
      </header>

      {state.step === "config" && (
        <div className="mx-auto max-w-md">
          <ConfigForm onSubmit={handleFetch} disabled={false} />
        </div>
      )}

      {state.step === "fetching" && (
        <div className="mx-auto max-w-md space-y-4">
          <ConfigForm onSubmit={handleFetch} disabled={true} />
          <FetchProgress count={state.count} status={state.status} />
        </div>
      )}

      {state.step === "error" && (
        <div className="mx-auto max-w-md space-y-4">
          <ConfigForm onSubmit={handleFetch} disabled={false} />
          <div className="rounded-md border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-800">{state.message}</p>
          </div>
        </div>
      )}

      {state.step === "analysis" && (
        <div>
          <div className="mb-6 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Token:{" "}
              <span className="font-semibold">
                {state.tokenInfo.name} ({state.tokenInfo.symbol})
              </span>
            </div>
            <button
              onClick={handleReset}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Change Token
            </button>
          </div>
          <AnalysisView
            timelines={state.timelines}
            tokenInfo={state.tokenInfo}
            tokenAddress={state.tokenAddress}
            chain={state.chain}
          />
        </div>
      )}
    </div>
  );
}
