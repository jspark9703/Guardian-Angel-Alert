"""피처 추출 + 모델 추론 파이프라인 지연 벤치마크.

합성 CSI 윈도우로 윈도우 1개당 처리 시간을 측정한다.
목표: 스트라이드 250ms 이내 (작업명세 단계 3 완료 기준).

실행:
    .venv/bin/python bench_pipeline.py            # MPS(가능 시) + CPU 비교
    .venv/bin/python bench_pipeline.py --fs 91    # 수신률 지정
"""

from __future__ import annotations

import argparse
import time

import numpy as np

from features import FeatureConfig, extract_window_features
from inference import FallInferenceEngine


def synthetic_window(fs_hz: float, seconds: float, subcarriers: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    n = int(round(seconds * fs_hz))
    times = np.arange(n) / fs_hz + rng.normal(0, 0.0005, size=n)
    times = np.sort(times)
    t = np.arange(n) / fs_hz
    base = 20 + 5 * np.sin(2 * np.pi * 0.7 * t)[:, None]
    spike = 8 * np.exp(-((t - seconds / 2) ** 2) / 0.02)[:, None]
    amps = base + spike * rng.uniform(0.3, 1.0, size=(1, subcarriers)) + rng.normal(
        0, 1.5, size=(n, subcarriers)
    )
    return times.astype(np.float64), amps.astype(np.float32)


def bench(fs_hz: float, subcarriers: int, iterations: int, device: str) -> None:
    config = FeatureConfig()
    engine = FallInferenceEngine(device=device)
    engine.warmup()

    feature_ms: list[float] = []
    infer_ms: list[float] = []
    probas: list[float] = []
    for i in range(iterations):
        times, amps = synthetic_window(fs_hz, config.window_seconds + 0.3, subcarriers, seed=i)
        t0 = time.monotonic()
        features = extract_window_features(times, amps, config)
        t1 = time.monotonic()
        probas.append(engine.predict(features.s3, features.acf))
        t2 = time.monotonic()
        feature_ms.append((t1 - t0) * 1000.0)
        infer_ms.append((t2 - t1) * 1000.0)

    def pct(values: list[float], q: float) -> float:
        return float(np.percentile(values, q))

    total = [f + i for f, i in zip(feature_ms, infer_ms)]
    print(f"device={engine.device} fs={fs_hz}Hz subcarriers={subcarriers} n={iterations}")
    print(f"  feature ms: median {pct(feature_ms, 50):7.1f}  p90 {pct(feature_ms, 90):7.1f}  max {max(feature_ms):7.1f}")
    print(f"  infer   ms: median {pct(infer_ms, 50):7.1f}  p90 {pct(infer_ms, 90):7.1f}  max {max(infer_ms):7.1f}")
    print(f"  total   ms: median {pct(total, 50):7.1f}  p90 {pct(total, 90):7.1f}  max {max(total):7.1f}")
    print(f"  stride 250ms 이내: {'예' if pct(total, 90) < 250 else '아니오'} (p90 기준)")
    print(f"  proba_fall range: {min(probas):.4f} ~ {max(probas):.4f}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fs", type=float, default=91.0, help="합성 수신률 Hz (실측 약 91)")
    ap.add_argument("--subcarriers", type=int, default=245)
    ap.add_argument("--iterations", type=int, default=40)
    ap.add_argument("--device", default="auto", choices=("auto", "cuda", "mps", "cpu"))
    args = ap.parse_args()
    bench(args.fs, args.subcarriers, args.iterations, args.device)


if __name__ == "__main__":
    main()
