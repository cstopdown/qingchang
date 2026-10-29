"""向真实运行的服务发送本地 WAV，并保存原始 HTTP 结果作为验收证据。"""

import argparse
import json
import os
from pathlib import Path
import time

import httpx


def main() -> None:
    parser = argparse.ArgumentParser(description="验证真实 MiniCPM 音频评分")
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--title", default="音频验收样本")
    parser.add_argument("--input-kind", choices=["dry-vocal", "mixed"], default="dry-vocal")
    parser.add_argument("--endpoint", default="http://127.0.0.1:8787")
    args = parser.parse_args()
    home = Path(os.environ.get("QINGCHANG_AI_HOME", Path(__file__).resolve().parent.parent / ".tools" / "ai"))
    headers = {"Authorization": f'Bearer {os.environ["QINGCHANG_AI_TOKEN"]}'} if os.environ.get("QINGCHANG_AI_TOKEN") else {}
    started = time.monotonic()
    with args.audio.open("rb") as audio, httpx.Client(timeout=600, trust_env=False) as client:
        response = client.post(
            args.endpoint.rstrip("/") + "/v1/score", headers=headers,
            data={"recordingId": args.audio.stem, "title": args.title, "lyrics": "", "inputKind": args.input_kind},
            files={"audio": (args.audio.name, audio, "audio/wav")},
        )
    evidence = {"file": str(args.audio.resolve()), "request": {"title": args.title, "inputKind": args.input_kind}, "statusCode": response.status_code,
                "elapsedSeconds": round(time.monotonic() - started, 3), "response": response.json()}
    destination = home / "validation"
    destination.mkdir(parents=True, exist_ok=True)
    (destination / f"{args.audio.stem}-{time.time_ns()}.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2))
    print(json.dumps(evidence, ensure_ascii=False, indent=2), flush=True)
    response.raise_for_status()


if __name__ == "__main__":
    main()
