import { fmtTime, useScopedLogs } from "@/lib/mock-store";

export function EventLogPanel() {
  const logs = useScopedLogs();

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="p-4 border-b border-border">
        <h3 className="text-xs font-mono font-semibold uppercase tracking-widest">Event Log</h3>
      </div>
      <div className="divide-y divide-border max-h-64 overflow-y-auto">
        {logs.length === 0 && (
          <div className="p-4 text-xs text-muted font-mono">로그가 없습니다.</div>
        )}
        {logs.map((l, i) => (
          <div key={i} className="p-3 flex items-center gap-3 text-xs font-mono">
            <span className="text-muted">{fmtTime(l.ts)}</span>
            <span className={`w-14 text-[10px] font-bold uppercase ${
              l.level === "FALL" ? "text-primary" :
              l.level === "ERROR" ? "text-primary" :
              l.level === "WARN" ? "text-warning" : "text-muted"
            }`}>{l.level}</span>
            <span className="text-foreground/80 flex-1">{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
