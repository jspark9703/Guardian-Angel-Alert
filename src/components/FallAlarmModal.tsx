import { useStore, acknowledgeAlarm, fmtDateTime } from "@/lib/mock-store";

export function FallAlarmModal() {
  const alarm = useStore((s) => s.alarm);

  if (!alarm) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-6">
      <div className="bg-surface border-2 border-primary rounded-lg max-w-lg w-full overflow-hidden shadow-2xl">
        <div className="animate-alert border-b border-primary/40 p-5">
          <div className="flex items-center gap-3">
            <div className="size-3 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-primary">
              EMERGENCY · FALL DETECTED
            </span>
          </div>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <h2 className="text-3xl font-bold text-foreground tracking-tight mb-1">
              낙상 감지 알람
            </h2>
            <p className="text-sm text-foreground/70">
              {alarm.room}호 · {alarm.residentName} · 즉시 확인이 필요합니다.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Stat label="발생 시각" value={fmtDateTime(alarm.timestamp)} />
            <Stat label="신뢰도" value={`${(alarm.confidence * 100).toFixed(1)}%`} highlight />
            <Stat label="지속 시간" value={`${alarm.duration.toFixed(2)}s`} />
            <Stat label="장치" value={alarm.room} />
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              onClick={() => acknowledgeAlarm("DISPATCHED")}
              className="py-3 bg-primary text-primary-foreground font-bold rounded text-sm uppercase tracking-wider hover:brightness-110"
            >
              응급 출동 확인
            </button>
            <button
              onClick={() => acknowledgeAlarm("FALSE_ALARM")}
              className="py-3 bg-surface border border-border text-muted font-medium rounded text-sm uppercase tracking-wider hover:text-foreground"
            >
              오탐지 처리
            </button>
          </div>
          <p className="text-center text-[10px] font-mono text-muted uppercase tracking-widest">
            SMS · Push · ARS 알림이 자동 발송되었습니다
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-background border border-border rounded p-3">
      <div className="text-[10px] font-mono text-muted uppercase mb-1">{label}</div>
      <div className={`text-sm font-mono ${highlight ? "text-primary font-bold" : "text-foreground"}`}>{value}</div>
    </div>
  );
}
