"""下载固定且最小的官方模型清单；分块可恢复，失败有限重试。"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess

MANIFEST = json.loads((Path(__file__).parent / "model-manifest.json").read_text())
CHUNK = 8 * 1024 * 1024


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(CHUNK), b""):
            result.update(block)
    return result.hexdigest()


def download(entry, home, endpoint):
    path = home / entry["destination"]
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.stat().st_size != entry["size"] or digest(path) != entry["sha256"]:
            raise ValueError(f"已有文件校验失败：{path}")
        return
    url = f'{endpoint}/{entry["repository"]}/resolve/{entry["revision"]}/{entry["path"]}'
    parts = path.with_name(path.name + ".parts")
    parts.mkdir(exist_ok=True)
    for index, start in enumerate(range(0, entry["size"], CHUNK)):
        end = min(start + CHUNK, entry["size"]) - 1
        part = parts / str(index)
        if part.exists() and part.stat().st_size == end - start + 1:
            continue
        pending = part.with_suffix(".pending")
        subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error",
                        "--connect-timeout", "15", "--max-time", "180", "--retry", "2",
                        "--range", f"{start}-{end}", "--output", str(pending),
                        url + f"?qingchang_part={index}"], check=True)
        if pending.stat().st_size != end - start + 1:
            raise ValueError(f"下载服务器未按范围返回内容：{path.name} {index}")
        pending.replace(part)
        print(json.dumps({"file": path.name, "downloadedBytes": end + 1,
                          "totalBytes": entry["size"]}), flush=True)
    pending = path.with_suffix(path.suffix + ".pending")
    with pending.open("wb") as target:
        for index in range((entry["size"] + CHUNK - 1) // CHUNK):
            target.write((parts / str(index)).read_bytes())
    if digest(pending) != entry["sha256"]:
        raise ValueError(f"官方SHA256校验失败：{path.name}")
    pending.replace(path)
    for part in parts.iterdir():
        part.unlink()
    parts.rmdir()
    print(json.dumps({"verified": str(path), "sha256": entry["sha256"]}), flush=True)


def prepare_source(home):
    root = home / "upstream-original"
    for entry in MANIFEST["sourceFiles"]:
        path = root / entry["path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        url = f'https://raw.githubusercontent.com/{MANIFEST["codeRepository"]}/{MANIFEST["codeRevision"]}/{entry["path"]}'
        if not path.exists():
            subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error",
                            "--retry", "2", "--max-time", "60", "--output", str(path), url], check=True)
        content = path.read_bytes()
        actual = hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
        if actual != entry["gitBlob"]:
            raise ValueError("官方代码Git blob校验失败：" + entry["path"])
        private = home / "upstream" / entry["path"]
        private.parent.mkdir(parents=True, exist_ok=True)
        if entry["path"].endswith("model_regression_audio.py"):
            old = b'MuQ.from_pretrained("OpenMuQ/MuQ-large-msd-iter")'
            assert content.count(old) == 1
            content = content.replace(old, f"MuQ.from_pretrained({str(home / 'models' / 'muq')!r})".encode())
        private.write_bytes(content)
    print("官方原文哈希已核验；私有副本仅替换MuQ本地权重路径", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--endpoint", default="https://huggingface.co")
    parser.add_argument("--phase", choices=["all", "source", "weights"], default="all")
    args = parser.parse_args()
    args.home = args.home.resolve()
    if args.phase in {"all", "weights"}:
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda entry: download(entry, args.home, args.endpoint.rstrip("/")), MANIFEST["files"]))
        (args.home / "verified-manifest.json").write_text(json.dumps(MANIFEST, ensure_ascii=False, indent=2))
    if args.phase in {"all", "source"}:
        prepare_source(args.home)


if __name__ == "__main__":
    main()
