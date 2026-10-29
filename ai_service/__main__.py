import argparse
import os
from pathlib import Path

import uvicorn

from .app import app_from_environment


def main() -> None:
    parser = argparse.ArgumentParser(description="轻唱本机 MiniCPM 评分服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "localhost", "::1"} and not os.environ.get("QINGCHANG_AI_TOKEN"):
        parser.error("对外监听必须先配置 QINGCHANG_AI_TOKEN")
    if not 1 <= args.port <= 65535:
        parser.error("端口须为 1 到 65535")
    home = Path(os.environ.get("QINGCHANG_AI_HOME", Path(__file__).resolve().parent.parent / ".tools" / "ai")).resolve()
    os.environ["QINGCHANG_AI_HOME"] = str(home)
    os.environ["HF_HOME"] = str(home / "cache" / "huggingface")
    os.environ["HF_HUB_OFFLINE"] = "1"
    uvicorn.run(app_from_environment(), host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
