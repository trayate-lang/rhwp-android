#!/usr/bin/env python3
"""휴대폰 주소·페어링 코드를 셸 기록이나 공개 로그에 남기지 않는 대화형 연결 도우미."""
from pathlib import Path
import getpass
import os
import re
import subprocess
import sys

sdk = Path(os.environ.get("ANDROID_HOME", str(Path.home() / "Library/Android/sdk")))
adb = str(sdk / "platform-tools/adb")
if "--connect" not in sys.argv:
    print("폰: 무선 디버깅 → 페어링 코드로 기기 페어링을 열어 주세요.")
    address = input("그 화면의 IP 주소 및 포트: ").strip()
    if not re.fullmatch(r"[0-9.]+:[0-9]{1,5}", address):
        raise SystemExit("예: 192.168.0.10:35000 형식으로 입력해 주세요.")
    code = getpass.getpass("6자리 Wi-Fi 페어링 코드 (화면에 표시되지 않음): ")
    if not re.fullmatch(r"\d{6}", code):
        raise SystemExit("6자리 숫자를 입력해 주세요.")
    result = subprocess.run([adb, "pair", address], input=code + "\n", text=True, capture_output=True, timeout=45)
    if "Successfully paired" not in result.stdout:
        raise SystemExit("페어링 실패: 두 기기의 Wi-Fi와 폰의 최신 코드를 확인하고 다시 실행해 주세요.")
    print("페어링 완료. 폰의 작은 코드 창을 닫고, 무선 디버깅 기본 화면을 확인하세요.")
else:
    print("기존 페어링을 유지한 채, 무선 디버깅 기본 화면의 최신 주소로 연결합니다.")
address = input("기본 화면의 IP 주소 및 포트 (위와 포트가 다릅니다): ").strip()
if not re.fullmatch(r"[0-9.]+:[0-9]{1,5}", address):
    raise SystemExit("주소 형식이 올바르지 않습니다.")
result = subprocess.run([adb, "connect", address], text=True, capture_output=True, timeout=30)
if "connected to" not in result.stdout:
    raise SystemExit("페어링은 완료됐지만 연결 실패. 무선 디버깅 기본 화면의 주소를 확인해 주세요.")
private = Path(__file__).resolve().parents[1] / ".local"
private.mkdir(mode=0o700, exist_ok=True)
target = private / "phone-target"
target.write_text(address + "\n")
target.chmod(0o600)
print("휴대폰 연결 완료. Codex에 '연결했어'라고 알려 주세요.")
