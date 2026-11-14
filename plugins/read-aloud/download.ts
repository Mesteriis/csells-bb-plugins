/** Download completed chunks concurrently, consuming them in their spoken order. */
export async function* downloadChunks(
  route: string, id: string, count: number, signal: AbortSignal,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch,
): AsyncGenerator<Uint8Array> {
  const download = async (index: number): Promise<Uint8Array> => {
    for (let attempt = 1; ; attempt++) {
      signal.throwIfAborted();
      let response: Response;
      let bytes: Uint8Array;
      try {
        response = await fetcher(`${route}/chunk?id=${encodeURIComponent(id)}&index=${index}`, { signal });
        if (!response.ok) {
          const detail = await response.json() as { error?: string };
          throw new Error(detail.error ?? `Audio download failed (${response.status})`);
        }
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch (cause) {
        signal.throwIfAborted();
        // Fetch/body transport failures are TypeErrors. A server's explicit
        // error already includes its exhausted synthesis attempts.
        if (!(cause instanceof TypeError) || attempt === 3) throw cause;
        continue;
      }
      if (bytes.length === 0) throw new Error(`Audio chunk ${index + 1} was empty`);
      return bytes;
    }
  };
  // Convert rejection to a value immediately: a later chunk can fail while
  // we are still awaiting an earlier one, without an unhandled rejection.
  type Result = { bytes: Uint8Array } | { error: unknown };
  const running: Promise<Result>[] = [];
  let next = 0;
  const fill = () => {
    while (running.length < 3 && next < count) {
      running.push(download(next++).then(bytes => ({ bytes }), (error: unknown) => ({ error })));
    }
  };
  fill();
  while (running.length > 0) {
    const pending = running.shift();
    if (pending === undefined) break;
    const result = await pending;
    signal.throwIfAborted();
    if ("error" in result) throw result.error;
    yield result.bytes;
    fill();
  }
}
