# CSI-Guard 로컬 백엔드

수신기(csi_recv) 시리얼 스트림을 받아 실시간 CSI 데이터와 낙상 판정을 제공하는 FastAPI 서버.
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

모델 추론 관련 옵션:

```bash
.venv/bin/python main.py --no-model            # 추론 없이 수신/스트림만
.venv/bin/python main.py --device cpu          # 기본 auto (macOS는 MPS 우선)
.venv/bin/python main.py --threshold 0.468     # 낙상 판정 임계값
.venv/bin/python main.py --checkpoint path/to/best_model.pt
```

체크포인트 기본 경로는 저장소 루트의 Window3BestModelInference/weights/best_model.pt 이다.

## 엔드포인트

| 경로 | 내용 |
|---|---|
| GET /monitor/status | 시리얼 연결 상태, 수신률(Hz), 체크섬 오류, 버퍼, 낙상 판정 상태 |
| GET /monitor/window?seconds=3 | 최근 N초 윈도우 요약 (프레임 수, 진폭 통계) |
| GET /monitor/detect | 낙상 판정 상세 + 최근 60초 확률 히스토리 |
| WS /ws/live | 10Hz 실시간 요약 푸시 (수신률, RSSI, 진폭, 낙상 확률/상태) |

## 낙상 탐지 파이프라인 (0.25초 주기)

```
링버퍼 3초 윈도우 -> 균일 그리드 리샘플 (native Hz)
  -> 서브캐리어 30개 선택 -> PCA motion signal
  -> S3 scalogram (224,224) + PCA-ACF (1,128,64)
  -> DualBranchResNet 추론 (best_model.pt)
  -> 임계값 0.468 + 인과 다수결(최근 5윈도우) -> IDLE/SUSPECT/FALL/COOLDOWN
```

- 피처 코드는 ACF_Scalogram_FeatureExtraction(연구단 제공, gitignore)에서 이식했고,
  합성 입력에 대해 원본과 비트 단위 동일 출력을 확인했다.
- 검증에 쓰인 mode5는 중심 윈도우 기준(미래 2윈도우 필요)이라 실시간에서는
  인과 다수결로 대체했다. 연구단 권장안 확인 후 조정 여지 있음 (detector.py 참조).
- CWT scale 계산(freq_to_scale, 호출당 약 0.5초)은 fs와 윈도우 길이에 결정적이라
  캐시한다. 측정 fs를 0.25Hz 격자로 양자화해 캐시가 적중하게 한다.
- 실측 지연: 피처 약 27ms + 추론(MPS) 약 15ms = 윈도우당 약 42ms (스트라이드 250ms 이내).

벤치마크:

```bash
.venv/bin/python bench_pipeline.py --fs 166.67
```

## 구조

```
backend/
  main.py               FastAPI 앱, 엔드포인트, 탐지 루프 기동
  detector.py           0.25초 주기 추론 루프, 상태머신, 인과 다수결
  csi/protocol.py       바이너리 프레임 파서 (매직 0xA55A, 체크섬, 재동기화)
  csi/serial_reader.py  포트 탐지, 921600 연결, 자동 재연결 스레드
  csi/buffer.py         링버퍼 (30초), 타임스탬프 unwrap, 수신 품질 지표
  features/common.py    S3 scalogram 코어 (원본 amfall_losnlos_common.py 이식)
  features/acf.py       PCA-ACF 계산 (원본 build_losnlos_pca_motion_acf_dataset.py 이식)
  features/realtime.py  실시간 윈도우 -> 모델 입력 피처 래퍼
  inference/model.py    DualBranchResNet 정의 (체크포인트와 1:1, 구조 변경 금지)
  inference/engine.py   체크포인트 로드, 정규화, 단일 윈도우 추론
  bench_pipeline.py     파이프라인 지연 벤치마크
```

프레임 프로토콜 정의의 원본은 esp32c5/csi_recv/main/app_main.c 이다.
프로토콜이 바뀌면 csi/protocol.py 의 HEADER_FMT 를 함께 갱신해야 한다.
피처 파라미터(FeatureConfig)는 학습 설정과 일치해야 하며, 근거는
ACF_Scalogram_FeatureExtraction/README_KO.md 의 모델 호환 설정 표이다.
