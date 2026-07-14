import { createFileRoute } from "@tanstack/react-router";
import { Header, SectionTitle } from "./index";
import {
  useStore,
  useTick,
  useCurrentUser,
  startDeviceReset,
  upsertDevice,
  deleteDevice,
  startMonitor,
  stopMonitor,
  setPort,
  setSerialBaud,
  applyCalibrationStatus,
  CALIBRATION_PHASE_SECONDS,
  type Device,
  type CalibrationStage,
} from "@/lib/mock-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  fetchPorts,
  startCalibration,
  startMonitor as startBackendMonitor,
  stopMonitor as stopBackendMonitor,
  useBackendUp,
  useCalibrationStatusPoll,
  useMonitorStatus,
  type DetectedPort,
} from "@/lib/backend";

const STAGE_LABELS: Record<CalibrationStage, string> = {
  IDLE: "대기",
  LEAVING: "공간 비우는 중",
  WAITING_ACK: "장치 응답 대기 중",
  WAITING_AGC: "AGC 보정 중",
  MEASURING: "움직임/재실 baseline 측정 중",
  DONE: "완료",
  ERROR: "오류",
};

// MQTT는 로컬 시리얼 구조 확정 전까지 비활성화 (작업명세 v1.0 참조)
function useDetectedPorts() {
  const [ports, setPorts] = useState<DetectedPort[]>([]);
  const [backendUp, setBackendUp] = useState<boolean | null>(null);
  const refresh = useCallback(async () => {
    try {
      const list = await fetchPorts();
      setPorts(list);
      setBackendUp(true);
    } catch {
      setPorts([]);
      setBackendUp(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { ports, backendUp, refresh };
}

export const Route = createFileRoute("/devices")({
  head: () => ({ meta: [{ title: "장치 설정 · CSI-Guard" }] }),
  component: DevicesPage,
});

const HOME_SPACES = ["거실", "침실", "안방", "주방", "화장실", "현관", "복도", "기타"];

function DevicesPage() {
  useTick();
  const user = useCurrentUser();
  const isFacility = user?.service === "FACILITY";
  const locationLabel = isFacility ? "호실" : "공간";
  const allDevices = useStore((s) => s.devices);
  const devices = isFacility
    ? allDevices.filter((d) => d.facilityId === user.facilityId)
    : allDevices.filter((d) => d.ownerUserId === user?.id);
  const [selectedId, setSelectedId] = useState<string | null>(devices[0]?.id ?? null);
  const [resetConfirm, setResetConfirm] = useState<Device | null>(null);
  const selected = devices.find((d) => d.id === selectedId) ?? devices[0];

  const backendUp = useBackendUp();
  const port = useStore((s) => s.port);
  const baud = useStore((s) => s.serialBaud);
  // 실백엔드는 HOME 계정당 시리얼 연결이 하나뿐이므로, 어떤 장치 행이든
  // HOME + 백엔드 연결 상태면 실캘리브레이션 대상이 된다 — 거주자-장치 매핑
  // 여부와는 무관(매핑은 재실 대상 관리 화면의 별개 책임).
  const isRealDevice = (d?: Device) => !isFacility && backendUp && !!d;

  return (
    <div>
      <Header title={isFacility ? "장치 설정 · ESP32 관리" : "장치 설정 · 가정 내 장치"} />
      <div className="p-6 space-y-4 max-w-7xl">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">
              {isFacility ? "Device Management" : "가정 내 장치 관리"}
            </h1>
            <p className="text-sm text-muted">
              {isFacility
                ? "MQTT 연동 ESP32 장치 상태 · RSSI · AGC · Noise Floor 모니터링 및 재설정"
                : "설치된 공간별 ESP32 장치 상태 및 재설정 · 거실 / 침실 / 화장실 등 위치별 관리"}
            </p>
          </div>
        </div>

        <ConnectionPanel />
        {!isFacility && backendUp && <DiagnosticsPanel />}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[10px] text-muted border-b border-border bg-background/30 font-mono">
                  <th className="p-3 uppercase">이름</th>
                  <th className="p-3 uppercase">{locationLabel}</th>
                  <th className="p-3 uppercase">연결</th>
                  <th className="p-3 uppercase">채널</th>
                  <th className="p-3 uppercase">RSSI</th>
                  <th className="p-3 uppercase">Noise</th>
                  <th className="p-3 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {devices.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    className={`hover:bg-black/5 cursor-pointer ${d.id === selected?.id ? "bg-primary/5" : ""}`}
                  >
                    <td className="p-3 font-medium">{d.name}</td>
                    <td className="p-3 font-mono">{d.room}</td>
                    <td className="p-3">
                      <span
                        className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${d.connection === "MQTT" ? "text-primary border-primary/40" : "text-warning border-warning/40"}`}
                      >
                        {d.connection}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-xs text-muted truncate max-w-[160px]">
                      {d.connection === "MQTT" ? d.mqttTopic : (d.serialPort ?? "-")}
                    </td>
                    <td className="p-3 font-mono text-xs">
                      <span className="text-muted">{d.base_rssi}→</span>
                      <span className="text-foreground"> {d.current_rssi}</span>
                    </td>
                    <td className="p-3 font-mono text-xs">{d.noise_floor}dBm</td>
                    <td className="p-3">
                      {d.calibrating ? (
                        <span className="text-[10px] font-mono uppercase text-warning">
                          ● calibrating
                        </span>
                      ) : (
                        <span
                          className={`text-[10px] font-mono uppercase ${d.online ? "text-success" : "text-muted"}`}
                        >
                          {d.online ? "● online" : "○ offline"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {devices.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted text-xs">
                      등록된 장치가 없습니다. 통신 설정에서 장치를 추가하세요.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="bg-surface border border-border rounded-lg p-4 space-y-4">
              <div>
                <SectionTitle>장치 상세</SectionTitle>
                <div className="text-sm font-semibold">{selected.name}</div>
                <div className="text-[10px] font-mono text-muted">
                  {selected.mac} · FW {selected.fw}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <Info label="Base RSSI" value={`${selected.base_rssi} dBm`} />
                <Info label="Current RSSI" value={`${selected.current_rssi} dBm`} highlight />
                <Info label="AGC" value={String(selected.agc)} />
                <Info label="Noise Floor" value={`${selected.noise_floor} dBm`} />
                <Info label="움직임 임계값" value={selected.presence_mv_threshold.toFixed(2)} />
                <Info label="재실 Baseline" value={selected.wander_baseline.toFixed(2)} />
                <Info label="MQTT Topic" value={selected.mqttTopic} wide />
              </div>

              {selected.calibrating ? (
                <CalibratingPanel device={selected} useReal={isRealDevice(selected)} />
              ) : (
                <button
                  onClick={() => setResetConfirm(selected)}
                  className="w-full py-2.5 bg-warning text-black rounded text-xs font-mono uppercase font-bold hover:brightness-110"
                >
                  장치 재설정 (Recalibrate)
                  {isRealDevice(selected) && (
                    <span className="ml-2 text-[9px] normal-case">실장치 연동</span>
                  )}
                </button>
              )}

              <button
                onClick={() => {
                  if (confirm(`${selected.name} 삭제?`)) {
                    deleteDevice(selected.id);
                    setSelectedId(null);
                    toast("장치 삭제됨");
                  }
                }}
                className="w-full py-1.5 border border-border rounded text-[10px] font-mono uppercase text-muted hover:text-primary"
              >
                Delete Device
              </button>
            </div>
          )}
        </div>

        {resetConfirm && (
          <ResetConfirmModal
            device={resetConfirm}
            useReal={isRealDevice(resetConfirm)}
            onCancel={() => setResetConfirm(null)}
            onConfirm={() => {
              if (isRealDevice(resetConfirm)) {
                startCalibration({ port: port || undefined, baud }).catch((e) =>
                  toast.error(
                    `캘리브레이션 시작 실패: ${e instanceof Error ? e.message : String(e)}`,
                  ),
                );
              } else {
                startDeviceReset(resetConfirm.id);
              }
              setResetConfirm(null);
              toast("재설정 시작");
            }}
          />
        )}
      </div>
    </div>
  );
}

function Info({
  label,
  value,
  highlight,
  wide,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`bg-background border border-border rounded p-2 ${wide ? "col-span-2" : ""}`}>
      <div className="text-[9px] font-mono uppercase text-muted">{label}</div>
      <div className={`font-mono text-xs truncate ${highlight ? "text-primary font-bold" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function CalibratingPanel({ device, useReal }: { device: Device; useReal: boolean }) {
  // 실장치는 이미 진행 중인 캘리브레이션(예: 다른 화면에서 시작된)의 상태도 계속
  // 따라가야 하므로 useReal이면 항상 폴링한다 — 시작 자체는 ResetConfirmModal의
  // onConfirm에서 별도로 트리거한다(이 컴포넌트는 폴링+반영만 담당).
  const status = useCalibrationStatusPoll(useReal);
  useEffect(() => {
    if (!useReal || !status) return;
    applyCalibrationStatus(device, status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useReal, status]);

  const seconds = CALIBRATION_PHASE_SECONDS[device.calibrationStage] || 0;
  const secLeft = Math.max(0, Math.ceil((1 - device.calibrationProgress) * seconds));
  return (
    <div className="border-2 border-primary rounded p-3 text-center">
      <div className="text-[10px] font-mono uppercase text-muted">
        {STAGE_LABELS[device.calibrationStage]}
      </div>
      <div className="text-2xl font-mono font-bold text-primary my-1">{secLeft}s</div>
      <div className="h-1 bg-background rounded overflow-hidden">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${device.calibrationProgress * 100}%` }}
        />
      </div>
      {device.calibrationStage === "ERROR" && status?.error && (
        <div className="mt-2 text-[10px] text-primary">{status.error}</div>
      )}
    </div>
  );
}

function ResetConfirmModal({
  device,
  useReal,
  onCancel,
  onConfirm,
}: {
  device: Device;
  useReal: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6">
      <div className="bg-surface border-2 border-warning rounded-lg max-w-md w-full">
        <div className="p-4 border-b border-border">
          <h3 className="text-sm font-mono uppercase tracking-widest text-warning">
            ⚠ 장치 재설정 확인
          </h3>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <p>
            <span className="font-semibold">{device.name}</span> ({device.room}호) 장치를
            재설정합니다.
            {useReal && (
              <span className="ml-1 text-[10px] font-mono text-success uppercase">실장치 연동</span>
            )}
          </p>
          <div className="border border-warning/40 bg-warning/5 rounded p-3 text-xs space-y-1">
            <div className="font-semibold">진행 절차 (4단계, 총 약 61초):</div>
            <div>
              1. <b>30초간</b> 감지 공간에서 사람이 <b>완전히 벗어나</b> 있어야 합니다.
            </div>
            <div>2. 장치가 명령에 응답할 때까지 대기 (약 0.2초).</div>
            <div>3. 장치의 AGC 보정이 끝날 때까지 대기 (약 1초).</div>
            <div>
              4. 이어서 <b>30초간</b> 움직임 임계값/재실 baseline을 재수집합니다.
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-border rounded text-xs font-mono uppercase text-muted"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-warning text-black rounded text-xs font-mono uppercase font-bold"
          >
            재설정 시작
          </button>
        </div>
      </div>
    </div>
  );
}

function AddDeviceButton({
  connectionType,
  facilityId,
  ownerId,
  isFacility,
  variant = "outline",
}: {
  connectionType: "MQTT" | "SERIAL";
  facilityId?: string;
  ownerId?: string;
  isFacility: boolean;
  variant?: "outline" | "solid";
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [room, setRoom] = useState(isFacility ? "" : "거실");
  const [serialPortInput, setSerialPortInput] = useState("");
  const { ports, backendUp, refresh } = useDetectedPorts();
  const locationLabel = isFacility ? "호실" : "공간";

  // 감지된 포트가 있으면 첫 항목(수신 중 우선)을 기본 선택
  useEffect(() => {
    if (connectionType !== "SERIAL" || !backendUp || ports.length === 0) return;
    if (!serialPortInput || !ports.some((p) => p.device === serialPortInput)) {
      const preferred = ports.find((p) => p.active) ?? ports[0];
      setSerialPortInput(preferred.device);
    }
  }, [connectionType, backendUp, ports, serialPortInput]);
  const add = () => {
    if (!name || !room) return;
    if (connectionType === "SERIAL" && !serialPortInput) return;
    const id = `d-${Date.now()}`;
    const useReal = !isFacility && backendUp === true;
    const topicSlug = isFacility ? room : romanize(room);
    const dev: Device = {
      id,
      name,
      room,
      mqttTopic:
        connectionType === "MQTT"
          ? isFacility
            ? `csi/dev/${topicSlug}`
            : `csi/home/${ownerId?.slice(-4) ?? "u"}/${topicSlug}`
          : `serial://${serialPortInput}`,
      mac: `AA:BB:CC:${Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, "0")}:${Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, "0")}:${Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, "0")}`.toUpperCase(),
      fw: "v1.4.2",
      online: true,
      lastSeen: Date.now(),
      base_rssi: -60,
      current_rssi: -60,
      agc: 25,
      noise_floor: -92,
      // CalibratingPanel은 calibrating이 true여야 렌더되어 실백엔드 폴링을
      // 시작한다 — mock 경로는 startDeviceReset이 곧바로 덮어쓰지만, 실백엔드
      // 경로는 이 값이 아니면 캘리브레이션이 조용히(화면 갱신 없이) 진행된다.
      calibrating: true,
      calibrationStage: useReal ? "LEAVING" : "IDLE",
      calibrationProgress: 0,
      presence_mv_threshold: 1.8,
      wander_baseline: 0.5,
      connection: connectionType,
      serialPort: connectionType === "SERIAL" ? serialPortInput : undefined,
      facilityId,
      ownerUserId: ownerId,
    };
    upsertDevice(dev);
    // 장치 추가 시 자동으로 캘리브레이션 시작 (4단계, 총 약 61초) — HOME +
    // 실백엔드 연결 시엔 실캘리브레이션 API를, 그 외엔 mock 타이머를 사용한다.
    if (useReal) {
      startCalibration({ port: serialPortInput || undefined, baud: 921600 }).catch((e) =>
        toast.error(`캘리브레이션 시작 실패: ${e instanceof Error ? e.message : String(e)}`),
      );
    } else {
      startDeviceReset(id);
    }
    toast.success(
      `${name} 추가됨 · 캘리브레이션 시작 (공간 비우기 → 응답 대기 → AGC 보정 → baseline 측정)`,
    );
    setOpen(false);
    setName("");
    setRoom(isFacility ? "" : "거실");
  };

  const btnClass =
    variant === "solid"
      ? `px-3 py-1.5 rounded text-[10px] font-mono uppercase font-bold ${connectionType === "MQTT" ? "bg-primary text-primary-foreground" : "bg-warning text-black"} hover:brightness-110`
      : "px-3 py-1.5 border border-border rounded text-[10px] font-mono uppercase text-muted hover:text-foreground";

  return (
    <>
      <button onClick={() => setOpen(true)} className={btnClass}>
        + {connectionType} 장치 추가
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6">
          <div className="bg-surface border border-border rounded-lg max-w-sm w-full p-5 space-y-3">
            <h3 className="text-sm font-semibold">
              {connectionType} 장치 추가
              <span
                className={`ml-2 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${connectionType === "MQTT" ? "text-primary border-primary/40" : "text-warning border-warning/40"}`}
              >
                {connectionType}
              </span>
            </h3>
            <p className="text-[11px] text-muted">
              추가 즉시 <b>4단계 캘리브레이션</b>(공간 비우기 → 응답 대기 → AGC 보정 → baseline
              측정, 총 약 61초)이 진행됩니다.
            </p>
            <div>
              <label className="text-[10px] font-mono uppercase text-muted">장치 이름</label>
              <input
                placeholder={isFacility ? "예: 302호 장치" : "예: 거실 장치"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full mt-1 bg-background border border-border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-muted">{locationLabel}</label>
              {isFacility ? (
                <input
                  placeholder="예: 302"
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  className="w-full mt-1 bg-background border border-border rounded px-3 py-2 text-sm"
                />
              ) : (
                <select
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  className="w-full mt-1 bg-background border border-border rounded px-3 py-2 text-sm"
                >
                  {HOME_SPACES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {connectionType === "SERIAL" && (
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-mono uppercase text-muted">Serial Port</label>
                  <button
                    onClick={refresh}
                    className="text-[9px] font-mono uppercase text-muted hover:text-foreground"
                  >
                    ↻ 재탐지
                  </button>
                </div>
                {backendUp ? (
                  <select
                    value={serialPortInput}
                    onChange={(e) => setSerialPortInput(e.target.value)}
                    className="w-full mt-1 bg-background border border-border rounded px-3 py-2 text-sm font-mono"
                  >
                    {ports.length === 0 && (
                      <option value="">감지된 포트 없음 · 수신기 USB 연결 확인</option>
                    )}
                    {ports.map((p) => (
                      <option key={p.device} value={p.device}>
                        {p.device}
                        {p.active ? " (수신 중)" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <input
                      placeholder="/dev/cu.usbmodemXXXX"
                      value={serialPortInput}
                      onChange={(e) => setSerialPortInput(e.target.value)}
                      className="w-full mt-1 bg-background border border-border rounded px-3 py-2 text-sm font-mono"
                    />
                    <p className="mt-1 text-[9px] text-warning font-mono">
                      로컬 백엔드 미실행 · 수동 입력 모드
                    </p>
                  </>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 border border-border rounded text-xs font-mono uppercase text-muted"
              >
                취소
              </button>
              <button
                onClick={add}
                className="px-4 py-2 bg-primary text-primary-foreground rounded text-xs font-mono uppercase font-bold"
              >
                추가 & 캘리브레이션
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function romanize(korean: string): string {
  const map: Record<string, string> = {
    거실: "livingroom",
    침실: "bedroom",
    안방: "masterbed",
    주방: "kitchen",
    화장실: "bathroom",
    현관: "entrance",
    복도: "hallway",
    기타: "misc",
  };
  return map[korean] ?? "misc";
}

// tick_count 같은 누적 카운터가 일정 시간(2초) 동안 값이 바뀌지 않으면 "루프가
// 멎었다"고 판단한다 — presence_loop는 0.25초마다 tick하므로 2초면 8회는
// 늘어나야 정상이다.
function useStalledCounter(value: number | undefined, enabled: boolean | undefined): boolean {
  const prevRef = useRef<{ value: number; at: number } | null>(null);
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!enabled || value == null) {
      setStalled(false);
      prevRef.current = null;
      return;
    }
    const prev = prevRef.current;
    if (prev && prev.value === value) {
      if (Date.now() - prev.at > 2000) setStalled(true);
    } else {
      prevRef.current = { value, at: Date.now() };
      setStalled(false);
    }
  }, [value, enabled]);
  return stalled;
}

// 연결/캘리브레이션/스트림 여부를 한 화면에서 확인하기 위한 진단 패널. 백엔드가
// 이미 계산해 두는 /monitor/status 값을 그대로 보여줄 뿐 — 백엔드 로직은 건드리지
// 않는다. HOME + 로컬 백엔드 연결 시에만 표시(FACILITY는 실백엔드가 없음).
function DiagnosticsPanel() {
  const status = useMonitorStatus(1000);
  const presenceStalled = useStalledCounter(status?.presence.tick_count, status?.presence.enabled);

  if (!status) {
    return (
      <div className="bg-surface border border-border rounded-lg p-5">
        <SectionTitle>진단 · Diagnostics</SectionTitle>
        <p className="text-xs text-muted">백엔드 응답 대기 중…</p>
      </div>
    );
  }

  const { serial, buffer, presence, detect, notify } = status;
  const streaming = buffer.hz_1s > 0;
  const macTotal = (serial?.frames_ok ?? 0) + (serial?.mac_filtered ?? 0);
  const macRatio = macTotal > 0 ? (serial?.mac_filtered ?? 0) / macTotal : 0;

  return (
    <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <SectionTitle>진단 · Diagnostics (연결 / 캘리브레이션 / 스트림)</SectionTitle>
        <span
          className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${
            streaming
              ? "text-success border-success/30 bg-success/10"
              : "text-primary border-primary/30 bg-primary/10"
          }`}
        >
          {streaming ? `● 스트림 수신 중 · ${buffer.hz_1s}Hz` : "○ 프레임 없음 · 스트림 정지"}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DiagGroup title="시리얼">
          <DiagRow
            label="연결"
            value={serial?.connected ? `● ${serial.port ?? "-"}` : "○ 미연결"}
            tone={serial?.connected ? "success" : "danger"}
          />
          <DiagRow label="Baud" value={String(serial?.baud ?? "-")} />
          <DiagRow label="재연결 횟수" value={String(serial?.reconnects ?? 0)} />
          <DiagRow label="파싱 성공 프레임" value={String(serial?.frames_ok ?? 0)} />
          <DiagRow
            label="체크섬 오류"
            value={String(serial?.checksum_errors ?? 0)}
            tone={(serial?.checksum_errors ?? 0) > 0 ? "warn" : undefined}
          />
          <DiagRow
            label="재동기화"
            value={String(serial?.resyncs ?? 0)}
            tone={(serial?.resyncs ?? 0) > 0 ? "warn" : undefined}
          />
          <DiagRow
            label="MAC 필터링됨"
            value={String(serial?.mac_filtered ?? 0)}
            tone={macRatio > 0.5 ? "danger" : macRatio > 0 ? "warn" : undefined}
            hint={
              macRatio > 0.5
                ? "프레임 대부분이 MAC 필터에 걸리고 있습니다 — 송신기 MAC이 예상(1a:00:00:00:00:00)과 다를 수 있습니다"
                : undefined
            }
          />
        </DiagGroup>

        <DiagGroup title="버퍼 · 스트림 수신">
          <DiagRow
            label="현재 Hz (1초)"
            value={String(buffer.hz_1s)}
            tone={streaming ? "success" : "danger"}
            hint={!streaming ? "0이면 지금 프레임이 전혀 들어오지 않고 있다는 뜻입니다" : undefined}
          />
          <DiagRow label="평균 Hz (5초)" value={String(buffer.hz_5s)} />
          <DiagRow label="버퍼 길이" value={`${buffer.buffered_seconds}s`} />
          <DiagRow label="누적 프레임" value={String(buffer.total_frames)} />
        </DiagGroup>

        <DiagGroup title="재실 루프 · 움직임/Wander (DL 모델과 무관)">
          <DiagRow
            label="상태"
            value={presence.enabled ? "● 동작 중" : "○ 비활성"}
            tone={presence.enabled ? "success" : "danger"}
          />
          <DiagRow
            label="tick 횟수"
            value={String(presence.tick_count ?? 0)}
            tone={presenceStalled ? "danger" : undefined}
            hint={
              presenceStalled ? "값이 멈춰 있습니다 — 재실 루프가 멎었을 수 있습니다" : undefined
            }
          />
          <DiagRow label="skip 횟수" value={String(presence.skip_count ?? 0)} />
          {presence.last_error && (
            <DiagRow label="마지막 오류" value={presence.last_error} tone="danger" />
          )}
        </DiagGroup>

        <DiagGroup title="낙상 모델 (DL)">
          <DiagRow
            label="상태"
            value={detect.enabled ? "● 가동 중" : "○ 비활성"}
            tone={detect.enabled ? "success" : "warn"}
          />
          {!detect.enabled && detect.reason && (
            <DiagRow label="비활성 사유" value={detect.reason} />
          )}
          {detect.enabled && (
            <>
              <DiagRow label="추론 횟수" value={String(detect.inference_count ?? 0)} />
              <DiagRow label="skip 횟수" value={String(detect.skip_count ?? 0)} />
              {detect.last_error && (
                <DiagRow label="마지막 오류" value={detect.last_error} tone="danger" />
              )}
            </>
          )}
        </DiagGroup>
      </div>

      <div className="text-[10px] font-mono text-muted">
        알림(ntfy):{" "}
        {notify.enabled
          ? `활성 · 수신자 ${notify.count}명`
          : `비활성${notify.reason ? ` · ${notify.reason}` : ""}`}
      </div>
    </div>
  );
}

function DiagGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded p-3 space-y-1.5">
      <div className="text-[10px] font-mono uppercase text-muted tracking-wider mb-1">{title}</div>
      {children}
    </div>
  );
}

function DiagRow({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "success" | "warn" | "danger";
  hint?: string;
}) {
  const cls =
    tone === "success"
      ? "text-success"
      : tone === "warn"
        ? "text-warning"
        : tone === "danger"
          ? "text-primary"
          : "text-foreground";
  return (
    <div>
      <div className="flex justify-between font-mono text-xs">
        <span className="text-muted">{label}</span>
        <span className={cls}>{value}</span>
      </div>
      {hint && (
        <div className="text-[9px] text-primary/80 font-mono mt-0.5 leading-relaxed">{hint}</div>
      )}
    </div>
  );
}

function ConnectionPanel() {
  const running = useStore((s) => s.running);
  const port = useStore((s) => s.port);
  const broker = useStore((s) => s.mqttBroker);
  const baud = useStore((s) => s.serialBaud);
  const backendConnected = useStore((s) => s.backendConnected);
  const [busy, setBusy] = useState(false);
  const user = useCurrentUser();
  const isFacility = user?.service === "FACILITY";
  const { ports, backendUp, refresh } = useDetectedPorts();
  // HOME + 로컬 백엔드 연결 시: 파이프라인은 backend/main.py 프로세스가 독립적으로
  // 돌리지만, 어떤 포트에 연결할지는 이 화면에서 실제로 제어한다(아래 연결/해제
  // 버튼) — backendConnected는 BackendDetectionBridge가 공유 /ws/live 소켓으로
  // 이미 실시간으로 갱신해 두는 값이라 별도 폴링 없이 그대로 읽는다.
  const isRealHome = !isFacility && backendUp === true;
  const connectionBusy = isRealHome ? backendConnected || busy : running;

  const handleRealToggle = async () => {
    setBusy(true);
    try {
      if (backendConnected) {
        await stopBackendMonitor();
        toast.success("실장치 연결 해제됨");
      } else {
        await startBackendMonitor({ port: port || undefined, baud });
        toast.success("연결 요청 완료 · 아래 진단 패널에서 상태를 확인하세요");
      }
    } catch (e) {
      toast.error(`연결 제어 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // 백엔드가 탐지한 포트 목록이 오면, 현재 설정된 포트가 목록에 없을 때 자동 보정
  // (연결 중/진행 중일 때는 선택을 덮어쓰지 않도록 connectionBusy로 가드)
  useEffect(() => {
    if (!backendUp || ports.length === 0 || connectionBusy) return;
    if (!ports.some((p) => p.device === port)) {
      const preferred = ports.find((p) => p.active) ?? ports[0];
      setPort(preferred.device);
    }
  }, [backendUp, ports, port, connectionBusy]);

  return (
    <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <SectionTitle>통신 설정 · Connection</SectionTitle>
          <p className="text-xs text-muted">
            {isRealHome
              ? "포트/Baud를 선택한 뒤 연결 버튼으로 backend/main.py의 시리얼 연결을 직접 제어합니다. 연결 중에는 포트/Baud를 변경할 수 없습니다."
              : "ESP32 수신기 시리얼 포트를 설정하고 파이프라인을 제어합니다. MQTT는 비활성화 상태입니다."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isRealHome ? (
            <>
              <span
                className={`text-[10px] font-mono uppercase ${backendConnected ? "text-success" : "text-muted"}`}
              >
                {backendConnected ? "● Connected" : "○ Disconnected"}
              </span>
              <button
                onClick={() => void handleRealToggle()}
                disabled={busy}
                className={`px-4 py-2 rounded font-mono text-xs font-bold uppercase tracking-widest ${
                  backendConnected ? "bg-primary text-primary-foreground" : "bg-success text-white"
                } hover:brightness-110 disabled:opacity-50`}
              >
                {busy ? "…" : backendConnected ? "■ Disconnect" : "▶ Connect"}
              </button>
            </>
          ) : (
            <>
              <span
                className={`text-[10px] font-mono uppercase ${running ? "text-success" : "text-muted"}`}
              >
                {running ? "● Pipeline Running" : "○ Idle"}
              </span>
              <button
                onClick={() => (running ? stopMonitor() : startMonitor())}
                className={`px-4 py-2 rounded font-mono text-xs font-bold uppercase tracking-widest ${
                  running ? "bg-primary text-primary-foreground" : "bg-success text-white"
                } hover:brightness-110`}
              >
                {running ? "■ Stop" : "▶ Start"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* MQTT (비활성화) */}
        <div className="border border-border rounded p-4 space-y-3 bg-background/50 opacity-50 select-none">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted">
              ▣ MQTT 통신
            </div>
            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border text-muted border-border">
              비활성화
            </span>
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase text-muted">Broker URL</label>
            <input
              value={broker}
              disabled
              readOnly
              placeholder="mqtt://host:1883"
              className="w-full mt-1 bg-surface border border-border rounded px-3 py-2 text-xs font-mono disabled:opacity-50"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
            <InfoRow label="QoS" value="1" />
            <InfoRow label="Keep-Alive" value="60s" />
            <InfoRow label="Client ID" value="csi-guard" />
            <InfoRow label="TLS" value="off" />
          </div>
          <div className="pt-2 border-t border-border/60">
            <button
              disabled
              className="px-3 py-1.5 rounded text-[10px] font-mono uppercase font-bold bg-border text-muted cursor-not-allowed"
            >
              + MQTT 장치 추가 (비활성화)
            </button>
          </div>
        </div>

        {/* Serial */}
        <div className="border border-border rounded p-4 space-y-3 bg-background/50">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-mono uppercase tracking-wider text-warning">
              ▣ Serial Port 통신
            </div>
            <span className="text-[9px] font-mono text-muted">ESP32 수신기 USB 직접 연결</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-mono uppercase text-muted">Port</label>
                <button
                  onClick={refresh}
                  disabled={connectionBusy}
                  className="text-[9px] font-mono uppercase text-muted hover:text-foreground disabled:opacity-50"
                >
                  ↻ 재탐지
                </button>
              </div>
              {backendUp ? (
                <select
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  disabled={connectionBusy || ports.length === 0}
                  className="w-full mt-1 bg-surface border border-border rounded px-3 py-2 text-xs font-mono disabled:opacity-50"
                >
                  {ports.length === 0 && <option value="">감지된 포트 없음</option>}
                  {ports.map((p) => (
                    <option key={p.device} value={p.device}>
                      {p.device}
                      {p.active ? " (수신 중)" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  disabled={connectionBusy}
                  placeholder="/dev/cu.usbmodemXXXX"
                  className="w-full mt-1 bg-surface border border-border rounded px-3 py-2 text-xs font-mono disabled:opacity-50"
                />
              )}
              {backendUp === false && (
                <p className="mt-1 text-[9px] text-warning font-mono">
                  로컬 백엔드 미실행 · 수동 입력 모드 (backend/main.py 실행 시 자동 탐지)
                </p>
              )}
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-muted">Baud Rate</label>
              <select
                value={baud}
                onChange={(e) => setSerialBaud(Number(e.target.value))}
                disabled={connectionBusy}
                className="w-full mt-1 bg-surface border border-border rounded px-3 py-2 text-xs font-mono disabled:opacity-50"
              >
                {[115200, 230400, 460800, 921600, 1500000].map((b) => (
                  <option key={b} value={b}>
                    {b.toLocaleString()}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
            <InfoRow label="Data Bits" value="8" />
            <InfoRow label="Stop Bits" value="1" />
            <InfoRow label="Parity" value="none" />
            <InfoRow label="Flow" value="none" />
          </div>
          <div className="pt-2 border-t border-border/60">
            <AddDeviceButton
              connectionType="SERIAL"
              facilityId={user?.facilityId}
              ownerId={user?.id}
              isFacility={isFacility}
              variant="solid"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border border-border rounded px-2 py-1 bg-surface">
      <span className="text-muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}
