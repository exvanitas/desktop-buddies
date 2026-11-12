#!/usr/bin/env python3
"""Builds the per-user Windows installer from the release zip, with Tauri's NSIS bundler.

    python -I apps/desktop/scripts/installer.py --release <X.Y.Z>
        --zip <desktop-buddies-X.Y.Z-windows-x64.zip> --out-dir <dir>

The installer installs for the one user, into %LOCALAPPDATA%\\Desktop Buddies: what the zip holds but
its README, which is the exe, the app folder beside it as app, LICENSE, NOTICE, TRADEMARKS.md and the
crates' notices, with a Start menu entry. Its uninstaller leaves the user's buddies in %APPDATA%. /S
installs and uninstalls silently.

Everything goes in from the zip, byte for byte: the zip is unpacked into a staging folder beside
src-tauri, the bundler takes the exe and the files from there, and is told not to patch or sign the
exe. The build's own target folder is never touched. The version is tauri.conf.json's, which is the
exe's own, and must be <X.Y.Z>. Once it's built, 7-Zip opens the installer again to check it holds
the zip's files, the same bytes, and nothing else in app.

It writes desktop-buddies-<X.Y.Z>-setup-x64.exe into <dir> and its line into SHA256SUMS.txt there,
beside the zip's. --tauri is the Tauri CLI (cargo-tauri, from `cargo install tauri-cli`) and
--sevenzip is 7-Zip; --target is passed on to the bundler.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

DESKTOP = pathlib.Path(__file__).resolve().parent.parent
TAURI_DIR = DESKTOP / "src-tauri"
EXE_NAME = "desktop-buddies.exe"
PRODUCT = "Desktop Buddies"
NOTICES = "THIRD-PARTY-NOTICES.txt"
BUNDLE = {
    "active": True,
    "targets": ["nsis"],
    "publisher": "exvanitas",
    "homepage": "https://github.com/exvanitas/desktop-buddies",
    "shortDescription": "Little characters that live on your Windows desktop.",
    "windows": {"nsis": {"installMode": "currentUser"}},
}


def stop(why):
    sys.exit(f"installer: {why}")


def packer():
    """preview.py, for what the zip must hold."""
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("preview", DESKTOP / "scripts" / "preview.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def rel(path):
    """A path as Tauri reads a resource: relative to src-tauri, with forward slashes."""
    return os.path.relpath(path, TAURI_DIR).replace(os.sep, "/")


def from_zip(o, pack):
    """What the installer must hold, by its path in the install folder: the zip's files but its README."""
    if not re.fullmatch(r"\d+\.\d+\.\d+", o.release):
        stop(f"{o.release!r} isn't a version like 1.2.3")
    version = json.loads((TAURI_DIR / "tauri.conf.json").read_text("utf-8")).get("version")
    if version != o.release:
        stop(f"tauri.conf.json's version is {version}, not {o.release}. The installer and the exe take theirs from it")
    if not o.zip.is_file():
        stop(f"there's no {o.zip}")
    if not zipfile.is_zipfile(o.zip):
        stop(f"{o.zip} isn't a zip")
    top = f"{PRODUCT} {o.release}/"
    with zipfile.ZipFile(o.zip) as z:
        names = [n for n in z.namelist() if not n.endswith("/")]
        if not names or any(not n.startswith(top) for n in names):
            stop(f"{o.zip} should hold everything under '{top}'")
        want = {n[len(top):]: z.read(n) for n in names if n != top + "README.txt"}
    if EXE_NAME not in want:
        stop(f"{o.zip} has no {EXE_NAME}")
    problem = pack.exe_problem(want[EXE_NAME])
    if problem:
        stop(f"the zip's exe {problem}")
    if "app/seed.json" in want:
        stop("the zip's app folder has a seed.json, and no buddies ship in a release")
    missing = [n for n in [*(f"app/{n}" for n in pack.NEEDED), *pack.RELEASE_FILES, NOTICES] if n not in want]
    if missing:
        stop(f"the zip is missing {', '.join(missing)}")
    return want


def stage_files(want, stage):
    """The zip's files in the staging folder, and the bundle settings that name them, merged over
    tauri.conf.json for this build only. They stay out of tauri.conf.json, which is built into the exe."""
    files = stage / "files"
    for name, data in want.items():
        (files / name).parent.mkdir(parents=True, exist_ok=True)
        (files / name).write_bytes(data)
    tops = sorted({name.split("/")[0] for name in want if name != EXE_NAME})
    return {"bundle": {**BUNDLE, "resources": {rel(files / t): t for t in tops}}}


def build(o, stage, exe, cfg):
    """Runs the bundler on a copy of the exe, and returns the setup it made."""
    release = stage / "target" / (o.target or "") / "release"
    release.mkdir(parents=True)
    (release / EXE_NAME).write_bytes(exe)
    (stage / "bundle.json").write_text(json.dumps(cfg, indent=2), "utf-8")
    cmd = [o.tauri, "bundle", "--bundles", "nsis", "--no-binary-patching", "--no-sign", "--ci", "--config", str(stage / "bundle.json")]
    if o.target:
        cmd += ["--target", o.target]
    env = dict(os.environ, CARGO_TARGET_DIR=str(stage / "target"), CI="true")
    if subprocess.run(cmd, cwd=TAURI_DIR, env=env).returncode != 0:
        stop("the bundler failed")
    name = f"{PRODUCT}_{o.release}_x64-setup.exe"
    made = sorted(p.name for p in (release / "bundle" / "nsis").glob("*.exe")) if (release / "bundle" / "nsis").is_dir() else []
    if made != [name]:
        stop(f"the bundler should have made {name} alone, and made {made or 'nothing'}")
    return release / "bundle" / "nsis" / name


def opened(o, setup, stage):
    """The installer's install folder, as 7-Zip opens it: by path, the bytes."""
    into = stage / "opened"
    r = subprocess.run([o.sevenzip, "x", str(setup), f"-o{into}", "-y"], capture_output=True, text=True)
    if r.returncode != 0:
        stop(f"7-Zip couldn't open {setup.name}: {(r.stderr or r.stdout).strip()[-500:]}")
    exes = [p for p in into.rglob(EXE_NAME) if p.is_file()]
    if len(exes) != 1:
        stop(f"the installer holds {len(exes)} copies of the exe, not one")
    root = exes[0].parent
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def compare(want, got):
    """What's wrong with the installer, against the zip. Outside app, the bundler's own files (its
    plugins) can sit beside these. A bundler that patches the exe puts its own copy back after, so only
    the installer shows it."""
    if EXE_NAME in got and got[EXE_NAME] != want[EXE_NAME]:
        return ["the bundler changed the exe"]
    out = [f"{n} is missing" for n in want if n not in got]
    out += [f"{n} isn't the same" for n in want if n in got and got[n] != want[n]]
    out += [f"{n} shouldn't be there" for n in got if n.startswith("app/") and n not in want]
    return out


def write_sums(out_dir, setup):
    """SHA256SUMS.txt with this setup's line, last, and every other line as it was."""
    sums = out_dir / "SHA256SUMS.txt"
    lines = sums.read_text("utf-8").splitlines() if sums.exists() else []
    lines = [line for line in lines if not line.endswith(f"  {setup.name}")]
    lines.append(f"{sha256(setup.read_bytes())}  {setup.name}")
    sums.write_text("\n".join(lines) + "\n", "utf-8", newline="\n")


def main():
    args = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    args.add_argument("--release", metavar="X.Y.Z", required=True)
    args.add_argument("--zip", required=True, type=pathlib.Path, help="the release zip, made by preview.py --release")
    args.add_argument("--out-dir", required=True, type=pathlib.Path)
    args.add_argument("--tauri", default="cargo-tauri")
    args.add_argument("--sevenzip", default="7z")
    args.add_argument("--target")
    o = args.parse_args()

    want = from_zip(o, packer())
    # Beside src-tauri, so on its drive: Tauri reads a resource by its path relative to src-tauri.
    stage = pathlib.Path(tempfile.mkdtemp(prefix=".installer-", dir=DESKTOP))
    try:
        setup = build(o, stage, want[EXE_NAME], stage_files(want, stage))
        problems = compare(want, opened(o, setup, stage))
        if problems:
            stop(f"the installer isn't the zip: {'; '.join(problems)}")
        o.out_dir.mkdir(parents=True, exist_ok=True)
        out = o.out_dir / f"desktop-buddies-{o.release}-setup-x64.exe"
        shutil.copyfile(setup, out)
        write_sums(o.out_dir, out)
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    print(f"{out}: {len(want)} files from {o.zip.name}, {out.stat().st_size} bytes, exe sha256 {sha256(want[EXE_NAME])}")


if __name__ == "__main__":
    main()
