import argparse
import os
from pathlib import Path

import uvicorn

from .app import create_app


def main():
    parser = argparse.ArgumentParser(description="轻唱 VocalVerse CPU 干声评分服务")
    parser.add_argument("--host", default="127.0.0.1", choices=["127.0.0.1"])
    parser.add_argument("--port", default=28787, type=int)
    args = parser.parse_args()
    home = Path(os.environ["QINGCHANG_VOCAL_HOME"]).resolve()
    uvicorn.run(create_app(home, os.environ["QINGCHANG_AI_TOKEN"]), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
