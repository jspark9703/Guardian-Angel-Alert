"""CSI-Guard 로컬 백엔드 (단계 1, 2: 시리얼 통신 + 실시간 스트림).

실행:
    python main.py                      # 포트 자동 탐지, http 127.0.0.1:8000
    python main.py --port /dev/cu.usbmodemXXXX --http-port 8000
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import time

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from csi.buffer import RingBuffer
from csi.serial_reader import SerialReader

WS_PUSH_HZ = 10

ring = RingBuffer(max_seconds=30.0, nominal_hz=200.0)
reader: SerialReader | None = None

app = FastAPI(title="CSI-Guard Local Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://127.0.0.1:8080"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root() -> dict:
    return {"service": "csi-guard-backend", "stage": "1-2 serial + stream"}


@app.get("/ports")
def list_ports() -> dict:
    """연결 가능한 시리얼 포트 목록 (장치 설정 화면의 포트 선택용)."""
    from serial.tools import list_ports as lp

    ports = []
    for p in lp.comports():
        name = f"{p.device} {p.description or ''}"
        if "Bluetooth" in name or "debug" in name:
            continue
        ports.append(
            {
                "device": p.device,
                "description": p.description,
                "serial_number": p.serial_number,
                "active": reader is not None and reader.port == p.device,
            }
        )
    return {"ports": ports}


@app.get("/monitor/status")
def monitor_status() -> dict:
    return {
        "serial": reader.status() if reader else None,
        "buffer": ring.stats(),
        "server_time": time.time(),
    }


@app.get("/monitor/window")
def monitor_window(seconds: float = 3.0) -> dict:
    times, amps = ring.window(seconds)
    if times.size == 0:
        return {"frames": 0, "seconds": seconds}
    return {
        "frames": int(times.shape[0]),
        "seconds": seconds,
        "span_sec": round(float(times[-1] - times[0]), 3),
        "subcarriers": int(amps.shape[1]),
        "amp_mean": round(float(amps.mean()), 3),
        "amp_std": round(float(amps.std()), 3),
    }


@app.websocket("/ws/live")
async def ws_live(ws: WebSocket) -> None:
    """대시보드용 실시간 요약 스트림 (10Hz).

    프레임 원본이 아니라 시각화에 필요한 요약(수신률, RSSI, 진폭 통계)만 보낸다.
    """
    await ws.accept()
    try:
        while True:
            stats = ring.stats()
            serial_status = reader.status() if reader else {}
            times, amps = ring.window(0.5)
            payload = {
                "t": time.time(),
                "connected": serial_status.get("connected", False),
                "hz_1s": stats["hz_1s"],
                "rssi": stats["last_rssi"],
                "buffered_seconds": stats["buffered_seconds"],
                "amp_mean": round(float(amps.mean()), 3) if times.size else None,
                "amp_std": round(float(amps.std()), 3) if times.size else None,
            }
            await ws.send_text(json.dumps(payload))
            await asyncio.sleep(1.0 / WS_PUSH_HZ)
    except WebSocketDisconnect:
        pass
    except Exception:
        with contextlib.suppress(Exception):
            await ws.close()


def main() -> None:
    global reader
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default=None, help="시리얼 포트 (기본: 자동 탐지)")
    ap.add_argument("--baud", type=int, default=921600)
    ap.add_argument("--preferred-serial", default=None, help="포트 여러 개일 때 우선할 시리얼 번호 조각")
    ap.add_argument("--http-host", default="127.0.0.1")
    ap.add_argument("--http-port", type=int, default=8000)
    args = ap.parse_args()

    reader = SerialReader(
        ring, port=args.port, baud=args.baud, preferred_serial=args.preferred_serial
    )
    reader.start()
    try:
        uvicorn.run(app, host=args.http_host, port=args.http_port, log_level="info")
    finally:
        reader.stop()


if __name__ == "__main__":
    main()
