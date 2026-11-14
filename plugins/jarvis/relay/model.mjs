// Model-only inference through BB's existing account pool. No shell, browser,
// filesystem, MCP or agent tools are offered to this conversational model.
// The inherited credential remains on the BB host and is never sent to staging.
export function createTalker({ baseUrl, token, model = "gpt-6.1-sol" }) {
  if (!baseUrl || !token)
    throw Error("The talker needs the host’s existing BB account-pool route");
  return async function complete({ instructions, input, signal }) {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/responses`, {
      method: "POST",
      signal: AbortSignal.any([
        signal ?? new AbortController().signal,
        AbortSignal.timeout(45000),
      ]),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        stream: true,
        instructions,
        reasoning: { effort: "low" },
        tools: [],
        input: [
          { role: "user", content: [{ type: "input_text", text: input }] },
        ],
      }),
    });
    if (!response.ok)
      throw Error(`Conversational model unavailable (${response.status})`);
    let buffer = "",
      output = "",
      completed = false;
    const decoder = new TextDecoder();
    for await (const bytes of response.body) {
      buffer += decoder.decode(bytes, { stream: true });
      let cut;
      while ((cut = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        for (const line of frame.split("\n"))
          if (line.startsWith("data: ")) {
            const raw = line.slice(6);
            if (raw === "[DONE]") continue;
            const event = JSON.parse(raw);
            if (event.type === "response.output_text.delta")
              output += event.delta;
            if (event.type === "response.completed") completed = true;
            if (event.type === "error" || event.type === "response.failed")
              throw Error("Conversational model failed");
          }
        if (output.length > 12000)
          throw Error("Conversational reply exceeded its limit");
      }
    }
    if (!completed || !output.trim())
      throw Error("Conversational reply was interrupted");
    return output.trim();
  };
}
