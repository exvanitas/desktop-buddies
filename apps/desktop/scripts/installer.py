#!/usr/bin/env python3
"""Builds the per-user Windows installer around an exe that's built already, with Tauri's NSIS bundler.

    python -I apps/desktop/scripts/installer.py --release <X.Y.Z> --exe <desktop-buddies.exe>
        --notices <THIRD-PARTY-NOTICES.txt> --out-dir <dir>

The installer installs for the one user, into %LOCALAPPDATA%\\Desktop Buddies: the exe, the built app
folder beside it as app, LICENSE, NOTICE, TRADEMARKS.md and the crates' notices, with a Start menu
entry. Its uninstaller leaves the user's buddies in %APPDATA%. /S installs and uninstalls silently.

The exe goes in byte for byte: the bundler takes it from a staging folder of its own, and is told not
to patch or sign it. The build's own target folder is never touched. The version is tauri.conf.json's,
which is the exe's own, and must be <X.Y.Z>. The app folder gets the zip's checks (preview.py's release
mode). Once it's built, 7-Zip opens the installer again to check it holds the exe, the app folder and
the licence files, the same bytes, and nothing else in app.

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
    """preview.py, for the checks the zip gets."""
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


def checked(o, pack):
    """What the installer must hold, by its path in the install folder, once the inputs pass."""
    if not re.fullmatch(r"\d+\.\d+\.\d+", o.release):
        stop(f"{o.release!r} isn't a version like 1.2.3")
    exe = o.exe.read_bytes()
    problem = pack.exe_problem(exe)
    if problem:
        stop(f"{o.exe} {problem}")
    version = json.loads((TAURI_DIR / "tauri.conf.json").read_text("utf-8")).get("version")
    if version != o.release:
        stop(f"tauri.conf.json's version is {version}, not {o.release}. The installer and the exe take theirs from it")
    if (pack.APP / "seed.json").exists():
        stop("the app folder has a seed.json, and no buddies ship in a release")
    problems = pack.font_problems()
    if problems:
        stop(f"in the app folder, {'; '.join(problems)}")
    missing = [n for n in pack.NEEDED if not (pack.APP / n).is_file()]
    if missing:
        stop(f"the app folder is missing {', '.join(missing)}. Build it first")
    notices = o.notices.read_bytes()
    if not notices.strip():
        stop(f"{o.notices} is empty")

    want = {EXE_NAME: exe}
    for name in pack.RELEASE_FILES:
        if not (pack.ROOT / name).is_file():
            stop(f"there's no {name} at the root")
        want[name] = (pack.ROOT / name).read_bytes()
    want[NOTICES] = notices
    for f in sorted(p for p in pack.APP.rglob("*") if p.is_file()):
        want[f"app/{f.relative_to(pack.APP).as_posix()}"] = f.read_bytes()
    return want


def config(o, pack):
    """The bundle settings merged over tauri.conf.json for this build only. They stay out of
    tauri.conf.json, which is built into the exe."""
    resources = {rel(pack.APP): "app"}
    resources.update({rel(pack.ROOT / name): name for name in pack.RELEASE_FILES})
    resources[rel(o.notices.resolve())] = NOTICES
    return {"bundle": {**BUNDLE, "resources": resources}}


def build(o, stage, cfg):
    """Runs the bundler on a copy of the exe, and returns the setup it made."""
    release = stage / "target" / (o.target or "") / "release"
    release.mkdir(parents=True)
    shutil.copyfile(o.exe, release / EXE_NAME)
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
    """What's wrong with the installer, against what it must hold. Outside app, the bundler's own files
    (its plugins) can sit beside these. A bundler that patches the exe puts its own copy back after,
    so only the installer shows it."""
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
    args.add_argument("--exe", required=True, type=pathlib.Path)
    args.add_argument("--notices", required=True, type=pathlib.Path)
    args.add_argument("--out-dir", required=True, type=pathlib.Path)
    args.add_argument("--tauri", default="cargo-tauri")
    args.add_argument("--sevenzip", default="7z")
    args.add_argument("--target")
    o = args.parse_args()
    o.exe = o.exe.resolve()

    pack = packer()
    want = checked(o, pack)
    stage = pathlib.Path(tempfile.mkdtemp(prefix="buddies-installer-"))
    try:
        setup = build(o, stage, config(o, pack))
        problems = compare(want, opened(o, setup, stage))
        if problems:
            stop(f"the installer isn't right: {'; '.join(problems)}")
        o.out_dir.mkdir(parents=True, exist_ok=True)
        out = o.out_dir / f"desktop-buddies-{o.release}-setup-x64.exe"
        shutil.copyfile(setup, out)
        write_sums(o.out_dir, out)
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    print(f"{out}: {len(want)} files, {out.stat().st_size} bytes, exe sha256 {sha256(want[EXE_NAME])}")


if __name__ == "__main__":
    main()
