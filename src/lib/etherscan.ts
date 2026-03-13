import { ETHERSCAN_V2_BASE } from "./chains";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 1000) {
    await new Promise((r) => setTimeout(r, 1000 - elapsed));
  }
  lastRequestTime = Date.now();
  return fetch(url);
}

export interface RawTransferEvent {
  blockNumber: string;
  timeStamp: string;
  logIndex: string;
  from: string;
  to: string;
  value: string;
}

interface EtherscanLogEntry {
  blockNumber: string;
  timeStamp: string;
  logIndex: string;
  topics: string[];
  data: string;
}

function parseAddress(topic: string): string {
  return "0x" + topic.slice(26).toLowerCase();
}

function parseLogEntry(entry: EtherscanLogEntry): RawTransferEvent {
  return {
    blockNumber: entry.blockNumber,
    timeStamp: entry.timeStamp,
    logIndex: entry.logIndex,
    from: parseAddress(entry.topics[1]),
    to: parseAddress(entry.topics[2]),
    value: BigInt(entry.data).toString(),
  };
}

export async function fetchTransferEvents(
  chainId: number,
  tokenAddress: string,
  apiKey: string,
  fromBlock: number,
  onProgress: (count: number) => void,
  signal?: AbortSignal,
): Promise<RawTransferEvent[]> {
  const allEvents: RawTransferEvent[] = [];
  let currentFromBlock = fromBlock;
  // Track seen logs in the boundary block to deduplicate when re-fetching
  let seenLogIndicesInBoundaryBlock = new Set<string>();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const url =
      `${ETHERSCAN_V2_BASE}?chainid=${chainId}&module=logs&action=getLogs` +
      `&address=${tokenAddress}` +
      `&topic0=${TRANSFER_TOPIC}` +
      `&fromBlock=${currentFromBlock}` +
      `&toBlock=latest` +
      `&page=1&offset=1000` +
      `&apikey=${apiKey}`;

    const res = await rateLimitedFetch(url);
    const json = await res.json();

    if (json.status === "0" && json.message === "No records found") {
      break;
    }

    if (json.status === "0") {
      throw new Error(json.result || json.message || "API error");
    }

    const entries: EtherscanLogEntry[] = json.result;
    if (!entries || entries.length === 0) break;

    // Deduplicate: skip logs we already collected from the boundary block
    let newEntries = entries;
    if (seenLogIndicesInBoundaryBlock.size > 0) {
      newEntries = entries.filter(
        (e) =>
          parseInt(e.blockNumber, 16) !== currentFromBlock ||
          !seenLogIndicesInBoundaryBlock.has(e.logIndex),
      );
    }

    const events = newEntries.map(parseLogEntry);
    allEvents.push(...events);
    onProgress(allEvents.length);

    if (entries.length < 1000) break;

    // Re-fetch from the last block (not +1) to avoid skipping same-block events
    const lastBlock = parseInt(entries[entries.length - 1].blockNumber, 16);
    const firstBlock = parseInt(entries[0].blockNumber, 16);

    // If all 1000 entries are in a single block, we can't paginate past it
    if (firstBlock === lastBlock) {
      throw new Error(
        `Block ${lastBlock} contains 1000+ Transfer events for this token, ` +
          `which exceeds the API page limit. This token has too many events ` +
          `to process. Please contact the admin.`,
      );
    }

    seenLogIndicesInBoundaryBlock = new Set<string>();
    for (let i = entries.length - 1; i >= 0; i--) {
      if (parseInt(entries[i].blockNumber, 16) === lastBlock) {
        seenLogIndicesInBoundaryBlock.add(entries[i].logIndex);
      } else {
        break;
      }
    }
    currentFromBlock = lastBlock;
  }

  return allEvents;
}

async function ethCall(
  chainId: number,
  tokenAddress: string,
  data: string,
  apiKey: string,
): Promise<string> {
  const url =
    `${ETHERSCAN_V2_BASE}?chainid=${chainId}&module=proxy&action=eth_call` +
    `&to=${tokenAddress}` +
    `&data=${data}` +
    `&tag=latest` +
    `&apikey=${apiKey}`;

  const res = await rateLimitedFetch(url);
  const json = await res.json();
  return json.result;
}

function decodeBytes32(hex: string): string {
  // Decode a raw bytes32 value as a null-terminated ASCII string
  let result = "";
  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (code === 0) break;
    result += String.fromCharCode(code);
  }
  return result;
}

function decodeString(hex: string): string {
  if (!hex || hex === "0x") return "";
  const stripped = hex.slice(2);

  // If response is exactly 32 bytes (64 hex chars), it's likely bytes32
  if (stripped.length === 64) {
    // Check if it looks like an ABI-encoded string (offset pointer in first 32 bytes)
    const possibleOffset = parseInt(stripped.slice(0, 64), 16);
    if (possibleOffset === 32) {
      // Could still be bytes32 that happens to start with 0x20...
      // but 0x20 = space, unlikely for a token name. Treat as bytes32.
      return decodeBytes32(stripped);
    }
    // Pure bytes32 return
    return decodeBytes32(stripped);
  }

  // ABI-encoded dynamic string
  const offset = parseInt(stripped.slice(0, 64), 16) * 2;
  if (offset + 64 > stripped.length) return decodeBytes32(stripped);
  const length = parseInt(stripped.slice(offset, offset + 64), 16);
  if (length === 0 || offset + 64 + length * 2 > stripped.length) {
    return decodeBytes32(stripped);
  }
  const data = stripped.slice(offset + 64, offset + 64 + length * 2);
  return decodeBytes32(data);
}

export interface TokenInfo {
  name: string;
  symbol: string;
  decimals: number;
}

export async function fetchTokenInfo(
  chainId: number,
  tokenAddress: string,
  apiKey: string,
): Promise<TokenInfo> {
  const [nameHex, symbolHex, decimalsHex] = await Promise.all([
    ethCall(chainId, tokenAddress, "0x06fdde03", apiKey), // name()
    ethCall(chainId, tokenAddress, "0x95d89b41", apiKey), // symbol()
    ethCall(chainId, tokenAddress, "0x313ce567", apiKey), // decimals()
  ]);

  return {
    name: decodeString(nameHex),
    symbol: decodeString(symbolHex),
    decimals: parseInt(decimalsHex, 16),
  };
}
