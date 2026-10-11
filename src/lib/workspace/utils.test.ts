// fetchAllRows: the paging that keeps wide reads (Reports' Gross Profit, the
// personal 400-day history) from being silently cut at PostgREST's per-response
// "Max rows" cap. A fake server stands in for PostgREST so the cap can be set
// to whatever the test needs.
import { describe, expect, it } from "vitest";
import { fetchAllRows } from "./utils";

/** Mimics PostgREST: honors .range(from, to) but never returns more than `cap` rows. */
function fakeServer(totalRows: number, cap: number) {
  const rows = Array.from({ length: totalRows }, (_, i) => ({ id: i }));
  const calls: Array<[number, number]> = [];
  const buildPage = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null };
  };
  return { buildPage, calls };
}

describe("fetchAllRows", () => {
  it("returns every row past the server's per-response cap", async () => {
    const { buildPage } = fakeServer(2500, 1000);
    const rows = await fetchAllRows(buildPage, 5000);
    expect(rows).toHaveLength(2500);
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 2500 }, (_, i) => i));
  });

  it("stops at maxRows, so a full-length result still signals truncation", async () => {
    const { buildPage, calls } = fakeServer(7000, 1000);
    const rows = await fetchAllRows(buildPage, 5000);
    expect(rows).toHaveLength(5000);
    expect(calls).toHaveLength(5);
  });

  it("doesn't need to know the server's cap", async () => {
    const { buildPage } = fakeServer(1234, 100);
    expect(await fetchAllRows(buildPage, 5000)).toHaveLength(1234);
  });

  it("asks only for the rows still wanted", async () => {
    const { buildPage, calls } = fakeServer(1500, 1000);
    await fetchAllRows(buildPage, 5000);
    expect(calls).toEqual([
      [0, 4999],
      [1000, 4999],
      [1500, 4999],
    ]);
  });

  it("handles an empty result", async () => {
    const { buildPage } = fakeServer(0, 1000);
    expect(await fetchAllRows(buildPage, 5000)).toEqual([]);
  });

  it("throws the server's error", async () => {
    const buildPage = async () => ({ data: null, error: { message: "permission denied" } });
    await expect(fetchAllRows(buildPage, 5000)).rejects.toThrow("permission denied");
  });
});
