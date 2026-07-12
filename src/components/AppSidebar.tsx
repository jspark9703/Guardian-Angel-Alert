import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useStore, stateLabel, stateColor, fmtDateTime, useCurrentUser, useCurrentFacility, logout } from "@/lib/mock-store";

export function AppSidebar() {
  const running = useStore((s) => s.running);
  const resident = useStore((s) => s.residents.find((r) => r.id === s.activeResidentId));
  const lastFallAt = useStore((s) => s.lastFallAt);
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const user = useCurrentUser();
  const facility = useCurrentFacility();
  const navigate = useNavigate();

  const currentState = resident?.state ?? "IDLE";
  const isFacility = user?.service === "FACILITY";
  const isRoot = user?.role === "ROOT";

  const navMain = [
    { to: "/", label: "실시간 관제" },
    { to: "/history", label: "낙상 이력" },
    { to: "/event-log", label: "이벤트 로그" },
    { to: "/devices", label: "장치 설정" },
  ];
  const navMgmt = [
    ...(isFacility ? [{ to: "/residents", label: "입소자 관리" }] : []),
    ...(isFacility && isRoot ? [{ to: "/facility-members", label: "시설 멤버" }] : []),
    { to: "/notifications", label: "알림 게이트웨이" },
    { to: "/config", label: "알고리즘 설정" },
    { to: "/train", label: "모델 학습" },
  ];


  const handleLogout = () => { logout(); navigate({ to: "/login" }); };

  return (
    <aside className="w-64 border-r border-border flex flex-col shrink-0 bg-background">
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-2 mb-1">
          <div className={`size-3 rounded-full ${running ? "bg-success animate-signal" : "bg-muted"}`} />
          <h1 className="font-mono font-bold tracking-tighter text-lg">CSI-GUARD v4.2</h1>
        </div>
        <p className="text-[10px] text-muted uppercase tracking-widest font-mono">
          {running ? "System Operational" : "System Idle"}
        </p>
      </div>

      {user && (
        <div className="px-4 pt-4 pb-2 border-b border-border">
          <div className="bg-surface border border-border rounded p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold truncate">{user.name}</span>
              <span className="text-[9px] font-mono uppercase text-muted">{user.role}</span>
            </div>
            <div className="text-[10px] font-mono text-muted truncate">
              {isFacility ? `${facility?.name ?? "-"} · ${user.service}` : "가정 서비스 · HOME"}
            </div>
            {isFacility && facility && (
              <div className="text-[9px] font-mono text-muted">INVITE: <span className="text-foreground/70">{facility.code}</span></div>
            )}
          </div>
        </div>
      )}

      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        <div className="text-[10px] font-semibold text-muted mb-2 px-2 uppercase tracking-wider">Main Dashboard</div>
        {navMain.map((n) => <NavLink key={n.to} to={n.to} label={n.label} active={pathname === n.to} />)}
        <div className="pt-4 text-[10px] font-semibold text-muted mb-2 px-2 uppercase tracking-wider">Management</div>
        {navMgmt.map((n) => <NavLink key={n.to} to={n.to} label={n.label} active={pathname === n.to} />)}

        <div className="pt-6 text-[10px] font-semibold text-muted mb-2 px-2 uppercase tracking-wider">Fall Status</div>
        <div className="px-2 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted font-mono">STATE</span>
            <span className={`font-mono font-medium ${stateColor(currentState)}`}>{stateLabel(currentState)}</span>
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-muted">LAST FALL</span>
            <span className="text-foreground/70">{lastFallAt ? fmtDateTime(lastFallAt).slice(-8) : "—"}</span>
          </div>
        </div>
      </nav>

      <div className="p-4 border-t border-border space-y-2">
        <Link
          to="/account"
          className="block w-full text-center py-2 border border-border rounded text-[11px] font-mono uppercase tracking-widest text-muted hover:text-foreground hover:bg-surface/50"
        >
          계정 관리
        </Link>
        <button
          onClick={handleLogout}
          className="w-full py-2 border border-border rounded text-[11px] font-mono uppercase tracking-widest text-muted hover:text-primary hover:border-primary/40"
        >
          Logout
        </button>
      </div>
    </aside>
  );
}

function NavLink({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
        active
          ? "bg-surface text-foreground border border-border/50"
          : "text-muted hover:text-foreground hover:bg-surface/50 border border-transparent"
      }`}
    >
      <span>{label}</span>
    </Link>
  );
}
