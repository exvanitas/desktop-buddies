"""The release scripts on a stand-in repo: the packer in both modes, the installer builder, and the
version check.

    python3 -I tools/release/tests/test_release.py
"""
import hashlib
import json
import os
import pathlib
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile

REPO = pathlib.Path(__file__).resolve().parent.parent.parent.parent
OFL = b"Copyright 2026 A Font's Authors\n\nSIL OPEN FONT LICENSE Version 1.1 - 26 February 2007\n"


def pe(machine=0x8664, flags=0x0022, lfanew=0x80, size=0x200):
    """A stand-in PE: a DOS header pointing at a PE signature and a COFF header. The default is an
    x64 executable, not a DLL."""
    b = bytearray(size)
    b[:2] = b"MZ"
    struct.pack_into("<I", b, 0x3C, lfanew)
    if lfanew + 24 <= size:
        b[lfanew:lfanew + 4] = b"PE\0\0"
        struct.pack_into("<HH", b, lfanew + 4, machine, 6)
        struct.pack_into("<H", b, lfanew + 22, flags)
    return bytes(b)


EXE = pe() + b"a stand-in exe"
APP = {
    "hub.html": b"<p>hub</p>", "overlay.html": b"<p>overlay</p>", "manager.html": b"<p>manager</p>",
    "maker.html": b"<p>maker</p>", "maker.js": b"maker()", "maker.css": b"a{}", "world.js": b"world()",
    "tray.png": b"\x89PNG stand-in", "fonts/dynapuff.woff2": b"wOF2 d", "fonts/dynapuff-OFL.txt": OFL,
    "fonts/lexend.woff2": b"wOF2 l", "fonts/lexend-OFL.txt": OFL, "fonts/nunito-OFL.txt": OFL,
}
CHANGELOG = "# Changelog\n\n## 0.2.0 (2026-12-01)\n\nThe second one.\n\n### Fixes\n- A fix.\n\n## 0.1.0 (2026-11-09)\n\nThe first one.\n"


class Repo:
    """A stand-in repo with copies of the real scripts in their real places."""

    def __init__(self, version="0.2.0"):
        self.dir = pathlib.Path(tempfile.mkdtemp(prefix="buddies-release-"))
        d = self.dir
        for rel in ("apps/desktop/scripts/preview.py", "apps/desktop/scripts/installer.py", "tools/release/version.py"):
            (d / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(REPO / rel, d / rel)
        for rel, data in APP.items():
            self.put(f"apps/desktop/dist/app/{rel}", data)
        self.put("apps/desktop/preview/README.txt", f"Desktop Buddies {version}\n\nTo run it\n".encode())
        self.put("apps/desktop/preview/exe.sha256", hashlib.sha256(b"MZ the frozen one").hexdigest().encode() + b"\n")
        self.put("LICENSE", b"MIT License\n")
        self.put("NOTICE", b"Credits\n")
        self.put("TRADEMARKS.md", b"# Trademarks\n")
        self.put("package.json", json.dumps({"name": "desktop-buddies", "version": version}).encode())
        self.put("apps/desktop/src-tauri/tauri.conf.json", json.dumps({"productName": "Desktop Buddies", "version": version}).encode())
        self.put("CHANGELOG.md", CHANGELOG.encode())
        self.put("in/desktop-buddies.exe", EXE)
        self.put("in/THIRD-PARTY-NOTICES.txt", b"Third-party notices\n")

    def put(self, rel, data):
        (self.dir / rel).parent.mkdir(parents=True, exist_ok=True)
        (self.dir / rel).write_bytes(data)

    def run(self, script, *args):
        return subprocess.run([sys.executable, "-I", str(self.dir / script), *map(str, args)], cwd=self.dir, capture_output=True, text=True)

    def pack(self, *extra, version="0.2.0", exe="in/desktop-buddies.exe"):
        return self.run("apps/desktop/scripts/preview.py", "--release", version, "--exe", exe,
                        "--notices", "in/THIRD-PARTY-NOTICES.txt", "--out-dir", "out", *extra)

    def check(self, tag="v0.2.0", *extra):
        return self.run("tools/release/version.py", tag, *extra)

    def tool(self, name, body):
        """A stand-in command: a Python script, run as a program."""
        path = self.dir / "fake" / name
        path.parent.mkdir(exist_ok=True)
        path.write_text(f"#!{sys.executable} -I\n" + body)
        path.chmod(0o755)
        return path

    def setup(self, *extra, version="0.2.0", exe="in/desktop-buddies.exe", mode="", notices="in/THIRD-PARTY-NOTICES.txt"):
        tauri = self.tool("tauri", FAKE_TAURI)
        sevenzip = self.tool("7z", FAKE_7Z)
        env = dict(os.environ, FAKE_MODE=mode, FAKE_RECORD=str(self.dir / "record.json"))
        return subprocess.run([sys.executable, "-I", str(self.dir / "apps/desktop/scripts/installer.py"), "--release", version,
                               "--exe", exe, "--notices", notices, "--out-dir", "out", "--tauri", str(tauri), "--sevenzip", str(sevenzip),
                               *extra], cwd=self.dir, capture_output=True, text=True, env=env)


# Tauri's bundler, as far as the builder sees it: it reads the merged config, takes the exe from
# CARGO_TARGET_DIR, and writes the setup where Tauri does. The setup here is a zip laid out as 7-Zip
# opens an NSIS installer: the install folder's files under $INSTDIR, beside the plugins and script.
# FAKE_MODE makes it go wrong in one way.
FAKE_TAURI = r"""
import json, os, pathlib, sys, zipfile
mode = os.environ["FAKE_MODE"]
args = sys.argv[1:]
cfg = json.loads(pathlib.Path(args[args.index("--config") + 1]).read_text())
target = pathlib.Path(os.environ["CARGO_TARGET_DIR"])
release = target / (args[args.index("--target") + 1] if "--target" in args else "") / "release"
pathlib.Path(os.environ["FAKE_RECORD"]).write_text(json.dumps({"args": args, "cwd": os.getcwd(), "config": cfg, "target": str(target)}))
if mode == "fail":
    sys.exit("bundler: it went wrong")
exe = release / "desktop-buddies.exe"
if mode == "patch":
    exe.write_bytes(exe.read_bytes().replace(b"a stand-in exe", b"a patched! exe"))
parts = {"desktop-buddies.exe": exe.read_bytes()}
for src, dest in cfg["bundle"]["resources"].items():
    src = pathlib.Path(src)
    if src.is_dir():
        for f in sorted(src.rglob("*")):
            if f.is_file():
                parts[dest + "/" + f.relative_to(src).as_posix()] = f.read_bytes()
    else:
        parts[dest] = src.read_bytes()
if mode == "drop":
    del parts["app/world.js"]
if mode == "extra":
    parts["app/stray.js"] = b"stray()"
if mode == "changed":
    parts["LICENSE"] = b"Another licence\n"
version = json.loads(pathlib.Path("tauri.conf.json").read_text())["version"]
name = "Desktop Buddies_" + ("9.9.9" if mode == "rename" else version) + "_x64-setup.exe"
out = release / "bundle" / "nsis"
out.mkdir(parents=True)
if mode != "none":
    with zipfile.ZipFile(out / name, "w") as z:
        z.writestr("[NSIS].nsi", "; the script")
        z.writestr("$PLUGINSDIR/System.dll", "MZ plugin")
        for n, d in parts.items():
            z.writestr("$INSTDIR/" + n, d)
if mode == "two":
    (out / "Desktop Buddies_0.0.1_x64-setup.exe").write_bytes(b"old")
"""

# 7-Zip's `7z x <archive> -o<dir> -y`, for the zip above.
FAKE_7Z = r"""
import os, sys, zipfile
args = sys.argv[1:]
assert args[0] == "x" and "-y" in args, args
if os.environ["FAKE_MODE"] == "unopenable":
    sys.exit("ERROR: Can not open the file as archive")
out = next(a[2:] for a in args if a.startswith("-o"))
zipfile.ZipFile(args[1]).extractall(out)
"""


class Base(unittest.TestCase):
    def setUp(self):
        self.repo = Repo()
        self.addCleanup(shutil.rmtree, self.repo.dir)

    def refused(self, r, words):
        self.assertNotEqual(r.returncode, 0, r.stdout)
        self.assertIn(words, r.stderr)


class Release(Base):
    def test_packs_a_ci_exe_with_the_release_files(self):
        r = self.repo.pack()
        self.assertEqual(r.returncode, 0, r.stderr)
        out = self.repo.dir / "out"
        name = "desktop-buddies-0.2.0-windows-x64.zip"
        self.assertEqual(sorted(p.name for p in out.iterdir()), ["SHA256SUMS.txt", name])
        top = "Desktop Buddies 0.2.0"
        want = {f"{top}/desktop-buddies.exe": EXE, f"{top}/README.txt": (self.repo.dir / "apps/desktop/preview/README.txt").read_bytes(),
                f"{top}/LICENSE": b"MIT License\n", f"{top}/NOTICE": b"Credits\n", f"{top}/TRADEMARKS.md": b"# Trademarks\n",
                f"{top}/THIRD-PARTY-NOTICES.txt": b"Third-party notices\n"}
        want.update({f"{top}/app/{rel}": data for rel, data in APP.items()})
        with zipfile.ZipFile(out / name) as z:
            self.assertEqual(sorted(z.namelist()), sorted(want))
            for n, data in want.items():
                self.assertTrue(z.read(n) == data, n)
        digest = hashlib.sha256((out / name).read_bytes()).hexdigest()
        self.assertEqual((out / "SHA256SUMS.txt").read_bytes(), f"{digest}  {name}\n".encode())

    def test_refuses_a_readme_for_another_version(self):
        self.refused(self.repo.pack(version="0.3.0"), "not 'Desktop Buddies 0.3.0'")

    def test_refuses_a_version_that_isnt_one(self):
        self.refused(self.repo.pack(version="v0.2.0"), "isn't a version")
        self.refused(self.repo.pack(version="0.2"), "isn't a version")

    def test_refuses_what_isnt_an_exe(self):
        for name, data in [("script", b"#!/bin/sh\n"), ("bare-mz", b"MZ"), ("short", pe(size=0x40)),
                           ("lfanew-past-end", pe(lfanew=0x1F0)),
                           ("header-cut-short", pe(size=0x400)[:0x80] + b"PE\0\0\x64\x86"), ("lfanew-in-dos-header", pe(lfanew=0x10)),
                           ("no-pe-signature", pe()[:0x80] + b"NE\0\0" + pe()[0x84:])]:
            self.repo.put(f"in/{name}.exe", data)
            self.refused(self.repo.pack(exe=f"in/{name}.exe"), "isn't a Windows exe")

    def test_refuses_an_exe_for_another_machine(self):
        for name, machine in [("x86", 0x14C), ("arm64", 0xAA64)]:
            self.repo.put(f"in/{name}.exe", pe(machine=machine))
            self.refused(self.repo.pack(exe=f"in/{name}.exe"), "isn't an x64 exe")

    def test_refuses_a_dll_or_an_image_that_isnt_executable(self):
        self.repo.put("in/lib.dll", pe(flags=0x2022))
        self.refused(self.repo.pack(exe="in/lib.dll"), "is a DLL")
        self.repo.put("in/obj.exe", pe(flags=0x0020))
        self.refused(self.repo.pack(exe="in/obj.exe"), "isn't marked executable")

    def test_refuses_a_buddy_to_seed(self):
        self.repo.put("apps/desktop/dist/app/seed.json", b"{}")
        self.refused(self.repo.pack(), "seed.json")

    def test_refuses_a_font_without_its_licence(self):
        (self.repo.dir / "apps/desktop/dist/app/fonts/nunito-OFL.txt").unlink()
        self.refused(self.repo.pack(), "fonts/nunito-OFL.txt")

    def test_refuses_a_new_font_without_its_licence(self):
        self.repo.put("apps/desktop/dist/app/fonts/new.woff2", b"wOF2 x")
        self.refused(self.repo.pack(), "fonts/new.woff2 has no licence")

    def test_refuses_an_unlicensed_font_of_any_kind_anywhere(self):
        for rel in ("fonts/new.ttf", "fonts/New.OTF", "extra/old.woff"):
            with self.subTest(rel):
                repo = Repo()
                self.addCleanup(shutil.rmtree, repo.dir)
                repo.put(f"apps/desktop/dist/app/{rel}", b"font bytes")
                self.refused(repo.pack(), f"{rel} has no licence")

    def test_takes_a_licensed_font_of_another_kind(self):
        self.repo.put("apps/desktop/dist/app/extra/old.ttf", b"font bytes")
        self.repo.put("apps/desktop/dist/app/extra/old-OFL.txt", OFL)
        r = self.repo.pack()
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_refuses_an_empty_licence(self):
        self.repo.put("apps/desktop/dist/app/fonts/new.woff2", b"wOF2 x")
        self.repo.put("apps/desktop/dist/app/fonts/new-OFL.txt", b"")
        self.refused(self.repo.pack(), "fonts/new-OFL.txt isn't the OFL")

    def test_refuses_a_licence_that_isnt_the_ofl(self):
        self.repo.put("apps/desktop/dist/app/fonts/nunito-OFL.txt", b"MIT License\n")
        self.refused(self.repo.pack(), "fonts/nunito-OFL.txt isn't the OFL")

    def test_refuses_a_missing_release_file(self):
        (self.repo.dir / "TRADEMARKS.md").unlink()
        self.refused(self.repo.pack(), "no TRADEMARKS.md")

    def test_refuses_empty_notices(self):
        self.repo.put("in/THIRD-PARTY-NOTICES.txt", b"\n")
        self.refused(self.repo.pack(), "is empty")

    def test_refuses_a_missing_app_file(self):
        (self.repo.dir / "apps/desktop/dist/app/world.js").unlink()
        self.refused(self.repo.pack(), "missing world.js")

    def test_takes_only_its_own_arguments(self):
        r = self.repo.pack("--out", "x.zip")
        self.refused(r, "--release takes")


class Installer(Base):
    SETUP = "desktop-buddies-0.2.0-setup-x64.exe"

    def record(self):
        return json.loads((self.repo.dir / "record.json").read_text())

    def opened(self):
        with zipfile.ZipFile(self.repo.dir / "out" / self.SETUP) as z:
            return {n[len("$INSTDIR/"):]: z.read(n) for n in z.namelist() if n.startswith("$INSTDIR/")}

    def test_builds_the_setup_with_the_exe_as_it_is(self):
        self.assertEqual(self.repo.pack().returncode, 0)
        r = self.repo.setup()
        self.assertEqual(r.returncode, 0, r.stderr)
        want = {"desktop-buddies.exe": EXE, "LICENSE": b"MIT License\n", "NOTICE": b"Credits\n", "TRADEMARKS.md": b"# Trademarks\n",
                "THIRD-PARTY-NOTICES.txt": b"Third-party notices\n"}
        want.update({f"app/{rel}": data for rel, data in APP.items()})
        got = self.opened()
        self.assertEqual(sorted(got), sorted(want))
        for n, data in want.items():
            self.assertTrue(got[n] == data, n)
        # the zip's line stays, and the setup's is added
        out = self.repo.dir / "out"
        sums = (out / "SHA256SUMS.txt").read_text().splitlines()
        self.assertEqual(len(sums), 2, sums)
        self.assertTrue(sums[0].endswith("  desktop-buddies-0.2.0-windows-x64.zip"))
        self.assertEqual(sums[1], f"{hashlib.sha256((out / self.SETUP).read_bytes()).hexdigest()}  {self.SETUP}")
        self.assertIn(hashlib.sha256(EXE).hexdigest(), r.stdout)

    def test_tells_the_bundler_to_leave_the_exe_alone_and_install_for_this_user(self):
        r = self.repo.setup()
        self.assertEqual(r.returncode, 0, r.stderr)
        rec = self.record()
        self.assertEqual(rec["args"][:3], ["bundle", "--bundles", "nsis"])
        for flag in ("--no-binary-patching", "--no-sign", "--ci"):
            self.assertIn(flag, rec["args"])
        self.assertEqual(pathlib.Path(rec["cwd"]), self.repo.dir / "apps/desktop/src-tauri")
        b = rec["config"]["bundle"]
        self.assertEqual(b["windows"]["nsis"]["installMode"], "currentUser")
        self.assertEqual((b["active"], b["targets"], b["publisher"]), (True, ["nsis"], "exvanitas"))
        # relative to src-tauri, as Tauri reads them
        self.assertEqual(b["resources"], {"../dist/app": "app", "../../../LICENSE": "LICENSE", "../../../NOTICE": "NOTICE",
                                          "../../../TRADEMARKS.md": "TRADEMARKS.md", "../../../in/THIRD-PARTY-NOTICES.txt": "THIRD-PARTY-NOTICES.txt"})
        self.assertNotIn("version", rec["config"], "the version is tauri.conf.json's, the exe's own")
        # the build's own target folder is never touched, and the staging folder is gone
        self.assertFalse((self.repo.dir / "apps/desktop/src-tauri/target").exists())
        self.assertFalse(pathlib.Path(rec["target"]).exists())

    def test_passes_a_target_on(self):
        r = self.repo.setup("--target", "x86_64-pc-windows-msvc")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.record()["args"][-2:], ["--target", "x86_64-pc-windows-msvc"])

    def test_a_rerun_replaces_its_own_line(self):
        self.assertEqual(self.repo.pack().returncode, 0)
        self.assertEqual(self.repo.setup().returncode, 0)
        r = self.repo.setup()
        self.assertEqual(r.returncode, 0, r.stderr)
        sums = (self.repo.dir / "out/SHA256SUMS.txt").read_text().splitlines()
        self.assertEqual([line.split("  ")[1] for line in sums], ["desktop-buddies-0.2.0-windows-x64.zip", self.SETUP])

    def test_starts_the_sums_when_there_are_none(self):
        r = self.repo.setup()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len((self.repo.dir / "out/SHA256SUMS.txt").read_text().splitlines()), 1)

    def refused_setup(self, r, words):
        self.refused(r, words)
        self.assertFalse((self.repo.dir / "out" / self.SETUP).exists(), "no setup left behind")

    def test_refuses_a_patched_exe(self):
        self.refused_setup(self.repo.setup(mode="patch"), "the bundler changed the exe")

    def test_refuses_a_setup_missing_a_file(self):
        self.refused_setup(self.repo.setup(mode="drop"), "app/world.js is missing")

    def test_refuses_a_setup_with_a_file_too_many(self):
        self.refused_setup(self.repo.setup(mode="extra"), "app/stray.js shouldn't be there")

    def test_refuses_a_setup_with_a_file_changed(self):
        self.refused_setup(self.repo.setup(mode="changed"), "LICENSE isn't the same")

    def test_refuses_when_the_bundler_fails(self):
        self.refused_setup(self.repo.setup(mode="fail"), "the bundler failed")

    def test_refuses_a_missing_or_unexpected_setup(self):
        for mode in ("none", "rename", "two"):
            with self.subTest(mode):
                self.refused_setup(self.repo.setup(mode=mode), "Desktop Buddies_0.2.0_x64-setup.exe")

    def test_refuses_a_setup_7zip_cant_open(self):
        self.refused_setup(self.repo.setup(mode="unopenable"), "7-Zip couldn't open")

    def test_refuses_a_tauri_conf_for_another_version(self):
        self.repo.put("apps/desktop/src-tauri/tauri.conf.json", json.dumps({"version": "0.1.0"}).encode())
        self.refused_setup(self.repo.setup(), "tauri.conf.json's version is 0.1.0, not 0.2.0")

    def test_refuses_what_the_zip_refuses(self):
        self.repo.put("in/x86.exe", pe(machine=0x14C))
        self.refused_setup(self.repo.setup(exe="in/x86.exe"), "isn't an x64 exe")
        self.refused_setup(self.repo.setup(version="0.2"), "isn't a version")
        self.repo.put("in/empty.txt", b"")
        self.refused_setup(self.repo.setup(notices="in/empty.txt"), "is empty")
        app = self.repo.dir / "apps/desktop/dist/app"
        self.repo.put("apps/desktop/dist/app/fonts/new.woff2", b"wOF2 x")
        self.refused_setup(self.repo.setup(), "fonts/new.woff2 has no licence")
        (app / "fonts/new.woff2").unlink()
        self.repo.put("apps/desktop/dist/app/seed.json", b"{}")
        self.refused_setup(self.repo.setup(), "seed.json")
        (app / "seed.json").unlink()
        (app / "world.js").unlink()
        self.refused_setup(self.repo.setup(), "missing world.js")


class Preview(Base):
    def preview(self, exe):
        return self.repo.run("apps/desktop/scripts/preview.py", "--exe", exe, "--out", "preview.zip")

    def test_still_refuses_any_exe_but_the_frozen_one(self):
        self.refused(self.preview("in/desktop-buddies.exe"), "isn't the frozen exe")
        self.assertFalse((self.repo.dir / "preview.zip").exists())

    def test_packs_the_frozen_exe_as_before(self):
        self.repo.put("in/frozen.exe", b"MZ the frozen one")
        r = self.preview("in/frozen.exe")
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(self.repo.dir / "preview.zip") as z:
            names = sorted(z.namelist())
        top = "Desktop Buddies 0.2.0"
        self.assertEqual(names, sorted([f"{top}/desktop-buddies.exe", f"{top}/README.txt"] + [f"{top}/app/{rel}" for rel in APP]))

    def test_takes_no_release_arguments(self):
        self.repo.put("in/frozen.exe", b"MZ the frozen one")
        self.refused(self.repo.run("apps/desktop/scripts/preview.py", "--exe", "in/frozen.exe", "--out", "p.zip", "--out-dir", "out"),
                     "a preview takes")


class Version(Base):
    def test_a_matching_tag_prints_the_version_and_the_top_notes(self):
        r = self.repo.check("v0.2.0", "--notes", "out/notes.md")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout, "0.2.0\n")
        self.assertEqual((self.repo.dir / "out/notes.md").read_text(), "The second one.\n\n### Fixes\n- A fix.\n")

    def test_refuses_a_tag_that_isnt_one(self):
        for tag in ("0.2.0", "v0.2", "v0.2.0-rc1", "v0.2.0 ", "release"):
            self.refused(self.repo.check(tag), "isn't a release tag")

    def test_refuses_a_tag_for_another_version(self):
        r = self.repo.check("v0.1.0")
        self.refused(r, "package.json says 0.2.0")
        self.assertIn("CHANGELOG.md's top section says 0.2.0", r.stderr)
        self.assertIn("first line says 0.2.0", r.stderr)
        self.assertIn("tauri.conf.json says 0.2.0", r.stderr)

    def test_refuses_package_json_alone_out_of_step(self):
        self.repo.put("package.json", json.dumps({"version": "0.1.0"}).encode())
        r = self.repo.check()
        self.refused(r, "package.json says 0.1.0")
        self.assertNotIn("CHANGELOG", r.stderr)

    def test_refuses_tauri_conf_alone_out_of_step(self):
        """The installer takes its version from there, and winget reads it back from Windows."""
        self.repo.put("apps/desktop/src-tauri/tauri.conf.json", json.dumps({"version": "0.1.0"}).encode())
        r = self.repo.check()
        self.refused(r, "tauri.conf.json says 0.1.0")
        self.assertNotIn("package.json", r.stderr)

    def test_refuses_package_json_with_no_version(self):
        self.repo.put("package.json", b"{}")
        self.refused(self.repo.check(), "package.json says None")

    def test_refuses_a_changelog_whose_top_is_another_version(self):
        self.repo.put("CHANGELOG.md", CHANGELOG.replace("## 0.2.0", "## 0.2.1").encode())
        self.refused(self.repo.check(), "CHANGELOG.md's top section says 0.2.1")

    def test_refuses_a_readme_out_of_step(self):
        self.repo.put("apps/desktop/preview/README.txt", b"Desktop Buddies preview 8\n")
        self.refused(self.repo.check(), "first line says 8")

    def test_refuses_an_empty_top_section(self):
        self.repo.put("CHANGELOG.md", b"# Changelog\n\n## 0.2.0\n\n## 0.1.0\n\nOld.\n")
        self.refused(self.repo.check(), "top section is empty")

    def test_refuses_a_missing_changelog(self):
        (self.repo.dir / "CHANGELOG.md").unlink()
        self.refused(self.repo.check(), "there's no CHANGELOG.md")


if __name__ == "__main__":
    unittest.main(verbosity=2)
