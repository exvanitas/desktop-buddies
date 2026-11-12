#!/usr/bin/env python3
"""Builds the older installer the runner's upgrade check starts from: this build at a lower version.

    python -I apps/desktop/shell-check/older-installer.py --zip <desktop-buddies-X.Y.Z-windows-x64.zip>
        --old-version <W.V.U> --out-dir <dir> [--tauri <cargo-tauri>] [--sevenzip <7z>] [--target <triple>]

The exe and the files are the zip's. Only the version differs: a copy of the zip under the lower
version's folder name, and tauri.conf.json at that version for the build, put back afterwards whatever
happens. So installing this one and then the real one is an upgrade to a higher version, as winget runs
it. installer.py builds it, with all its checks, into <dir>.
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent.parent
CONF = ROOT / "apps" / "desktop" / "src-tauri" / "tauri.conf.json"
INSTALLER = ROOT / "apps" / "desktop" / "scripts" / "installer.py"


def stop(why):
    sys.exit(f"older-installer: {why}")


def parts(version):
    return tuple(int(p) for p in version.split("."))


def main():
    args = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    args.add_argument("--zip", required=True, type=pathlib.Path)
    args.add_argument("--old-version", required=True)
    args.add_argument("--out-dir", required=True, type=pathlib.Path)
    args.add_argument("--tauri")
    args.add_argument("--sevenzip")
    args.add_argument("--target")
    o = args.parse_args()

    conf = CONF.read_bytes()
    current = json.loads(conf).get("version")
    old = o.old_version
    if not re.fullmatch(r"\d+\.\d+\.\d+", old) or parts(old) >= parts(current):
        stop(f"{old!r} isn't a version lower than {current}")
    older_conf, n = re.subn(rb'("version"\s*:\s*")' + re.escape(current.encode()) + rb'"', rb"\g<1>" + old.encode() + b'"', conf)
    if n != 1:
        stop(f"tauri.conf.json's version {current} isn't written once, as \"version\": \"{current}\"")

    o.out_dir.mkdir(parents=True, exist_ok=True)
    old_zip = o.out_dir / f"desktop-buddies-{old}-windows-x64.zip"
    new_top, old_top = f"Desktop Buddies {current}/", f"Desktop Buddies {old}/"
    with zipfile.ZipFile(o.zip) as src, zipfile.ZipFile(old_zip, "w", zipfile.ZIP_DEFLATED) as dst:
        for name in src.namelist():
            dst.writestr(old_top + name[len(new_top):] if name.startswith(new_top) else name, src.read(name))

    passed = [a for flag in ("tauri", "sevenzip", "target") if getattr(o, flag) for a in (f"--{flag}", getattr(o, flag))]
    try:
        CONF.write_bytes(older_conf)
        code = subprocess.run([sys.executable, "-I", str(INSTALLER), "--release", old, "--zip", str(old_zip), "--out-dir", str(o.out_dir), *passed]).returncode
    finally:
        CONF.write_bytes(conf)
    if code != 0:
        stop("installer.py failed on the older build")


if __name__ == "__main__":
    main()
