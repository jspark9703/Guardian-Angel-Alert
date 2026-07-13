"""0.25초 주기 실시간 낙상 탐지 루프.

링버퍼에서 3초 윈도우를 꺼내 피처 추출 + 모델 추론을 수행하고,
임계값 + 인과 다수결(최근 5윈도우) 후처리로 상태를 판정한다.

후처리 주의: 검증에 쓴 mode5는 중심 윈도우 기준(미래 2윈도우 필요)이라
실시간에서는 확정에 0.5초가 추가된다. 여기서는 최근 5개 raw 판정의
다수결(인과)을 쓴다. 의미는 근사이며 연구단 권장안 확인 후 조정한다.

상태 매핑 (대시보드 도메인 용어와 동일):
  IDLE(대기)      다수결 음성, raw도 음성
  SUSPECT(의심)   raw 양성이지만 다수결 미확정
  FALL(낙상)      다수결 양성 -> 낙상 이벤트 확정
  COOLDOWN(냉각중) FALL 종료 후 cooldown_seconds 동안 재알람 억제

같은 틱에서 낙상 DL 추론과 병렬로 움직임(MV)/재실(Presence) 감지도 계산한다
(_update_presence) — DL 모델의 입력/출력과는 완전히 무관한 별도 계산 경로이며,
그 결과가 재실 상태(presence_state)로 귀결된다. migration.md/
occupation_pipline.md 참고.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from typing import Any, Callable

from csi.buffer import RingBuffer
from features import FeatureConfig, extract_window_features
from inference import FallInferenceEngine
from presence import PresenceConfig, PresenceDetector, PresenceStatus, compute_final_signal

log = logging.getLogger("detector")

STRIDE_SEC = 0.25
DEFAULT_THRESHOLD = 0.468
MODE_SIZE = 5
COOLDOWN_SECONDS = 10.0
HISTORY_MAXLEN = 240  # 최근 60초 (0.25s x 240)


class FallDetector(threading.Thread):
    def __init__(
        self,
        ring: RingBuffer,
        engine: FallInferenceEngine,
        threshold: float = DEFAULT_THRESHOLD,
        stride_sec: float = STRIDE_SEC,
        cooldown_seconds: float = COOLDOWN_SECONDS,
        feature_config: FeatureConfig | None = None,
        presence_config: PresenceConfig | None = None,
        on_fall: Callable[[int, float | None, float], None] | None = None,
    ) -> None:
        super().__init__(daemon=True, name="fall-detector")
        self.ring = ring
        self.engine = engine
        self.threshold = threshold
        self.stride_sec = stride_sec
        self.cooldown_seconds = cooldown_seconds
        self.feature_config = feature_config or FeatureConfig()
        # FALL 확정 시 (fall_count, proba, 시각) 콜백. 블로킹 금지 (큐 적재 수준만 허용)
        self.on_fall = on_fall

        # 재실 감지(MV+Wander) — DL 낙상 추론과 무관한 병렬 계산. presence_config는
        # 온보딩 캘리브레이션(onboarding.run_calibration)이 런타임에 presence_mv_threshold/
        # wander_baseline을 갱신하는 바로 그 인스턴스를 공유한다.
        self.presence_config = presence_config or PresenceConfig()
        self.presence_detector = PresenceDetector(
            mv_threshold=self.presence_config.presence_mv_threshold,
            wander_baseline=self.presence_config.wander_baseline,
            wander_ratio_threshold=self.presence_config.wander_ratio_threshold,
            wander_min_duration_s=self.presence_config.wander_min_duration_s,
            presence_timeout_s=self.presence_config.presence_timeout_s,
        )

        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._recent_preds: deque[int] = deque(maxlen=MODE_SIZE)
        self._history: deque[dict[str, Any]] = deque(maxlen=HISTORY_MAXLEN)
        self._state = "IDLE"
        self._cooldown_until = 0.0
        self._fall_count = 0
        self._last_fall_time: float | None = None
        self._last_result: dict[str, Any] | None = None
        self._last_presence: PresenceStatus | None = None
        self._last_error: str | None = None
        self._inference_count = 0
        self._skip_count = 0
        self._latency_ema_ms: float | None = None

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        log.info(
            "detector start: device=%s threshold=%.3f stride=%.2fs mode=causal%d",
            self.engine.device, self.threshold, self.stride_sec, MODE_SIZE,
        )
        next_tick = time.monotonic()
        while not self._stop.is_set():
            now = time.monotonic()
            if now < next_tick:
                time.sleep(min(next_tick - now, 0.05))
                continue
            next_tick = max(next_tick + self.stride_sec, now)
            try:
                self._tick()
            except Exception:
                log.exception("detector tick failed")

    def _tick(self) -> None:
        started = time.monotonic()
        times, amps = self.ring.window(self.feature_config.window_seconds + 0.5)
        if times.size == 0:
            self._record_skip("no data")
            return
        try:
            features = extract_window_features(times, amps, self.feature_config)
        except ValueError as error:
            self._record_skip(str(error))
            return
        feature_ms = (time.monotonic() - started) * 1000.0

        infer_started = time.monotonic()
        proba = self.engine.predict(features.s3, features.acf)
        infer_ms = (time.monotonic() - infer_started) * 1000.0

        presence_status = self._update_presence()

        total_ms = (time.monotonic() - started) * 1000.0

        raw_pred = int(proba >= self.threshold)
        with self._lock:
            self._recent_preds.append(raw_pred)
            majority = (
                int(sum(self._recent_preds) * 2 > len(self._recent_preds))
                if len(self._recent_preds) == MODE_SIZE
                else 0
            )
            self._advance_state(raw_pred, majority, proba)
            self._inference_count += 1
            self._last_error = None
            self._latency_ema_ms = (
                total_ms
                if self._latency_ema_ms is None
                else 0.9 * self._latency_ema_ms + 0.1 * total_ms
            )
            if presence_status is not None:
                self._last_presence = presence_status
            result = {
                "t": time.time(),
                "proba_fall": round(proba, 4),
                "raw_pred": raw_pred,
                "majority_pred": majority,
                "state": self._state,
                "fs_hz": round(features.fs_hz, 2),
                "window_samples": features.window_samples,
                "feature_ms": round(feature_ms, 1),
                "infer_ms": round(infer_ms, 1),
                "total_ms": round(total_ms, 1),
            }
            self._last_result = result
            self._history.append(
                {"t": result["t"], "proba_fall": result["proba_fall"], "state": self._state}
            )
        if total_ms > self.stride_sec * 1000.0:
            log.warning("tick %.0fms exceeds stride %.0fms", total_ms, self.stride_sec * 1000.0)

    def _update_presence(self) -> PresenceStatus | None:
        """움직임(MV)/Wander 신호를 낙상 DL 추론과 병렬로 계산해 재실 상태를 갱신한다.

        같은 CSI 스트림을 입력으로 쓰지만 DL 모델의 피처(S3/PCA-ACF)와는 완전히
        독립된 계산이다 — 여기서 데이터를 얻지 못하거나 계산이 실패해도 낙상
        판정에는 영향을 주지 않는다(None 반환, 이전 값 유지).
        """
        cfg = self.presence_config
        # 캘리브레이션(onboarding.run_calibration)이 갱신했을 수 있는 값을 매 틱 반영
        self.presence_detector.set_thresholds(
            cfg.presence_mv_threshold,
            cfg.wander_baseline,
            cfg.wander_ratio_threshold,
            cfg.wander_min_duration_s,
        )
        self.presence_detector.presence_timeout_s = cfg.presence_timeout_s

        mv_window = self.ring.get_window(cfg.window_sec)
        if mv_window is None:
            return None
        mv_times_s, mv_amp = mv_window
        mv_result = compute_final_signal(
            mv_times_s * 1e6,
            mv_amp,
            window_sec=cfg.window_sec,
            stride_sec=cfg.stride_sec,
            fs_hz=cfg.fs_hz,
            omega=cfg.omega,
            n_streams=cfg.n_streams,
            bandpass_low=cfg.bandpass_low,
            bandpass_high=cfg.bandpass_high,
            bandpass_order=cfg.bandpass_order,
        )
        if mv_result is None:
            return None

        wander_current = 0.0
        wander_window = self.ring.get_window(cfg.wander_window_sec)
        if wander_window is not None:
            w_times_s, w_amp = wander_window
            wander_result = compute_final_signal(
                w_times_s * 1e6,
                w_amp,
                window_sec=cfg.wander_window_sec,
                stride_sec=cfg.stride_sec,
                fs_hz=cfg.fs_hz,
                omega=cfg.wander_omega,
                n_streams=cfg.n_streams,
                bandpass_low=cfg.wander_prefilter_low,
                bandpass_high=cfg.wander_prefilter_high,
                bandpass_order=cfg.bandpass_order,
                compute_band_energy=True,
                energy_band_low=cfg.wander_bandpass_low,
                energy_band_high=cfg.wander_bandpass_high,
            )
            if wander_result is not None and wander_result.band_energy is not None:
                wander_current = wander_result.band_energy

        return self.presence_detector.update(time.time(), mv_result.mv_current, wander_current)

    def _advance_state(self, raw_pred: int, majority: int, proba: float | None = None) -> None:
        now = time.monotonic()
        if self._state == "COOLDOWN":
            if now >= self._cooldown_until:
                self._state = "FALL" if majority else "SUSPECT" if raw_pred else "IDLE"
            return
        if majority:
            if self._state != "FALL":
                self._fall_count += 1
                self._last_fall_time = time.time()
                log.warning("FALL confirmed (#%d)", self._fall_count)
                self._emit_fall(proba)
            self._state = "FALL"
            return
        if self._state == "FALL":
            # 낙상 종료: 재알람 억제 냉각 구간으로
            self._state = "COOLDOWN"
            self._cooldown_until = now + self.cooldown_seconds
            return
        self._state = "SUSPECT" if raw_pred else "IDLE"

    def _emit_fall(self, proba: float | None) -> None:
        """FALL 확정 시점 콜백 호출. 콜백 오류가 탐지 루프를 깨지 않게 격리한다."""
        if self.on_fall is None:
            return
        try:
            self.on_fall(self._fall_count, proba, self._last_fall_time or time.time())
        except Exception:
            log.exception("on_fall 콜백 실패")

    def _record_skip(self, reason: str) -> None:
        with self._lock:
            self._skip_count += 1
            self._last_error = reason

    def _presence_payload(self) -> dict[str, Any]:
        """`_lock` 보유 상태에서 호출. reference/fall_detect/API.md의 DetectionInfo와
        동일한 필드명을 써서 프론트 포팅 시 혼동을 줄인다. 아직 한 번도 계산되지
        않았으면(_last_presence is None) 전부 None으로 채운다."""
        p = self._last_presence
        cfg = self.presence_config
        if p is None:
            return {
                "presence_state": None,
                "mv_current": None,
                "presence_mv_threshold": cfg.presence_mv_threshold,
                "wander_current": None,
                "wander_baseline": cfg.wander_baseline,
                "wander_ratio_threshold": cfg.wander_ratio_threshold,
                "wander_ratio": None,
                "wander_confirmed": None,
                "last_activity_at": None,
                "presence_just_changed": None,
            }
        return {
            "presence_state": p.state.value,
            "mv_current": p.mv_current,
            "presence_mv_threshold": p.mv_threshold,
            "wander_current": p.wander_current,
            "wander_baseline": p.wander_baseline,
            "wander_ratio_threshold": p.wander_ratio_threshold,
            "wander_ratio": p.wander_ratio,
            "wander_confirmed": p.wander_confirmed,
            "last_activity_at": p.last_activity_at,
            "presence_just_changed": p.just_changed,
        }

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {
                "enabled": True,
                "device": str(self.engine.device),
                "checkpoint_epoch": self.engine.epoch,
                "threshold": self.threshold,
                "postprocess": f"causal_mode{MODE_SIZE}",
                "state": self._state,
                "fall_count": self._fall_count,
                "last_fall_time": self._last_fall_time,
                "inference_count": self._inference_count,
                "skip_count": self._skip_count,
                "latency_ema_ms": round(self._latency_ema_ms, 1) if self._latency_ema_ms else None,
                "last_error": self._last_error,
                "last": self._last_result,
                **self._presence_payload(),
            }

    def live_payload(self) -> dict[str, Any]:
        """/ws/live에 합쳐 보낼 최소 필드."""
        with self._lock:
            last = self._last_result
            return {
                "detect_state": self._state,
                "proba_fall": last["proba_fall"] if last else None,
                "threshold": self.threshold,
                "fall_count": self._fall_count,
                "last_fall_time": self._last_fall_time,
                **self._presence_payload(),
            }

    def history(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._history)
