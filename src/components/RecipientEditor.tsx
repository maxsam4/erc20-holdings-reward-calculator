import { useEffect, useRef, useState } from "react";
import { formatUnits, getAddress, isAddress, parseUnits } from "viem";
import type { Address } from "viem";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface ParsedRecipient {
  address: Address;
  amount: bigint;
}

export interface EditorState {
  recipients: ParsedRecipient[];
  total: bigint;
  valid: boolean;
  issues: string[];
}

interface RowText {
  address: string;
  amountText: string;
}

interface RecipientEditorProps {
  initialRows: ParsedRecipient[];
  decimals: number;
  symbol: string;
  rawMode: boolean;
  onChange: (state: EditorState) => void;
}

function formatAmount(amount: bigint, decimals: number, raw: boolean): string {
  return raw ? amount.toString() : formatUnits(amount, decimals);
}

function parseAmount(
  text: string,
  decimals: number,
  raw: boolean,
): bigint | null {
  const t = text.trim();
  if (!t) return null;
  try {
    if (raw) {
      if (!/^\d+$/.test(t)) return null;
      return BigInt(t);
    }
    if (t === "." || !/^\d*\.?\d*$/.test(t)) return null;
    return parseUnits(t, decimals);
  } catch {
    return null;
  }
}

function parsePaste(text: string): RowText[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[\s,=]+/);
      return { address: parts[0] ?? "", amountText: parts[1] ?? "" };
    });
}

export default function RecipientEditor({
  initialRows,
  decimals,
  symbol,
  rawMode,
  onChange,
}: RecipientEditorProps) {
  const [rows, setRows] = useState<RowText[]>(() =>
    initialRows.map((r) => ({
      address: r.address,
      amountText: formatAmount(r.amount, decimals, rawMode),
    })),
  );
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  // Reformat amounts in place when the decimal/raw display mode flips.
  const prevRaw = useRef(rawMode);
  useEffect(() => {
    if (prevRaw.current === rawMode) return;
    const from = prevRaw.current;
    prevRaw.current = rawMode;
    setRows((current) =>
      current.map((r) => {
        const amt = parseAmount(r.amountText, decimals, from);
        if (amt === null) return r;
        return { ...r, amountText: formatAmount(amt, decimals, rawMode) };
      }),
    );
  }, [rawMode, decimals]);

  // Emit parsed/validated state to the parent without setState-during-render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    let total = 0n;
    const recipients: ParsedRecipient[] = [];
    let invalidAddr = 0;
    let invalidAmt = 0;
    let zeroAddr = 0;
    let dupes = 0;
    const seen = new Set<string>();

    for (const row of rows) {
      if (!isAddress(row.address)) {
        invalidAddr++;
        continue;
      }
      const norm = getAddress(row.address);
      if (norm === ZERO_ADDRESS) {
        zeroAddr++;
        continue;
      }
      const amt = parseAmount(row.amountText, decimals, rawMode);
      if (amt === null || amt <= 0n) {
        invalidAmt++;
        continue;
      }
      if (seen.has(norm)) dupes++;
      seen.add(norm);
      recipients.push({ address: norm, amount: amt });
      total += amt;
    }

    const issues: string[] = [];
    if (invalidAddr) issues.push(`${invalidAddr} invalid address(es)`);
    if (zeroAddr) issues.push(`${zeroAddr} zero-address row(s)`);
    if (invalidAmt) issues.push(`${invalidAmt} invalid or zero amount(s)`);
    if (dupes) issues.push(`${dupes} duplicate address(es) — amounts will be summed`);

    const valid =
      recipients.length > 0 &&
      invalidAddr === 0 &&
      invalidAmt === 0 &&
      zeroAddr === 0;

    onChangeRef.current({ recipients, total, valid, issues });
  }, [rows, decimals, rawMode]);

  function updateRow(index: number, patch: Partial<RowText>) {
    setRows((current) =>
      current.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
  }

  function addRow() {
    setRows((current) => [...current, { address: "", amountText: "" }]);
  }

  function applyPaste(mode: "replace" | "append") {
    const parsed = parsePaste(pasteText);
    setRows((current) => (mode === "replace" ? parsed : [...current, ...parsed]));
    setPasteText("");
    setPasteOpen(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600">
          {rows.length} recipient row(s)
        </span>
        <button
          type="button"
          onClick={() => setPasteOpen((v) => !v)}
          className="text-xs font-medium text-blue-600 hover:text-blue-800"
        >
          {pasteOpen ? "Hide paste import" : "Paste import"}
        </button>
      </div>

      {pasteOpen && (
        <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={5}
            placeholder={`0xabc...  1.5\n0xdef...  2.25\n(one address and amount per line; comma, space or = separated)`}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => applyPaste("replace")}
              disabled={!pasteText.trim()}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Replace list
            </button>
            <button
              type="button"
              onClick={() => applyPaste("append")}
              disabled={!pasteText.trim()}
              className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Append
            </button>
          </div>
        </div>
      )}

      <div className="max-h-80 overflow-y-auto rounded-md border border-gray-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">
                Address
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">
                Amount {rawMode ? "(raw)" : `(${symbol})`}
              </th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, i) => {
              const addrBad = row.address.trim() !== "" && !isAddress(row.address);
              const amtBad =
                row.amountText.trim() !== "" &&
                parseAmount(row.amountText, decimals, rawMode) === null;
              return (
                <tr key={i}>
                  <td className="px-3 py-1.5">
                    <input
                      value={row.address}
                      onChange={(e) => updateRow(i, { address: e.target.value })}
                      placeholder="0x…"
                      className={`w-full rounded border px-2 py-1 font-mono text-xs focus:ring-1 ${
                        addrBad
                          ? "border-red-400 focus:border-red-500 focus:ring-red-500"
                          : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                      }`}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      value={row.amountText}
                      onChange={(e) =>
                        updateRow(i, { amountText: e.target.value })
                      }
                      placeholder={rawMode ? "0" : "0.0"}
                      inputMode="decimal"
                      className={`w-full rounded border px-2 py-1 text-right font-mono text-xs tabular-nums focus:ring-1 ${
                        amtBad
                          ? "border-red-400 focus:border-red-500 focus:ring-red-500"
                          : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                      }`}
                    />
                  </td>
                  <td className="px-2 text-center">
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="text-gray-400 hover:text-red-600"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={addRow}
        className="text-xs font-medium text-blue-600 hover:text-blue-800"
      >
        + Add recipient
      </button>
    </div>
  );
}
