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
        self._ser: serial.Serial | None = None
        self._ser_lock = threading.Lock()

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

    # --- 온보딩 캘리브레이션(onboarding.run_calibration) 덕타이핑 계약 ---
    # migration.md §5: run_calibration()은 monitor가 .running/.packet_count/
    # .send_line()/.get_window() 4개만 제공하면 동작한다.

    @property
    def running(self) -> bool:
        """`.connected`의 별칭 — run_calibration()이 기대하는 속성 이름."""
        return self.connected

    @property
    def packet_count(self) -> int:
        """MAC 필터 이전, 파싱에 성공한 전체 CSI 프레임 수.

        캘리브레이션의 무음(silence) 감지는 "펌웨어가 뭔가 보내고 있는가"를 봐야
        하므로 송신기 MAC으로 걸러지기 전 값(parser.frames_ok)이 맞다 — 링버퍼에
        실제로 쌓인 프레임 수(mac 필터 이후)를 쓰면 안 된다.
        """
        return self.parser.frames_ok

    def send_line(self, text: str) -> bool:
        """열린 시리얼 포트로 명령 문자열을 전송(줄바꿈 추가). 연결 없으면 False.

        온보딩 캘리브레이션이 `"train"` 명령을 보낼 때 쓴다 — 명령을 그대로
        전달할 뿐이며, 그 명령을 해석하는 것은 csi_recv_calibrate 펌웨어다(백엔드는
        프로토콜을 새로 정의하지 않는다). run() 스레드가 아닌 다른 스레드/코루틴에서
        호출되므로 `_ser_lock`으로 보호한다.
        """
        with self._ser_lock:
            ser = self._ser
            if ser is None:
                return False
            try:
                ser.write((text + "\n").encode("ascii"))
                return True
            except (serial.SerialException, OSError):
                return False

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
                    with self._ser_lock:
                        self._ser = ser
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
            with self._ser_lock:
                self._ser = None
            if self.connected:
                self.reconnects += 1
            self.connected = False
            self.port = None
            time.sleep(1.0)
