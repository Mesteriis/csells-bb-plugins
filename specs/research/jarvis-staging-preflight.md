# Jarvis implementation preflight

Date: 2026-11-14. Owner: thread thr_qpanimf2w7. Specs published at e3b3b451e178ba8993409fa5ea79995a1517fe95 on origin/specs/jarvis-vision. Implementation is authorized; promotion is not. The initial candidate is installed only in its disposable VM. A fresh expiring relay credential was issued; shared service/provider credentials have not been copied.

## Confirmed platform boundary

The installed BB reports Plugin SDK 0.6.132; this repository's existing plugin pins are 0.5.9. `bb plugin types --check plugins/you-should-know` reports that mismatch. Jarvis must pin the installed contract rather than inherit the old implementation's dependency version.

The installed plugin-authoring reference documents `bb.sdk` as bound to the hosting server over loopback. Local BB source corroborates this: `apps/server/src/start-server.ts` binds the plugin service to its own 127.0.0.1 server port, and `services/plugins/plugin-runtime.ts` constructs that SDK from the binding. This is source evidence, not an end-to-end candidate test.

A separate BB installation's ordinary plugin SDK therefore operates on that installation's sessions. Installing Jarvis there alone would not demonstrate awareness or control of Chris's existing BB sessions. Installing the candidate into stable BB would change the stable installation before review. The official fake-host harness is appropriate for unit tests, but its documented auth/event/runtime limitations make it unsuitable as the live staging artifact.

## Approved staging decision

Proposed: add a restricted remote adapter for staging, preserving the local SDK adapter for normal plugin installation. The candidate UI/backend runs in a disposable VM. A separate task-owned relay on the BB host calls the existing BB API without loading candidate code into stable BB, modifying its database directly, or copying provider credentials.

The relay would expose only bounded reads of authorized visible sessions and interactions, plus operations on an explicit allowlist of task-owned test sessions. Task ownership is held by the relay, not trusted from candidate-supplied metadata. It must reject arbitrary URLs, shell/file operations, unrelated session mutations and unrestricted forwarding. Creation is confined to the selected test project/environment and reconciled by correlation before retry. Approvals require the exact current interaction and explicit decision; stopping covers only the owned scope. New expiring staging credentials remain private, and relay routes/credentials are removed at teardown.

Chris approved the restricted relay on 2026-11-14. This adds a remote-access component to the agreed plugin design while preserving real existing-session acceptance. Validate the adapter and relay contracts with the actual installed public API before coding them; the private `@bb/sdk` workspace package is not a distributable plugin dependency. The initial relay now uses the public `bb-app` `BBSdk` export and has passed real session reads, a bounded delegation and one independently observed foreground-process cancellation. This is foundation evidence, not full acceptance.

## Placement observations

Registry discovery succeeded. Badger's pinned SSH identity and DMI serial matched its registry. Live running guest allocations total 27,648 MiB of 31,986 MiB, leaving 4,338 MiB before a new allocation; the recorded minimum host headroom is 4,096 MiB. Do not place a new candidate there under that policy despite apparent available memory. Existing guests were preserved.

Lynx has a registered Debian 13 template on a private DHCP/NAT guest network and a 4,096 MiB headroom requirement. Its recorded capacity is not a live admission check. Pinned SSH reached the host but authentication using the registered lab key was rejected. The registered CA-verified Proxmox API also rejected its recorded administrative credential (HTTP 401). Investigate current registered access before selecting or reserving it; do not relax host-key verification. No changes were made to Lynx.

## Next execution steps

1. Complete the requested source research before implementation, then verify the approved restricted relay against the actual supported access path.
2. Verify live hypervisor capacity and recovery, reserve a task-owned VM with an expiry in the registry, then provision with new scoped credentials.
3. Scaffold Jarvis with the current SDK. Start Slice A with durable dispatch correlation, watched-session state, exact decision routing and scoped cancellation; write failure-path tests before implementation.
4. Exercise the actual plugin against real BB work and publish a review URL and evidence. Continue speech, memory and initiative according to the release gates; no promotion until Chris approves the staged candidate.

## Provisioned candidate and initial live evidence

Dragon was selected after fresh pinned SSH checks: physical memory31,929MiB, existing guest allocation24,576MiB, candidate2,048MiB, remaining5,305MiB. VM100 is a full clone of Debian13 template9001, two vCPUs and24GiB disk, on the existing private NAT bridge. Dedicated SSH key, pinned guest host identity, owner `thr_qpanimf2w7`, expiry2026-11-18T23:59:59Z. Registry service `jarvis-stage-thr-qpanimf2w7` and Dragon's task guest inventory were updated and read back. The live registry remains authoritative for placement and lifecycle.

Guest cloud-init initially exposed a deprecated user field from the shared template. Task-specific user-data fixed it; reboot returned cloud-init done, no errors or recoverable warnings. The shared template stayed unchanged. Node24.22.3 official archive checksum was verified; BB0.49.0 and SDK0.6.132 run from task-owned directories. BB listens only on guest loopback. Its first-run provider onboarding was completed through the public settings API because execution is supplied by the real BB relay, not a second provider installation.

The relay is a separate process on the real BB host, bound to loopback, reached by a dedicated SSH reverse tunnel. The browser reaches only the candidate BB server. A new private credential expires at the staging expiry; neither the browser nor guest has a stable BB/provider/admin credential. The relay exposes seven explicit operations and rejects arbitrary method/URL/target forwarding, browser-origin requests, expired tokens and unrelated mutations. Ownership comes from its durable dispatch journal. Uncertain dispatches are never retried automatically; recovery requires matching the original BB spawn event and server-generated correlation.

Initial live checks on2026-11-14:

- Candidate read50 real visible top-level sessions through its actual plugin RPC.
- Task `live-read-smoke-01`, real thread `thr_mgg4t5unqf`, produced the exact requested bounded response through Codex.
- Task `live-cancel-01`, real thread `thr_g4v6fruk75`, ran a foreground180-second test process. The controller verified its PID and command before stopping. The candidate reported observed-idle, and an independent process check found the PID absent after465ms. One sample; this is neither a percentile nor voice latency evidence.
- An unrelated stop operation was rejected. Desktop browser rendering showed the staff panel and actual sessions with zero captured page errors.
- Current focused suite covers idempotency, unknown dispatch/recovery, approval races, uncertain decisions, visibility races, late descendants, restricted transport and the imported Qwen lifecycle regressions. See implementation evidence for the current count/build.

Artifacts and private credentials live outside the VM in task thread storage under `thr_qpanimf2w7/jarvis-staging`. Source lives on the feature branch. The early typed panel is not the complete SliceA/B review candidate: conversational talker, ordinary questions/follow-ups, full cancellation reconciliation, speech, memory, initiative and the declared acceptance scorecard remain pending. Do not promote this foundation as the finished product.


Current foundation verification:22 tests passed on the VM, TypeScript check and BB plugin build passed. Chrome for Testing155.0.8059.39 exercised actual session-detail controls at1280×960 and390×844: response visible, no horizontal panel overflow, no captured page errors. The narrow layout check found a long-path wrapping defect, which was fixed and retested. This is responsive browser coverage, not physical-phone microphone/audio evidence. Restarting the relay and resubmitting the same operation returned the same real thread; the journal remained at two tasks.

Early authenticated preview: https://csells-mac-mini--4840.getbb.app/plugins/jarvis/staff. Unauthenticated requests return401. Source/evidence remain outside the VM; the registry records the exact launchd relay/tunnel jobs, exposure and teardown ownership. The preview is not a promotion request.
