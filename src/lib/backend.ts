// 로컬 백엔드(backend/main.py, 127.0.0.1:8000) API 클라이언트.
// 대시보드와 같은 맥에서 돌아가는 FastAPI 서버로, 수신기 시리얼 스트림을 중계한다.

import { useEffect, useRef, useState } from "react";

export const BACKEND_URL = "http://127.0.0.1:8000";

export interface DetectedPort {
  device: string;
  description: string | null;
  serial_number: string | null;
  active: boolean;
}

export async function fetchPorts(): Promise<DetectedPort[]> {
  const res = await fetch(`${BACKEND_URL}/ports`, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`ports ${res.status}`);
  const data = (await res.json()) as { ports: DetectedPort[] };
  return data.ports;
}

// 로컬 백엔드 프로세스 자체가 떠 있는지(수신기 연결 여부와 무관) — 온보딩/장치 재설정
// 화면이 mock 타이머 대신 실제 캘리브레이션 API를 쓸지 결정하는 데 쓰인다.
export function useBackendUp(): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchPorts()
      .then(() => {
        if (!cancelled) setUp(true);
      })
      .catch(() => {
        if (!cancelled) setUp(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return up;
}

// ---- 실시간 스트림 (/ws/live, 10Hz) ----

export type DetectState = "IDLE" | "SUSPECT" | "FALL" | "COOLDOWN";

// 재실(Presence) 상태 — 낙상 DL 모델과 무관한 별도 신호(움직임 MV + Wander)의 결과.
export type PresenceState = "present" | "absent";

export interface LiveSample {
  t: number;
  connected: boolean; // 백엔드-수신기 시리얼 연결 여부
  hz_1s: number;
  rssi: number | null;
  buffered_seconds: number;
  amp_mean: number | null;
  amp_std: number | null; // 최근 0.5초 진폭 표준편차 (움직임 근사 지표)
  // 낙상 판정 (백엔드 모델 가동 시에만 존재)
  detect_state?: DetectState;
  proba_fall?: number | null; // 최근 3초 윈도우 낙상 확률 (0.25초 주기 갱신)
  threshold?: number; // DL 낙상 판정 임계값 (기본 0.468) — 아래 presence_mv_threshold와는 무관한 별개 값
  fall_count?: number; // 백엔드 기동 후 낙상 확정 횟수
  last_fall_time?: number | null;
  // 재실 감지 (낙상 DL 추론과 병렬로 계산되는 움직임(MV)/Wander 신호 — backend/presence 참고)
  presence_state?: PresenceState | null;
  mv_current?: number | null; // 움직임(이동분산) 현재값
  presence_mv_threshold?: number | null; // 캘리브레이션으로 도출된 움직임 임계값
  wander_current?: number | null;
  wander_baseline?: number | null; // 캘리브레이션으로 도출된 재실 baseline
  wander_ratio_threshold?: number | null;
  wander_ratio?: number | null;
  wander_confirmed?: boolean | null;
  last_activity_at?: number | null;
  presence_just_changed?: boolean | null;
}

// ---- 온보딩 캘리브레이션 (/onboarding/calibrate/*) ----
// 4단계: leaving(공간 비우기) -> waiting_ack(장치 응답 대기) -> waiting_agc(AGC 보정)
// -> measuring(baseline 측정), 총 약 31초. 압축하지 않은 실제 소요시간이다.
export type CalibrationPhase =
  | "idle"
  | "leaving"
  | "waiting_ack"
  | "waiting_agc"
  | "measuring"
  | "done"
  | "error";

export interface CalibrationStatus {
  phase: CalibrationPhase;
  elapsed_s: number | null;
  phase_elapsed_s: number | null;
  agc_duration_s: number | null;
  presence_mv_threshold: number | null;
  wander_baseline: number | null;
  error: string | null;
}

export async function startCalibration(): Promise<{ status: string }> {
  const res = await fetch(`${BACKEND_URL}/onboarding/calibrate/start`, {
    method: "POST",
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: `calibrate/start ${res.status}` }));
    throw new Error(body.detail ?? `calibrate/start ${res.status}`);
  }
  return res.json();
}

export async function fetchCalibrationStatus(): Promise<CalibrationStatus> {
  const res = await fetch(`${BACKEND_URL}/onboarding/calibrate/status`, {
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`calibrate/status ${res.status}`);
  return res.json();
}

// active=true인 동안 1초 간격으로 캘리브레이션 상태만 폴링한다(시작은 트리거하지
// 않음) — devices.tsx처럼 "재설정" 버튼 클릭 시점에 별도로 startCalibration()을
// 호출하고, 진행 상황 표시만 계속 따라가야 하는 화면에서 쓴다.
export function useCalibrationStatusPoll(active: boolean): CalibrationStatus | null {
  const [status, setStatus] = useState<CalibrationStatus | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const s = await fetchCalibrationStatus();
        if (!cancelled) setStatus(s);
      } catch {
        // 폴링 실패는 무시 — 다음 tick에 재시도 (일시적 네트워크 hiccup 대비)
      }
    };
    poll();
    const id = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active]);

  return status;
}

export interface BackendCalibrationState {
  status: CalibrationStatus | null;
  startError: string | null;
}

// active=true가 되는 순간 캘리브레이션을 1회 시작하고 useCalibrationStatusPoll로 상태를
// 계속 폴링한다. mock startDeviceReset()과 나란히 쓰이는 실백엔드 경로 — 온보딩
// 위저드처럼 "이 화면에 들어오면 곧바로 캘리브레이션을 시작"하는 1회성 흐름에 쓴다.
export function useBackendCalibration(active: boolean): BackendCalibrationState {
  const [startError, setStartError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!active || startedRef.current) return;
    startedRef.current = true;
    startCalibration().catch((e) => setStartError(e instanceof Error ? e.message : String(e)));
  }, [active]);

  const status = useCalibrationStatusPoll(active);

  return { status, startError };
}

export interface LiveStreamState {
  wsUp: boolean; // 브라우저-백엔드 WebSocket 연결 여부
  last: LiveSample | null;
  history: LiveSample[];
}

export function useLiveStream(maxHistory = 300): LiveStreamState {
  const [state, setState] = useState<LiveStreamState>({ wsUp: false, last: null, history: [] });

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(`${BACKEND_URL.replace(/^http/, "ws")}/ws/live`);
      } catch {
        retry = setTimeout(connect, 2000);
        return;
      }
      ws.onopen = () => setState((s) => ({ ...s, wsUp: true }));
      ws.onmessage = (e) => {
        const sample = JSON.parse(e.data as string) as LiveSample;
        setState((s) => ({
          wsUp: true,
          last: sample,
          history: [...s.history.slice(-(maxHistory - 1)), sample],
        }));
      };
      ws.onclose = () => {
        setState((s) => ({ ...s, wsUp: false }));
        if (!closed) retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [maxHistory]);

  return state;
}
