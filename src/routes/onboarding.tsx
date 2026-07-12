import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useCurrentUser, useCurrentFacility, completeOnboarding, upsertDevice, useStore, startDeviceReset, type Device } from "@/lib/mock-store";
import { toast } from "sonner";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "초기 설정 · CSI-Guard" }] }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const user = useCurrentUser();
  const facility = useCurrentFacility();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [deviceName, setDeviceName] = useState("");
  const [room, setRoom] = useState("");
  const [mqttTopic, setMqttTopic] = useState("");
  const [createdDeviceId, setCreatedDeviceId] = useState<string | null>(null);

  const isFacility = user?.service === "FACILITY";
  const isMember = user?.role === "MEMBER";

  useEffect(() => {
    if (!user) return;
    if (isFacility) {
      setDeviceName(`${room || "302"}호 장치`);
      setMqttTopic(`csi/${facility?.code?.toLowerCase() ?? "fac"}/${room || "302"}`);
    } else {
      const space = room || "거실";
      if (!room) setRoom("거실");
      setDeviceName(`${space} 장치`);
      const slugMap: Record<string, string> = { "거실": "livingroom", "침실": "bedroom", "안방": "masterbed", "주방": "kitchen", "화장실": "bathroom", "현관": "entrance", "복도": "hallway", "기타": "misc" };
      setMqttTopic(`csi/home/${user.id.slice(-4)}/${slugMap[space] ?? "misc"}`);
    }
  }, [user, facility, room, isFacility]);

  if (!user) return null;

  const finish = () => {
    completeOnboarding();
    toast.success("초기 설정 완료");
    navigate({ to: "/" });
  };

  const goNext = () => setStep((s) => s + 1);

  const createAndCalibrate = () => {
    const id = `d-${Date.now()}`;
    const dev: Device = {
      id, name: deviceName || "장치", room: room || "-",
      mqttTopic: mqttTopic || `csi/${id}`, mac: randMac(), fw: "v1.4.2",
      online: true, lastSeen: Date.now(),
      base_rssi: -60, current_rssi: -60, agc: 25, noise_floor: -92,
      calibrating: false, calibrationStage: "IDLE", calibrationProgress: 0,
      connection: "MQTT",
      facilityId: isFacility ? facility?.id : undefined,
      ownerUserId: !isFacility ? user.id : undefined,
    };
    upsertDevice(dev);
    setCreatedDeviceId(id);
    startDeviceReset(id);
    setStep(3);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-2xl bg-surface border border-border rounded-lg overflow-hidden">
        <div className="p-5 border-b border-border">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted">Initial Setup · Step {step} / 4</div>
          <h1 className="text-xl font-bold mt-1">CSI-Guard 초기 설정</h1>
        </div>

        <div className="p-6 min-h-[300px]">
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold">서비스 안내</h2>
              <div className="border border-border rounded p-4 space-y-2 text-sm">
                {isFacility ? (
                  <>
                    <p><span className="font-mono text-primary">FACILITY</span> 서비스는 다수의 ESP32 장치를 MQTT로 연동하여 요양원 전체 호실을 통합 관제합니다.</p>
                    <p className="text-muted">시설: <span className="font-mono text-foreground">{facility?.name} ({facility?.code})</span></p>
                    <p className="text-muted">권한: <span className="font-mono text-foreground">{user.role}</span> {isMember && "— 기존 등록된 장치를 사용합니다."}</p>
                  </>
                ) : (
                  <>
                    <p><span className="font-mono text-primary">HOME</span> 서비스는 가정 내 1개의 ESP32 장치로 낙상을 감지하고 가족에게 알림을 보냅니다.</p>
                    <p className="text-muted">권장 설치 위치: 거실 또는 침실 벽면 (지상 1.5m ± 0.3m)</p>
                  </>
                )}
              </div>
              <div className="border-l-2 border-warning pl-3 py-2 bg-warning/5 text-xs">
                다음 단계에서 <b>장치를 등록</b>하고, <b>10초 대기 → 10초 캘리브레이션</b>을 통해 baseline RSSI/noise floor를 수집합니다.
              </div>
              <div className="flex justify-end">
                {isMember ? (
                  <button onClick={finish} className="px-5 py-2 bg-primary text-primary-foreground rounded text-xs font-mono uppercase font-bold">시작하기 (장치는 관리자가 등록)</button>
                ) : (
                  <button onClick={goNext} className="px-5 py-2 bg-primary text-primary-foreground rounded text-xs font-mono uppercase font-bold">다음</button>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold">장치 등록 · MQTT</h2>
              <div className="grid grid-cols-2 gap-3">
                <F label="장치 이름"><input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} className={inputCls} /></F>
                <F label={isFacility ? "호실 번호" : "설치 공간"}>
                  {isFacility ? (
                    <input value={room} onChange={(e) => setRoom(e.target.value)} className={inputCls} />
                  ) : (
                    <select value={room} onChange={(e) => setRoom(e.target.value)} className={inputCls}>
                      {["거실", "침실", "안방", "주방", "화장실", "현관", "복도", "기타"].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </F>
                <div className="col-span-2">
                  <F label="MQTT 토픽"><input value={mqttTopic} onChange={(e) => setMqttTopic(e.target.value)} className={inputCls} /></F>
                </div>
              </div>
              <div className="text-[10px] font-mono text-muted">ESP32 firmware v1.4.2 · 브로커: mqtt://csi-guard.local:1883</div>
              <div className="flex justify-between">
                <button onClick={() => setStep(1)} className="px-4 py-2 border border-border rounded text-xs font-mono uppercase text-muted">이전</button>
                <button onClick={createAndCalibrate} className="px-5 py-2 bg-primary text-primary-foreground rounded text-xs font-mono uppercase font-bold">
                  장치 등록 및 캘리브레이션 시작
                </button>
              </div>
            </div>
          )}

          {step === 3 && createdDeviceId && (
            <CalibrationStep deviceId={createdDeviceId} onDone={() => setStep(4)} />
          )}

          {step === 4 && (
            <div className="space-y-4 text-center py-6">
              <div className="text-4xl">✓</div>
              <h2 className="text-lg font-semibold">설정 완료</h2>
              <p className="text-sm text-muted">이제 실시간 관제를 시작할 수 있습니다.<br />사이드바의 <span className="font-mono text-foreground">▶ Start</span> 버튼을 누르세요.</p>
              <button onClick={finish} className="px-6 py-2.5 bg-primary text-primary-foreground rounded text-xs font-mono uppercase font-bold">대시보드로 이동</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CalibrationStep({ deviceId, onDone }: { deviceId: string; onDone: () => void }) {
  const dev = useStore((s) => s.devices.find((d) => d.id === deviceId));
  useEffect(() => {
    if (dev && !dev.calibrating && dev.calibrationProgress >= 1) {
      const t = setTimeout(onDone, 500);
      return () => clearTimeout(t);
    }
  }, [dev, onDone]);
  if (!dev) return null;

  const isWait = dev.calibrationStage === "WAITING";
  const isMeas = dev.calibrationStage === "MEASURING";
  const secLeft = Math.max(0, Math.ceil((1 - dev.calibrationProgress) * 10));

  return (
    <div className="space-y-6">
      <h2 className="text-sm font-semibold">장치 캘리브레이션</h2>

      <div className={`rounded-lg border-2 p-5 text-center ${isWait ? "border-warning bg-warning/5" : "border-border"}`}>
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted mb-2">Stage 1 · Clear Space</div>
        <div className="text-lg font-semibold mb-2">
          {isWait ? "⚠ 감지 공간에서 벗어나 주세요" : dev.calibrationStage === "IDLE" && dev.calibrationProgress === 0 ? "준비 중…" : "완료 ✓"}
        </div>
        <div className="text-3xl font-mono font-bold text-warning">{isWait ? `${secLeft}s` : "—"}</div>
        {isWait && <div className="mt-3 h-1 bg-background rounded overflow-hidden"><div className="h-full bg-warning transition-all" style={{ width: `${dev.calibrationProgress * 100}%` }} /></div>}
      </div>

      <div className={`rounded-lg border-2 p-5 text-center ${isMeas ? "border-primary bg-primary/5" : "border-border opacity-60"}`}>
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted mb-2">Stage 2 · Baseline Measurement</div>
        <div className="text-lg font-semibold mb-2">
          {isMeas ? "장치 캘리브레이션 중…" : dev.calibrationProgress >= 1 ? "완료 ✓" : "대기"}
        </div>
        <div className="text-3xl font-mono font-bold text-primary">{isMeas ? `${secLeft}s` : "—"}</div>
        {isMeas && <div className="mt-3 h-1 bg-background rounded overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${dev.calibrationProgress * 100}%` }} /></div>}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <Stat label="Base RSSI" value={`${dev.base_rssi} dBm`} />
        <Stat label="Noise Floor" value={`${dev.noise_floor} dBm`} />
        <Stat label="AGC" value={String(dev.agc)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background border border-border rounded p-2">
      <div className="text-[9px] font-mono uppercase text-muted">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}

const inputCls = "w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-muted";
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-[10px] font-mono uppercase text-muted">{label}</label><div className="mt-1">{children}</div></div>;
}

function randMac() {
  const h = () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0").toUpperCase();
  return `${h()}:${h()}:${h()}:${h()}:${h()}:${h()}`;
}
