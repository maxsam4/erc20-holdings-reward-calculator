import { useRef, useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import type { Address, PublicClient } from "viem";
import {
  DISPERSE_ADDRESS,
  estimateDisperseGas,
  sendDisperse,
  splitToFittingBatches,
  sumAmounts,
  verifyDisperse,
  type DisperseAsset,
} from "../lib/disperse";
import { approve, readAllowance } from "../lib/erc20";
import { getViemChain } from "../lib/viemChains";
import type { WalletState } from "../lib/wallet";
import type { ParsedRecipient } from "./RecipientEditor";

type StepStatus = "pending" | "signing" | "mining" | "unknown" | "done" | "failed";

type Outcome = "success" | "reverted" | "pending";

// Resolve a broadcast tx's outcome robustly. A plain waitForTransactionReceipt
// over a wallet/L2 RPC can time out even though the tx was mined (Polygon RPC
// lag, flaky block-watching over injected transports). So: try a direct
// one-shot receipt read first, then wait with a generous timeout, and only
// report "pending" (NOT failed) if it still can't be confirmed — the tx may
// well succeed, and the caller keeps the hash so it can be re-checked.
async function resolveReceipt(
  client: PublicClient,
  hash: `0x${string}`,
): Promise<Outcome> {
  try {
    const r = await client.getTransactionReceipt({ hash });
    return r.status === "success" ? "success" : "reverted";
  } catch {
    // Not indexed yet — fall through to a watched wait.
  }
  try {
    const r = await client.waitForTransactionReceipt({
      hash,
      timeout: 180_000,
      pollingInterval: 4_000,
    });
    return r.status === "success" ? "success" : "reverted";
  } catch {
    return "pending";
  }
}

interface Step {
  label: string;
  status: StepStatus;
  hash?: `0x${string}`;
  error?: string;
}

type Phase = "idle" | "running" | "error" | "done";

interface DistributeProgressProps {
  asset: DisperseAsset;
  decimals: number;
  symbol: string;
  recipients: ParsedRecipient[];
  batchSize: number;
  wallet: WalletState;
  explorerUrl: string;
  onClose: () => void;
}

export default function DistributeProgress({
  asset,
  decimals,
  symbol,
  recipients,
  batchSize,
  wallet,
  explorerUrl,
  onClose,
}: DistributeProgressProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [approveStep, setApproveStep] = useState<Step | null>(null);
  const [batchSteps, setBatchSteps] = useState<Step[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const [leftover, setLeftover] = useState<bigint>(0n);
  const [revoked, setRevoked] = useState(false);

  const batchesRef = useRef<ParsedRecipient[][]>([]);
  const hashesRef = useRef<Array<`0x${string}` | undefined>>([]);
  const cursorRef = useRef(0);
  const startAccountRef = useRef<Address | null>(null);
  const startChainRef = useRef<number | null>(null);

  // Always read the latest wallet context inside the async send loop.
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  const grandTotal = sumAmounts(recipients.map((r) => r.amount));
  const fmt = (v: bigint) => formatUnits(v, decimals);

  // Assert (via a live eth_chainId round-trip, not just the async-updated
  // chainChanged state) that we are still on the same account+chain captured at
  // the start of the run. Throws to halt before any approval/send if the wallet
  // switched away and back during an awaited step.
  async function ensureContext(client: PublicClient): Promise<void> {
    const live = await client.getChainId();
    if (
      live !== startChainRef.current ||
      walletRef.current.account !== startAccountRef.current
    ) {
      throw new Error(
        "Wallet network or account changed — halted to avoid sending on the wrong chain.",
      );
    }
  }

  function setBatch(index: number, patch: Partial<Step>) {
    setBatchSteps((steps) =>
      steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    );
  }

  async function processBatches(from: number): Promise<void> {
    const { walletClient, publicClient, account, chainId } = walletRef.current;
    const chain = getViemChain(chainId);
    if (!walletClient || !publicClient || !account || !chain) {
      setFatal("Wallet is not ready.");
      setPhase("error");
      return;
    }

    setPhase("running");
    for (let i = from; i < batchesRef.current.length; i++) {
      cursorRef.current = i;
      const batch = batchesRef.current[i];
      try {
        await ensureContext(publicClient);
        // If this batch was already broadcast (hash recorded), resolve that tx
        // instead of sending again — prevents a double-send when a previous
        // attempt failed *after* broadcast (e.g. receipt polling glitch).
        let hash = hashesRef.current[i];
        if (!hash) {
          setBatch(i, { status: "signing", error: undefined });
          hash = await sendDisperse(
            walletClient,
            account,
            chain,
            asset,
            batch.map((r) => r.address),
            batch.map((r) => r.amount),
          );
          hashesRef.current[i] = hash;
        }
        setBatch(i, { status: "mining", hash, error: undefined });
        const outcome = await resolveReceipt(publicClient, hash);
        if (outcome === "reverted") {
          // Reverted: no funds moved, so it is safe to resend on retry.
          hashesRef.current[i] = undefined;
          setBatch(i, {
            status: "failed",
            hash: undefined,
            error: "Transaction reverted",
          });
          setPhase("error");
          return;
        }
        if (outcome === "pending") {
          // Broadcast but the RPC couldn't confirm it in time. Keep the hash so
          // "Check status" re-resolves it instead of resending. Do NOT mark
          // failed — it has very likely succeeded.
          setBatch(i, {
            status: "unknown",
            hash,
            error: "Broadcast — awaiting confirmation. Use “Check status” to resume.",
          });
          setFatal(
            "A transaction was broadcast but the RPC hasn't confirmed it yet. It may already have succeeded — open it in the explorer, then use “Check status & continue”. It will not be resent.",
          );
          setPhase("error");
          return;
        }
        setBatch(i, { status: "done", hash });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const broadcast = !!hashesRef.current[i];
        if (broadcast) {
          // Send succeeded but a later step threw — never resend; re-check.
          setBatch(i, {
            status: "unknown",
            hash: hashesRef.current[i],
            error: msg + " — already broadcast; “Check status” will re-check, not resend.",
          });
        } else {
          const hint =
            asset.kind === "native"
              ? " A recipient contract may have rejected the transfer; remove it and retry."
              : "";
          setBatch(i, { status: "failed", error: msg + hint });
        }
        setPhase("error");
        return;
      }
    }

    cursorRef.current = batchesRef.current.length;
    if (asset.kind === "token") {
      await refreshLeftover();
    }
    setPhase("done");
  }

  async function refreshLeftover(): Promise<void> {
    const { publicClient, account } = walletRef.current;
    if (asset.kind !== "token" || !publicClient || !account) return;
    try {
      setLeftover(
        await readAllowance(publicClient, asset.token, account, DISPERSE_ADDRESS),
      );
    } catch {
      /* non-fatal */
    }
  }

  async function start(): Promise<void> {
    setFatal(null);
    const { walletClient, publicClient, account, chainId } = wallet;
    const chain = getViemChain(chainId);
    if (!walletClient || !publicClient || !account || !chain) {
      setFatal("Wallet is not ready.");
      setPhase("error");
      return;
    }
    startAccountRef.current = account;
    startChainRef.current = chainId;
    setPhase("running");

    try {
      await ensureContext(publicClient);
      // 1. Verify the Disperse contract bytecode on this chain.
      if (!(await verifyDisperse(publicClient))) {
        setFatal(
          `The Disperse contract is not deployed/verified on chain ${chainId}. Switch to a supported network (e.g. Polygon).`,
        );
        setPhase("error");
        return;
      }

      // 2. Balance pre-check.
      if (asset.kind === "native") {
        const bal = await publicClient.getBalance({ address: account });
        if (bal < grandTotal) {
          setFatal(
            `Insufficient balance: need ${fmt(grandTotal)} ${symbol}, have ${fmt(bal)}.`,
          );
          setPhase("error");
          return;
        }
      } else {
        const bal = await publicClient.readContract({
          address: asset.token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account],
        });
        if (bal < grandTotal) {
          setFatal(
            `Insufficient token balance: need ${fmt(grandTotal)} ${symbol}, have ${fmt(bal)}.`,
          );
          setPhase("error");
          return;
        }

        // 3. Ensure allowance (exact grand total; reset-from-nonzero for USDT-style tokens).
        let allowance = await readAllowance(
          publicClient,
          asset.token,
          account,
          DISPERSE_ADDRESS,
        );
        if (allowance < grandTotal) {
          if (allowance > 0n) {
            // USDT-style tokens reject a non-zero→non-zero allowance change.
            await ensureContext(publicClient);
            const resetLabel = "Reset existing allowance to 0";
            setApproveStep({ label: resetLabel, status: "signing" });
            const h0 = await approve(walletClient, account, chain, asset.token, DISPERSE_ADDRESS, 0n);
            setApproveStep({ label: resetLabel, status: "mining", hash: h0 });
            if ((await resolveReceipt(publicClient, h0)) === "reverted") {
              setApproveStep({ label: resetLabel, status: "failed", hash: h0, error: "Reset reverted" });
              setFatal("Allowance reset transaction reverted.");
              setPhase("error");
              return;
            }
          }
          await ensureContext(publicClient);
          const approveLabel = `Approve ${fmt(grandTotal)} ${symbol}`;
          setApproveStep({ label: approveLabel, status: "signing" });
          const h = await approve(walletClient, account, chain, asset.token, DISPERSE_ADDRESS, grandTotal);
          setApproveStep({ label: approveLabel, status: "mining", hash: h });
          if ((await resolveReceipt(publicClient, h)) === "reverted") {
            setApproveStep({ label: approveLabel, status: "failed", hash: h, error: "Approve reverted" });
            setFatal("Approval transaction reverted.");
            setPhase("error");
            return;
          }
          // The on-chain allowance is the source of truth even if the receipt
          // couldn't be confirmed in time.
          allowance = await readAllowance(publicClient, asset.token, account, DISPERSE_ADDRESS);
          if (allowance < grandTotal) {
            setApproveStep({ label: approveLabel, status: "failed", hash: h, error: "Allowance not yet sufficient — retry." });
            setFatal("Approval isn't confirmed yet (allowance still below the total). Retry to re-check.");
            setPhase("error");
            return;
          }
          setApproveStep((s) => (s ? { ...s, status: "done" } : s));
        }
      }

      // 4. Gas-aware batching.
      await ensureContext(publicClient);
      const block = await publicClient.getBlock();
      const gasCap = (block.gasLimit * 90n) / 100n;
      const batches = await splitToFittingBatches(
        recipients,
        (batch) =>
          estimateDisperseGas(
            publicClient,
            account,
            asset,
            batch.map((r) => r.address),
            batch.map((r) => r.amount),
          ),
        gasCap,
        batchSize,
      );
      batchesRef.current = batches;
      hashesRef.current = batches.map(() => undefined);
      setBatchSteps(
        batches.map((b, i) => ({
          label: `Batch ${i + 1} · ${b.length} recipients · ${fmt(sumAmounts(b.map((r) => r.amount)))} ${symbol}`,
          status: "pending" as StepStatus,
        })),
      );

      // 5. Send.
      await processBatches(0);
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  async function revoke(): Promise<void> {
    const { walletClient, publicClient, account, chainId } = walletRef.current;
    const chain = getViemChain(chainId);
    if (asset.kind !== "token" || !walletClient || !publicClient || !account || !chain)
      return;
    // Revoking is terminal: it drops the allowance the remaining batches would
    // need, so retry is disabled afterwards (reopen to start a fresh run).
    setRevoked(true);
    try {
      const h = await approve(walletClient, account, chain, asset.token, DISPERSE_ADDRESS, 0n);
      await publicClient.waitForTransactionReceipt({ hash: h });
      await refreshLeftover();
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e));
    }
  }

  const StatusIcon = ({ status }: { status: StepStatus }) => {
    const map: Record<StepStatus, string> = {
      pending: "text-gray-300",
      signing: "text-blue-500 animate-pulse",
      mining: "text-blue-500 animate-pulse",
      unknown: "text-amber-500",
      done: "text-green-600",
      failed: "text-red-600",
    };
    const glyph: Record<StepStatus, string> = {
      pending: "○",
      signing: "◔",
      mining: "◑",
      unknown: "◷",
      done: "●",
      failed: "✕",
    };
    return <span className={map[status]}>{glyph[status]}</span>;
  };

  const StepRow = ({ step }: { step: Step }) => (
    <div className="flex items-center justify-between gap-2 py-1 text-sm">
      <span className="flex items-center gap-2">
        <StatusIcon status={step.status} />
        <span className="text-gray-700">{step.label}</span>
      </span>
      {step.hash && (
        <a
          href={`${explorerUrl}/tx/${step.hash}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-blue-600 hover:underline"
        >
          {step.hash.slice(0, 10)}…
        </a>
      )}
      {step.error && (
        <span className="max-w-[50%] truncate text-xs text-red-600" title={step.error}>
          {step.error}
        </span>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
        Sending <span className="font-semibold">{fmt(grandTotal)} {symbol}</span> to{" "}
        <span className="font-semibold">{recipients.length}</span> recipients.
      </div>

      {phase === "idle" && (
        <div className="flex gap-2">
          <button
            onClick={start}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {asset.kind === "token" ? "Approve & send" : "Send"}
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Back
          </button>
        </div>
      )}

      {(approveStep || batchSteps.length > 0) && (
        <div className="divide-y divide-gray-100 rounded-md border border-gray-200 px-3">
          {approveStep && <StepRow step={approveStep} />}
          {batchSteps.map((s, i) => (
            <StepRow key={i} step={s} />
          ))}
        </div>
      )}

      {fatal && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {fatal}
        </div>
      )}

      {phase === "error" && (
        <div className="space-y-2">
          {revoked && (
            <p className="text-xs text-amber-700">
              Approval revoked — reopen this dialog to start a new distribution.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {!revoked &&
              (batchesRef.current.length > 0 ? (
                <button
                  onClick={() => processBatches(cursorRef.current)}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  {hashesRef.current[cursorRef.current]
                    ? "Check status & continue"
                    : "Retry from failed batch"}
                </button>
              ) : (
                <button
                  onClick={start}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Try again
                </button>
              ))}
            {asset.kind === "token" && !revoked && (
              <button
                onClick={revoke}
                className="rounded-md border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50"
                title="Set the Disperse allowance back to 0 (stops this run)"
              >
                Revoke approval
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="space-y-3">
          <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            Distribution complete — all batches confirmed.
          </div>
          {asset.kind === "token" && leftover > 0n && (
            <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <span>Leftover approval of {fmt(leftover)} {symbol} remains.</span>
              <button
                onClick={revoke}
                className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                Revoke approval
              </button>
            </div>
          )}
          <button
            onClick={onClose}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
