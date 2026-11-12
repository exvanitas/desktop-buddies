"""The release scripts on a stand-in repo: the packer in both modes, and the version check.

    python3 -I tools/release/tests/test_release.py
"""
import hashlib
import json
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
        for rel in ("apps/desktop/scripts/preview.py", "tools/release/version.py"):
            (d / rel).parent.mkdir(parents=True)
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
