import { chains } from "../lib/chains";
import { nativeSymbol } from "../lib/viemChains";
import type { WalletState } from "../lib/wallet";

interface WalletConnectProps {
  wallet: WalletState;
}

function truncate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function WalletConnect({ wallet }: WalletConnectProps) {
  const { status, providers, account, chainId, error } = wallet;

  if (status !== "connected" || !account) {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
        <p className="mb-3 text-sm font-medium text-gray-700">
          Connect a wallet to distribute rewards
        </p>
        {providers.length === 0 ? (
          <p className="text-xs text-gray-500">
            No browser wallet detected. Install MetaMask or Rabby, then reopen
            this dialog.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {providers.map((p) => (
              <button
                key={p.info.uuid}
                onClick={() => wallet.connect(p.info.uuid)}
                disabled={status === "connecting"}
                className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {p.info.icon && (
                  <img src={p.info.icon} alt="" className="h-5 w-5 rounded" />
                )}
                {status === "connecting" ? "Connecting…" : p.info.name}
              </button>
            ))}
          </div>
        )}
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  const knownChain = chains.find((c) => c.chainId === chainId);

  return (
    <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-4 py-2.5">
      <div className="flex items-center gap-3 text-sm">
        <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
        <span className="font-mono text-gray-700">{truncate(account)}</span>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={chainId ?? ""}
          onChange={(e) => wallet.switchChain(Number(e.target.value))}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          title="Switch network"
        >
          {!knownChain && chainId != null && (
            <option value={chainId}>Chain {chainId}</option>
          )}
          {chains.map((c) => (
            <option key={c.id} value={c.chainId}>
              {c.name} ({nativeSymbol(c.chainId)})
            </option>
          ))}
        </select>
        <button
          onClick={wallet.disconnect}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
