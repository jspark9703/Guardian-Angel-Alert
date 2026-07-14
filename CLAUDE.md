# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CSI-Guard: a Wi-Fi CSI-based non-contact fall detection dashboard (실시간 관제 · 낙상 감지). The frontend (`src/`) is still primarily a **mockup** — FACILITY accounts (multi-resident nursing-home scenario) are 100% simulated in-memory via `setInterval` timers, with no real backend, database, or MQTT broker. Refreshing the page resets everything except the session (persisted to `localStorage`).

**HOME accounts are different**: a real local Python backend (`backend/`, see below) now exists for the single-device home scenario, and the frontend bridges to it over HTTP/WebSocket (`src/lib/backend.ts`, `src/components/BackendDetectionBridge.tsx`) instead of the mock simulation. When touching HOME-facing code, check whether the change belongs in the mock store or the real backend — they are two separate, only loosely-coupled implementations of the same UI contract (see "The mock store" and "Local backend" below).

The UI text is Korean (product is being built for a Korean eldercare/home-monitoring market). Keep new user-facing strings in Korean and consistent with existing terminology (see "Domain terms" below).

This project is connected to [Lovable](https://lovable.dev) and synced via git — see the notes under "Lovable sync" before rewriting history.

## Commands

Package manager is **bun** (`bun.lock`, `bunfig.toml` present).

```bash
bun install        # install deps
bun run dev         # vite dev server
bun run build       # production build (vite build)
bun run build:dev   # dev-mode build
bun run preview     # preview a production build
bun run lint         # eslint .
bun run format       # prettier --write .
```

There is no test suite/runner configured for the frontend. Don't invent one — check with the user before adding a test framework.

The Python backend (`backend/`) has its own venv and dependencies, run separately from the frontend:

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python main.py                        # auto-detects the receiver's serial port, http 127.0.0.1:8000
.venv/bin/python main.py --no-model              # skip DL model load (serial + presence/MV only, no fall inference)
.venv/bin/python bench_pipeline.py --fs 166.67   # pipeline latency benchmark
```

No test suite there either — `backend/tests` doesn't exist; ad hoc verification is done by importing the module under `PYTHONPATH=.` and feeding synthetic CSI frames (see recent session history / `backend/README.md`).

## Architecture

### Stack
- **TanStack Start** (React 19 + TanStack Router, file-based routing) via `@lovable.dev/vite-tanstack-config`, which wraps most of `vite.config.ts` — do not manually add TanStack devtools, `tanstackStart`, `viteReact`, `tailwindcss`, `tsConfigPaths`, nitro, or the `@` path alias plugins; they're already injected by that config (see the comment at the top of [vite.config.ts](vite.config.ts)).
- Tailwind CSS v4 + shadcn/ui (`new-york` style, see [components.json](components.json)) for components in `src/components/ui`.
- No server-side data layer yet: `@tanstack/react-query` is wired up (`QueryClientProvider` in `__root.tsx`) but nothing currently fetches through it — all reads/writes go through the mock store.

### Routing (`src/routes/`)
File-based routing per TanStack Start conventions — see [src/routes/README.md](src/routes/README.md) for the naming rules (`$id` dynamic segments, `{-$category}` optional, `$` splat, `_layout` layouts). `src/routeTree.gen.ts` is auto-generated; never hand-edit it. The only root shell is `src/routes/__root.tsx`; don't create Next/Remix-style `pages/` or `app/` directories.

Route list: `index` (live dashboard), `history` (fall history), `event-log`, `devices` (device/MQTT management + calibration), `residents` (resident CRUD + resident↔device mapping, both FACILITY and HOME), `facility-members` (root-only member management), `notifications` (알림 게이트웨이 — SMS/push/ARS recipients), `config` (detection algorithm thresholds), `account`, `train` (model-training page — currently a "Coming Soon" stub, not implemented), `login`, `signup`.

There is no onboarding wizard route — an earlier `onboarding` route bundled resident registration + device registration + calibration into one forced first-login flow, but it was removed once `AuthGate` stopped gating on it (see below); resident registration/device↔resident mapping now lives entirely in `residents`, and device add+calibration lives entirely in `devices` (`AddDeviceButton`).

### Auth / session gating
`src/routes/__root.tsx` wraps every page in `AuthGate` ([src/components/AuthGate.tsx](src/components/AuthGate.tsx)), which:
- Hydrates the session from `localStorage` on mount (`hydrateSession()` — must run client-side only, hence the `hydrated` gate to avoid SSR mismatch).
- Redirects unauthenticated users to `/login`, and authenticated users away from `/login`/`/signup`. Onboarding is **not** enforced — a logged-in user always lands on the dashboard regardless of whether they've registered any resident/device yet; registration is optional and user-initiated via the sidebar (`residents`, `devices`).
- Only renders `AppSidebar` + `FallAlarmModal` chrome once a session exists; `/login`/`/signup` render standalone.

`PUBLIC_PATHS` in `AuthGate.tsx` is the source of truth for which routes skip the auth check — update it when adding new pre-login routes.

### The mock store (`src/lib/mock-store.ts`)
This is the heart of the app for FACILITY (and unconnected/mock HOME) users — read it before touching almost any feature. Key points:
- A hand-rolled external store using `useSyncExternalStore` (`useStore(selector)`), not Redux/Zustand. `set(patch)` shallow-merges and notifies listeners; `getState()` is available for non-reactive reads.
- Domain model: `UserAccount` (service: `HOME`|`FACILITY`, role: `ROOT`|`MEMBER`|`USER`) → optionally belongs to a `Facility` → owns/relates to `Device`s and `Resident`s. `Resident.deviceIds` supports multi-device mapping (e.g., a room's bathroom + shower sensors); `deviceId` is kept as the primary/back-compat pointer.
- **Simulation loop**: a `setInterval(tick, 100)` (client-only, guarded by `typeof window !== "undefined"`) mutates resident `mv`/`wander`/`presence`/`state` and device `rssi`/`noise_floor` each tick, occasionally injecting a random "fall" spike. This drives FACILITY's live-monitoring UI. A HOME resident that's actively bridged to the real backend (`backendDrivenResidentId`, set by `applyBackendDetection`) is excluded from this loop — its `state`/`confidence`/`presence`/`wander`/`mv` come from the real backend instead (see "Local backend" below); if the backend disconnects it's shown explicitly offline rather than falling back to simulated values.
- **Fall state machine**: `StateMachine = IDLE | SUSPECT | FALL | COOLDOWN`, transitions driven by comparing `mv` against `PipelineConfig.mv_threshold` (or a per-resident `thresholdOverride`). `PipelineConfig` mirrors the *old* MV-threshold reference pipeline's tunables (window/stride/bandpass/threshold — see "Reference implementation" below) and only drives the mock simulation; it has no effect on the real backend, which uses a DL model for fall detection and a separately-named `presence_mv_threshold` for movement/presence.
- **Device calibration flow** (`startDeviceReset`, `applyCalibrationStatus`): a 4-phase timed simulation — `LEAVING` (10s) → `WAITING_ACK` (~0.2s) → `WAITING_AGC` (~1s) → `MEASURING` (20s) → `DONE`, mirroring the real backend's `onboarding.run_calibration()` timing exactly (~31s total, not compressed) so the mock and real UI show the same phases. Produces `Device.presence_mv_threshold`/`wander_baseline` (not RSSI/noise floor — those remain separate ongoing telemetry). `devices.tsx` (`AddDeviceButton`, `ResetConfirmModal`) picks this mock timer vs. the real `startCalibration()`/`useCalibrationStatusPoll` (`src/lib/backend.ts`) purely on `!isFacility && backendUp` — a HOME account only ever has one real backend serial connection, so this doesn't depend on resident↔device mapping (that's `residents.tsx`'s separate responsibility).
- Scoping: FACILITY users only see residents/devices/logs where `facilityId` matches their facility; HOME users only see their own (`ownerUserId`). When adding new entities or queries, follow this same scoping pattern (see `useScopedLogs`, `tick()`'s `scopedResidents`).
- All mutations are plain exported functions (`login`, `signup`, `simulateFall`, `upsertResident`, `upsertDevice`, `updateConfig`, `acknowledgeAlarm`, ...) called directly from components — no dispatch/action-type layer.
- `backendConnected` (set by `BackendDetectionBridge`) reflects the real backend's live WS+serial connection state for HOME users, independent of the mock `running` flag (which only starts/stops the FACILITY simulation loop and has no effect on the real backend). UI chrome that shows "is the system live" (`AppSidebar`'s status dot, `index.tsx`'s stopped banner) branches on whichever flag is actually meaningful for that user's service type — don't wire mock `running` into HOME-facing status displays.

### Local backend (`backend/`)
A real local FastAPI server for the single-device HOME scenario — reads a physical ESP32-C5 receiver over serial, runs CSI signal processing, and serves the frontend over HTTP/WebSocket at `127.0.0.1:8000`. Not used by FACILITY accounts at all. See `backend/README.md` for the full endpoint list and setup; key architectural points:
- **Two independent threads, not one pipeline**: `detector.py` (`FallDetector`) does DL-based fall detection (S3 scalogram + PCA-ACF features → `DualBranchResNet` → threshold + causal majority vote) and requires a model checkpoint to run at all. `presence_loop.py` (`PresenceLoop`) does movement(MV)/presence detection independently — it runs whenever the serial reader has data, **regardless of whether the DL model loaded** (`--no-model`, missing checkpoint, etc.). These were originally coupled (presence computed inside `FallDetector`) until that was found to silently kill all movement/presence output whenever the model wasn't available; keep them separate.
- `main.py` starts both unconditionally-where-possible (`start_presence_loop()` always; `start_detector()` best-effort) and merges their `live_payload()`s into the `/ws/live` WebSocket (10Hz) — presence fields (`presence_state`, `mv_current`, `wander_current`, ...) are always present when connected; fall fields (`proba_fall`, `detect_state`, ...) are only present if the DL model loaded.
- `presence/` (ported from `reference/fall_detect/`, see below) holds the movement/presence signal chain: `streaming_features.py`/`preprocessing.py` (resample → bandpass → subcarrier select → moving-variance or Welch-PSD band energy) and `state_machine.py` (`PresenceDetector`, PRESENT/ABSENT timeout logic). `presence/config.py`'s `PresenceConfig.presence_mv_threshold`/`wander_baseline` are deliberately named apart from `detector.py`'s DL probability `threshold` — different scales, unrelated signals, both computed from the same raw CSI stream in parallel.
- `onboarding.py` (`run_calibration`) drives the 4-phase calibration (`leaving`/`waiting_ack`/`waiting_agc`/`measuring`) that derives `presence_mv_threshold`/`wander_baseline`, exposed via `POST /onboarding/calibrate/start` + `GET /onboarding/calibrate/status`. It assumes the receiver firmware already understands a `"train"` serial command (`csi_recv_calibrate`); this repo doesn't touch firmware.
- `csi/serial_reader.py`/`csi/buffer.py` expose a small duck-typed contract (`.running`, `.packet_count`, `.send_line()`, `.get_window()`) that `onboarding.run_calibration()` and the presence/fall loops depend on — preserve these names if refactoring either file.
- No test suite; `.venv` and `__pycache__` are gitignored but the rest of `backend/` is tracked.

### Reference implementation (`reference/fall_detect/`)
A separate, older Python/FastAPI project (gitignored — `reference/*` in `.gitignore`, exists locally only) implementing a full CSI pipeline built around **classic moving-variance thresholding** (no DL model) for both fall *and* presence detection: resample → Butterworth bandpass → top-N subcarrier selection → moving-variance/Welch-PSD → threshold state machine. `backend/presence/` and `backend/onboarding.py` are a near-verbatim port of this project's presence-detection and calibration code (see `reference/fall_detect/migration.md` for the porting rationale/dependency map) — the fall-detection half (`fall_state_machine.py`) was **not** ported, since `backend/detector.py` uses a real DL model instead. `mock-store.ts`'s `PipelineConfig`/`DEFAULT_CONFIG` also mirror this project's old `PipelineConfig` field names for the mock simulation; keep them in sync if either changes. Not run or imported directly by the frontend or by `backend/`.

### SSR error handling
`src/start.ts` (request middleware) and `src/server.ts` (fetch wrapper) both catch server-side errors and render a fallback via `src/lib/error-page.ts`, because h3/Nitro can swallow in-handler throws into an opaque `{"unhandled":true,"message":"HTTPError"}` 500 response. `src/lib/error-capture.ts` records the last real error out-of-band (via global `error`/`unhandledrejection` listeners) so `server.ts` can recover the original stack trace when it detects that swallowed-error shape. Don't remove this plumbing when touching SSR/error handling — it's working around a specific upstream h3 behavior, not incidental complexity.

## Domain terms (Korean UI)
- MV / moving variance → **움직임 감지** ("motion detection") in threshold/label text, "이동 분산 (딥러닝 입력)" when referring to the underlying signal.
- Fall states: IDLE=대기, SUSPECT=의심, FALL=낙상, COOLDOWN=냉각중.
- Presence: PRESENT=재실, ABSENT=퇴실.
- Service types: HOME (가정) vs FACILITY (시설); FACILITY roles: ROOT(시설 등록자)/MEMBER(초대코드로 참여).
- "움직임 임계값"/"재실 baseline" in real-backend-facing UI text refer to `presence_mv_threshold`/`wander_baseline` — keep these visually and terminologically separate from the DL fall-probability threshold (labeled "판정 임계값"/"낙상 확률 임계값"); they are unrelated numbers on different scales.

## Conventions
- Path alias `@/*` → `src/*` (see [tsconfig.json](tsconfig.json)).
- Prettier: 100 col width, double quotes off (`singleQuote: false`), trailing commas everywhere — run `bun run format` rather than hand-wrapping.
- ESLint: `@typescript-eslint/no-unused-vars` is off and `noUnusedLocals`/`noUnusedParameters` are off in `tsconfig.json` — don't add these back speculatively. Importing the Next.js `server-only` package is blocked by lint; use a `*.server.ts` filename or `@tanstack/react-start/server-only` instead.
- `bunfig.toml` enforces a 24h supply-chain guard on new package versions (`minimumReleaseAge`); only a short allowlist of `@lovable.dev/*` packages bypasses it. Adding to that exclusion list needs explicit user confirmation.

## Lovable sync
This branch is connected to Lovable and pushes sync back into the Lovable editor. Avoid force-pushing or rewriting/rebasing/amending already-pushed commits — it rewrites history on Lovable's side and can lose the user's project history there. Keep the connected branch in a working (buildable) state.
