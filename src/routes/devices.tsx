import { createFileRoute } from "@tanstack/react-router";
import { Header, SectionTitle } from "./index";
import { useStore, useTick, useCurrentUser, startDeviceReset, upsertDevice, deleteDevice, startMonitor, stopMonitor, setPort, setMqttBroker, setSerialBaud, type Device } from "@/lib/mock-store";
import { useState } from "react";
import { toast } from "sonner";


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

  return (
    <div>
      <Header title={isFacility ? "장치 설정 · ESP32 관리" : "장치 설정 · 가정 내 장치"} criticalCount={0} onlineCount={devices.filter((d) => d.online).length} />
      <div className="p-6 space-y-4 max-w-7xl">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">{isFacility ? "Device Management" : "가정 내 장치 관리"}</h1>
            <p className="text-sm text-muted">
              {isFacility
                ? "MQTT 연동 ESP32 장치 상태 · RSSI · AGC · Noise Floor 모니터링 및 재설정"
                : "설치된 공간별 ESP32 장치 상태 및 재설정 · 거실 / 침실 / 화장실 등 위치별 관리"}
            </p>
          </div>
        </div>

        <ConnectionPanel />


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
                  <tr key={d.id} onClick={() => setSelectedId(d.id)}
                    className={`hover:bg-black/5 cursor-pointer ${d.id === selected?.id ? "bg-primary/5" : ""}`}>
                    <td className="p-3 font-medium">{d.name}</td>
                    <td className="p-3 font-mono">{d.room}</td>
                    <td className="p-3">
                      <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${d.connection === "MQTT" ? "text-primary border-primary/40" : "text-warning border-warning/40"}`}>
                        {d.connection}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-xs text-muted truncate max-w-[160px]">
                      {d.connection === "MQTT" ? d.mqttTopic : (d.serialPort ?? "-")}
                    </td>
                    <td className="p-3 font-mono text-xs">
                      <span className="text-muted">{d.base_rssi}→</span><span className="text-foreground"> {d.current_rssi}</span>
                    </td>
                    <td className="p-3 font-mono text-xs">{d.noise_floor}dBm</td>
                    <td className="p-3">
                      {d.calibrating ? (
                        <span className="text-[10px] font-mono uppercase text-warning">● calibrating</span>
                      ) : (
                        <span className={`text-[10px] font-mono uppercase ${d.online ? "text-success" : "text-muted"}`}>
                          {d.online ? "● online" : "○ offline"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {devices.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-muted text-xs">등록된 장치가 없습니다. 통신 설정에서 장치를 추가하세요.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="bg-surface border border-border rounded-lg p-4 space-y-4">
              <div>
                <SectionTitle>장치 상세</SectionTitle>
                <div className="text-sm font-semibold">{selected.name}</div>
                <div className="text-[10px] font-mono text-muted">{selected.mac} · FW {selected.fw}</div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <Info label="Base RSSI" value={`${selected.base_rssi} dBm`} />
                <Info label="Current RSSI" value={`${selected.current_rssi} dBm`} highlight />
                <Info label="AGC" value={String(selected.agc)} />
                <Info label="Noise Floor" value={`${selected.noise_floor} dBm`} />
                <Info label="MQTT Topic" value={selected.mqttTopic} wide />
              </div>

              {selected.calibrating ? (
                <div className="border-2 border-primary rounded p-3 text-center">
                  <div className="text-[10px] font-mono uppercase text-muted">
                    {selected.calibrationStage === "WAITING" ? "공간 비우는 중" : "베이스라인 측정 중"}
                  </div>
                  <div className="text-2xl font-mono font-bold text-primary my-1">
                    {Math.max(0, Math.ceil((1 - selected.calibrationProgress) * 10))}s
                  </div>
                  <div className="h-1 bg-background rounded overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${selected.calibrationProgress * 100}%` }} />
                  </div>
                </div>
              ) : (
                <button onClick={() => setResetConfirm(selected)}
                  className="w-full py-2.5 bg-warning text-black rounded text-xs font-mono uppercase font-bold hover:brightness-110">
                  장치 재설정 (Recalibrate)
                </button>
              )}

              <button onClick={() => { if (confirm(`${selected.name} 삭제?`)) { deleteDevice(selected.id); setSelectedId(null); toast("장치 삭제됨"); } }}
                className="w-full py-1.5 border border-border rounded text-[10px] font-mono uppercase text-muted hover:text-primary">
                Delete Device
              </button>
            </div>
          )}
        </div>




        {resetConfirm && (
          <ResetConfirmModal device={resetConfirm} onCancel={() => setResetConfirm(null)}
            onConfirm={() => { startDeviceReset(resetConfirm.id); setResetConfirm(null); toast("재설정 시작"); }} />
        )}
      </div>
    </div>
  );
}

function Info({ label, value, highlight, wide }: { label: string; value: string; highlight?: boolean; wide?: boolean }) {
  return (
    <div className={`bg-background border border-border rounded p-2 ${wide ? "col-span-2" : ""}`}>
      <div className="text-[9px] font-mono uppercase text-muted">{label}</div>
      <div className={`font-mono text-xs truncate ${highlight ? "text-primary font-bold" : ""}`}>{value}</div>
    </div>
  );
}

function ResetConfirmModal({ device, onCancel, onConfirm }: { device: Device; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6">
      <div className="bg-surface border-2 border-warning rounded-lg max-w-md w-full">
        <div className="p-4 border-b border-border">
          <h3 className="text-sm font-mono uppercase tracking-widest text-warning">⚠ 장치 재설정 확인</h3>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <p><span className="font-semibold">{device.name}</span> ({device.room}호) 장치를 재설정합니다.</p>
          <div className="border border-warning/40 bg-warning/5 rounded p-3 text-xs space-y-1">
            <div className="font-semibold">진행 절차:</div>
            <div>1. <b>10초간</b> 감지 공간에서 사람이 <b>완전히 벗어나</b> 있어야 합니다.</div>
            <div>2. 이어서 <b>10초간</b> baseline RSSI/noise floor를 재수집합니다.</div>
            <div className="text-muted mt-1">총 소요 시간: 약 20초</div>
          </div>
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 border border-border rounded text-xs font-mono uppercase text-muted">취소</button>
          <button onClick={onConfirm} className="px-4 py-2 bg-warning text-black rounded text-xs font-mono uppercase font-bold">재설정 시작</button>
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
  const [serialPortInput, setSerialPortInput] = useState(connectionType === "SERIAL" ? "COM4" : "");
  const locationLabel = isFacility ? "호실" : "공간";
  const add = () => {
    if (!name || !room) return;
    if (connectionType === "SERIAL" && !serialPortInput) return;
    const id = `d-${Date.now()}`;
    const topicSlug = isFacility ? room : romanize(room);
    const dev: Device = {
      id, name, room,
      mqttTopic: connectionType === "MQTT"
        ? (isFacility ? `csi/dev/${topicSlug}` : `csi/home/${ownerId?.slice(-4) ?? "u"}/${topicSlug}`)
        : `serial://${serialPortInput}`,
      mac: `AA:BB:CC:${Math.floor(Math.random() * 256).toString(16).padStart(2, "0")}:${Math.floor(Math.random() * 256).toString(16).padStart(2, "0")}:${Math.floor(Math.random() * 256).toString(16).padStart(2, "0")}`.toUpperCase(),
      fw: "v1.4.2",
      online: true, lastSeen: Date.now(),
      base_rssi: -60, current_rssi: -60, agc: 25, noise_floor: -92,
      calibrating: false, calibrationStage: "IDLE", calibrationProgress: 0,
      connection: connectionType,
      serialPort: connectionType === "SERIAL" ? serialPortInput : undefined,
      facilityId, ownerUserId: ownerId,
    };
    upsertDevice(dev);
    // 장치 추가 시 자동으로 캘리브레이션 시작: 10초 대기 + 10초 최적화
    startDeviceReset(id);
    toast.success(`${name} 추가됨 · 캘리브레이션 시작 (10초 대기 → 10초 측정)`);
    setOpen(false); setName(""); setRoom(isFacility ? "" : "거실");
  };

  const btnClass = variant === "solid"
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
              <span className={`ml-2 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${connectionType === "MQTT" ? "text-primary border-primary/40" : "text-warning border-warning/40"}`}>
                {connectionType}
              </span>
            </h3>
            <p className="text-[11px] text-muted">추가 즉시 <b>10초 대기 → 10초 캘리브레이션</b>이 진행됩니다.</p>
            <div>
              <label className="text-[10px] font-mono uppercase text-muted">장치 이름</label>
              <input placeholder={isFacility ? "예: 302호 장치" : "예: 거실 장치"} value={name} onChange={(e) => setName(e.target.value)}
                className="w-full mt-1 bg-background border border-border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-muted">{locationLabel}</label>
              {isFacility ? (
                <input placeholder="예: 302" value={room} onChange={(e) => setRoom(e.target.value)}
                  className="w-full mt-1 bg-background border border-border rounded px-3 py-2 text-sm" />
              ) : (
                <select value={room} onChange={(e) => setRoom(e.target.value)}
                  className="w-full mt-1 bg-background border border-border rounded px-3 py-2 text-sm">
                  {HOME_SPACES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
            </div>
            {connectionType === "SERIAL" && (
              <div>
                <label className="text-[10px] font-mono uppercase text-muted">Serial Port</label>
                <input placeholder="COM4 / /dev/ttyUSB0" value={serialPortInput} onChange={(e) => setSerialPortInput(e.target.value)}
                  className="w-full mt-1 bg-background border border-border rounded px-3 py-2 text-sm font-mono" />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setOpen(false)} className="px-4 py-2 border border-border rounded text-xs font-mono uppercase text-muted">취소</button>
              <button onClick={add} className="px-4 py-2 bg-primary text-primary-foreground rounded text-xs font-mono uppercase font-bold">추가 & 캘리브레이션</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function romanize(korean: string): string {
  const map: Record<string, string> = { "거실": "livingroom", "침실": "bedroom", "안방": "masterbed", "주방": "kitchen", "화장실": "bathroom", "현관": "entrance", "복도": "hallway", "기타": "misc" };
  return map[korean] ?? "misc";
}

function ConnectionPanel() {
  const running = useStore((s) => s.running);
  const port = useStore((s) => s.port);
  const broker = useStore((s) => s.mqttBroker);
  const baud = useStore((s) => s.serialBaud);
  const user = useCurrentUser();
  const isFacility = user?.service === "FACILITY";

  return (
    <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <SectionTitle>통신 설정 · Connection</SectionTitle>
          <p className="text-xs text-muted">MQTT 브로커 및 ESP32 시리얼 포트를 설정하고 파이프라인을 제어합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono uppercase ${running ? "text-success" : "text-muted"}`}>
            {running ? "● Pipeline Running" : "○ Idle"}
          </span>
          <button
            onClick={() => running ? stopMonitor() : startMonitor()}
            className={`px-4 py-2 rounded font-mono text-xs font-bold uppercase tracking-widest ${
              running ? "bg-primary text-primary-foreground" : "bg-success text-white"
            } hover:brightness-110`}
          >
            {running ? "■ Stop" : "▶ Start"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* MQTT */}
        <div className="border border-border rounded p-4 space-y-3 bg-background/50">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-mono uppercase tracking-wider text-primary">▣ MQTT 통신</div>
            <span className="text-[9px] font-mono text-muted">{isFacility ? "다중 ESP32 브로커 연동" : "가정 내 브로커"}</span>
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase text-muted">Broker URL</label>
            <input value={broker} onChange={(e) => setMqttBroker(e.target.value)} disabled={running}
              placeholder="mqtt://host:1883"
              className="w-full mt-1 bg-surface border border-border rounded px-3 py-2 text-xs font-mono disabled:opacity-50" />
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
            <InfoRow label="QoS" value="1" />
            <InfoRow label="Keep-Alive" value="60s" />
            <InfoRow label="Client ID" value="csi-guard" />
            <InfoRow label="TLS" value="off" />
          </div>
          <div className="pt-2 border-t border-border/60">
            <AddDeviceButton connectionType="MQTT" facilityId={user?.facilityId} ownerId={user?.id} isFacility={isFacility} variant="solid" />
          </div>
        </div>

        {/* Serial */}
        <div className="border border-border rounded p-4 space-y-3 bg-background/50">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-mono uppercase tracking-wider text-warning">▣ Serial Port 통신</div>
            <span className="text-[9px] font-mono text-muted">ESP32 USB 직접 연결</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-mono uppercase text-muted">Port</label>
              <input value={port} onChange={(e) => setPort(e.target.value)} disabled={running}
                placeholder="COM4 / /dev/ttyUSB0"
                className="w-full mt-1 bg-surface border border-border rounded px-3 py-2 text-xs font-mono disabled:opacity-50" />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-muted">Baud Rate</label>
              <select value={baud} onChange={(e) => setSerialBaud(Number(e.target.value))} disabled={running}
                className="w-full mt-1 bg-surface border border-border rounded px-3 py-2 text-xs font-mono disabled:opacity-50">
                {[115200, 230400, 460800, 921600, 1500000].map((b) => <option key={b} value={b}>{b.toLocaleString()}</option>)}
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
            <AddDeviceButton connectionType="SERIAL" facilityId={user?.facilityId} ownerId={user?.id} isFacility={isFacility} variant="solid" />
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border border-border rounded px-2 py-1 bg-surface">
      <span className="text-muted">{label}</span><span>{value}</span>
    </div>
  );
}
