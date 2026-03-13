# ERC20 Holdings Reward Calculator

Calculate time-weighted average ERC20 token holdings and distribute rewards proportionally across holders.

**Live app: [maxsam4.github.io/erc20-holdings-reward-calculator](https://maxsam4.github.io/erc20-holdings-reward-calculator/)**

## Privacy

Everything runs entirely in your browser. Your Etherscan API key is used only for direct requests from your browser to the Etherscan API — it never leaves your device or passes through any intermediary server.

## How It Works

1. **Configure**: Select a chain, enter a token contract address, and provide an Etherscan API key
2. **Fetch**: The app downloads all Transfer events for the token via the Etherscan V2 API (cached in IndexedDB for incremental updates)
3. **Analyze**: Pick a date range, enter a total reward amount, and see each holder's proportional share instantly — no re-fetching needed

All computation happens client-side in the browser. No data is sent to any server.

## Supported Chains

Ethereum (default), Polygon, BSC, Arbitrum, Optimism, Base, Avalanche

## Caching

- **Transfer events** are stored in IndexedDB. On subsequent fetches, only new events since the last cached block are downloaded.
- **Token info** (name, symbol, decimals) is cached in localStorage to skip redundant API calls.
- **Form state** (chain, token address, API key) is persisted in localStorage.

## Usage

```bash
npm install
npm run dev
```

## Limitations

- **Rebase tokens** (e.g., stETH): Balance changes from rebases don't emit Transfer events, so results will be inaccurate
- **Fee-on-transfer tokens**: The actual received amount differs from the Transfer event value, causing slight discrepancies
- **Very large tokens**: Tokens with millions of transfers will take significant time to fetch (rate limited to 1 req/sec)
