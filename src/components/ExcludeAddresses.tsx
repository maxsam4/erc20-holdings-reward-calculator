import { useState } from "react";

interface ExcludeAddressesProps {
  addresses: string[];
  onChange: (addresses: string[]) => void;
}

export default function ExcludeAddresses({
  addresses,
  onChange,
}: ExcludeAddressesProps) {
  const [input, setInput] = useState("");

  function handleAdd() {
    const addr = input.trim().toLowerCase();
    if (addr && /^0x[0-9a-f]{40}$/.test(addr) && !addresses.includes(addr)) {
      onChange([...addresses, addr]);
      setInput("");
    }
  }

  function handleRemove(addr: string) {
    onChange(addresses.filter((a) => a !== addr));
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Excluded Addresses
      </label>
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="0x..."
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAdd())}
        />
        <button
          type="button"
          onClick={handleAdd}
          className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
        >
          Add
        </button>
      </div>
      {addresses.length > 0 && (
        <div className="space-y-1">
          {addresses.map((addr) => (
            <div
              key={addr}
              className="flex items-center justify-between rounded bg-gray-50 px-2 py-1"
            >
              <span className="text-xs font-mono text-gray-600">
                {addr.slice(0, 10)}...{addr.slice(-8)}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(addr)}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
