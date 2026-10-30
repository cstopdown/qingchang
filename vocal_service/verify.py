"""对已运行的独立模型做真实清唱、合成器乐、静音及HTTP契约验收。"""

import argparse
import io
import json
import math
import os
from pathlib import Path
import struct
import time
import urllib.error
import urllib.request
import uuid
import wave


def synthetic(silent=False):
    rate = 24000
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(rate)
        samples = [0 if silent else int(4000 * sum(math.sin(2 * math.pi * f * i / rate)
                                                  for f in [220, 277.18, 329.63]) / 3)
                   for i in range(rate * 3)]
        target.writeframes(struct.pack("<" + "h" * len(samples), *samples))
    return output.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:28787")
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    token = os.environ["QINGCHANG_AI_TOKEN"]

    def request(path, data=None, authenticated=True, origin=None):
        headers = {"Authorization": "Bearer " + token} if authenticated else {}
        if origin:
            headers["Origin"] = origin
        body = None
        if data is not None:
            boundary = "qingchang-" + uuid.uuid4().hex
            body = (f'--{boundary}\r\nContent-Disposition: form-data; name="recordingId"\r\n\r\nverification\r\n'
                    f'--{boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nverification\r\n'
                    f'--{boundary}\r\nContent-Disposition: form-data; name="audio"; filename="dry.wav"\r\n'
                    'Content-Type: audio/wav\r\n\r\n').encode() + data + f"\r\n--{boundary}--\r\n".encode()
            headers["Content-Type"] = "multipart/form-data; boundary=" + boundary
        started = time.monotonic()
        try:
            response = urllib.request.urlopen(urllib.request.Request(args.url + path, data=body, headers=headers), timeout=600)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return {"httpStatus": response.code, "elapsedSeconds": time.monotonic() - started,
                    "body": json.load(response)}

    results = {"health": request("/health")}
    assert results["health"]["body"]["status"] == "ready"
    for name, data in [("vocal", args.audio.read_bytes()), ("instrumental", synthetic()),
                       ("silence", synthetic(True)), ("invalidWav", b"invalid wav")]:
        result = request("/v2/score", data)
        results[name] = result
        if name in {"vocal", "instrumental"}:
            assert result["httpStatus"] == 200
            report = result["body"]
            assert report["scorable"] and report["analysis"]["modelCalled"]
            assert math.isfinite(report["score"]) and 0 <= report["score"] <= 100
        elif name == "silence":
            assert result["httpStatus"] == 200
            assert result["body"]["score"] is None and not result["body"]["analysis"]["modelCalled"]
        else:
            assert result["httpStatus"] == 422
        print(json.dumps({"case": name, "httpStatus": result["httpStatus"],
                          "elapsedSeconds": result["elapsedSeconds"]}), flush=True)
    results["authentication"] = request("/health", authenticated=False)
    results["origin"] = request("/health", origin="https://untrusted.example")
    assert results["authentication"]["httpStatus"] == 401
    assert results["origin"]["httpStatus"] == 403
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
