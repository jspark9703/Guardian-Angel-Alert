import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  useStore,
  useTick,
  stateLabel,
  stateColor,
  fmtDateTime,
  setActiveResident,
  setActiveDevice,
  useCurrentUser,
  useHomePrimaryDeviceId,
  simulateFall,
  presenceLabel,
  presenceColor,
  unifiedStatusLabel,
  unifiedStatusColor,
  type StateMachine,
} from "@/lib/mock-store";
import { toast } from "sonner";
import { EventLogPanel } from "@/components/EventLogPanel";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { useLiveStream } from "@/lib/backend";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "실시간 관제 · CSI-Guard" }] }),
  component: MonitoringPage,
});

function MonitoringPage() {
  useTick();
  const user = useCurrentUser();
  const isFacility = user?.service === "FACILITY";
  const running = useStore((s) => s.running);
  const allResidents = useStore((s) => s.residents);
  const residents = isFacility
    ? allResidents.filter((r) => r.facilityId === user?.facilityId)
    : allResidents.filter((r) => r.ownerUserId === user?.id);
  const activeId = useStore((s) => s.activeResidentId);
  const active = residents.find((r) => r.id === activeId) ?? residents[0];
  const activeDevice = useStore((s) => s.devices.find((d) => d.id === active?.deviceId));
  const config = useStore((s) => s.config);
  const mvHistory = useStore((s) => s.mvHistory);
  const allFalls = useStore((s) => s.falls);
  const falls = allFalls.filter((f) => residents.some((r) => r.id === f.residentId));

  const chartData = mvHistory.map((p, i) => ({ i, mv: Number(p.mv.toFixed(3)) }));
  const threshold = active?.thresholdOverride ?? config.mv_threshold;

  // 로컬 백엔드 실시간 스트림 (가정용 화면은 mock 대신 실데이터만 표시)
  const live = useLiveStream();
  const backendUp = live.wsUp;
  const serialUp = live.last?.connected ?? false;
  const liveMode = backendUp && serialUp;
  // 실데이터 차트는 진폭 std 근사치가 아니라 실제 움직임(MV) 신호를 그린다 —
  // presence_loop.py가 DL 모델과 무관하게 항상 계산해 /ws/live로 내려주는 값.
  const liveChartData = live.history.map((p, i) => ({ i, mv: p.mv_current ?? 0 }));
  const liveMvThreshold = live.last?.presence_mv_threshold ?? threshold;

  // 다중 장치 선택(프론트엔드 전용) — 실백엔드는 여전히 장치 1대만 지원하므로,
  // 대표 장치(useHomePrimaryDeviceId)가 아닌 다른 장치를 고르면 "아직 미연결"로
  // 명시 표시한다(가짜 mock 데이터로 위장하지 않음).
  const allDevices = useStore((s) => s.devices);
  const homeDevices = !isFacility ? allDevices.filter((d) => d.ownerUserId === user?.id) : [];
  const activeDeviceId = useStore((s) => s.activeDeviceId);
  const primaryDeviceId = useHomePrimaryDeviceId();
  const selectedDevice =
    homeDevices.find((d) => d.id === activeDeviceId) ??
    homeDevices.find((d) => d.id === primaryDeviceId) ??
    homeDevices[0];
  const selectedResident = residents.find(
    (r) => r.deviceId === selectedDevice?.id || (r.deviceIds ?? []).includes(selectedDevice?.id ?? ""),
  );
  const showDevicePicker = !isFacility && homeDevices.length > 1;
  const showRealData =
    homeDevices.length <= 1 || !selectedDevice || selectedDevice.id === primaryDeviceId;
  const effectiveLiveMode = liveMode && showRealData;

  const title = isFacility ? "요양원 통합 대시보드" : "가정 모니터링 대시보드";

  return (
    <div className="flex flex-col">
      <Header title={title} />

      <div className="p-6 space-y-6">
        {isFacility && !running && (
          <div className="bg-surface border border-warning/40 rounded p-4 flex items-center gap-3">
            <div className="size-2 rounded-full bg-warning" />
            <div className="text-sm">
              <span className="font-semibold text-warning">모니터링 정지 상태</span>
            </div>
          </div>
        )}

        {showDevicePicker && (
          <section>
            <SectionTitle>장치 선택 · 선택한 장치의 모니터링 정보만 표시</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {homeDevices.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setActiveDevice(d.id)}
                  className={`px-3 py-1.5 rounded border text-xs font-mono ${
                    selectedDevice?.id === d.id
                      ? "border-foreground bg-surface"
                      : "border-border text-muted hover:text-foreground"
                  }`}
                >
                  {d.name}
                  {d.id === primaryDeviceId && (
                    <span className="ml-1.5 text-[9px] text-success uppercase">live</span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {!isFacility && !showRealData && (
          <div className="bg-surface border border-warning/40 rounded p-4 flex items-center gap-3">
            <div className="size-2 rounded-full bg-warning" />
            <div className="text-sm">
              <span className="font-semibold text-warning">{selectedDevice?.name}</span>
              <span className="text-muted">
                {" "}
                · 아직 로컬 백엔드에 연결되지 않은 장치입니다. 현재 1대의 실장치만 동시 연동을
                지원합니다.
              </span>
            </div>
          </div>
        )}

        {isFacility && (
          <section>
            <SectionTitle>
              다중 거주자 상태 그리드 · 호실 클릭 시 해당 ESP32와 MQTT 통신
            </SectionTitle>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {residents.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setActiveResident(r.id)}
                  className={`text-left bg-surface border rounded-lg p-4 hover:border-muted transition-colors ${
                    r.id === activeId
                      ? "border-foreground ring-2 ring-primary/30"
                      : r.state === "FALL"
                        ? "border-primary animate-alert"
                        : r.state === "SUSPECT"
                          ? "border-warning"
                          : "border-border"
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="text-sm font-semibold">
                        {r.room}호 · {r.name}
                      </div>
                      <div className="text-[10px] text-muted font-mono">
                        {r.deviceId} · {r.age}세
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-mono uppercase font-bold ${unifiedStatusColor(r.state, r.presence)}`}
                    >
                      {unifiedStatusLabel(r.state, r.presence)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <span className={`font-bold ${presenceColor(r.presence)}`}>
                      {presenceLabel(r.presence)}
                    </span>
                    <span className="text-muted">MV {r.mv.toFixed(2)}</span>
                    <span className="text-muted">W {r.wander.toFixed(2)}</span>
                    <span className={r.online ? "text-success" : "text-muted"}>
                      {r.online ? "ON" : "OFF"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {isFacility ? (
            <>
              <StatCard
                label="대상자"
                value={active?.name ?? "미등록"}
                sub={activeDevice ? `${activeDevice.room}호` : "장치 미등록"}
              />
              <StatCard
                label="재실감지"
                value={presenceLabel(active?.presence ?? "ABSENT")}
                sub={`MV ${(active?.mv ?? 0).toFixed(2)} / 임계값 ${threshold.toFixed(2)}`}
                tone={active?.presence === "PRESENT" ? "success" : "default"}
              />
              <StatCard
                label="낙상 감지"
                value={stateLabel(active?.state ?? "IDLE")}
                sub={`DNN 신뢰도 ${((active?.confidence ?? 0) * 100).toFixed(1)}% · CSI-NET v2`}
                tone={fallTone(active?.state ?? "IDLE")}
              />
              <StatCard
                label="수신기 상태"
                value={activeDevice?.online ? "수신 중" : "연결 끊김"}
                sub={
                  activeDevice
                    ? `RSSI ${activeDevice.current_rssi}dBm · ${activeDevice.connection}`
                    : "장치 없음"
                }
                tone={activeDevice?.online ? "success" : "danger"}
              />
            </>
          ) : (
            <>
              <StatCard
                label="대상자"
                value={selectedResident?.name ?? "미등록"}
                sub={selectedDevice ? `${selectedDevice.room}호` : "등록된 장치 없음"}
              />
              <StatCard
                label="재실감지"
                value={
                  !effectiveLiveMode
                    ? "연결 끊김"
                    : presenceLabel(live.last?.presence_state === "present" ? "PRESENT" : "ABSENT")
                }
                sub={
                  effectiveLiveMode && live.last?.mv_current != null
                    ? `MV ${live.last.mv_current.toFixed(2)} / 임계값 ${(live.last.presence_mv_threshold ?? liveMvThreshold).toFixed(2)}`
                    : effectiveLiveMode
                      ? "장치 설정에서 캘리브레이션을 진행하세요"
                      : "백엔드/수신기 연결 후 표시됩니다"
                }
                tone={
                  effectiveLiveMode && live.last?.presence_state === "present" ? "success" : "default"
                }
              />
              <StatCard
                label="낙상 감지"
                value={
                  !effectiveLiveMode
                    ? "연결 끊김"
                    : live.last?.proba_fall != null
                      ? stateLabel(live.last.detect_state ?? "IDLE")
                      : "모델 미가동"
                }
                sub={
                  effectiveLiveMode && live.last?.proba_fall != null
                    ? `낙상 확률 ${(live.last.proba_fall * 100).toFixed(1)}% · 3초 윈도우 / 0.25초 주기`
                    : effectiveLiveMode
                      ? "백엔드가 --no-model로 실행 중이거나 모델 로드 실패"
                      : "백엔드/수신기 연결 후 표시됩니다"
                }
                tone={
                  !effectiveLiveMode || live.last?.proba_fall == null
                    ? "default"
                    : fallTone(live.last?.detect_state ?? "IDLE")
                }
              />
              <StatCard
                label="수신기 상태"
                value={effectiveLiveMode ? "수신 중" : "연결 끊김"}
                sub={
                  effectiveLiveMode
                    ? `${live.last?.hz_1s ?? 0}Hz · RSSI ${live.last?.rssi ?? "—"}dBm`
                    : !showRealData
                      ? "다른 장치 선택됨 · 위 배너 참고"
                      : backendUp
                        ? "수신기(USB) 미연결 · 장치 설정에서 포트 확인"
                        : "로컬 백엔드 미실행 (backend/main.py)"
                }
                tone={effectiveLiveMode ? "success" : "danger"}
              />
            </>
          )}
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-surface border border-border rounded-lg flex flex-col">
            <div className="p-4 border-b border-border flex justify-between items-center">
              <h3 className="text-xs font-mono font-semibold uppercase tracking-widest">
                {isFacility
                  ? `실시간 움직임 감지 · ${active?.name}`
                  : "실시간 움직임 감지 · 수신기 실데이터"}
              </h3>
              <div className="flex items-center gap-2">
                {isFacility ? (
                  <span className="text-[10px] font-mono text-muted px-2 py-0.5 rounded bg-background border border-border">
                    MQTT: {activeDevice?.mqttTopic ?? "—"} · {chartData.length} samples
                  </span>
                ) : effectiveLiveMode ? (
                  <span className="text-[10px] font-mono text-success px-2 py-0.5 rounded bg-success/10 border border-success/30">
                    ● LIVE · {live.last?.hz_1s ?? 0}Hz · {live.history.length} samples
                  </span>
                ) : (
                  <span className="text-[10px] font-mono text-danger px-2 py-0.5 rounded bg-danger/10 border border-danger/30">
                    ○ 연결 끊김
                  </span>
                )}
                <button
                  onClick={() => {
                    simulateFall(active?.id);
                    toast.warning(
                      "[시뮬레이션] 딥러닝 낙상 이벤트 발생 — 알람 응답 파이프라인 확인",
                    );
                  }}
                  className="px-2.5 py-1 rounded text-[10px] font-mono uppercase font-bold bg-danger text-white hover:brightness-110"
                  title="현재 활성 대상에 딥러닝 추론 결과로 낙상 이벤트를 강제 발생시킵니다"
                >
                  ⚠ 낙상 시뮬레이션
                </button>
              </div>
            </div>
            <div className="p-4 h-72">
              {isFacility ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <XAxis
                      dataKey="i"
                      tick={{ fill: "#71717a", fontSize: 10, fontFamily: "JetBrains Mono" }}
                      axisLine={{ stroke: "#e4e4e7" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "#71717a", fontSize: 10, fontFamily: "JetBrains Mono" }}
                      axisLine={{ stroke: "#e4e4e7" }}
                      tickLine={false}
                      domain={[0, "dataMax + 1"]}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#ffffff",
                        border: "1px solid #e4e4e7",
                        fontFamily: "JetBrains Mono",
                        fontSize: 11,
                      }}
                      labelStyle={{ color: "#71717a" }}
                    />
                    <ReferenceLine
                      y={threshold}
                      stroke="#ef4444"
                      strokeDasharray="4 4"
                      label={{
                        value: `임계값 ${threshold}`,
                        fill: "#ef4444",
                        fontSize: 10,
                        position: "insideTopRight",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="mv"
                      stroke="#22c55e"
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : effectiveLiveMode ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={liveChartData}
                    margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                  >
                    <XAxis
                      dataKey="i"
                      tick={{ fill: "#71717a", fontSize: 10, fontFamily: "JetBrains Mono" }}
                      axisLine={{ stroke: "#e4e4e7" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "#71717a", fontSize: 10, fontFamily: "JetBrains Mono" }}
                      axisLine={{ stroke: "#e4e4e7" }}
                      tickLine={false}
                      domain={[0, "dataMax + 1"]}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#ffffff",
                        border: "1px solid #e4e4e7",
                        fontFamily: "JetBrains Mono",
                        fontSize: 11,
                      }}
                      labelStyle={{ color: "#71717a" }}
                    />
                    <ReferenceLine
                      y={liveMvThreshold}
                      stroke="#ef4444"
                      strokeDasharray="4 4"
                      label={{
                        value: `임계값 ${liveMvThreshold.toFixed(2)}`,
                        fill: "#ef4444",
                        fontSize: 10,
                        position: "insideTopRight",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="mv"
                      stroke="#22c55e"
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-muted">
                  <div className="text-3xl">📡</div>
                  <div className="text-sm font-semibold">
                    {!showRealData ? "다른 장치 선택됨" : "수신기 연결 안 됨"}
                  </div>
                  <div className="text-xs font-mono text-center">
                    {!showRealData
                      ? "이 장치는 아직 로컬 백엔드에 연결되지 않았습니다. 위 장치 선택에서 LIVE 표시된 장치를 고르세요."
                      : backendUp
                        ? "로컬 백엔드는 실행 중이지만 수신기(USB)가 감지되지 않습니다. 수신기 연결 후 자동으로 복구됩니다."
                        : "로컬 백엔드가 실행되고 있지 않습니다. backend 디렉토리에서 main.py를 실행하세요."}
                  </div>
                </div>
              )}
            </div>
          </div>

          <EventLogPanel />
        </div>

        <section className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="text-xs font-mono font-semibold uppercase tracking-widest">
              최근 낙상 이벤트
            </h3>
          </div>
          <table className="w-full text-left text-sm font-mono">
            <thead>
              <tr className="text-[10px] text-muted border-b border-border">
                <th className="p-3 font-medium uppercase">Timestamp</th>
                <th className="p-3 font-medium uppercase">Resident</th>
                <th className="p-3 font-medium uppercase">DNN Confidence</th>
                <th className="p-3 font-medium uppercase text-right">Response</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {falls.slice(0, 5).map((f) => (
                <tr key={f.id}>
                  <td className="p-3 text-muted">{fmtDateTime(f.timestamp)}</td>
                  <td className="p-3">
                    {f.residentName} (Room {f.room})
                  </td>
                  <td className="p-3">{(f.confidence * 100).toFixed(1)}%</td>
                  <td className="p-3 text-right">
                    <ResponseBadge response={f.response} />
                  </td>
                </tr>
              ))}
              {falls.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-muted text-xs">
                    감지된 낙상이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

const STATE_SEVERITY: StateMachine[] = ["FALL", "SUSPECT", "COOLDOWN", "IDLE"];

function worstState(list: { state: StateMachine }[]): StateMachine {
  for (const s of STATE_SEVERITY) {
    if (list.some((r) => r.state === s)) return s;
  }
  return "IDLE";
}

function fallTone(state: StateMachine): "danger" | "warn" | "default" {
  if (state === "FALL") return "danger";
  if (state === "SUSPECT") return "warn";
  return "default";
}

export function Header({ title }: { title: string }) {
  const [now, setNow] = useState<string>("");
  const user = useCurrentUser();
  const isFacility = user?.service === "FACILITY";
  const running = useStore((s) => s.running);
  const backendConnected = useStore((s) => s.backendConnected);
  const alarm = useStore((s) => s.alarm);
  const allResidents = useStore((s) => s.residents);
  const scoped = isFacility
    ? allResidents.filter((r) => r.facilityId === user?.facilityId)
    : allResidents.filter((r) => r.ownerUserId === user?.id);
  const presentCount = scoped.filter((r) => r.presence === "PRESENT").length;
  const absentCount = scoped.length - presentCount;
  // FACILITY는 mock 시뮬레이션(running), HOME은 실백엔드 연결(backendConnected)
  // 기준 — AppSidebar의 상태 점과 동일한 판단 기준을 재사용한다.
  const operational = isFacility ? running : backendConnected;
  // alarm이 있으면(사용자가 명시적으로 확인하기 전까지) FALL을 그대로 유지한다
  // — 개별 resident.state는 mock tick()에서 바로 COOLDOWN으로 넘어가더라도
  // 헤더는 alarm 기준으로 별도 판단한다.
  const displayState = alarm ? "FALL" : worstState(scoped);
  useEffect(() => {
    const fmt = () => setNow(new Date().toLocaleString("sv-SE").replace("T", " ").slice(0, 19));
    fmt();
    const id = setInterval(fmt, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <header className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0 bg-background sticky top-0 z-10">
      <div className="flex items-center gap-4">
        <h2 className="text-sm font-medium">{title}</h2>
        <div className="flex gap-2">
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-mono border font-bold ${stateColor(displayState)} ${
              displayState === "FALL"
                ? "bg-primary/10 border-primary/20 animate-pulse"
                : "bg-surface border-border"
            }`}
          >
            {stateLabel(displayState)}
          </span>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
              presentCount > 0
                ? "bg-success/10 text-success border-success/20"
                : "bg-muted/10 text-muted border-muted/20"
            }`}
            title="재실 감지: 움직임+WANDER 통합 판단"
          >
            {isFacility
              ? presentCount > 0
                ? `재실 ${presentCount}`
                : `퇴실 ${absentCount}`
              : presentCount > 0
                ? "재실"
                : "퇴실"}
          </span>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
              operational
                ? "bg-success/10 text-success border-success/20"
                : "bg-surface text-muted border-border"
            }`}
          >
            {operational ? "ONLINE" : "OFFLINE"}
          </span>
        </div>
      </div>
      <div className="text-right">
        <div className="text-[10px] font-mono text-muted">SYSTEM TIME</div>
        <div className="text-xs font-mono min-h-[14px]" suppressHydrationWarning>
          {now || "—"}
        </div>
      </div>
    </header>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-mono font-semibold uppercase tracking-widest text-muted mb-3">
      {children}
    </h3>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "danger" | "warn" | "success" | "default";
}) {
  const toneClass =
    tone === "danger"
      ? "text-primary"
      : tone === "warn"
        ? "text-warning"
        : tone === "success"
          ? "text-success"
          : "text-foreground";
  return (
    <div className="bg-surface p-4 rounded border border-border">
      <div className="text-[10px] font-mono text-muted mb-1 uppercase">{label}</div>
      <div className={`text-2xl font-mono font-medium tracking-tight ${toneClass}`}>{value}</div>
      <div className="text-[10px] text-muted mt-2 font-mono truncate">{sub}</div>
    </div>
  );
}

export function ResponseBadge({ response }: { response: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    PENDING: { label: "대기중", cls: "text-warning border-warning/30 bg-warning/10" },
    ACKNOWLEDGED: { label: "확인함", cls: "text-sky-600 border-sky-600/30 bg-sky-600/10" },
    DISPATCHED: { label: "출동중", cls: "text-success border-success/30 bg-success/10" },
    FALSE_ALARM: { label: "오탐지", cls: "text-muted border-border bg-background" },
  };
  const m = map[response] ?? map.PENDING;
  return (
    <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${m.cls}`}>
      {m.label}
    </span>
  );
}
