import { useRef, useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import type { Address } from "viem";
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

type StepStatus = "pending" | "signing" | "mining" | "done" | "failed";

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

  const batchesRef = useRef<ParsedRecipient[][]>([]);
  const cursorRef = useRef(0);
  const startAccountRef = useRef<Address | null>(null);
  const startChainRef = useRef<number | null>(null);

  // Always read the latest wallet context inside the async send loop.
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  const grandTotal = sumAmounts(recipients.map((r) => r.amount));
  const fmt = (v: bigint) => formatUnits(v, decimals);

  function contextChanged(): boolean {
    const w = walletRef.current;
    return (
      w.account !== startAccountRef.current ||
      w.chainId !== startChainRef.current
    );
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
      if (contextChanged()) {
        setFatal("Wallet account or network changed — sending was halted.");
        setPhase("error");
        return;
      }
      const batch = batchesRef.current[i];
      setBatch(i, { status: "signing", error: undefined });
      try {
        const hash = await sendDisperse(
          walletClient,
          account,
          chain,
          asset,
          batch.map((r) => r.address),
          batch.map((r) => r.amount),
        );
        setBatch(i, { status: "mining", hash });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Transaction reverted");
        setBatch(i, { status: "done" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const hint =
          asset.kind === "native"
            ? " A recipient contract may have rejected the transfer; remove it and retry."
            : "";
        setBatch(i, { status: "failed", error: msg + hint });
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
            setApproveStep({ label: "Reset existing allowance to 0", status: "signing" });
            const h0 = await approve(walletClient, account, chain, asset.token, DISPERSE_ADDRESS, 0n);
            setApproveStep({ label: "Reset existing allowance to 0", status: "mining", hash: h0 });
            await publicClient.waitForTransactionReceipt({ hash: h0 });
          }
          setApproveStep({ label: `Approve ${fmt(grandTotal)} ${symbol}`, status: "signing" });
          const h = await approve(walletClient, account, chain, asset.token, DISPERSE_ADDRESS, grandTotal);
          setApproveStep({ label: `Approve ${fmt(grandTotal)} ${symbol}`, status: "mining", hash: h });
          await publicClient.waitForTransactionReceipt({ hash: h });
          allowance = await readAllowance(publicClient, asset.token, account, DISPERSE_ADDRESS);
          if (allowance < grandTotal) {
            setApproveStep({ label: "Approve", status: "failed", error: "Allowance still insufficient." });
            setFatal("Approval did not grant enough allowance.");
            setPhase("error");
            return;
          }
          setApproveStep((s) => (s ? { ...s, status: "done" } : s));
        }
      }

      // 4. Gas-aware batching.
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
      done: "text-green-600",
      failed: "text-red-600",
    };
    const glyph: Record<StepStatus, string> = {
      pending: "○",
      signing: "◔",
      mining: "◑",
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
        <div className="flex gap-2">
          <button
            onClick={() => processBatches(cursorRef.current)}
            disabled={batchesRef.current.length === 0}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Retry from failed batch
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Close
          </button>
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
