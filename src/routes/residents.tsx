import { createFileRoute } from "@tanstack/react-router";
import {
  useStore,
  upsertResident,
  deleteResident,
  useCurrentUser,
  type Resident,
  type Device,
} from "@/lib/mock-store";
import { Header, SectionTitle } from "./index";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/residents")({
  head: () => ({ meta: [{ title: "입소자 관리 · CSI-Guard" }] }),
  component: ResidentsPage,
});

function ResidentsPage() {
  const user = useCurrentUser();
  const isFacility = user?.service === "FACILITY";
  const allResidents = useStore((s) => s.residents);
  const allDevices = useStore((s) => s.devices);

  // 서비스별 독립 스코프: FACILITY는 시설 내, HOME은 본인 소유만
  const residents = useMemo(() => {
    if (!user) return [];
    return isFacility
      ? allResidents.filter((r) => r.facilityId === user.facilityId)
      : allResidents.filter((r) => r.ownerUserId === user.id);
  }, [allResidents, user, isFacility]);

  const scopedDevices = useMemo(() => {
    if (!user) return [];
    return isFacility
      ? allDevices.filter((d) => d.facilityId === user.facilityId)
      : allDevices.filter((d) => d.ownerUserId === user.id);
  }, [allDevices, user, isFacility]);

  const [editing, setEditing] = useState<Resident | null>(null);

  const blank = (): Resident => ({
    id: `r-${Date.now()}`,
    name: "",
    room: isFacility ? "" : "거실",
    age: isFacility ? 80 : 65,
    caregiver: isFacility ? "" : "본인",
    deviceId: scopedDevices[0]?.id ?? "",
    deviceIds: scopedDevices[0] ? [scopedDevices[0].id] : [],
    facilityId: isFacility ? user?.facilityId : undefined,
    ownerUserId: isFacility ? undefined : user?.id,
    state: "IDLE",
    mv: 0,
    wander: 0,
    presence: "ABSENT",
    lastActivityAt: 0,
    confidence: 0,
    online: true,
  });

  const title = isFacility ? "입소자 · 디바이스 관리" : "가족 · 디바이스 관리";
  const subtitle = isFacility
    ? "시설 거주자 프로필, 방 번호, ESP32 매핑(다중 가능), mv_threshold 오버라이드"
    : "가정 내 사용자 프로필과 ESP32 매핑(다중 가능) · 본인 계정에만 귀속";

  return (
    <div>
      <Header title={title} />
      <div className="p-6 space-y-4 max-w-6xl">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">
              {isFacility ? "Residents & Devices" : "Home Users & Devices"}
            </h1>
            <p className="text-sm text-muted">{subtitle}</p>
          </div>
          <button
            onClick={() => setEditing(blank())}
            className="px-4 py-2 bg-primary text-primary-foreground rounded text-xs font-mono uppercase font-bold"
          >
            + {isFacility ? "거주자 등록" : "사용자 등록"}
          </button>
        </div>

        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[10px] text-muted border-b border-border bg-background/30 font-mono">
                <th className="p-3 font-medium uppercase">{isFacility ? "Room" : "공간"}</th>
                <th className="p-3 font-medium uppercase">Name</th>
                <th className="p-3 font-medium uppercase">Age</th>
                <th className="p-3 font-medium uppercase">{isFacility ? "Caregiver" : "관계"}</th>
                <th className="p-3 font-medium uppercase">Devices</th>
                <th className="p-3 font-medium uppercase">Threshold</th>
                <th className="p-3 font-medium uppercase">Status</th>
                <th className="p-3 font-medium uppercase text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {residents.map((r) => {
                const ids =
                  r.deviceIds && r.deviceIds.length > 0
                    ? r.deviceIds
                    : [r.deviceId].filter(Boolean);
                const names = ids.map((id) => allDevices.find((d) => d.id === id)?.name ?? id);
                return (
                  <tr key={r.id} className="hover:bg-black/5">
                    <td className="p-3 font-mono">{r.room}</td>
                    <td className="p-3 font-medium">{r.name}</td>
                    <td className="p-3 font-mono text-muted">{r.age}</td>
                    <td className="p-3 text-sm">{r.caregiver}</td>
                    <td className="p-3 font-mono text-xs">
                      {names.length === 0 ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {names.map((n, i) => (
                            <span
                              key={i}
                              className="px-1.5 py-0.5 rounded border border-border bg-background text-[10px]"
                            >
                              {n}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {r.thresholdOverride != null ? (
                        <span className="text-warning">{r.thresholdOverride}</span>
                      ) : (
                        <span className="text-muted">global</span>
                      )}
                    </td>
                    <td className="p-3">
                      <span
                        className={`text-[10px] font-mono uppercase ${r.online ? "text-success" : "text-muted"}`}
                      >
                        {r.online ? "● online" : "○ offline"}
                      </span>
                    </td>
                    <td className="p-3 text-right space-x-2">
                      <button
                        onClick={() => setEditing(r)}
                        className="text-[10px] font-mono uppercase text-muted hover:text-foreground"
                      >
                        edit
                      </button>
                      <button
                        onClick={() => {
                          deleteResident(r.id);
                          toast(`${r.name} 삭제됨`);
                        }}
                        className="text-[10px] font-mono uppercase text-primary hover:brightness-110"
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                );
              })}
              {residents.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted text-xs">
                    {isFacility ? "등록된 거주자가 없습니다." : "등록된 사용자가 없습니다."}
                    {scopedDevices.length === 0 &&
                      " 장치는 아직 없어도 등록할 수 있으며, 이후 장치 설정에서 매핑을 추가하세요."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {editing && (
          <EditModal
            resident={editing}
            devices={scopedDevices}
            isFacility={isFacility}
            onClose={() => setEditing(null)}
            onSave={(r) => {
              // 다중 매핑에서 주 장치 보정
              const ids =
                r.deviceIds && r.deviceIds.length > 0
                  ? r.deviceIds
                  : r.deviceId
                    ? [r.deviceId]
                    : [];
              const primary = ids.includes(r.deviceId) ? r.deviceId : (ids[0] ?? "");
              upsertResident({ ...r, deviceIds: ids, deviceId: primary });
              toast.success(`${r.name} 저장됨`);
              setEditing(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function EditModal({
  resident,
  devices,
  isFacility,
  onClose,
  onSave,
}: {
  resident: Resident;
  devices: Device[];
  isFacility: boolean;
  onClose: () => void;
  onSave: (r: Resident) => void;
}) {
  const [r, setR] = useState<Resident>({
    ...resident,
    deviceIds:
      resident.deviceIds && resident.deviceIds.length > 0
        ? resident.deviceIds
        : resident.deviceId
          ? [resident.deviceId]
          : [],
  });

  const toggleDevice = (id: string) => {
    setR((prev) => {
      const list = prev.deviceIds ?? [];
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      const primary = next.includes(prev.deviceId) ? prev.deviceId : (next[0] ?? "");
      return { ...prev, deviceIds: next, deviceId: primary };
    });
  };
  const setPrimary = (id: string) => {
    setR((prev) => {
      const list = prev.deviceIds ?? [];
      return { ...prev, deviceId: id, deviceIds: list.includes(id) ? list : [...list, id] };
    });
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-6">
      <div className="bg-surface border border-border rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-border">
          <h3 className="text-sm font-mono uppercase tracking-widest">
            {isFacility ? "Resident Profile" : "Home User Profile"}
          </h3>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4">
          <Field label="이름">
            <input
              value={r.name}
              onChange={(e) => setR({ ...r, name: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={isFacility ? "방 번호" : "주 사용 공간"}>
            <input
              value={r.room}
              onChange={(e) => setR({ ...r, room: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="나이">
            <input
              type="number"
              value={r.age}
              onChange={(e) => setR({ ...r, age: Number(e.target.value) })}
              className={inputCls}
            />
          </Field>
          <Field label={isFacility ? "담당 요양사" : "관계 / 메모"}>
            <input
              value={r.caregiver}
              onChange={(e) => setR({ ...r, caregiver: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="MV Threshold Override">
            <input
              type="number"
              step="0.1"
              placeholder="global 사용"
              value={r.thresholdOverride ?? ""}
              onChange={(e) =>
                setR({
                  ...r,
                  thresholdOverride: e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
              className={inputCls}
            />
          </Field>
          <Field label="온라인">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={r.online}
                onChange={(e) => setR({ ...r, online: e.target.checked })}
              />
              online
            </label>
          </Field>

          <div className="col-span-2">
            <div className="text-[10px] font-mono text-muted uppercase mb-1">
              매핑 장치 · Devices ({(r.deviceIds ?? []).length})
            </div>
            <div className="text-[10px] text-muted mb-2">
              한 명당 여러 장치를 매핑할 수 있습니다. ★ 표시가 주(primary) 장치입니다.
            </div>
            <div className="border border-border rounded divide-y divide-border max-h-56 overflow-y-auto">
              {devices.length === 0 && (
                <div className="p-3 text-xs text-muted text-center">
                  사용 가능한 장치가 없습니다.
                </div>
              )}
              {devices.map((d) => {
                const checked = (r.deviceIds ?? []).includes(d.id);
                const isPrimary = r.deviceId === d.id;
                return (
                  <label
                    key={d.id}
                    className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer ${checked ? "bg-primary/5" : ""}`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleDevice(d.id)} />
                    <div className="flex-1">
                      <div className="font-medium">
                        {d.name} <span className="text-[10px] font-mono text-muted">{d.room}</span>
                      </div>
                      <div className="text-[10px] font-mono text-muted truncate">{d.mqttTopic}</div>
                    </div>
                    {checked && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setPrimary(d.id);
                        }}
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${isPrimary ? "border-primary text-primary" : "border-border text-muted"}`}
                        title="주 장치로 설정"
                      >
                        {isPrimary ? "★ primary" : "☆ set primary"}
                      </button>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-border rounded text-xs font-mono uppercase text-muted"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(r)}
            disabled={!r.name}
            className="px-4 py-2 bg-primary text-primary-foreground rounded text-xs font-mono uppercase font-bold disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full bg-background border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-muted";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-mono text-muted uppercase mb-1">{label}</div>
      {children}
    </div>
  );
}
