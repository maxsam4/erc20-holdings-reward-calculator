import type { RawTransferEvent, TokenInfo } from "./etherscan";

const DB_NAME = "erc20-reward-calc";
const STORE_NAME = "transfer-events";
const META_STORE = "meta";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function cacheKey(chainId: string, tokenAddress: string): string {
  return `${chainId}:${tokenAddress.toLowerCase()}`;
}

export async function getCachedEvents(
  chainId: string,
  tokenAddress: string,
): Promise<RawTransferEvent[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(cacheKey(chainId, tokenAddress));
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function setCachedEvents(
  chainId: string,
  tokenAddress: string,
  events: RawTransferEvent[],
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(events, cacheKey(chainId, tokenAddress));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getLastCachedBlock(
  chainId: string,
  tokenAddress: string,
): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readonly");
    const store = tx.objectStore(META_STORE);
    const request = store.get(`lastBlock:${cacheKey(chainId, tokenAddress)}`);
    request.onsuccess = () => resolve(request.result || 0);
    request.onerror = () => reject(request.error);
  });
}

export async function setLastCachedBlock(
  chainId: string,
  tokenAddress: string,
  block: number,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readwrite");
    const store = tx.objectStore(META_STORE);
    store.put(block, `lastBlock:${cacheKey(chainId, tokenAddress)}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const LS_PREFIX = "erc20-calc:";

export function loadFormState(): {
  chainId: string;
  tokenAddress: string;
  apiKey: string;
} {
  return {
    chainId: localStorage.getItem(`${LS_PREFIX}chainId`) || "ethereum",
    tokenAddress: localStorage.getItem(`${LS_PREFIX}tokenAddress`) || "",
    apiKey: localStorage.getItem(`${LS_PREFIX}apiKey`) || "",
  };
}

export function saveFormState(
  chainId: string,
  tokenAddress: string,
  apiKey: string,
): void {
  localStorage.setItem(`${LS_PREFIX}chainId`, chainId);
  localStorage.setItem(`${LS_PREFIX}tokenAddress`, tokenAddress);
  localStorage.setItem(`${LS_PREFIX}apiKey`, apiKey);
}

export function getCachedTokenInfo(
  chainId: string,
  tokenAddress: string,
): TokenInfo | null {
  const raw = localStorage.getItem(
    `${LS_PREFIX}tokenInfo:${cacheKey(chainId, tokenAddress)}`,
  );
  if (!raw) return null;
  return JSON.parse(raw);
}

export function setCachedTokenInfo(
  chainId: string,
  tokenAddress: string,
  info: TokenInfo,
): void {
  localStorage.setItem(
    `${LS_PREFIX}tokenInfo:${cacheKey(chainId, tokenAddress)}`,
    JSON.stringify(info),
  );
}
