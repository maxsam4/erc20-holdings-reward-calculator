# ERC20 Holdings Reward Calculator

## Tech Stack
- React 18, TypeScript, Vite, Tailwind CSS
- No backend — pure client-side SPA
- Etherscan V2 API (`https://api.etherscan.io/v2/api` with `chainid` param)
- IndexedDB for transfer event caching, localStorage for form state + token info

## Commands
- `npm run dev` — start dev server
- `npm run build` — typecheck + build for production
- `npm run preview` — preview production build

## Architecture
- `src/lib/chains.ts` — chain definitions (id, chainId, explorer URL)
- `src/lib/etherscan.ts` — V2 API client: getLogs pagination, eth_call proxy, rate limiter
- `src/lib/balance.ts` — balance reconstruction from Transfer events, time-weighted average calc
- `src/lib/storage.ts` — IndexedDB (events cache keyed by `chain:token`), localStorage (form state, token info)
- `src/lib/csv.ts` — CSV export/download
- `src/App.tsx` — two-step flow: ConfigForm → FetchProgress → AnalysisView

## Deployment
- GitHub Pages via `.github/workflows/deploy.yml` (push to main)
- Vite `base` is set to `/erc20-holdings-reward-calculator/` for GitHub Pages path

## Conventions
- All token math uses `BigInt` — only convert to display format at render time
- Rate limit Etherscan API calls to 1 req/sec
- Components in `src/components/`, library code in `src/lib/`
- Ethereum is the default chain
- Zero address is always pre-excluded from results
- Table displays 2 decimal places for balances/rewards; CSV exports full precision without locale formatting

## Gotchas
- Never use `toLocaleString()` for CSV values — commas break column parsing
- Etherscan V1 endpoints are deprecated and will return errors; always use V2 with `chainid`
- `fromBlock=0` works for fetching all logs; Etherscan handles chain-specific genesis blocks
- Token decimals can be 0–18+; always use BigInt division, never floating point, for balance math
