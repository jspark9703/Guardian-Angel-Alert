# CSI-Guard 로컬 백엔드

수신기(csi_recv) 시리얼 스트림을 받아 실시간 CSI 데이터를 제공하는 FastAPI 서버.
전 과정이 로컬(127.0.0.1)에서 동작한다. 작업 명세는 dcos/작업명세_로컬_실시간_낙상감지_v1.0.md 참조.

## 설치와 실행

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python main.py
```

수신기 포트는 자동 탐지된다(cu.usbmodem 첫 번째). 포트가 여러 개면 다음처럼 지정한다.

```bash
.venv/bin/python main.py --port /dev/cu.usbmodem5B7B0323351
```

## 엔드포인트

| 경로 | 내용 |
|---|---|
| GET /monitor/status | 시리얼 연결 상태, 수신률(Hz), 체크섬 오류, 버퍼 상태 |
| GET /monitor/window?seconds=3 | 최근 N초 윈도우 요약 (프레임 수, 진폭 통계) |
| WS /ws/live | 10Hz 실시간 요약 푸시 (수신률, RSSI, 진폭 평균/표준편차) |

## 구조

```
backend/
  main.py               FastAPI 앱, 엔드포인트
  csi/protocol.py       바이너리 프레임 파서 (매직 0xA55A, 체크섬, 재동기화)
  csi/serial_reader.py  포트 탐지, 921600 연결, 자동 재연결 스레드
  csi/buffer.py         링버퍼 (30초), 타임스탬프 unwrap, 수신 품질 지표
```

프레임 프로토콜 정의의 원본은 esp32c5/csi_recv/main/app_main.c 이다.
프로토콜이 바뀌면 csi/protocol.py 의 HEADER_FMT 를 함께 갱신해야 한다.
