import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Header } from "./index";
import { useScopedLogs, fmtDateTime } from "@/lib/mock-store";

export const Route = createFileRoute("/event-log")({
  head: () => ({ meta: [{ title: "이벤트 로그 · CSI-Guard" }] }),
  component: EventLogPage,
});

function EventLogPage() {
  const logs = useScopedLogs();
  const [filter, setFilter] = useState<string>("ALL");
  const [query, setQuery] = useState<string>("");

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      const matchLevel = filter === "ALL" || l.level === filter;
      const matchQuery =
        query.trim() === "" || l.msg.toLowerCase().includes(query.trim().toLowerCase());
      return matchLevel && matchQuery;
    });
  }, [logs, filter, query]);

  return (
    <div>
      <Header title="이벤트 로그" />
      <div className="p-6 space-y-4 max-w-6xl">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">Event Log</h1>
            <p className="text-sm text-muted">
              총 {logs.length}건 · 서비스 권한 범위 내 이벤트만 표시됩니다.
            </p>
          </div>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="메시지 검색"
              className="bg-surface border border-border rounded px-3 py-2 text-xs font-mono placeholder:text-muted"
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-surface border border-border rounded px-3 py-2 text-xs font-mono"
            >
              <option value="ALL">전체 레벨</option>
              <option value="FALL">FALL</option>
              <option value="ERROR">ERROR</option>
              <option value="WARN">WARN</option>
              <option value="INFO">INFO</option>
            </select>
          </div>
        </div>

        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-left text-sm font-mono">
            <thead>
              <tr className="text-[10px] text-muted border-b border-border bg-background/30">
                <th className="p-3 font-medium uppercase w-44">Timestamp</th>
                <th className="p-3 font-medium uppercase w-20">Level</th>
                <th className="p-3 font-medium uppercase">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((l, i) => (
                <tr key={i}>
                  <td className="p-3 text-muted">{fmtDateTime(l.ts)}</td>
                  <td className="p-3">
                    <span className={`text-[10px] font-bold uppercase ${levelColor(l.level)}`}>
                      {l.level}
                    </span>
                  </td>
                  <td className="p-3 text-foreground/80">{l.msg}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-8 text-center text-muted text-xs">
                    조건에 맞는 이벤트 로그가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function levelColor(level: string) {
  switch (level) {
    case "FALL":
      return "text-primary";
    case "ERROR":
      return "text-primary";
    case "WARN":
      return "text-warning";
    case "INFO":
      return "text-success";
    default:
      return "text-muted";
  }
}
