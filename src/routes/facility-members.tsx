import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Header, SectionTitle } from "./index";
import { useStore, useCurrentUser, useCurrentFacility, removeMember, regenerateInviteCode } from "@/lib/mock-store";
import { toast } from "sonner";

export const Route = createFileRoute("/facility-members")({
  head: () => ({ meta: [{ title: "시설 멤버 · CSI-Guard" }] }),
  component: FacilityMembersPage,
});

function FacilityMembersPage() {
  const user = useCurrentUser();
  const facility = useCurrentFacility();
  const allUsers = useStore((s) => s.users);
  const navigate = useNavigate();

  useEffect(() => {
    if (user && user.role !== "ROOT") navigate({ to: "/" });
  }, [user, navigate]);

  if (!user || !facility) return null;
  const members = allUsers.filter((u) => u.facilityId === facility.id);

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(facility.code); toast.success("초대 코드 복사됨"); } catch {}
  };

  return (
    <div>
      <Header title="시설 멤버 관리 (Root)" criticalCount={0} onlineCount={0} />
      <div className="p-6 space-y-6 max-w-5xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight mb-1">Facility Members · IAM</h1>
          <p className="text-sm text-muted">AWS IAM 방식 · Root 계정이 시설을 소유하고 멤버(요양사)를 초대합니다.</p>
        </div>

        <section className="bg-surface border border-border rounded-lg p-5">
          <SectionTitle>Facility</SectionTitle>
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-lg font-semibold">{facility.name}</div>
              <div className="text-[10px] font-mono text-muted">Facility ID: {facility.id}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-mono uppercase text-muted">초대 코드</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="font-mono font-bold text-lg text-primary">{facility.code}</span>
                <button onClick={copyCode} className="text-[10px] font-mono uppercase border border-border rounded px-2 py-1 text-muted hover:text-foreground">복사</button>
                <button onClick={() => { regenerateInviteCode(facility.id); toast("코드 재발급됨"); }}
                  className="text-[10px] font-mono uppercase border border-border rounded px-2 py-1 text-muted hover:text-foreground">재발급</button>
              </div>
            </div>
          </div>
        </section>

        <section>
          <SectionTitle>Members ({members.length})</SectionTitle>
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[10px] text-muted border-b border-border bg-background/30 font-mono">
                  <th className="p-3 uppercase">Name</th>
                  <th className="p-3 uppercase">Email</th>
                  <th className="p-3 uppercase">Role</th>
                  <th className="p-3 uppercase">Onboarded</th>
                  <th className="p-3 uppercase text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((m) => (
                  <tr key={m.id} className="hover:bg-black/5">
                    <td className="p-3 font-medium">{m.name}</td>
                    <td className="p-3 font-mono text-xs">{m.email}</td>
                    <td className="p-3">
                      <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${m.role === "ROOT" ? "text-primary border-primary/30 bg-primary/10" : "text-muted border-border"}`}>
                        {m.role}
                      </span>
                    </td>
                    <td className="p-3 text-xs">{m.onboarded ? "✓" : "—"}</td>
                    <td className="p-3 text-right">
                      {m.role !== "ROOT" && (
                        <button onClick={() => { if (confirm(`${m.name} 제거?`)) { removeMember(m.id); toast(`${m.name} 제거됨`); } }}
                          className="text-[10px] font-mono uppercase text-primary hover:brightness-110">제거</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
