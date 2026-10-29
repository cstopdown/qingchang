"""下载固定版本，并逐文件对照官方 Hub 元数据验证内容哈希。"""

import hashlib
import json
import os
from pathlib import Path
import urllib.request
import threading
import time

from huggingface_hub import snapshot_download


ROOT = Path(__file__).resolve().parent
MANIFEST = json.loads((ROOT / "model-manifest.json").read_text())


def emit(stage: str, message: str, **fields) -> None:
    print(json.dumps({"event": "progress", "stage": stage, "message": message, **fields}, ensure_ascii=False), flush=True)


def main() -> None:
    home = Path(os.environ.get("QINGCHANG_AI_HOME", ROOT.parent / ".tools" / "ai")).resolve()
    model_dir = home / "models" / "MiniCPM-o-4_5-4bit"
    revision = MANIFEST["revision"]
    url = f'https://huggingface.co/api/models/{MANIFEST["modelId"]}/revision/{revision}?blobs=true'
    emit("metadata", "核对官方模型版本与文件清单")
    with urllib.request.urlopen(url, timeout=60) as response:
        metadata = json.load(response)
    if metadata["sha"] != revision:
        raise ValueError("官方模型版本与锁定版本不一致")
    files = {item["rfilename"]: item for item in metadata["siblings"]}
    total = sum(files[name]["size"] for name in MANIFEST["files"])
    emit("download", "下载 MiniCPM-o 4.5 音频模型", totalBytes=total)
    complete = threading.Event()

    def progress():
        previous = 0
        previous_time = time.monotonic()
        while not complete.wait(5):
            downloaded = 0
            paths = [model_dir / name for name in MANIFEST["files"]]
            paths.extend((model_dir / ".cache" / "huggingface" / "download").glob("*.incomplete"))
            for path in paths:
                try:
                    downloaded += path.stat().st_size
                except FileNotFoundError:
                    continue
            now = time.monotonic()
            emit("download", "正在下载模型文件", downloadedBytes=min(downloaded, total), totalBytes=total,
                 downloadRateBytesPerSecond=max(0, (downloaded - previous) / (now - previous_time)))
            previous, previous_time = downloaded, now

    monitor = threading.Thread(target=progress, daemon=True)
    monitor.start()
    try:
        snapshot_download(
            repo_id=MANIFEST["modelId"], revision=revision, local_dir=model_dir,
            allow_patterns=MANIFEST["files"], max_workers=2,
        )
    finally:
        complete.set()
        monitor.join()
    verified = []
    for name in MANIFEST["files"]:
        path = model_dir / name
        item = files[name]
        if path.stat().st_size != item["size"]:
            raise ValueError(f"模型文件大小不一致：{name}")
        sha256 = hashlib.sha256()
        blob_sha = hashlib.sha1(f'blob {item["size"]}\0'.encode())
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(8 * 1024 * 1024), b""):
                sha256.update(chunk)
                blob_sha.update(chunk)
        if "lfs" in item:
            expected = item["lfs"]["sha256"]
            if sha256.hexdigest() != expected:
                raise ValueError(f"模型文件 SHA256 不一致：{name}")
        elif blob_sha.hexdigest() != item["blobId"]:
            raise ValueError(f"模型元数据 Git blob 哈希不一致：{name}")
        if name in MANIFEST["weightHashes"] and sha256.hexdigest() != MANIFEST["weightHashes"][name]:
            raise ValueError(f"权重与项目锁定哈希不一致：{name}")
        verified.append({"file": name, "bytes": item["size"], "sha256": sha256.hexdigest()})
        emit("verify", f"已校验 {name}", downloadedBytes=sum(entry["bytes"] for entry in verified), totalBytes=total)
    (home / "model-verified.json").write_text(json.dumps({"modelId": MANIFEST["modelId"], "revision": revision, "files": verified}, indent=2))
    print(json.dumps({"event": "ready", "stage": "setup", "message": "模型下载与哈希校验完成", "modelDirectory": str(model_dir)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
