import { describe, expect, it, vi } from "vitest";
import { downloadChunks } from "./download";

describe("resumable chunk downloads", () => {
  it("retries a failed download of the same chunk and preserves order", async () => {
    const attempts = new Map<string, number>();
    const fetcher = vi.fn(async (input: string) => {
      const index = new URL(input, "http://test").searchParams.get("index")!;
      const n = (attempts.get(index) ?? 0) + 1; attempts.set(index, n);
      if (index === "1" && n === 1) throw new TypeError("network disconnected");
      return new Response(new Uint8Array([Number(index) + 1]), { headers: { "Content-Type": "audio/mpeg" } });
    });
    const result = [];
    for await (const chunk of downloadChunks("/api", "read", 4, new AbortController().signal, fetcher)) result.push([...chunk]);
    expect(result).toEqual([[1], [2], [3], [4]]);
    expect(attempts.get("1")).toBe(2);
  });
  it("reports synthesis failure instead of retrying an already-exhausted server job", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "chunk failed after 3 attempts" }), { status: 502 }));
    const run = async () => { for await (const chunk of downloadChunks("/api", "read", 1, new AbortController().signal, fetcher)) { expect(chunk.length).toBeGreaterThan(0); } };
    await expect(run()).rejects.toThrow("chunk failed after 3 attempts");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds look-ahead while preserving out-of-order network results", async () => {
    const releases: ((response: Response) => void)[] = [];
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { releases.push(resolve); }));
    const iterator = downloadChunks("/api", "read", 5, new AbortController().signal, fetcher);
    const first = iterator.next();
    expect(fetcher).toHaveBeenCalledTimes(3);
    releases[2]?.(new Response(new Uint8Array([3])));
    releases[1]?.(new Response(new Uint8Array([2])));
    releases[0]?.(new Response(new Uint8Array([1])));
    expect([...(await first).value as Uint8Array]).toEqual([1]);
    expect([...(await iterator.next()).value as Uint8Array]).toEqual([2]);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect([...(await iterator.next()).value as Uint8Array]).toEqual([3]);
    expect(fetcher).toHaveBeenCalledTimes(5);
    releases[3]?.(new Response(new Uint8Array([4])));
    releases[4]?.(new Response(new Uint8Array([5])));
    expect([...(await iterator.next()).value as Uint8Array]).toEqual([4]);
    expect([...(await iterator.next()).value as Uint8Array]).toEqual([5]);
    expect((await iterator.next()).done).toBe(true);
  });

});
