"""下载固定版本的官方音频模型；镜像地址须由调用者显式指定。"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--endpoint", default="https://huggingface.co")
    parser.add_argument("--metadata", type=Path, help="已从官方 API 保存的固定 revision 元数据")
    args = parser.parse_args()
    manifest = json.loads((Path(__file__).parent / "transformers-manifest.json").read_text())
    repo, revision = manifest["modelId"], manifest["revision"]
    endpoint = args.endpoint.rstrip("/")
    if args.metadata:
        metadata = json.loads(args.metadata.read_text())
    else:
        with urllib.request.urlopen(f"{endpoint}/api/models/{repo}/revision/{revision}?blobs=true", timeout=30) as response:
            metadata = json.load(response)
    if metadata["sha"] != revision:
        raise ValueError("下载源返回的模型 revision 与固定版本不一致")
    files = [entry for entry in metadata["siblings"] if "/" not in entry["rfilename"] and not entry["rfilename"].startswith(".")]
    args.directory.mkdir(parents=True, exist_ok=True)

    def download(entry):
        name = entry["rfilename"]
        path = args.directory / name
        subprocess.run([
            "curl", "--fail", "--location", "--silent", "--show-error", "--retry", "3", "--connect-timeout", "15",
            "--continue-at", "-", "--output", str(path),
            f"{endpoint}/{repo}/resolve/{revision}/{name}",
        ], check=True)
        digest_hash = hashlib.sha256()
        blob_hash = hashlib.sha1(f'blob {entry["size"]}\0'.encode())
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
                digest_hash.update(block)
                blob_hash.update(block)
        digest = digest_hash.hexdigest()
        if path.stat().st_size != entry["size"]:
            raise ValueError(f"官方文件大小校验失败：{name}")
        if "lfs" in entry and digest != entry["lfs"]["sha256"]:
            raise ValueError(f"官方 LFS SHA256 校验失败：{name}")
        if "lfs" not in entry and blob_hash.hexdigest() != entry["blobId"]:
            raise ValueError(f"官方 Git blob 校验失败：{name}")
        print(json.dumps({"file": name, "bytes": path.stat().st_size, "sha256": digest}), flush=True)
        return {"file": name, "bytes": path.stat().st_size, "sha256": digest}

    with ThreadPoolExecutor(max_workers=2) as executor:
        verified = list(executor.map(download, files))
    (args.directory / "qingchang-verified.json").write_text(json.dumps({
        **manifest, "endpoint": endpoint, "files": verified,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
