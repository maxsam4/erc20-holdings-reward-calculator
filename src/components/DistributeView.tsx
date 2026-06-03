import { useEffect, useMemo, useState } from "react";
import { formatUnits, getAddress, isAddress, parseUnits } from "viem";
import type { Address } from "viem";
import type { Chain } from "../lib/chains";
import type { HolderResult } from "../lib/balance";
import { computeAtomicAmounts, DEFAULT_BATCH_SIZE, type DisperseAsset } from "../lib/disperse";
import { readTokenMeta, type TokenMeta } from "../lib/erc20";
import { getViemChain, nativeSymbol } from "../lib/viemChains";
import { useWallet } from "../lib/wallet";
import WalletConnect from "./WalletConnect";
import RecipientEditor, {
  type EditorState,
  type ParsedRecipient,
} from "./RecipientEditor";
import DistributeProgress from "./DistributeProgress";

interface DistributeViewProps {
  results: HolderResult[];
  analyzedToken: { address: string; symbol: string; decimals: number };
  analysisChain: Chain;
  defaultTotal: string;
  onClose: () => void;
}

type TokenChoice = "native" | "analyzed" | "custom";
type Step = "configure" | "review" | "send";

function aggregate(recipients: ParsedRecipient[]): ParsedRecipient[] {
  const map = new Map<Address, bigint>();
  for (const r of recipients) {
    map.set(r.address, (map.get(r.address) ?? 0n) + r.amount);
  }
  return [...map.entries()].map(([address, amount]) => ({ address, amount }));
}

export default function DistributeView({
  results,
  analyzedToken,
  analysisChain,
  defaultTotal,
  onClose,
}: DistributeViewProps) {
  const wallet = useWallet();
  const connected = wallet.status === "connected" && !!wallet.account;

  const [step, setStep] = useState<Step>("configure");
  const [tokenChoice, setTokenChoice] = useState<TokenChoice>("native");
  const [customAddress, setCustomAddress] = useState("");
  const [total, setTotal] = useState(defaultTotal);
  const [rawMode, setRawMode] = useState(false);
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);

  const [meta, setMeta] = useState<TokenMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [initialRows, setInitialRows] = useState<ParsedRecipient[]>([]);

  const weights = useMemo(() => results.map((r) => r.avgBalance), [results]);

  const tokenAddress: Address | null = useMemo(() => {
    if (tokenChoice === "analyzed" && isAddress(analyzedToken.address))
      return getAddress(analyzedToken.address);
    if (tokenChoice === "custom" && isAddress(customAddress))
      return getAddress(customAddress);
    return null;
  }, [tokenChoice, customAddress, analyzedToken.address]);

  const asset: DisperseAsset | null = useMemo(() => {
    if (tokenChoice === "native") return { kind: "native" };
    if (tokenAddress) return { kind: "token", token: tokenAddress };
    return null;
  }, [tokenChoice, tokenAddress]);

  // Load reward-token metadata (decimals/symbol/balance) for the connected chain.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setMetaError(null);
      setMetaLoading(false);
      if (!connected || !wallet.publicClient || !wallet.account) {
        setMeta(null);
        return;
      }
      if (tokenChoice === "native") {
        try {
          const bal = await wallet.publicClient.getBalance({ address: wallet.account });
          if (!cancelled)
            setMeta({
              symbol: nativeSymbol(wallet.chainId),
              decimals: getViemChain(wallet.chainId)?.nativeCurrency.decimals ?? 18,
              balance: bal,
            });
        } catch (e) {
          if (!cancelled) setMetaError(e instanceof Error ? e.message : String(e));
        }
        return;
      }
      if (!tokenAddress) {
        setMeta(null);
        return;
      }
      setMetaLoading(true);
      try {
        const m = await readTokenMeta(wallet.publicClient, tokenAddress, wallet.account);
        if (!cancelled) setMeta(m);
      } catch {
        if (!cancelled) {
          setMeta(null);
          setMetaError("Could not read token on this chain. Check the address and network.");
        }
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [connected, wallet.publicClient, wallet.account, wallet.chainId, tokenChoice, tokenAddress]);

  const decimals = meta?.decimals ?? 18;
  const symbol = meta?.symbol ?? "";

  function goReview() {
    let totalAtomic: bigint;
    try {
      totalAtomic = total.trim() ? parseUnits(total, decimals) : 0n;
    } catch {
      setMetaError("Invalid total amount for this token's decimals.");
      return;
    }
    let amounts: bigint[];
    try {
      amounts = computeAtomicAmounts(weights, totalAtomic);
    } catch (e) {
      setMetaError(e instanceof Error ? e.message : "Could not compute amounts.");
      return;
    }
    setInitialRows(
      results.map((r, i) => ({ address: getAddress(r.address), amount: amounts[i] })),
    );
    setStep("review");
  }

  const analyzedChainMismatch =
    tokenChoice === "analyzed" && wallet.chainId !== analysisChain.chainId;

  const sendRecipients = editorState ? aggregate(editorState.recipients) : [];
  const explorerUrl = getViemChain(wallet.chainId)?.blockExplorers?.default.url ?? analysisChain.blockExplorerUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-2xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-base font-semibold text-gray-900">
            Distribute rewards
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700"
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          <WalletConnect wallet={wallet} />

          {!connected ? (
            <p className="text-sm text-gray-500">
              Connect a wallet to continue. Rewards send on the wallet's current
              network (Polygon recommended) — independent of the analysis chain.
            </p>
          ) : step === "configure" ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Reward token
                </label>
                <div className="flex flex-wrap gap-2">
                  {(["native", "analyzed", "custom"] as TokenChoice[]).map((c) => (
                    <button
                      key={c}
                      onClick={() => setTokenChoice(c)}
                      className={`rounded-md border px-3 py-1.5 text-sm ${
                        tokenChoice === c
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-300 text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {c === "native"
                        ? `Native (${nativeSymbol(wallet.chainId)})`
                        : c === "analyzed"
                          ? `Analyzed token (${analyzedToken.symbol})`
                          : "Custom ERC20"}
                    </button>
                  ))}
                </div>
              </div>

              {tokenChoice === "custom" && (
                <input
                  value={customAddress}
                  onChange={(e) => setCustomAddress(e.target.value)}
                  placeholder="0x… token contract address"
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              )}

              {analyzedChainMismatch && (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                  The analyzed token's address may point to a different token on
                  this network. Verify the symbol/balance below.
                </p>
              )}

              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                {metaLoading
                  ? "Reading token…"
                  : metaError
                    ? <span className="text-red-700">{metaError}</span>
                    : meta
                      ? <>Token: <span className="font-medium">{symbol}</span> · {decimals} decimals · your balance{" "}
                          <span className="font-mono">{formatUnits(meta.balance, decimals)}</span></>
                      : "Select or enter a token."}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Total to distribute{symbol ? ` (${symbol})` : ""}
                  </label>
                  <input
                    value={total}
                    onChange={(e) => setTotal(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.0"
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Recipients per batch
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={batchSize}
                    onChange={(e) => setBatchSize(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={rawMode}
                  onChange={(e) => setRawMode(e.target.checked)}
                />
                Enter amounts in raw base units (no decimals)
              </label>

              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={goReview}
                  disabled={!asset || !meta || results.length === 0}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Review {results.length} recipients →
                </button>
              </div>
            </div>
          ) : step === "review" ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">
                  Review &amp; edit amounts
                </span>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={rawMode}
                    onChange={(e) => setRawMode(e.target.checked)}
                  />
                  Raw units
                </label>
              </div>

              <RecipientEditor
                key={`${tokenChoice}:${tokenAddress ?? "native"}:${total}:${decimals}`}
                initialRows={initialRows}
                decimals={decimals}
                symbol={symbol || nativeSymbol(wallet.chainId)}
                rawMode={rawMode}
                onChange={setEditorState}
              />

              <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                <span className="text-gray-600">
                  {editorState?.recipients.length ?? 0} valid · Total{" "}
                  <span className="font-mono font-semibold">
                    {formatUnits(editorState?.total ?? 0n, decimals)} {symbol || nativeSymbol(wallet.chainId)}
                  </span>
                </span>
                {meta && editorState && editorState.total > meta.balance && (
                  <span className="text-xs text-red-600">Exceeds your balance</span>
                )}
              </div>

              {editorState && editorState.issues.length > 0 && (
                <ul className="list-inside list-disc text-xs text-amber-700">
                  {editorState.issues.map((iss, i) => (
                    <li key={i}>{iss}</li>
                  ))}
                </ul>
              )}

              <div className="flex justify-between gap-2">
                <button
                  onClick={() => setStep("configure")}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  ← Back
                </button>
                <button
                  onClick={() => setStep("send")}
                  disabled={
                    !editorState ||
                    !editorState.valid ||
                    (!!meta && editorState.total > meta.balance)
                  }
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Continue to send →
                </button>
              </div>
            </div>
          ) : (
            asset && (
              <DistributeProgress
                asset={asset}
                decimals={decimals}
                symbol={symbol || nativeSymbol(wallet.chainId)}
                recipients={sendRecipients}
                batchSize={batchSize}
                wallet={wallet}
                explorerUrl={explorerUrl}
                onClose={onClose}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}
