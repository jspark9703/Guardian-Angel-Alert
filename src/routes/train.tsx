import { createFileRoute } from "@tanstack/react-router";
import { Header } from "./index";

export const Route = createFileRoute("/train")({
  head: () => ({ meta: [{ title: "모델 학습 · CSI-Guard" }] }),
  component: TrainPage,
});

function TrainPage() {
  return (
    <div>
      <Header title="개인화 모델 학습" criticalCount={0} onlineCount={0} />
      <div className="p-6 max-w-4xl">
        <div className="bg-surface border border-dashed border-border rounded-lg p-12 text-center">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted mb-4">Coming Soon</div>
          <h1 className="text-2xl font-semibold tracking-tight mb-3">DNN 모델 학습 기능</h1>
          <p className="text-sm text-muted max-w-md mx-auto leading-relaxed">
            거주자별 CSI 패턴에 맞춘 개인화 DNN 모델 학습 기능은 추후 제공될 예정입니다. 현재 규칙 기반 상태머신이 활성화되어 있습니다.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-3 max-w-lg mx-auto text-left">
            <Placeholder label="Data Collection" />
            <Placeholder label="Model Training" />
            <Placeholder label="Deploy & Evaluate" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="border border-border rounded p-3 opacity-40">
      <div className="text-[10px] font-mono uppercase text-muted">{label}</div>
      <div className="text-[9px] font-mono text-muted mt-2">— stub —</div>
    </div>
  );
}
