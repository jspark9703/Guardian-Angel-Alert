import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Header, SectionTitle } from "./index";
import { useCurrentUser, useCurrentFacility, updateAccount, logout } from "@/lib/mock-store";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "계정 관리 · CSI-Guard" }] }),
  component: AccountPage,
});

function AccountPage() {
  const user = useCurrentUser();
  const facility = useCurrentFacility();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  if (!user) return null;

  const saveProfile = () => {
    if (!name.trim() || !email.trim()) return toast.error("이름과 이메일은 필수입니다");
    updateAccount({ name: name.trim(), email: email.trim() });
    toast.success("프로필 저장됨");
  };
  const savePassword = () => {
    if (pw.length < 4) return toast.error("비밀번호는 4자 이상");
    if (pw !== pw2) return toast.error("비밀번호 확인이 일치하지 않습니다");
    updateAccount({ password: pw });
    setPw(""); setPw2("");
    toast.success("비밀번호 변경됨");
  };
  const doLogout = () => { logout(); navigate({ to: "/login" }); };

  return (
    <div>
      <Header title="계정 관리" />
      <div className="p-6 space-y-5 max-w-3xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight mb-1">Account Settings</h1>
          <p className="text-sm text-muted">프로필 정보 및 로그인 자격 증명 관리</p>
        </div>

        {/* Overview */}
        <div className="bg-surface border border-border rounded-lg p-5">
          <SectionTitle>계정 정보</SectionTitle>
          <div className="grid grid-cols-2 gap-3 text-xs font-mono">
            <Info label="User ID" value={user.id} />
            <Info label="Role" value={user.role} accent />
            <Info label="Service" value={user.service} />
            <Info label="Facility" value={facility?.name ?? "—"} />
            {facility && <Info label="Invite Code" value={facility.code} wide />}
          </div>
        </div>

        {/* Profile */}
        <div className="bg-surface border border-border rounded-lg p-5 space-y-3">
          <SectionTitle>프로필</SectionTitle>
          <Field label="이름" value={name} onChange={setName} />
          <Field label="이메일" value={email} onChange={setEmail} />
          <div className="flex justify-end">
            <button onClick={saveProfile} className="px-4 py-2 bg-primary text-primary-foreground rounded text-xs font-mono uppercase font-bold">저장</button>
          </div>
        </div>

        {/* Password */}
        <div className="bg-surface border border-border rounded-lg p-5 space-y-3">
          <SectionTitle>비밀번호 변경</SectionTitle>
          <Field label="새 비밀번호" value={pw} onChange={setPw} type="password" />
          <Field label="비밀번호 확인" value={pw2} onChange={setPw2} type="password" />
          <div className="flex justify-end">
            <button onClick={savePassword} className="px-4 py-2 bg-primary text-primary-foreground rounded text-xs font-mono uppercase font-bold">비밀번호 변경</button>
          </div>
        </div>

        {/* Danger */}
        <div className="bg-surface border border-primary/30 rounded-lg p-5 space-y-2">
          <SectionTitle>세션</SectionTitle>
          <p className="text-xs text-muted">현재 기기에서 로그아웃합니다.</p>
          <div className="flex justify-end">
            <button onClick={doLogout} className="px-4 py-2 border border-primary/50 text-primary rounded text-xs font-mono uppercase font-bold hover:bg-primary/10">
              Logout
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="text-[10px] font-mono uppercase text-muted">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1 bg-background border border-border rounded px-3 py-2 text-sm font-mono" />
    </div>
  );
}

function Info({ label, value, accent, wide }: { label: string; value: string; accent?: boolean; wide?: boolean }) {
  return (
    <div className={`bg-background border border-border rounded p-2 ${wide ? "col-span-2" : ""}`}>
      <div className="text-[9px] uppercase text-muted">{label}</div>
      <div className={`text-xs mt-0.5 truncate ${accent ? "text-primary font-bold" : ""}`}>{value}</div>
    </div>
  );
}
