"""수신기(csi_recv) 시리얼 연결 관리.

- 포트 자동 탐지 (macOS cu.usbmodem*, 알려진 수신기 시리얼 우선)
- 921600 baud 연결, 끊김 감지, 1초 간격 자동 재연결
- 읽은 바이트를 FrameParser 에 넣고, 송신기 MAC 프레임만 RingBuffer 에 적재
"""

from __future__ import annotations

import glob
import threading
import time

import serial

from .buffer import RingBuffer
from .protocol import FrameParser

DEFAULT_BAUD = 921600
CSI_SEND_MAC = "1a:00:00:00:00:00"  # csi_send 의 스푸핑 MAC (수신기도 필터하지만 이중 방어)
PORT_PATTERN = "/dev/cu.usbmodem*"


def discover_port(preferred_serial: str | None = None) -> str | None:
    ports = sorted(glob.glob(PORT_PATTERN))
    if not ports:
        return None
    if preferred_serial:
        for p in ports:
            if preferred_serial in p:
                return p
    return ports[0]


class SerialReader(threading.Thread):
    def __init__(
        self,
        buffer: RingBuffer,
        port: str | None = None,
        baud: int = DEFAULT_BAUD,
        preferred_serial: str | None = None,
    ) -> None:
        super().__init__(daemon=True, name="csi-serial-reader")
        self.buffer = buffer
        self.fixed_port = port
        self.baud = baud
        self.preferred_serial = preferred_serial
        self.parser = FrameParser()
        self.connected = False
        self.port: str | None = None
        self.reconnects = 0
        self.mac_filtered = 0
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def status(self) -> dict:
        return {
            "connected": self.connected,
            "port": self.port,
            "baud": self.baud,
            "reconnects": self.reconnects,
            "frames_ok": self.parser.frames_ok,
            "checksum_errors": self.parser.checksum_errors,
            "resyncs": self.parser.resyncs,
            "mac_filtered": self.mac_filtered,
        }

    def run(self) -> None:
        while not self._stop.is_set():
            port = self.fixed_port or discover_port(self.preferred_serial)
            if port is None:
                self.connected = False
                self.port = None
                time.sleep(1.0)
                continue
            try:
                with serial.Serial(port, self.baud, timeout=0.5) as ser:
                    ser.reset_input_buffer()
                    self.port = port
                    self.connected = True
                    while not self._stop.is_set():
                        data = ser.read(8192)
                        if not data:
                            continue
                        for frame in self.parser.feed(data):
                            if frame.mac != CSI_SEND_MAC:
                                self.mac_filtered += 1
                                continue
                            self.buffer.append(frame)
            except (serial.SerialException, OSError):
                pass
            if self.connected:
                self.reconnects += 1
            self.connected = False
            self.port = None
            time.sleep(1.0)
