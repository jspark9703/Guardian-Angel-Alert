import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  useCurrentUser,
  useCurrentFacility,
  completeOnboarding,
  upsertDevice,
  useStore,
  startDeviceReset,
  applyCalibrationStatus,
  CALIBRATION_STAGE_ORDER,
  CALIBRATION_PHASE_SECONDS,
  type Device,
  type CalibrationStage,
} from "@/lib/mock-store";
import { useBackendUp, useBackendCalibration } from "@/lib/backend";
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
  const backendUp = useBackendUp();
  // HOME + 로컬 백엔드가 떠 있으면 mock 타이머 대신 실제 캘리브레이션 API를 쓴다.
  const useRealCalibration = !isFacility && backendUp;

  useEffect(() => {
    if (!user) return;
    if (isFacility) {
      setDeviceName(`${room || "302"}호 장치`);
      setMqttTopic(`csi/${facility?.code?.toLowerCase() ?? "fac"}/${room || "302"}`);
    } else {
      const space = room || "거실";
      if (!room) setRoom("거실");
      setDeviceName(`${space} 장치`);
      const slugMap: Record<string, string> = {
        거실: "livingroom",
        침실: "bedroom",
        안방: "masterbed",
        주방: "kitchen",
        화장실: "bathroom",
        현관: "entrance",
        복도: "hallway",
        기타: "misc",
      };
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
      id,
      name: deviceName || "장치",
      room: room || "-",
      mqttTopic: mqttTopic || `csi/${id}`,
      mac: randMac(),
      fw: "v1.4.2",
      online: true,
      lastSeen: Date.now(),
      base_rssi: -60,
      current_rssi: -60,
      agc: 25,
      noise_floor: -92,
      calibrating: !useRealCalibration,
      calibrationStage: "IDLE",
      calibrationProgress: 0,
      presence_mv_threshold: 1.8,
      wander_baseline: 0.5,
      connection: "MQTT",
      facilityId: isFacility ? facility?.id : undefined,
      ownerUserId: !isFacility ? user.id : undefined,
    };
    upsertDevice(dev);
    setCreatedDeviceId(id);
    // 실백엔드 연동 시엔 CalibrationStep의 useBackendCalibration이 진행상황을 채운다
    if (!useRealCalibration) startDeviceReset(id);
    setStep(3);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-2xl bg-surface border border-border rounded-lg overflow-hidden">
        <div className="p-5 border-b border-border">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted">
            Initial Setup · Step {step} / 4
          </div>
          <h1 className="text-xl font-bold mt-1">CSI-Guard 초기 설정</h1>
        </div>

        <div className="p-6 min-h-[300px]">
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold">서비스 안내</h2>
              <div className="border border-border rounded p-4 space-y-2 text-sm">
                {isFacility ? (
                  <>
                    <p>
                      <span className="font-mono text-primary">FACILITY</span> 서비스는 다수의 ESP32
                      장치를 MQTT로 연동하여 요양원 전체 호실을 통합 관제합니다.
                    </p>
                    <p className="text-muted">
                      시설:{" "}
                      <span className="font-mono text-foreground">
                        {facility?.name} ({facility?.code})
                      </span>
                    </p>
                    <p className="text-muted">
                      권한: <span className="font-mono text-foreground">{user.role}</span>{" "}
                      {isMember && "— 기존 등록된 장치를 사용합니다."}
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      <span className="font-mono text-primary">HOME</span> 서비스는 가정 내 1개의
                      ESP32 장치로 낙상을 감지하고 가족에게 알림을 보냅니다.
                    </p>
                    <p className="text-muted">
                      권장 설치 위치: 거실 또는 침실 벽면 (지상 1.5m ± 0.3m)
                    </p>
                  </>
                )}
              </div>
              <div className="border-l-2 border-warning pl-3 py-2 bg-warning/5 text-xs">
                다음 단계에서 <b>장치를 등록</b>하고,{" "}
                <b>
                  4단계 캘리브레이션(공간 비우기 → 장치 응답 대기 → AGC 보정 → 움직임/재실 baseline
                  측정, 총 약 31초)
                </b>
                을 통해 움직임 임계값과 재실 baseline을 수집합니다.
              </div>
              <div className="flex justify-end">
                {isMember ? (
                  <button
                    onClick={finish}
                    className="px-5 py-2 bg-primary text-primary-foreground rounded text-xs font-mono uppercase font-bold"
                  >
                    시작하기 (장치는 관리자가 등록)
                  </button>
                ) : (
                  <button
                    onClick={goNext}
                    className="px-5 py-2 bg-primary text-primary-foreground rounded text-xs font-mono uppercase font-bold"
                  >
                    다음
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold">장치 등록 · MQTT</h2>
              <div className="grid grid-cols-2 gap-3">
                <F label="장치 이름">
                  <input
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    className={inputCls}
                  />
                </F>
                <F label={isFacility ? "호실 번호" : "설치 공간"}>
                  {isFacility ? (
                    <input
                      value={room}
                      onChange={(e) => setRoom(e.target.value)}
                      className={inputCls}
                    />
                  ) : (
                    <select
                      value={room}
                      onChange={(e) => setRoom(e.target.value)}
                      className={inputCls}
                    >
                      {["거실", "침실", "안방", "주방", "화장실", "현관", "복도", "기타"].map(
                        (s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ),
                      )}
                    </select>
                  )}
                </F>
                <div className="col-span-2">
                  <F label="MQTT 토픽">
                    <input
                      value={mqttTopic}
                      onChange={(e) => setMqttTopic(e.target.value)}
                      className={inputCls}
                    />
                  </F>
                </div>
              </div>
              <div className="text-[10px] font-mono text-muted">
                ESP32 firmware v1.4.2 · 브로커: mqtt://csi-guard.local:1883
              </div>
              <div className="flex justify-between">
                <button
                  onClick={() => setStep(1)}
                  className="px-4 py-2 border border-border rounded text-xs font-mono uppercase text-muted"
                >
                  이전
                </button>
                <button
                  onClick={createAndCalibrate}
                  className="px-5 py-2 bg-primary text-primary-foreground rounded text-xs font-mono uppercase font-bold"
                >
                  장치 등록 및 캘리브레이션 시작
                </button>
              </div>
            </div>
          )}

          {step === 3 && createdDeviceId && (
            <CalibrationStep
              deviceId={createdDeviceId}
              useReal={useRealCalibration}
              onDone={() => setStep(4)}
            />
          )}

          {step === 4 && (
            <div className="space-y-4 text-center py-6">
              <div className="text-4xl">✓</div>
              <h2 className="text-lg font-semibold">설정 완료</h2>
              <p className="text-sm text-muted">
                이제 실시간 관제를 시작할 수 있습니다.
                <br />
                사이드바의 <span className="font-mono text-foreground">▶ Start</span> 버튼을
                누르세요.
              </p>
              <button
                onClick={finish}
                className="px-6 py-2.5 bg-primary text-primary-foreground rounded text-xs font-mono uppercase font-bold"
              >
                대시보드로 이동
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const STAGE_LABELS: Record<CalibrationStage, string> = {
  IDLE: "대기",
  LEAVING: "1 · 공간 비우기",
  WAITING_ACK: "2 · 장치 응답 대기",
  WAITING_AGC: "3 · AGC 보정",
  MEASURING: "4 · 움직임/재실 baseline 측정",
  DONE: "완료",
  ERROR: "오류",
};

function CalibrationStep({
  deviceId,
  useReal,
  onDone,
}: {
  deviceId: string;
  useReal: boolean;
  onDone: () => void;
}) {
  const dev = useStore((s) => s.devices.find((d) => d.id === deviceId));
  const backend = useBackendCalibration(useReal);

  // 실백엔드 폴링 결과를 mock과 동일한 Device 필드로 매핑 — 이후 렌더 로직은
  // mock/실백엔드 구분 없이 항상 dev.calibrationStage 등만 읽으면 된다.
  useEffect(() => {
    if (!useReal || !dev || !backend.status) return;
    applyCalibrationStatus(dev, backend.status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useReal, backend.status]);

  useEffect(() => {
    if (dev && dev.calibrationStage === "DONE" && !dev.calibrating) {
      const t = setTimeout(onDone, 500);
      return () => clearTimeout(t);
    }
  }, [dev, onDone]);

  if (!dev) return null;

  const error = useReal ? (backend.startError ?? backend.status?.error) : null;
  const stageIndex = CALIBRATION_STAGE_ORDER.indexOf(dev.calibrationStage);

  return (
    <div className="space-y-6">
      <h2 className="text-sm font-semibold">
        장치 캘리브레이션
        {useReal && (
          <span className="ml-2 text-[10px] font-mono text-success uppercase">실장치 연동</span>
        )}
      </h2>
      <p className="text-[11px] text-muted font-mono leading-relaxed">
        4단계(공간 비우기 → 장치 응답 대기 → AGC 보정 → 움직임/재실 baseline 측정), 총 약 31초
        소요됩니다.
      </p>

      {error && (
        <div className="border-2 border-primary rounded p-3 text-xs text-primary bg-primary/5">
          캘리브레이션 오류: {error}
        </div>
      )}

      <div className="space-y-3">
        {CALIBRATION_STAGE_ORDER.map((stage, i) => (
          <StageRow
            key={stage}
            stage={stage}
            active={dev.calibrationStage === stage}
            done={dev.calibrationStage === "DONE" || stageIndex > i}
            progress={dev.calibrationStage === stage ? dev.calibrationProgress : 0}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 text-center text-xs">
        <Stat label="움직임 임계값" value={dev.presence_mv_threshold.toFixed(2)} />
        <Stat label="재실 Baseline" value={dev.wander_baseline.toFixed(2)} />
      </div>
    </div>
  );
}

function StageRow({
  stage,
  active,
  done,
  progress,
}: {
  stage: CalibrationStage;
  active: boolean;
  done: boolean;
  progress: number;
}) {
  const seconds = CALIBRATION_PHASE_SECONDS[stage];
  const secLeft = Math.max(0, Math.ceil((1 - progress) * seconds));
  return (
    <div
      className={`rounded-lg border-2 p-4 flex items-center justify-between ${
        active
          ? "border-warning bg-warning/5"
          : done
            ? "border-success/40 bg-success/5"
            : "border-border opacity-60"
      }`}
    >
      <div className="flex-1">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted mb-1">
          Stage {STAGE_LABELS[stage]}
        </div>
        <div className="text-sm font-semibold">
          {active ? "진행 중…" : done ? "완료 ✓" : "대기"}
        </div>
        {active && (
          <div className="mt-2 h-1 bg-background rounded overflow-hidden">
            <div
              className="h-full bg-warning transition-all"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}
      </div>
      {active && <div className="text-2xl font-mono font-bold text-warning ml-3">{secLeft}s</div>}
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

const inputCls =
  "w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-muted";
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-mono uppercase text-muted">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function randMac() {
  const h = () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `${h()}:${h()}:${h()}:${h()}:${h()}:${h()}`;
}
