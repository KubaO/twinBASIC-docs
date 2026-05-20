"""Raw (uncompressed) cache via the GitHub Actions cache v2 API (Twirp).

Replaces actions/cache@v4 to avoid double-compressing payloads that
are already gzipped (apt lists, playwright browsers).

Usage:
    python ci_cache.py restore [--sudo] KEY PATH [RESTORE_KEY_PREFIX ...]
    python ci_cache.py save KEY PATH

Environment: ACTIONS_RESULTS_URL, ACTIONS_RUNTIME_TOKEN (set by the
runner; exported to run steps via actions/github-script).
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

TWIRP = "twirp/github.actions.results.api.v1.CacheService"
BLOCK = 32 * 1024 * 1024  # 32 MB Azure block size

_results_url = os.environ.get("ACTIONS_RESULTS_URL", "").rstrip("/")
_token = os.environ.get("ACTIONS_RUNTIME_TOKEN", "")


VERSION_SALT = "v2"

def _version(path: str) -> str:
    return hashlib.sha256(f"{VERSION_SALT}:{path}".encode()).hexdigest()


def _twirp(method: str, body: dict) -> dict:
    url = f"{_results_url}/{TWIRP}/{method}"
    data = json.dumps(body).encode()
    req = Request(url, data=data, method="POST", headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {_token}",
    })
    try:
        with urlopen(req) as resp:
            return json.loads(resp.read())
    except HTTPError as e:
        text = e.read().decode(errors="replace")
        sys.exit(f"{method}: HTTP {e.code} {e.reason}\n{text}")


def _upload_blob(sas_url: str, filepath: str) -> None:
    """Upload a file to Azure Blob Storage via staged block upload."""
    size = os.path.getsize(filepath)
    sep = "&" if "?" in sas_url else "?"
    block_ids: list[str] = []

    with open(filepath, "rb") as f:
        index = 0
        while True:
            chunk = f.read(BLOCK)
            if not chunk:
                break
            block_id = base64.b64encode(f"{index:06d}".encode()).decode()
            block_ids.append(block_id)
            put_url = f"{sas_url}{sep}comp=block&blockid={block_id}"
            req = Request(put_url, data=chunk, method="PUT", headers={
                "Content-Length": str(len(chunk)),
                "x-ms-blob-type": "BlockBlob",
            })
            urlopen(req).close()
            index += 1

    block_list_xml = '<?xml version="1.0" encoding="UTF-8"?><BlockList>'
    for bid in block_ids:
        block_list_xml += f"<Latest>{bid}</Latest>"
    block_list_xml += "</BlockList>"

    req = Request(
        f"{sas_url}{sep}comp=blocklist",
        data=block_list_xml.encode(),
        method="PUT",
        headers={"Content-Type": "application/xml"},
    )
    urlopen(req).close()
    print(f"Uploaded {size} bytes in {len(block_ids)} blocks")


def cmd_restore(args: argparse.Namespace) -> None:
    ver = _version(args.path)
    resp = _twirp("GetCacheEntryDownloadURL", {
        "metadata": {"cacheVersion": ver},
        "key": args.key,
        "restoreKeys": args.restore_keys,
        "version": ver,
    })

    if not resp.get("ok"):
        print(f"Cache miss for {args.key}")
        return

    print(f"Cache hit: {resp.get('matched_key', '')}")
    download_url = resp["signed_download_url"]

    tar_cmd = ["sudo", "tar"] if args.sudo else ["tar"]
    proc = subprocess.Popen(
        [*tar_cmd, "-xf", "-", "-C", "/"],
        stdin=subprocess.PIPE,
    )
    with urlopen(download_url) as dl:
        while chunk := dl.read(1024 * 1024):
            proc.stdin.write(chunk)
    proc.stdin.close()
    if proc.wait() != 0:
        sys.exit(f"tar extract failed (exit {proc.returncode})")

    print(f"Restored {args.path}")


def cmd_save(args: argparse.Namespace) -> None:
    ver = _version(args.path)
    rel = args.path.lstrip("/")

    with tempfile.NamedTemporaryFile(suffix=".tar", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        subprocess.run(["tar", "-cf", tmp_path, "-C", "/", rel], check=True)
        size = os.path.getsize(tmp_path)

        resp = _twirp("CreateCacheEntry", {
            "metadata": {"cacheVersion": ver},
            "key": args.key,
            "version": ver,
        })
        if not resp.get("ok"):
            print(f"Cache save skipped: {resp.get('message', 'entry exists')}")
            return

        _upload_blob(resp["signed_upload_url"], tmp_path)

        resp = _twirp("FinalizeCacheEntryUpload", {
            "metadata": {"cacheVersion": ver},
            "key": args.key,
            "sizeBytes": str(size),
            "version": ver,
        })
        if not resp.get("ok"):
            sys.exit(f"Finalize failed: {resp.get('message', '')}")

        print(f"Saved {args.key} ({size} bytes, uncompressed)")
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def main() -> None:
    if not _results_url or not _token:
        sys.exit("ACTIONS_RESULTS_URL and ACTIONS_RUNTIME_TOKEN must be set")

    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    p_restore = sub.add_parser("restore")
    p_restore.add_argument("--sudo", action="store_true")
    p_restore.add_argument("key")
    p_restore.add_argument("path")
    p_restore.add_argument("restore_keys", nargs="*")

    p_save = sub.add_parser("save")
    p_save.add_argument("key")
    p_save.add_argument("path")

    args = parser.parse_args()
    if args.command == "restore":
        cmd_restore(args)
    else:
        cmd_save(args)


if __name__ == "__main__":
    main()
