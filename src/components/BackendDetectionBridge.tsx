// 로컬 백엔드(/ws/live)의 낙상 판정을 mock-store에 흘려보내는 전역 브리지.
// HOME 계정의 실장치 1대에 한해 동작하며, AuthGate(인증된 쉘)에서 항상 렌더되어
// 어느 페이지에 있어도 FALL 판정 시 알람 모달과 이벤트 로그가 동작한다.

import { useEffect, useRef } from "react";
import { useLiveStream } from "@/lib/backend";
import { applyBackendDetection, useCurrentUser } from "@/lib/mock-store";

export function BackendDetectionBridge() {
  const user = useCurrentUser();
  if (user?.service !== "HOME") return null;
  return <HomeBridge />;
}

function HomeBridge() {
  const live = useLiveStream(2);
  // 마운트 직후 WS가 붙기 전에 "연결 끊김"으로 오판하지 않도록 잠깐 유예
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    const sample = live.last;
    const connected = live.wsUp && (sample?.connected ?? false);
    if (!connected && Date.now() - mountedAt.current < 3000) return;
    applyBackendDetection({
      connected,
      state: sample?.detect_state,
      proba: sample?.proba_fall,
    });
  }, [live.wsUp, live.last]);

  return null;
}
