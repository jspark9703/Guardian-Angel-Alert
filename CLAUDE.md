# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CSI-Guard: a Wi-Fi CSI-based non-contact fall detection dashboard (실시간 관제 · 낙상 감지). This repo is currently an **entirely front-end mockup/prototype** — there is no real backend, database, or MQTT broker. All app state (residents, devices, facilities, users, fall events, live sensor readings) lives in a single in-memory client store and is simulated with `setInterval` timers. Refreshing the page resets everything except the session (persisted to `localStorage`).

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

There is no test suite/runner configured in this repo. Don't invent one — check with the user before adding a test framework.

## Architecture

### Stack
- **TanStack Start** (React 19 + TanStack Router, file-based routing) via `@lovable.dev/vite-tanstack-config`, which wraps most of `vite.config.ts` — do not manually add TanStack devtools, `tanstackStart`, `viteReact`, `tailwindcss`, `tsConfigPaths`, nitro, or the `@` path alias plugins; they're already injected by that config (see the comment at the top of [vite.config.ts](vite.config.ts)).
- Tailwind CSS v4 + shadcn/ui (`new-york` style, see [components.json](components.json)) for components in `src/components/ui`.
- No server-side data layer yet: `@tanstack/react-query` is wired up (`QueryClientProvider` in `__root.tsx`) but nothing currently fetches through it — all reads/writes go through the mock store.

### Routing (`src/routes/`)
File-based routing per TanStack Start conventions — see [src/routes/README.md](src/routes/README.md) for the naming rules (`$id` dynamic segments, `{-$category}` optional, `$` splat, `_layout` layouts). `src/routeTree.gen.ts` is auto-generated; never hand-edit it. The only root shell is `src/routes/__root.tsx`; don't create Next/Remix-style `pages/` or `app/` directories.

Route list: `index` (live dashboard), `history` (fall history), `event-log`, `devices` (device/MQTT management + calibration), `residents` (facility resident CRUD), `facility-members` (root-only member management), `notifications` (알림 게이트웨이 — SMS/push/ARS recipients), `config` (detection algorithm thresholds), `account`, `train` (model-training page — currently a "Coming Soon" stub, not implemented), `login`, `signup`, `onboarding`.

### Auth / session gating
`src/routes/__root.tsx` wraps every page in `AuthGate` ([src/components/AuthGate.tsx](src/components/AuthGate.tsx)), which:
- Hydrates the session from `localStorage` on mount (`hydrateSession()` — must run client-side only, hence the `hydrated` gate to avoid SSR mismatch).
- Redirects unauthenticated users to `/login`, unonboarded users to `/onboarding`, and onboarded/authenticated users away from `/login`, `/signup`, `/onboarding`.
- Only renders `AppSidebar` + `FallAlarmModal` chrome once a session exists and the user is onboarded; `/login`, `/signup`, `/onboarding` render standalone.

`PUBLIC_PATHS` in `AuthGate.tsx` is the source of truth for which routes skip the auth check — update it when adding new pre-login routes.

### The mock store (`src/lib/mock-store.ts`)
This is the heart of the app — read it before touching almost any feature. Key points:
- A hand-rolled external store using `useSyncExternalStore` (`useStore(selector)`), not Redux/Zustand. `set(patch)` shallow-merges and notifies listeners; `getState()` is available for non-reactive reads.
- Domain model: `UserAccount` (service: `HOME`|`FACILITY`, role: `ROOT`|`MEMBER`|`USER`) → optionally belongs to a `Facility` → owns/relates to `Device`s and `Resident`s. `Resident.deviceIds` supports multi-device mapping (e.g., a room's bathroom + shower sensors); `deviceId` is kept as the primary/back-compat pointer.
- **Simulation loop**: a `setInterval(tick, 100)` (client-only, guarded by `typeof window !== "undefined"`) mutates resident `mv`/`wander`/`presence`/`state` and device `rssi`/`noise_floor` each tick, occasionally injecting a random "fall" spike. This drives the whole live-monitoring UI — there's no real sensor or MQTT connection.
- **Fall state machine**: `StateMachine = IDLE | SUSPECT | FALL | COOLDOWN`, transitions driven by comparing `mv` against `PipelineConfig.mv_threshold` (or a per-resident `thresholdOverride`). `PipelineConfig` mirrors the real signal-processing pipeline's tunables (window/stride/bandpass/threshold — see "Reference implementation" below).
- **Device calibration flow** (`startDeviceReset`): a two-phase timed simulation (10s WAITING + 10s MEASURING) that mimics recalibrating base RSSI/noise floor. Progress is polled via `getResetTimeLeft`.
- Scoping: FACILITY users only see residents/devices/logs where `facilityId` matches their facility; HOME users only see their own (`ownerUserId`). When adding new entities or queries, follow this same scoping pattern (see `useScopedLogs`, `tick()`'s `scopedResidents`).
- All mutations are plain exported functions (`login`, `signup`, `simulateFall`, `upsertResident`, `upsertDevice`, `updateConfig`, `acknowledgeAlarm`, ...) called directly from components — no dispatch/action-type layer.

### Reference implementation (`reference/fall_detect_for_benchmark/`)
A separate Python/FastAPI project (gitignored — `reference/*` in `.gitignore`, exists locally only) implementing the *real* CSI signal-processing pipeline this dashboard's mock simulates: resample → Butterworth bandpass → top-N subcarrier selection → moving-variance → threshold state machine. Its `PipelineConfig`-equivalent fields and parameter names (`mv_threshold`, `mv_window_sec`, `bandpass_low/high`, `cooldown_s`, etc.) are intentionally mirrored in `mock-store.ts`'s `PipelineConfig`/`DEFAULT_CONFIG` — keep them in sync if either changes. See its README for the two-ESP32-C5 hardware setup and API surface; it is not run or imported by this front-end project.

### SSR error handling
`src/start.ts` (request middleware) and `src/server.ts` (fetch wrapper) both catch server-side errors and render a fallback via `src/lib/error-page.ts`, because h3/Nitro can swallow in-handler throws into an opaque `{"unhandled":true,"message":"HTTPError"}` 500 response. `src/lib/error-capture.ts` records the last real error out-of-band (via global `error`/`unhandledrejection` listeners) so `server.ts` can recover the original stack trace when it detects that swallowed-error shape. Don't remove this plumbing when touching SSR/error handling — it's working around a specific upstream h3 behavior, not incidental complexity.

## Domain terms (Korean UI)
- MV / moving variance → **움직임 감지** ("motion detection") in threshold/label text, "이동 분산 (딥러닝 입력)" when referring to the underlying signal.
- Fall states: IDLE=대기, SUSPECT=의심, FALL=낙상, COOLDOWN=냉각중.
- Presence: PRESENT=재실, ABSENT=퇴실.
- Service types: HOME (가정) vs FACILITY (시설); FACILITY roles: ROOT(시설 등록자)/MEMBER(초대코드로 참여).

## Conventions
- Path alias `@/*` → `src/*` (see [tsconfig.json](tsconfig.json)).
- Prettier: 100 col width, double quotes off (`singleQuote: false`), trailing commas everywhere — run `bun run format` rather than hand-wrapping.
- ESLint: `@typescript-eslint/no-unused-vars` is off and `noUnusedLocals`/`noUnusedParameters` are off in `tsconfig.json` — don't add these back speculatively. Importing the Next.js `server-only` package is blocked by lint; use a `*.server.ts` filename or `@tanstack/react-start/server-only` instead.
- `bunfig.toml` enforces a 24h supply-chain guard on new package versions (`minimumReleaseAge`); only a short allowlist of `@lovable.dev/*` packages bypasses it. Adding to that exclusion list needs explicit user confirmation.

## Lovable sync
This branch is connected to Lovable and pushes sync back into the Lovable editor. Avoid force-pushing or rewriting/rebasing/amending already-pushed commits — it rewrites history on Lovable's side and can lose the user's project history there. Keep the connected branch in a working (buildable) state.
