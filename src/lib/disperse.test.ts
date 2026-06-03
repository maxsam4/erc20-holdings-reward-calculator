import { describe, it, expect } from "vitest";
import {
  computeAtomicAmounts,
  chunk,
  sumAmounts,
  splitToFittingBatches,
} from "./disperse";

describe("sumAmounts", () => {
  it("sums a list of bigints", () => {
    expect(sumAmounts([1n, 2n, 3n])).toBe(6n);
  });

  it("returns 0 for an empty list", () => {
    expect(sumAmounts([])).toBe(0n);
  });
});

describe("chunk", () => {
  it("splits into batches of the given size with a smaller final batch", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single batch when size exceeds length", () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });

  it("returns an empty array for empty input", () => {
    expect(chunk([], 2)).toEqual([]);
  });

  it("throws on a non-positive size", () => {
    expect(() => chunk([1, 2], 0)).toThrow();
  });
});

describe("computeAtomicAmounts", () => {
  it("splits evenly when weights are equal and divide cleanly", () => {
    expect(computeAtomicAmounts([1n, 1n, 1n, 1n], 100n)).toEqual([
      25n,
      25n,
      25n,
      25n,
    ]);
  });

  it("splits proportionally to weights", () => {
    expect(computeAtomicAmounts([1n, 3n], 100n)).toEqual([25n, 75n]);
  });

  it("distributes the remainder to the largest fractional remainders, tie-broken by index", () => {
    // floors are [33,33,33] summing 99; remainder 1; all remainders tie -> index 0
    expect(computeAtomicAmounts([1n, 1n, 1n], 100n)).toEqual([34n, 33n, 33n]);
  });

  it("distributes a single remainder unit to the correct recipient", () => {
    // weights [3,1] total 10: floors [7,2] sum 9; remainders (30%4=2),(10%4=2) tie -> index 0
    expect(computeAtomicAmounts([3n, 1n], 10n)).toEqual([8n, 2n]);
  });

  it("returns the full total for a single recipient", () => {
    expect(computeAtomicAmounts([5n], 1000n)).toEqual([1000n]);
  });

  it("returns all zeros when total is zero", () => {
    expect(computeAtomicAmounts([1n, 2n, 3n], 0n)).toEqual([0n, 0n, 0n]);
  });

  it("always sums exactly to the total and never produces negatives", () => {
    const cases: Array<{ weights: bigint[]; total: bigint }> = [
      { weights: [7n, 11n, 13n, 17n, 19n], total: 1_000_000n },
      { weights: [1n, 1n, 1n, 1n, 1n, 1n, 1n], total: 12345n },
      {
        weights: [123456789n, 987654321n, 555555555n],
        total: 10n ** 18n * 1000n, // 1000 tokens at 18 decimals
      },
      { weights: [1n, 999_999n], total: 3n },
    ];
    for (const { weights, total } of cases) {
      const amounts = computeAtomicAmounts(weights, total);
      expect(amounts).toHaveLength(weights.length);
      expect(sumAmounts(amounts)).toBe(total);
      for (const a of amounts) expect(a >= 0n).toBe(true);
    }
  });

  it("throws when the total weight is zero", () => {
    expect(() => computeAtomicAmounts([0n, 0n], 100n)).toThrow();
  });

  it("throws on a negative weight", () => {
    expect(() => computeAtomicAmounts([-1n, 2n], 100n)).toThrow();
  });

  it("throws on a negative total", () => {
    expect(() => computeAtomicAmounts([1n, 1n], -5n)).toThrow();
  });
});

describe("splitToFittingBatches", () => {
  // estimator: gas proportional to batch size
  const estimatorPerItem = (perItem: bigint) => async (batch: number[]) =>
    BigInt(batch.length) * perItem;

  it("keeps maxSize chunks when every chunk fits under the cap", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const batches = await splitToFittingBatches(
      items,
      estimatorPerItem(1n),
      10n,
      4,
    );
    expect(batches).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10]]);
  });

  it("splits chunks that exceed the cap until they fit", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const batches = await splitToFittingBatches(
      items,
      estimatorPerItem(1n),
      3n,
      4,
    );
    for (const b of batches) expect(b.length).toBeLessThanOrEqual(3);
    expect(batches.flat()).toEqual(items);
  });

  it("returns singletons when nothing fits the cap", async () => {
    const items = [1, 2, 3];
    const batches = await splitToFittingBatches(
      items,
      estimatorPerItem(1n),
      0n,
      4,
    );
    expect(batches).toEqual([[1], [2], [3]]);
  });

  it("treats an estimator that throws as not fitting and still returns singletons", async () => {
    const items = [1, 2];
    const throwing = async () => {
      throw new Error("execution reverted");
    };
    const batches = await splitToFittingBatches(items, throwing, 1_000n, 4);
    expect(batches).toEqual([[1], [2]]);
  });

  it("never loses or reorders recipients", async () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    const batches = await splitToFittingBatches(
      items,
      estimatorPerItem(2n),
      5n,
      10,
    );
    expect(batches.flat()).toEqual(items);
  });
});
