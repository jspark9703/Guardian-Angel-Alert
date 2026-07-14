import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useStore, hydrateSession } from "@/lib/mock-store";
import { AppSidebar } from "@/components/AppSidebar";
import { FallAlarmModal } from "@/components/FallAlarmModal";
import { BackendDetectionBridge } from "@/components/BackendDetectionBridge";

const PUBLIC_PATHS = ["/login", "/signup"];

export function AuthGate({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    hydrateSession();
    setHydrated(true);
  }, []);

  const session = useStore((s) => s.session);
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();

  // 온보딩(초기설정)은 더 이상 로그인 직후 강제되지 않는다 — 로그인하면 항상
  // 대시보드로 가고, 재실 대상/장치 등록은 사이드바 Management의 "재실 대상
  // 관리"(/residents)·"장치 설정"(/devices)에서 사용자가 원할 때 직접 진행한다.
  // /onboarding 라우트 자체는 남겨두되(선택적으로 직접 방문 가능), 여기서 자동
  // 이동시키지 않는다.
  useEffect(() => {
    if (!hydrated) return;
    const isPublic = PUBLIC_PATHS.includes(pathname);
    if (!session && !isPublic) {
      navigate({ to: "/login" });
    } else if (session && isPublic) {
      navigate({ to: "/" });
    }
  }, [hydrated, session, pathname, navigate]);

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted font-mono text-xs">
        Loading…
      </div>
    );
  }

  const isPublic = PUBLIC_PATHS.includes(pathname);
  const isOnboarding = pathname === "/onboarding";

  // Public / onboarding: render without shell
  if (isPublic || isOnboarding || !session) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
      <FallAlarmModal />
      <BackendDetectionBridge />
    </div>
  );
}
