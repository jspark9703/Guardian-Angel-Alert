import { createFileRoute } from "@tanstack/react-router";
import {
  useStore,
  updateConfig,
  DEFAULT_CONFIG,
  useCurrentUser,
  type PipelineConfig,
} from "@/lib/mock-store";
import { Header, SectionTitle } from "./index";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/config")({
  head: () => ({ meta: [{ title: "알고리즘 설정 · CSI-Guard" }] }),
  component: ConfigGate,
});

function ConfigGate() {
  return <ConfigPage />;
}

const PIPELINE_FIELDS: Array<{
  key: keyof PipelineConfig;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  desc: string;
}> = [
  {
    key: "window_sec",
    label: "Window",
    unit: "sec",
    min: 0.5,
    max: 10,
    step: 0.1,
    desc: "CSI 슬라이딩 윈도우 길이",
  },
  {
    key: "stride_sec",
    label: "Stride",
    unit: "sec",
    min: 0.1,
    max: 2,
    step: 0.05,
    desc: "파이프라인 실행 주기",
  },
  {
    key: "fs_hz",
    label: "Sample Rate",
    unit: "Hz",
    min: 10,
    max: 500,
    step: 10,
    desc: "리샘플링 목표 주파수",
  },
  {
    key: "mv_window_sec",
    label: "움직임 감지 Window",
    unit: "sec",
    min: 0.1,
    max: 2,
    step: 0.05,
    desc: "움직임 감지(이동분산) 계산 윈도우",
  },
  {
    key: "n_streams",
    label: "N Streams",
    unit: "count",
    min: 1,
    max: 64,
    step: 1,
    desc: "선택 부반송파 수",
  },
  {
    key: "bandpass_low",
    label: "Bandpass Low",
    unit: "Hz",
    min: 0.1,
    max: 20,
    step: 0.1,
    desc: "대역통과 하한",
  },
  {
    key: "bandpass_high",
    label: "Bandpass High",
    unit: "Hz",
    min: 5,
    max: 200,
    step: 0.5,
    desc: "대역통과 상한 · Nyquist 자동 강등",
  },
  {
    key: "bandpass_order",
    label: "Filter Order",
    unit: "",
    min: 1,
    max: 10,
    step: 1,
    desc: "Butterworth 필터 차수",
  },
];

const STATE_FIELDS: Array<{
  key: keyof PipelineConfig;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  desc: string;
  critical?: boolean;
}> = [
  {
    key: "mv_threshold",
    label: "움직임 감지 임계값",
    unit: "",
    min: 0.1,
    max: 10,
    step: 0.05,
    desc: "mock 시뮬레이션의 움직임 감지 임계값 (재실 감지 MV 신호 트리거) — 실제 HOME 백엔드와는 무관",
    critical: true,
  },
  {
    key: "min_duration_s",
    label: "Min Duration",
    unit: "sec",
    min: 0.1,
    max: 3,
    step: 0.05,
    desc: "낙상 확정 최소 지속시간",
  },
  {
    key: "merge_gap_s",
    label: "Merge Gap",
    unit: "sec",
    min: 0,
    max: 2,
    step: 0.05,
    desc: "SUSPECT 병합 갭 (히스테리시스)",
  },
  {
    key: "max_duration_s",
    label: "Max Duration",
    unit: "sec",
    min: 0.5,
    max: 10,
    step: 0.1,
    desc: "낙상 최대 지속시간 → COOLDOWN 강제",
  },
  {
    key: "cooldown_s",
    label: "Cooldown",
    unit: "sec",
    min: 0,
    max: 30,
    step: 0.5,
    desc: "재감지 lockout 대기시간",
  },
];

const PRESENCE_FIELDS: Array<{
  key: keyof PipelineConfig;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  desc: string;
}> = [
  {
    key: "wander_threshold",
    label: "WANDER 감지 임계값",
    unit: "",
    min: 0.1,
    max: 1,
    step: 0.05,
    desc: "WANDER 신호가 재실 판단에 기여하는 최소값",
  },
  {
    key: "presence_timeout_s",
    label: "퇴실 판단 대기",
    unit: "sec",
    min: 1,
    max: 60,
    step: 1,
    desc: "MV/WANDER 신호가 이 시간 이상 없으면 퇴실로 판단 (배경노이즈만 지속)",
  },
];

function ConfigPage() {
  const user = useCurrentUser();
  const config = useStore((s) => s.config);
  const [draft, setDraft] = useState<PipelineConfig>(config);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  // "서비스 관리자" = HOME 사용자 본인 또는 FACILITY ROOT
  const isServiceAdmin = !user || user.service === "HOME" || user.role === "ROOT";

  const requestApply = () => setConfirmOpen(true);
  const confirmApply = () => {
    updateConfig(draft);
    setConfirmOpen(false);
    toast.success("설정이 적용되었습니다", { description: "다음 tick부터 즉시 반영됩니다." });
  };
  const reset = () => {
    setDraft(DEFAULT_CONFIG);
    toast("기본값으로 되돌렸습니다");
  };

  return (
    <div>
      <Header title="탐지 알고리즘 설정 · Pipeline Config" criticalCount={0} onlineCount={0} />
      <div className="p-6 space-y-6 max-w-6xl">
        {!isServiceAdmin && (
          <div className="bg-primary/10 border border-primary/40 rounded-lg p-4 flex gap-3">
            <div className="text-primary text-xl leading-none">⚠</div>
            <div>
              <div className="text-sm font-semibold text-primary mb-1">
                서비스 관리자 권한이 아닙니다
              </div>
              <p className="text-xs text-foreground/70 leading-relaxed">
                현재 계정{" "}
                <span className="font-mono text-foreground">
                  {user?.name} ({user?.role})
                </span>{" "}
                은 일반 사용자입니다. 알고리즘 파라미터를 변경하면 낙상 탐지 성능(오탐/미탐)에{" "}
                <span className="text-primary font-semibold">직접적인 영향</span>이 발생할 수 있으니
                반드시 서비스 관리자와 협의 후 수정하시기 바랍니다.
              </p>
            </div>
          </div>
        )}

        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">Pipeline Configuration</h1>
            <p className="text-sm text-muted">
              13개 파라미터를 재시작 없이 다음 tick부터 즉시 반영. 비어있지 않은 필드만 서버에
              전송됩니다.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={reset}
              className="px-4 py-2 border border-border rounded text-xs font-mono uppercase text-muted hover:text-foreground"
            >
              Reset Defaults
            </button>
            <button
              onClick={requestApply}
              disabled={!dirty}
              className="px-4 py-2 bg-primary text-primary-foreground rounded text-xs font-mono uppercase font-bold disabled:opacity-40"
            >
              Apply Config
            </button>
          </div>
        </div>

        <section>
          <SectionTitle>Signal Processing Pipeline</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PIPELINE_FIELDS.map((f) => (
              <ParamRow
                key={f.key}
                field={f}
                value={draft[f.key]}
                onChange={(v) => setDraft({ ...draft, [f.key]: v })}
              />
            ))}
          </div>
        </section>

        <section>
          <SectionTitle>State Machine · Fall Detection</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {STATE_FIELDS.map((f) => (
              <ParamRow
                key={f.key}
                field={f}
                value={draft[f.key]}
                onChange={(v) => setDraft({ ...draft, [f.key]: v })}
                critical={f.critical}
              />
            ))}
          </div>
        </section>

        <section>
          <SectionTitle>재실 감지 · Presence Detection (MV + WANDER)</SectionTitle>
          <p className="text-[11px] text-muted font-mono mb-3 leading-relaxed">
            재실 감지는 <span className="text-foreground">움직임 감지(MV)</span> 와{" "}
            <span className="text-foreground">WANDER 감지</span> 두 출력을 조합한 더미 로직으로
            판단합니다. 예: MV 감지 후 WANDER 지속 → 재실 / WANDER → MV → 배경노이즈 지속 → 퇴실.
            재실/퇴실 전이 시 별도 알람은 없고 헤더와 상태 카드에서만 표시됩니다. (로직은 추후
            고도화 예정)
          </p>
          <p className="text-[11px] text-primary/80 font-mono mb-3 leading-relaxed">
            ※ 이 화면의 값은 mock 시뮬레이션(PipelineConfig)에만 적용됩니다. HOME 실장치(로컬
            백엔드) 연동 시에는
            <span className="text-foreground"> 장치 설정 → 캘리브레이션</span>으로 별도 도출되는
            움직임 임계값/재실 baseline이 쓰이며, 이 페이지의 조정은 그 값에 영향을 주지 않습니다.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PRESENCE_FIELDS.map((f) => (
              <ParamRow
                key={f.key}
                field={f}
                value={draft[f.key]}
                onChange={(v) => setDraft({ ...draft, [f.key]: v })}
              />
            ))}
          </div>
        </section>

        <section className="bg-surface border border-border rounded-lg p-4">
          <SectionTitle>Config Sync</SectionTitle>
          <p className="text-xs text-muted font-mono">
            GET /detection/config → 화면 진입 시 자동 로드 · POST /detection/config → 부분 업데이트
            · WebSocket 100ms tick으로 상태 스트리밍
          </p>
        </section>
      </div>

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            className="bg-background border-2 border-primary/60 rounded-lg max-w-md w-full p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="text-primary text-2xl">⚠</div>
              <h2 className="text-lg font-semibold text-foreground">알고리즘 설정 변경 확인</h2>
            </div>
            <p className="text-sm text-foreground/80 leading-relaxed mb-2">
              변경된 파라미터는{" "}
              <span className="text-foreground font-semibold">다음 tick부터 즉시 반영</span>되며,
              낙상 탐지의{" "}
              <span className="text-primary font-semibold">오탐/미탐률에 직접적인 영향</span>을
              줍니다.
            </p>
            {!isServiceAdmin && (
              <p className="text-xs text-primary bg-primary/10 border border-primary/40 rounded p-2 mb-3 font-mono">
                ※ 서비스 관리자 권한이 아닌 계정입니다. 정말로 적용하시겠습니까?
              </p>
            )}
            <p className="text-xs text-foreground/60 font-mono mb-4">
              계속 진행하려면 [적용]을 눌러주세요.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 border border-border rounded text-xs font-mono uppercase text-foreground/70 hover:text-foreground hover:bg-surface"
              >
                취소
              </button>
              <button
                onClick={confirmApply}
                className="px-4 py-2 bg-primary text-primary-foreground rounded text-xs font-mono uppercase font-bold hover:bg-primary/90"
              >
                적용
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ParamRow({
  field,
  value,
  onChange,
  critical,
}: {
  field: {
    key: string;
    label: string;
    unit: string;
    min: number;
    max: number;
    step: number;
    desc: string;
  };
  value: number;
  onChange: (v: number) => void;
  critical?: boolean;
}) {
  return (
    <div
      className={`bg-surface border rounded p-4 ${critical ? "border-primary/30" : "border-border"}`}
    >
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="text-sm font-medium flex items-center gap-2">
            {field.label}
            {critical && (
              <span className="text-[9px] font-mono text-primary uppercase">critical</span>
            )}
          </div>
          <div className="text-[10px] text-muted mt-0.5">{field.desc}</div>
        </div>
        <div className="text-right">
          <input
            type="number"
            value={value}
            step={field.step}
            min={field.min}
            max={field.max}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-20 bg-background border border-border rounded px-2 py-1 text-xs font-mono text-right focus:outline-none focus:border-muted"
          />
          <div className="text-[9px] text-muted font-mono mt-0.5">{field.unit}</div>
        </div>
      </div>
      <input
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary h-1"
      />
      <div className="flex justify-between text-[9px] text-muted font-mono mt-1">
        <span>{field.min}</span>
        <span>{field.max}</span>
      </div>
    </div>
  );
}
