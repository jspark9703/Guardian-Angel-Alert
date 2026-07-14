import { createFileRoute } from "@tanstack/react-router";
import {
  useStore,
  updateConfig,
  DEFAULT_CONFIG,
  useCurrentUser,
  type PipelineConfig,
} from "@/lib/mock-store";
import {
  useBackendUp,
  fetchPresenceConfig,
  updatePresenceConfig,
  fetchDetectionConfig,
  updateDetectionConfig,
  type PresenceConfigSnapshot,
  type DetectionConfigSnapshot,
} from "@/lib/backend";
import { Header, SectionTitle } from "./index";
import { toast } from "sonner";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/config")({
  head: () => ({ meta: [{ title: "알고리즘 설정 · CSI-Guard" }] }),
  component: ConfigGate,
});

function ConfigGate() {
  return <ConfigPage />;
}

interface FieldMeta<K extends string> {
  key: K;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  desc: string;
}

const MOCK_FIELDS: FieldMeta<keyof PipelineConfig>[] = [
  {
    key: "mv_threshold",
    label: "움직임 감지 임계값",
    unit: "",
    min: 0.1,
    max: 10,
    step: 0.05,
    desc: "mock 시뮬레이션의 움직임 감지 임계값 (재실 감지 MV 신호 트리거) — 실제 HOME 백엔드와는 무관",
  },
  {
    key: "wander_threshold",
    label: "WANDER 감지 임계값",
    unit: "",
    min: 0.1,
    max: 1,
    step: 0.05,
    desc: "mock 전용 절대 임계값(0~1) — 실백엔드의 baseline 대비 배율(wander_ratio_threshold)과 척도가 다릅니다",
  },
  {
    key: "threshold",
    label: "낙상 신뢰도 임계값",
    unit: "",
    min: 0,
    max: 1,
    step: 0.01,
    desc: "mock 시뮬레이션에는 확률 개념이 없어 표시 전용 — 실백엔드 detector.threshold와 동일한 스케일(0~1)",
  },
  {
    key: "cooldown_s",
    label: "재감지 lockout 대기시간",
    unit: "sec",
    min: 0,
    max: 30,
    step: 0.5,
    desc: "낙상 확정 후 재감지를 막는 lockout 시간",
  },
  {
    key: "presence_timeout_s",
    label: "퇴실 판단 대기 시간",
    unit: "sec",
    min: 1,
    max: 60,
    step: 1,
    desc: "MV/WANDER 신호가 이 시간 이상 없으면 퇴실로 판단",
  },
];

interface RealDraft {
  presence_mv_threshold: number;
  wander_ratio_threshold: number;
  threshold: number;
  cooldown_seconds: number;
  presence_timeout_s: number;
}

const REAL_FIELDS: FieldMeta<keyof RealDraft>[] = [
  {
    key: "presence_mv_threshold",
    label: "움직임 감지 임계값",
    unit: "",
    min: 0.1,
    max: 10,
    step: 0.05,
    desc: "presence_loop가 0.25초마다 다시 읽음 — Apply 즉시 반영",
  },
  {
    key: "wander_ratio_threshold",
    label: "WANDER 감지 임계값",
    unit: "×",
    min: 1.0,
    max: 5,
    step: 0.1,
    desc: "wander_current/baseline 비율이 이 배수를 넘으면 WANDER 판정",
  },
  {
    key: "threshold",
    label: "낙상 신뢰도 임계값",
    unit: "",
    min: 0,
    max: 1,
    step: 0.01,
    desc: "DL 모델 softmax 확률 임계값 — 낙상 탐지 모델 비활성 시 적용되지 않습니다",
  },
  {
    key: "cooldown_seconds",
    label: "재감지 lockout 대기시간",
    unit: "sec",
    min: 0,
    max: 60,
    step: 0.5,
    desc: "낙상 확정 후 재감지를 막는 lockout 시간 — 낙상 탐지 모델 비활성 시 적용되지 않습니다",
  },
  {
    key: "presence_timeout_s",
    label: "퇴실 판단 대기 시간",
    unit: "sec",
    min: 1,
    max: 60,
    step: 1,
    desc: "활동 없음이 이 시간 이상 지속되면 퇴실 판정",
  },
];

function ConfigPage() {
  const user = useCurrentUser();
  const isFacility = user?.service === "FACILITY";
  const backendUp = useBackendUp();
  const useReal = !isFacility && backendUp === true;
  // "서비스 관리자" = HOME 사용자 본인 또는 FACILITY ROOT
  const isServiceAdmin = !user || user.service === "HOME" || user.role === "ROOT";

  return (
    <div>
      <Header title="탐지 알고리즘 설정 · Pipeline Config" />
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

        {useReal ? (
          <RealConfigForm isServiceAdmin={isServiceAdmin} />
        ) : (
          <MockConfigForm isServiceAdmin={isServiceAdmin} />
        )}

        <section className="bg-surface border border-border rounded-lg p-4">
          <SectionTitle>Config Sync</SectionTitle>
          <p className="text-xs text-muted font-mono">
            {useReal
              ? "GET/POST /presence/config · GET/POST /detection/config — 백엔드에 곧바로 반영, 인메모리 전용(재시작 시 초기화)"
              : "이 화면의 값은 mock 시뮬레이션(PipelineConfig)에만 적용됩니다. HOME 실장치 연동 시에는 이 페이지가 실백엔드의 /presence/config · /detection/config를 직접 호출합니다."}
          </p>
        </section>
      </div>
    </div>
  );
}

function MockConfigForm({ isServiceAdmin }: { isServiceAdmin: boolean }) {
  const config = useStore((s) => s.config);
  const [draft, setDraft] = useState<PipelineConfig>(config);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

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
    <>
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight mb-1">Pipeline Configuration</h1>
          <p className="text-sm text-muted">
            mock 시뮬레이션(PipelineConfig)에 적용됩니다 — 다음 tick부터 즉시 반영.
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
        <SectionTitle>탐지 알고리즘 파라미터</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {MOCK_FIELDS.map((f) => (
            <ParamRow
              key={f.key}
              field={f}
              value={draft[f.key]}
              onChange={(v) => setDraft({ ...draft, [f.key]: v })}
            />
          ))}
        </div>
      </section>

      {confirmOpen && (
        <ConfirmModal
          isServiceAdmin={isServiceAdmin}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={confirmApply}
        />
      )}
    </>
  );
}

function RealConfigForm({ isServiceAdmin }: { isServiceAdmin: boolean }) {
  const [presence, setPresence] = useState<PresenceConfigSnapshot | null>(null);
  const [detection, setDetection] = useState<DetectionConfigSnapshot | null>(null);
  const [draft, setDraft] = useState<RealDraft | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchPresenceConfig(), fetchDetectionConfig()])
      .then(([p, d]) => {
        if (cancelled) return;
        setPresence(p);
        setDetection(d);
        setDraft({
          presence_mv_threshold: p.presence_mv_threshold,
          wander_ratio_threshold: p.wander_ratio_threshold,
          threshold: d.threshold ?? 0.468,
          cooldown_seconds: d.cooldown_seconds ?? 10,
          presence_timeout_s: p.presence_timeout_s,
        });
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return (
      <div className="bg-surface border border-primary/40 rounded p-4 text-sm text-primary">
        백엔드에서 현재 설정을 불러오지 못했습니다: {loadError}
      </div>
    );
  }
  if (!draft || !presence || !detection) {
    return <div className="text-sm text-muted">백엔드에서 현재 설정을 불러오는 중…</div>;
  }

  const detectionEnabled = detection.enabled;
  const serverValues: RealDraft = {
    presence_mv_threshold: presence.presence_mv_threshold,
    wander_ratio_threshold: presence.wander_ratio_threshold,
    threshold: detection.threshold ?? 0.468,
    cooldown_seconds: detection.cooldown_seconds ?? 10,
    presence_timeout_s: presence.presence_timeout_s,
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(serverValues);

  const requestApply = () => setConfirmOpen(true);
  const confirmApply = async () => {
    setConfirmOpen(false);
    try {
      const newPresence = await updatePresenceConfig({
        presence_mv_threshold: draft.presence_mv_threshold,
        wander_ratio_threshold: draft.wander_ratio_threshold,
        presence_timeout_s: draft.presence_timeout_s,
      });
      setPresence(newPresence);
      if (detectionEnabled) {
        const newDetection = await updateDetectionConfig({
          threshold: draft.threshold,
          cooldown_seconds: draft.cooldown_seconds,
        });
        setDetection(newDetection);
      }
      toast.success("설정이 적용되었습니다", {
        description: "백엔드에 곧바로 반영됩니다 (재시작 시 초기화).",
      });
    } catch (e) {
      toast.error(`적용 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const reset = () => {
    setDraft(serverValues);
    toast("현재 백엔드 값으로 되돌렸습니다");
  };

  return (
    <>
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight mb-1">Pipeline Configuration</h1>
          <p className="text-sm text-muted">
            실백엔드(로컬 backend/main.py)에 곧바로 반영됩니다 — 재시작 없이, 단 인메모리 전용(재시작 시
            초기화).
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={reset}
            className="px-4 py-2 border border-border rounded text-xs font-mono uppercase text-muted hover:text-foreground"
          >
            Reset
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

      {!detectionEnabled && (
        <div className="bg-warning/10 border border-warning/40 rounded p-3 text-xs text-warning">
          낙상 탐지 모델이 비활성 상태입니다(--no-model 또는 로드 실패) — 낙상 신뢰도 임계값/재감지
          lockout 대기시간은 지금 적용되지 않습니다.
        </div>
      )}

      <section>
        <SectionTitle>탐지 알고리즘 파라미터</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {REAL_FIELDS.map((f) => (
            <ParamRow
              key={f.key}
              field={f}
              value={draft[f.key]}
              onChange={(v) => setDraft({ ...draft, [f.key]: v })}
              disabled={!detectionEnabled && (f.key === "threshold" || f.key === "cooldown_seconds")}
            />
          ))}
        </div>
      </section>

      {confirmOpen && (
        <ConfirmModal
          isServiceAdmin={isServiceAdmin}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void confirmApply()}
        />
      )}
    </>
  );
}

function ConfirmModal({
  isServiceAdmin,
  onCancel,
  onConfirm,
}: {
  isServiceAdmin: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onCancel}
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
          <span className="text-foreground font-semibold">즉시 반영</span>되며, 낙상 탐지의{" "}
          <span className="text-primary font-semibold">오탐/미탐률에 직접적인 영향</span>을 줍니다.
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
            onClick={onCancel}
            className="px-4 py-2 border border-border rounded text-xs font-mono uppercase text-foreground/70 hover:text-foreground hover:bg-surface"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-primary text-primary-foreground rounded text-xs font-mono uppercase font-bold hover:bg-primary/90"
          >
            적용
          </button>
        </div>
      </div>
    </div>
  );
}

function ParamRow<K extends string>({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FieldMeta<K>;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`bg-surface border rounded p-4 border-border ${disabled ? "opacity-50" : ""}`}>
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="text-sm font-medium">{field.label}</div>
          <div className="text-[10px] text-muted mt-0.5">{field.desc}</div>
        </div>
        <div className="text-right">
          <input
            type="number"
            value={value}
            step={field.step}
            min={field.min}
            max={field.max}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-20 bg-background border border-border rounded px-2 py-1 text-xs font-mono text-right focus:outline-none focus:border-muted disabled:opacity-50"
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
        disabled={disabled}
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
