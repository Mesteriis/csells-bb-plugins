// Closed metadata vocabulary: never persist transcript, prompt, URLs, headers,
// arbitrary error strings or audio. Shared by client and relay ingestion.
const stages = new Set([
  "connect",
  "duplex",
  "page",
  "media",
  "speaker-check",
  "capture",
  "turn",
  "transcribe",
  "command",
  "speech",
  "playback",
  "context",
  "relay",
  "client",
]);
const phases = new Set([
  "start",
  "audible",
  "silent",
  "visible",
  "hidden",
  "muted",
  "unmuted",
  "ready",
  "waiting",
  "first-byte",
  "scheduled",
  "complete",
  "failed",
  "interrupted",
  "running",
  "suspended",
  "closed",
  "interrupted-context",
  "exit",
]);
const uuid = /^[a-f0-9-]{36}$/i;
export function diagnostic(input, now = Date.now()) {
  if (!input || !stages.has(input.stage) || !phases.has(input.phase))
    return null;
  const out = { at: now, stage: input.stage, phase: input.phase };
  if (["mic-off","media-before-mic","media-after-mic","unprocessed","webrtc","jarvis-graph","native-graph","webrtc-jarvis"].includes(input.mode)) out.mode=input.mode;
  for (const key of ["micLive","echoCancellation","noiseSuppression","autoGainControl"]) if(typeof input[key]==="boolean") out[key]=input[key];
  for (const key of ["clientId", "requestId", "utteranceId"])
    if (typeof input[key] === "string" && uuid.test(input[key]))
      out[key] = input[key];
  for (const key of [
    "durationMs",
    "bytesSent",
    "contextSampleRate",
    "bytesReceived",
    "clockMs",
    "utteranceAgeMs",
    "bytes",
    "samples",
    "generation",
    "httpStatus",
    "sampleRate",
    "bufferedMs",
    "pid",
    "positionMs",
    "rms",
    "exitCode",
  ])
    if (Number.isFinite(input[key]) && input[key] >= 0)
      out[key] = Math.min(input[key], 1e12);
  if (["visible", "hidden"].includes(input.visibility))
    out.visibility = input.visibility;
  if (
    [
      "AbortError",
      "NotAllowedError",
      "NotReadableError",
      "NetworkError",
      "TimeoutError",
      "TypeError",
      "Error",
    ].includes(input.errorKind)
  )
    out.errorKind = input.errorKind;
  if (
    ["android", "ios", "mac", "windows", "linux", "unknown"].includes(input.os)
  )
    out.os = input.os;
  if (
    typeof input.browser === "string" &&
    /^(Chrome|Firefox|Safari|Edge)\/[0-9.]{1,24}$/.test(input.browser)
  )
    out.browser = input.browser;
  return out;
}
