#!/usr/bin/env python3
"""Builds the Microsoft Store's MSIX package from a built exe and app folder.

    python3 -I apps/desktop/packaging/msix/msix.py --exe <desktop-buddies.exe> --out <x.msix>
        [--app <app folder>] [--identity <identity.json>] [--notices <THIRD-PARTY-NOTICES.txt>]
        [--stage <empty folder>] [--stage-only] [--sdk <folder with makeappx.exe>] [--version <x.y.z.0>]
    python3 -I apps/desktop/packaging/msix/msix.py --family [--identity <identity.json>]

It lays the package out in a fresh folder: the exe, the app folder as app/, LICENSE, NOTICE,
TRADEMARKS.md and the notices if given, AppxManifest.xml with the identity and package.json's version
as x.y.z.0, and the icons, drawn from the app's icon at every size the manifest names. MakePri indexes
the icons into resources.pri and MakeAppx packs it, both from the newest Windows 10 SDK on the
machine. The package is unsigned: the Store signs what it publishes, and a test signs its own.
--stage-only stops before the SDK's tools, so it runs anywhere. --family prints the package family
name the identity gives, which is what the MCP server's PACKAGE_FAMILY must say.

The identity defaults to identity.json beside this script, which holds the app's Partner Center
identity. A placeholder identity still builds, for tests, and a build says so as a warning.

The Store takes a version of four parts, each at most 65535, the first at least 1 and the last 0
(Microsoft's "Version numbering for Windows 10 and 11 packages"). Anything else is refused before a
file is staged: package.json's 0.1.0 is. --version is for a test package only, and follows the same
rule.
"""
import argparse
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, str(HERE))
import icons  # noqa: E402

DESKTOP = HERE.parent.parent
ROOT = DESKTOP.parent.parent
ICON = DESKTOP / "src-tauri" / "icons" / "icon.png"
EXE = "desktop-buddies.exe"
ROOT_FILES = ("LICENSE", "NOTICE", "TRADEMARKS.md")
NAME = re.compile(r"[A-Za-z0-9.-]{3,50}")
PLACEHOLDER_NAME = "PLACEHOLDER."
PLACEHOLDER_PUBLISHER = "CN=00000000-0000-0000-0000-000000000000"
# Windows' own base32 for publisher ids: no i, l, o or u.
BASE32 = "0123456789abcdefghjkmnpqrstvwxyz"


def stop(why):
    sys.exit(f"msix: {why}")


def publisher_id(publisher):
    """The 13 characters Windows derives from the Publisher: the first 8 bytes of SHA-256 over its
    UTF-16LE, read as 65 bits with a zero after, in groups of 5."""
    bits = int.from_bytes(hashlib.sha256(publisher.encode("utf-16-le")).digest()[:8], "big") << 1
    return "".join(BASE32[(bits >> (60 - 5 * i)) & 31] for i in range(13))


def family(identity):
    return f"{identity['name']}_{publisher_id(identity['publisher'])}"


def read_identity(path):
    try:
        identity = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError) as e:
        stop(f"can't read {path}: {e}")
    if not isinstance(identity, dict) or set(identity) != {"name", "publisher", "publisherDisplayName"}:
        stop(f"{path} must have exactly name, publisher and publisherDisplayName")
    if not all(isinstance(v, str) and v.strip() for v in identity.values()):
        stop(f"{path}'s values must be text")
    if not NAME.fullmatch(identity["name"]):
        stop(f"{path}'s name must be 3 to 50 of A-Z, a-z, 0-9, '.' and '-'")
    if not identity["publisher"].startswith("CN="):
        stop(f"{path}'s publisher must start CN=, as Partner Center gives it")
    if any(c in v for v in identity.values() for c in "<>&\"{}"):
        stop(f"{path}'s values can't hold < > & \" {{ or }}")
    return identity


def placeholder(identity):
    return identity["name"].startswith(PLACEHOLDER_NAME) or identity["publisher"] == PLACEHOLDER_PUBLISHER


def store_version(v):
    """v as the Store takes it, or why not."""
    parts = v.split(".")
    if len(parts) != 4 or not all(re.fullmatch(r"0|[1-9]\d{0,4}", p) for p in parts):
        return None, f"{v!r} isn't four numbers like 1.2.3.0"
    n = [int(p) for p in parts]
    if any(x > 65535 for x in n):
        return None, f"{v!r} has a part over 65535"
    if n[0] < 1:
        return None, f"{v!r} starts with 0, and the Store needs 1 or more"
    if n[3] != 0:
        return None, f"{v!r} doesn't end in 0, which the Store keeps for itself"
    return v, None


def version(given=None):
    """The package's version: package.json's x.y.z as x.y.z.0, or a test package's own."""
    if given is None:
        v = json.loads((ROOT / "package.json").read_text("utf-8")).get("version", "")
        if not re.fullmatch(r"\d+\.\d+\.\d+", v):
            stop(f"package.json's version {v!r} isn't like 1.2.3")
        given, where = f"{v}.0", f"package.json's version {v} as {v}.0"
    else:
        where = "--version"
    ok, why = store_version(given)
    if not ok:
        stop(f"{where}: {why}. Nothing was staged")
    return ok


def manifest(identity, ver):
    text = (HERE / "AppxManifest.xml").read_text("utf-8")
    values = {"NAME": identity["name"], "PUBLISHER": identity["publisher"], "PUBLISHER_DISPLAY_NAME": identity["publisherDisplayName"], "VERSION": ver}
    for k, v in values.items():
        text = text.replace("{{" + k + "}}", v)
    left = re.findall(r"\{\{[A-Z_]+\}\}", text)
    if left:
        stop(f"the manifest still has {', '.join(left)}")
    return text


def stage(o, identity, into):
    exe = o.exe.read_bytes()
    if exe[:2] != b"MZ":
        stop(f"{o.exe} isn't a Windows exe")
    if not (o.app / "hub.html").is_file():
        stop(f"{o.app} has no hub.html. Build the app first")
    shutil.copyfile(o.exe, into / EXE)
    shutil.copytree(o.app, into / "app")
    for name in ROOT_FILES:
        shutil.copyfile(ROOT / name, into / name)
    if o.notices:
        shutil.copyfile(o.notices, into / "THIRD-PARTY-NOTICES.txt")
    (into / "AppxManifest.xml").write_text(manifest(identity, o.store_version), "utf-8", newline="\r\n")
    (into / "Assets").mkdir()
    for name, png in icons.draw(ICON.read_bytes()).items():
        (into / "Assets" / name).write_bytes(png)


def sdk_bin(given):
    if given:
        return given
    kits = pathlib.Path("C:/Program Files (x86)/Windows Kits/10/bin")
    found = sorted((p for p in kits.glob("10.*/x64") if (p / "makeappx.exe").is_file() and (p / "makepri.exe").is_file()),
                   key=lambda p: tuple(int(n) for n in p.parent.name.split(".")))
    if not found:
        stop(f"no Windows SDK with makeappx.exe and makepri.exe under {kits}")
    return found[-1]


def run(*cmd):
    print("+", " ".join(str(c) for c in cmd), flush=True)
    r = subprocess.run([str(c) for c in cmd], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    print(r.stdout, flush=True)
    if r.returncode:
        stop(f"{pathlib.Path(cmd[0]).name} failed with {r.returncode}")


def pack(o, staged, work):
    tools = sdk_bin(o.sdk)
    # Only the icons are indexed, so nothing in the app folder can be read as a resource qualifier.
    shutil.copytree(staged / "Assets", work / "pri" / "Assets")
    run(tools / "makepri.exe", "createconfig", "/cf", work / "priconfig.xml", "/dq", "en-US", "/pv", "10.0.0", "/o")
    run(tools / "makepri.exe", "new", "/pr", work / "pri", "/cf", work / "priconfig.xml", "/mn", staged / "AppxManifest.xml", "/of", staged / "resources.pri", "/o")
    o.out.parent.mkdir(parents=True, exist_ok=True)
    run(tools / "makeappx.exe", "pack", "/d", staged, "/p", o.out, "/o")


def main():
    args = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    args.add_argument("--exe", type=pathlib.Path)
    args.add_argument("--app", type=pathlib.Path, default=DESKTOP / "dist" / "app")
    args.add_argument("--out", type=pathlib.Path)
    args.add_argument("--identity", type=pathlib.Path, default=HERE / "identity.json")
    args.add_argument("--notices", type=pathlib.Path)
    args.add_argument("--stage", type=pathlib.Path, help="an empty or missing folder to lay the package out in, kept afterwards")
    args.add_argument("--stage-only", action="store_true")
    args.add_argument("--sdk", type=pathlib.Path)
    args.add_argument("--family", action="store_true")
    args.add_argument("--version", help="a test package's own version, x.y.z.0")
    o = args.parse_args()
    identity = read_identity(o.identity)
    if o.family:
        print(family(identity))
        return
    if not o.exe or not (o.out or o.stage_only):
        args.error("--exe and --out are needed, or --exe and --stage-only")
    o.store_version = version(o.version)
    if placeholder(identity):
        print(f"::warning::msix: {o.identity.name} holds placeholders, so the Store won't take this package", flush=True)
    work = pathlib.Path(tempfile.mkdtemp(prefix="buddies-msix-"))
    try:
        staged = o.stage or work / "stage"
        if staged.exists() and any(staged.iterdir()):
            stop(f"{staged} isn't empty")
        staged.mkdir(parents=True, exist_ok=True)
        stage(o, identity, staged)
        print(f"staged {sum(1 for p in staged.rglob('*') if p.is_file())} files, version {o.store_version}, family {family(identity)}", flush=True)
        if not o.stage_only:
            pack(o, staged, work)
            print(f"{o.out}: {o.out.stat().st_size} bytes, sha256 {hashlib.sha256(o.out.read_bytes()).hexdigest()}")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
