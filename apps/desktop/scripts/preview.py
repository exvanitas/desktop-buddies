#!/usr/bin/env python3
"""Packs a preview zip: the frozen exe, the built app folder, and preview/README.txt.

    pnpm --filter @buddies/desktop build
    python3 -I apps/desktop/scripts/preview.py --exe <desktop-buddies.exe> --out <preview.zip>

The zip's folder is named after the README's first line, so update the README first. It refuses any
exe but the frozen one: a new exe gets a new Smart App Control verdict, and that's never an accident.

    python3 -I apps/desktop/scripts/preview.py --release <X.Y.Z> --exe <desktop-buddies.exe>
        --notices <THIRD-PARTY-NOTICES.txt> --out-dir <dir>

Release mode is for the release workflow, which builds its own exe: it takes any exe, and adds
LICENSE, NOTICE, TRADEMARKS.md and the crates' notices. It writes
desktop-buddies-<X.Y.Z>-windows-x64.zip and SHA256SUMS.txt into <dir>. It refuses anything but an x64
Windows exe, an app folder with a buddy to seed, a font file without the OFL beside it, and a README
for another version.
"""
import argparse
import hashlib
import pathlib
import re
import struct
import sys
import zipfile

DESKTOP = pathlib.Path(__file__).resolve().parent.parent
ROOT = DESKTOP.parent.parent
APP = DESKTOP / "dist" / "app"
PREVIEW = DESKTOP / "preview"
NEEDED = ("hub.html", "overlay.html", "manager.html", "maker.html", "maker.js", "maker.css", "world.js", "tray.png")
# Every font file in the app folder has <name>-OFL.txt beside it. These are always there, Nunito's
# because maker.js embeds it.
FONT_LICENCES = ("fonts/dynapuff-OFL.txt", "fonts/lexend-OFL.txt", "fonts/nunito-OFL.txt")
FONT_TYPES = (".woff2", ".woff", ".ttf", ".otf")
OFL_TITLE = b"SIL OPEN FONT LICENSE Version 1.1"
RELEASE_FILES = ("LICENSE", "NOTICE", "TRADEMARKS.md")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def stop(why):
    sys.exit(f"preview: {why}")


def exe_problem(b):
    """Why b isn't an x64 Windows exe, or None."""
    if len(b) < 0x40 or b[:2] != b"MZ":
        return "isn't a Windows exe"
    e = struct.unpack_from("<I", b, 0x3C)[0]
    if not 0x40 <= e <= len(b) - 24 or b[e:e + 4] != b"PE\0\0":
        return "isn't a Windows exe"
    machine, flags = struct.unpack_from("<H", b, e + 4)[0], struct.unpack_from("<H", b, e + 22)[0]
    if machine != 0x8664:
        return f"isn't an x64 exe (machine {machine:#06x})"
    if flags & 0x2000:
        return "is a DLL"
    if not flags & 0x0002:
        return "isn't marked executable"
    return None


def font_problems():
    """Each font file without its licence, and each licence that isn't the OFL."""
    fonts = sorted(f for f in APP.rglob("*") if f.is_file() and f.suffix.lower() in FONT_TYPES)
    licences = {APP / n for n in FONT_LICENCES} | {f.with_name(f"{f.stem}-OFL.txt") for f in fonts}
    out = [f"{f.relative_to(APP).as_posix()} has no licence" for f in fonts if not f.with_name(f"{f.stem}-OFL.txt").is_file()]
    for f in sorted(licences):
        if f.is_file() and OFL_TITLE not in f.read_bytes():
            out.append(f"{f.relative_to(APP).as_posix()} isn't the OFL")
        elif not f.is_file() and f.relative_to(APP).as_posix() in FONT_LICENCES:
            out.append(f"{f.relative_to(APP).as_posix()} is missing")
    return out


def write_zip(out, parts):
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, data in parts.items():
            z.writestr(name, data)
    with zipfile.ZipFile(out) as z:
        if z.testzip() is not None or any(z.read(n) != d for n, d in parts.items()):
            stop(f"{out} didn't read back the same")


def app_parts(root):
    missing = [n for n in NEEDED if not (APP / n).is_file()]
    if missing:
        stop(f"the app folder is missing {', '.join(missing)}. Build it first")
    return {f"{root}/app/{f.relative_to(APP).as_posix()}": f.read_bytes() for f in sorted(p for p in APP.rglob("*") if p.is_file())}


def preview(o):
    frozen = (PREVIEW / "exe.sha256").read_text().strip()
    exe = o.exe.read_bytes()
    if sha256(exe) != frozen:
        stop(f"{o.exe} isn't the frozen exe. Expected {frozen}, got {sha256(exe)}")
    readme = (PREVIEW / "README.txt").read_bytes()
    root = readme.decode("utf-8").splitlines()[0].strip()
    parts = {f"{root}/desktop-buddies.exe": exe, f"{root}/README.txt": readme}
    parts.update(app_parts(root))
    write_zip(o.out, parts)
    print(f"{o.out}: {root}, {len(parts)} files, {o.out.stat().st_size} bytes")


def release(o):
    version = o.release
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        stop(f"{version!r} isn't a version like 1.2.3")
    exe = o.exe.read_bytes()
    problem = exe_problem(exe)
    if problem:
        stop(f"{o.exe} {problem}")
    readme = (PREVIEW / "README.txt").read_bytes()
    root = readme.decode("utf-8").splitlines()[0].strip()
    if root != f"Desktop Buddies {version}":
        stop(f"preview/README.txt's first line is {root!r}, not 'Desktop Buddies {version}'")
    if (APP / "seed.json").exists():
        stop("the app folder has a seed.json, and no buddies ship in a release")
    problems = font_problems()
    if problems:
        stop(f"in the app folder, {'; '.join(problems)}")
    notices = o.notices.read_bytes()
    if not notices.strip():
        stop(f"{o.notices} is empty")

    parts = {f"{root}/desktop-buddies.exe": exe, f"{root}/README.txt": readme}
    for name in RELEASE_FILES:
        if not (ROOT / name).is_file():
            stop(f"there's no {name} at the root")
        parts[f"{root}/{name}"] = (ROOT / name).read_bytes()
    parts[f"{root}/THIRD-PARTY-NOTICES.txt"] = notices
    parts.update(app_parts(root))

    o.out_dir.mkdir(parents=True, exist_ok=True)
    out = o.out_dir / f"desktop-buddies-{version}-windows-x64.zip"
    write_zip(out, parts)
    (o.out_dir / "SHA256SUMS.txt").write_text(f"{sha256(out.read_bytes())}  {out.name}\n", "utf-8", newline="\n")
    print(f"{out}: {root}, {len(parts)} files, {out.stat().st_size} bytes, exe sha256 {sha256(exe)}")


def main():
    args = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    args.add_argument("--exe", required=True, type=pathlib.Path)
    args.add_argument("--out", type=pathlib.Path, help="the preview zip")
    args.add_argument("--release", metavar="X.Y.Z", help="pack a release of this version instead")
    args.add_argument("--notices", type=pathlib.Path, help="release: THIRD-PARTY-NOTICES.txt")
    args.add_argument("--out-dir", type=pathlib.Path, help="release: where the zip and SHA256SUMS.txt go")
    o = args.parse_args()
    if o.release is None:
        if o.out is None or o.notices or o.out_dir:
            args.error("a preview takes --exe and --out only")
        preview(o)
    else:
        if o.out or o.notices is None or o.out_dir is None:
            args.error("--release takes --exe, --notices and --out-dir")
        release(o)


if __name__ == "__main__":
    main()
