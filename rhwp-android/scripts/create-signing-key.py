#!/usr/bin/env python3
"""개인 설치용 키를 한 번만 만든다. 기존 키는 교체하지 않아 같은 앱의 업데이트를 유지한다."""
from pathlib import Path
import os
import secrets
import subprocess

root = Path(__file__).resolve().parents[1]
private = root / ".local"
private.mkdir(mode=0o700, exist_ok=True)
config = private / "signing.properties"
key = private / "rhwp-fold-personal.jks"
if config.exists() or key.exists():
    raise SystemExit("기존 서명 자료가 있습니다. 키를 새로 만들지 않았습니다.")
password = secrets.token_hex(32)
env = dict(os.environ, RHWP_KEY_PASSWORD=password)
java = Path(os.environ["JAVA_HOME"])
subprocess.run([str(java / "bin/keytool"), "-genkeypair", "-keystore", str(key),
                "-storetype", "JKS", "-storepass:env", "RHWP_KEY_PASSWORD",
                "-keypass:env", "RHWP_KEY_PASSWORD", "-alias", "rhwp-fold-personal",
                "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000",
                "-dname", "CN=rHWP Fold Personal", "-noprompt"], env=env, check=True, capture_output=True)
key.chmod(0o600)
config.write_text("storeFile=.local/rhwp-fold-personal.jks\nkeyAlias=rhwp-fold-personal\n"
                  + f"storePassword={password}\nkeyPassword={password}\n")
config.chmod(0o600)
print("개인 서명키 생성 완료. rhwp-android/.local을 비공개 백업하고 Git에는 넣지 마세요.")
