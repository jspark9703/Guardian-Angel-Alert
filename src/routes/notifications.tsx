import { createFileRoute } from "@tanstack/react-router";
import { useStore, upsertRecipient, deleteRecipient, useCurrentUser, type Recipient, type Resident } from "@/lib/mock-store";
import { Header, SectionTitle } from "./index";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/notifications")({
  head: () => ({ meta: [{ title: "알림 게이트웨이 · CSI-Guard" }] }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const user = useCurrentUser();
  const recipients = useStore((s) => s.recipients);
  const allResidents = useStore((s) => s.residents);
  const residents = useMemo(
    () => user?.service === "FACILITY" ? allResidents.filter((r) => r.facilityId === user.facilityId) : [],
    [allResidents, user],
  );
  const [editing, setEditing] = useState<Recipient | null>(null);
  const isFacility = user?.service === "FACILITY";

  const shared = useMemo(() => recipients.filter((r) => !r.residentId), [recipients]);
  const byResident = useMemo(() => {
    const map: Record<string, Recipient[]> = {};
    recipients.forEach((r) => { if (r.residentId) (map[r.residentId] ??= []).push(r); });
    return map;
  }, [recipients]);

  const blank = (residentId?: string): Recipient => ({
    id: `n-${Date.now()}`, name: "", role: "가족", phone: "",
    sms: true, push: true, ars: false, residentId,
  });

  return (
    <div>
      <Header title="알림 게이트웨이" />
      <div className="p-6 space-y-6 max-w-6xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight mb-1">Notification Gateway</h1>
          <p className="text-sm text-muted">
            {isFacility
              ? "입소자별 알림 수신자 관리 · 낙상 감지 시 해당 입소자에 등록된 가족·요양사에게만 즉시 통보"
              : "낙상 감지 시 SMS · Push · ARS 채널로 즉시 통보 · 미확인 시 자동 에스컬레이션"}
          </p>
        </div>

        <section className="grid grid-cols-3 gap-4">
          <ChannelCard title="SMS" desc="Twilio · KT Bizmessage" enabled />
          <ChannelCard title="Web/App Push" desc="FCM · APNs" enabled />
          <ChannelCard title="ARS Escalation" desc="60초 미확인 시 자동 음성 통화" enabled />
        </section>

        {isFacility ? (
          <>
            <section>
              <div className="flex justify-between items-center mb-3">
                <SectionTitle>입소자별 알림 수신자</SectionTitle>
                <span className="text-[10px] font-mono text-muted uppercase">{residents.length} residents</span>
              </div>
              <div className="space-y-4">
                {residents.map((res) => (
                  <ResidentGroup
                    key={res.id}
                    resident={res}
                    recipients={byResident[res.id] ?? []}
                    onAdd={() => setEditing(blank(res.id))}
                    onEdit={(r) => setEditing(r)}
                  />
                ))}
                {residents.length === 0 && (
                  <div className="bg-surface border border-border rounded p-6 text-center text-xs text-muted">
                    등록된 입소자가 없습니다. 입소자 관리에서 먼저 추가하세요.
                  </div>
                )}
              </div>
            </section>

            <section>
              <div className="flex justify-between items-center mb-3">
                <SectionTitle>공용 수신자 (전체 낙상 알림)</SectionTitle>
                <button onClick={() => setEditing(blank(undefined))} className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-[10px] font-mono uppercase font-bold">
                  + 공용 수신자
                </button>
              </div>
              <RecipientTable rows={shared} onEdit={(r) => setEditing(r)} emptyText="공용 수신자가 없습니다. 시설 당직실·관리자 등 전체 알림 대상을 등록하세요." />
            </section>
          </>
        ) : (
          <section>
            <div className="flex justify-between items-center mb-3">
              <SectionTitle>Recipients</SectionTitle>
              <button onClick={() => setEditing(blank(undefined))} className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-[10px] font-mono uppercase font-bold">
                + 수신자 추가
              </button>
            </div>
            <RecipientTable rows={recipients} onEdit={(r) => setEditing(r)} emptyText="수신자가 없습니다." />
          </section>
        )}

        {editing && (
          <EditModal
            recipient={editing}
            residents={residents}
            isFacility={isFacility}
            onClose={() => setEditing(null)}
            onSave={(r) => { upsertRecipient(r); toast.success(`${r.name} 저장됨`); setEditing(null); }}
          />
        )}
      </div>
    </div>
  );
}

function ResidentGroup({ resident, recipients, onAdd, onEdit }: {
  resident: Resident; recipients: Recipient[]; onAdd: () => void; onEdit: (r: Recipient) => void;
}) {
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/30">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono uppercase text-muted">{resident.room}호</span>
          <span className="text-sm font-semibold">{resident.name}</span>
          <span className="text-[10px] font-mono text-muted">{resident.age}세 · 담당 {resident.caregiver}</span>
          <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border border-border text-muted">
            {recipients.length} recipients
          </span>
        </div>
        <button onClick={onAdd} className="px-3 py-1 border border-primary/40 text-primary rounded text-[10px] font-mono uppercase hover:bg-primary/10">
          + 수신자 추가
        </button>
      </div>
      <RecipientTable rows={recipients} onEdit={onEdit} embedded emptyText={`${resident.name}님의 수신자가 없습니다. 낙상 알림이 공용 수신자에게만 발송됩니다.`} />
    </div>
  );
}

function RecipientTable({ rows, onEdit, emptyText, embedded }: {
  rows: Recipient[]; onEdit: (r: Recipient) => void; emptyText: string; embedded?: boolean;
}) {
  return (
    <div className={embedded ? "" : "bg-surface border border-border rounded-lg overflow-hidden"}>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-[10px] text-muted border-b border-border bg-background/30 font-mono">
            <th className="p-3 font-medium uppercase">Name</th>
            <th className="p-3 font-medium uppercase">Role</th>
            <th className="p-3 font-medium uppercase">Phone</th>
            <th className="p-3 font-medium uppercase">Channels</th>
            <th className="p-3 font-medium uppercase text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-black/5">
              <td className="p-3 font-medium">{r.name}</td>
              <td className="p-3 text-sm">{r.role}</td>
              <td className="p-3 font-mono text-xs text-muted">{r.phone}</td>
              <td className="p-3">
                <div className="flex gap-1">
                  {r.sms && <Chip>SMS</Chip>}
                  {r.push && <Chip>PUSH</Chip>}
                  {r.ars && <Chip>ARS</Chip>}
                </div>
              </td>
              <td className="p-3 text-right space-x-2">
                <button onClick={() => onEdit(r)} className="text-[10px] font-mono uppercase text-muted hover:text-foreground">edit</button>
                <button onClick={() => { deleteRecipient(r.id); toast(`${r.name} 삭제됨`); }} className="text-[10px] font-mono uppercase text-primary">delete</button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5} className="p-4 text-center text-muted text-xs">{emptyText}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ChannelCard({ title, desc, enabled }: { title: string; desc: string; enabled: boolean }) {
  return (
    <div className="bg-surface border border-border rounded p-4">
      <div className="flex justify-between items-start mb-2">
        <div className="text-sm font-semibold">{title}</div>
        <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${enabled ? "text-success border-success/30 bg-success/10" : "text-muted border-border"}`}>
          {enabled ? "ACTIVE" : "OFF"}
        </span>
      </div>
      <p className="text-[11px] text-muted font-mono">{desc}</p>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border border-border bg-background text-muted">{children}</span>;
}

function EditModal({ recipient, residents, isFacility, onClose, onSave }: {
  recipient: Recipient; residents: Resident[]; isFacility: boolean;
  onClose: () => void; onSave: (r: Recipient) => void;
}) {
  const [r, setR] = useState<Recipient>(recipient);
  return (
    <div className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-6">
      <div className="bg-surface border border-border rounded-lg max-w-md w-full">
        <div className="p-4 border-b border-border"><h3 className="text-sm font-mono uppercase tracking-widest">Recipient</h3></div>
        <div className="p-6 space-y-4">
          {isFacility && (
            <F label="담당 입소자">
              <select
                value={r.residentId ?? ""}
                onChange={(e) => setR({ ...r, residentId: e.target.value || undefined })}
                className={cls}
              >
                <option value="">공용 (전체 낙상 알림)</option>
                {residents.map((res) => (
                  <option key={res.id} value={res.id}>{res.room}호 · {res.name}</option>
                ))}
              </select>
            </F>
          )}
          <F label="이름"><input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} className={cls} /></F>
          <F label="역할">
            <select value={r.role} onChange={(e) => setR({ ...r, role: e.target.value as any })} className={cls}>
              <option>가족</option><option>요양사</option><option>관리자</option>
            </select>
          </F>
          <F label="전화번호"><input value={r.phone} onChange={(e) => setR({ ...r, phone: e.target.value })} placeholder="010-0000-0000" className={cls} /></F>
          <F label="채널">
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={r.sms} onChange={(e) => setR({ ...r, sms: e.target.checked })} />SMS</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={r.push} onChange={(e) => setR({ ...r, push: e.target.checked })} />Push</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={r.ars} onChange={(e) => setR({ ...r, ars: e.target.checked })} />ARS</label>
            </div>
          </F>
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border border-border rounded text-xs font-mono uppercase text-muted">Cancel</button>
          <button onClick={() => onSave(r)} className="px-4 py-2 bg-primary text-primary-foreground rounded text-xs font-mono uppercase font-bold">Save</button>
        </div>
      </div>
    </div>
  );
}

const cls = "w-full bg-background border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-muted";
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-[10px] font-mono text-muted uppercase mb-1">{label}</div>{children}</div>;
}
