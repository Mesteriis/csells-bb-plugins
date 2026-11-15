// The registered gateway issues a fresh exclusive short-lived credential per
// utterance. Its administrator key is read only on its owning host, never copied.
import { readFile } from "node:fs/promises";
export function createVoice({ baseUrl, adminKeyPath, sdk }) {
  let active = false;
  return {
    async transcribe(bytes, type, signal) {
      return sdk.system.transcribeVoice({
        file: new Blob([bytes], { type }),
        prompt:
          "An English conversation with Jarvis about BB agents and their questions.",
        signal,
      });
    },
    async speech(text, signal) {
      if (typeof text !== "string" || !text.trim() || text.length > 2000)
        throw Error("Speech must contain 1–2000 characters");
      if (active) throw Error("Speech is busy");
      active = true;
      let lease;
      const release = async () => {
        try {
          if (lease) {
            const response = await fetch(`${baseUrl}/leases/current`, {
              method: "DELETE",
              headers: { authorization: `Bearer ${lease.api_key}` },
              signal: AbortSignal.timeout(5000),
            });
            if (!response.ok)
              throw Error(
                "Voice lease release was not confirmed; its expiry remains in force",
              );
          }
        } finally {
          active = false;
        }
      };
      try {
        const admin = (await readFile(adminKeyPath, "utf8")).trim();
        const reservation = await fetch(`${baseUrl}/leases`, {
          method: "POST",
          signal,
          headers: {
            authorization: `Bearer ${admin}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            owner: "jarvis-stage-voice",
            ttl_seconds: 120,
          }),
        });
        if (!reservation.ok)
          throw Error(`Alfred voice unavailable (${reservation.status})`);
        lease = await reservation.json();
        const audio = await fetch(`${baseUrl}/v1/audio/speech`, {
          method: "POST",
          signal,
          headers: {
            authorization: `Bearer ${lease.api_key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "pocket-tts",
            voice: "alfred",
            speed: 1.0,
            response_format: "pcm",
            input: text,
          }),
        });
        if (!audio.ok) throw Error(`Alfred synthesis failed (${audio.status})`);
        return { body: audio.body, release };
      } catch (e) {
        await release();
        throw e;
      }
    },
  };
}
