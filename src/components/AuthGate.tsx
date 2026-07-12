import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useStore, hydrateSession, useCurrentUser } from "@/lib/mock-store";
import { AppSidebar } from "@/components/AppSidebar";
import { FallAlarmModal } from "@/components/FallAlarmModal";

const PUBLIC_PATHS = ["/login", "/signup"];

export function AuthGate({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { hydrateSession(); setHydrated(true); }, []);

  const session = useStore((s) => s.session);
  const user = useCurrentUser();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();

  useEffect(() => {
    if (!hydrated) return;
    const isPublic = PUBLIC_PATHS.includes(pathname);
    if (!session && !isPublic) {
      navigate({ to: "/login" });
    } else if (session && user && !user.onboarded && pathname !== "/onboarding") {
      navigate({ to: "/onboarding" });
    } else if (session && user?.onboarded && (isPublic || pathname === "/onboarding")) {
      navigate({ to: "/" });
    }
  }, [hydrated, session, user, pathname, navigate]);

  if (!hydrated) {
    return <div className="min-h-screen flex items-center justify-center text-muted font-mono text-xs">Loading…</div>;
  }

  const isPublic = PUBLIC_PATHS.includes(pathname);
  const isOnboarding = pathname === "/onboarding";

  // Public / onboarding: render without shell
  if (isPublic || isOnboarding || !session || !user?.onboarded) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
      <FallAlarmModal />
    </div>
  );
}
