import { useState, useEffect } from "react";
import { chains, type Chain } from "../lib/chains";
import { loadFormState, saveFormState } from "../lib/storage";

interface ConfigFormProps {
  onSubmit: (chain: Chain, tokenAddress: string, apiKey: string) => void;
  disabled: boolean;
}

export default function ConfigForm({ onSubmit, disabled }: ConfigFormProps) {
  const saved = loadFormState();
  const [chainId, setChainId] = useState(saved.chainId);
  const [tokenAddress, setTokenAddress] = useState(saved.tokenAddress);
  const [apiKey, setApiKey] = useState(saved.apiKey);

  useEffect(() => {
    saveFormState(chainId, tokenAddress, apiKey);
  }, [chainId, tokenAddress, apiKey]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const chain = chains.find((c) => c.id === chainId) || chains[0];
    onSubmit(chain, tokenAddress.trim(), apiKey.trim());
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Chain
        </label>
        <select
          value={chainId}
          onChange={(e) => setChainId(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          disabled={disabled}
        >
          {chains.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Token Address
        </label>
        <input
          type="text"
          value={tokenAddress}
          onChange={(e) => setTokenAddress(e.target.value)}
          placeholder="0x..."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          disabled={disabled}
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          API Key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Etherscan API key"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          disabled={disabled}
          required
        />
      </div>

      <button
        type="submit"
        disabled={disabled || !tokenAddress.trim() || !apiKey.trim()}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {disabled ? "Fetching..." : "Fetch Transfer Events"}
      </button>
    </form>
  );
}
