"""The MSIX builder up to MakeAppx, which only Windows has: the identity, the manifest, the icons and
the layout, on a stand-in repo. And the facts other files must agree with: the startup task's id in
shell-core, and the package family name in the MCP server.

    python3 -I apps/desktop/packaging/msix/tests/test_msix.py
"""
import json
import pathlib
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zlib

HERE = pathlib.Path(__file__).resolve().parent
MSIX = HERE.parent
REPO = MSIX.parent.parent.parent.parent
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, str(MSIX))
import icons  # noqa: E402
import msix  # noqa: E402

NS = {
    "m": "http://schemas.microsoft.com/appx/manifest/foundation/windows10",
    "uap": "http://schemas.microsoft.com/appx/manifest/uap/windows10",
    "uap3": "http://schemas.microsoft.com/appx/manifest/uap/windows10/3",
    "desktop": "http://schemas.microsoft.com/appx/manifest/desktop/windows10",
    "rescap": "http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities",
}
IDENTITY = {"name": "Test.DesktopBuddies", "publisher": "CN=Desktop Buddies Test", "publisherDisplayName": "exvanitas"}


def png(w, h, pixel):
    return icons.write_png(w, h, bytes(pixel) * (w * h))


def size_of(data):
    return struct.unpack(">II", data[16:24])


class Identity(unittest.TestCase):
    def test_publisher_ids_match_windows_own(self):
        # Two families Windows itself ships: Microsoft.WindowsCalculator_8wekyb3d8bbwe, and the
        # system apps' cw5n1h2txyewy.
        self.assertEqual(msix.publisher_id("CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US"), "8wekyb3d8bbwe")
        self.assertEqual(msix.publisher_id("CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US"), "cw5n1h2txyewy")

    def test_the_mcp_server_names_the_family_this_identity_gives(self):
        identity = msix.read_identity(MSIX / "identity.json")
        server = (REPO / "tools" / "mcp" / "server.mjs").read_text("utf-8")
        named = re.findall(r"^export const PACKAGE_FAMILY = '([^']+)';$", server, re.M)
        self.assertEqual(named, [msix.family(identity)], "tools/mcp/server.mjs's PACKAGE_FAMILY must be what msix.py --family prints")

    def test_the_identity_in_the_repo_is_a_marked_placeholder(self):
        identity = msix.read_identity(MSIX / "identity.json")
        self.assertTrue(msix.placeholder(identity))
        self.assertEqual(identity["publisherDisplayName"], "exvanitas")
        self.assertFalse(msix.placeholder(IDENTITY))

    def test_a_bad_identity_is_refused(self):
        d = pathlib.Path(tempfile.mkdtemp())
        try:
            for bad in ({**IDENTITY, "extra": "x"}, {"name": "x", "publisher": "CN=a"}, {**IDENTITY, "name": "ab"},
                        {**IDENTITY, "name": "has space"}, {**IDENTITY, "publisher": "O=nope"}, {**IDENTITY, "publisherDisplayName": "a<b"},
                        {**IDENTITY, "name": "{{VERSION}}"}, {**IDENTITY, "publisherDisplayName": " "}):
                f = d / "identity.json"
                f.write_text(json.dumps(bad))
                with self.assertRaises(SystemExit, msg=bad):
                    msix.read_identity(f)
            f.write_text("{")
            with self.assertRaises(SystemExit):
                msix.read_identity(f)
        finally:
            shutil.rmtree(d)


class Version(unittest.TestCase):
    def test_what_the_store_takes(self):
        for v in ("1.0.0.0", "65535.65535.65535.0", "2.10.0.0"):
            self.assertEqual(msix.store_version(v), (v, None), v)
        for v, why in (("0.1.0.0", "starts with 0"), ("1.0.0.1", "doesn't end in 0"), ("65536.0.0.0", "over 65535"), ("1.70000.0.0", "over 65535"),
                       ("1.0.0", "isn't four numbers"), ("1.0.0.0.0", "isn't four numbers"), ("01.0.0.0", "isn't four numbers"), ("1.a.0.0", "isn't four numbers"),
                       ("", "isn't four numbers"), ("1.0.0.-0", "isn't four numbers")):
            ok, said = msix.store_version(v)
            self.assertIsNone(ok, v)
            self.assertIn(why, said, v)


class Manifest(unittest.TestCase):
    def setUp(self):
        self.text = msix.manifest(IDENTITY, "1.2.3.0")
        self.xml = ET.fromstring(self.text)
        self.app = self.xml.find("m:Applications/m:Application", NS)

    def test_identity_and_names(self):
        i = self.xml.find("m:Identity", NS).attrib
        self.assertEqual((i["Name"], i["Publisher"], i["Version"], i["ProcessorArchitecture"]), ("Test.DesktopBuddies", "CN=Desktop Buddies Test", "1.2.3.0", "x64"))
        self.assertEqual(self.xml.find("m:Properties/m:PublisherDisplayName", NS).text, "exvanitas")
        self.assertEqual(self.xml.find("m:Properties/m:DisplayName", NS).text, "Desktop Buddies")
        self.assertEqual(self.app.find("uap:VisualElements", NS).get("DisplayName"), "Desktop Buddies")
        self.assertNotIn("{{", self.text)

    def test_desktop_full_trust_and_nothing_else(self):
        family = self.xml.find("m:Dependencies/m:TargetDeviceFamily", NS).attrib
        self.assertEqual((family["Name"], family["MinVersion"]), ("Windows.Desktop", "10.0.17763.0"))
        self.assertEqual((self.app.get("Executable"), self.app.get("EntryPoint")), ("desktop-buddies.exe", "Windows.FullTrustApplication"))
        caps = list(self.xml.find("m:Capabilities", NS))
        self.assertEqual([(c.tag, c.get("Name")) for c in caps], [(f"{{{NS['rescap']}}}Capability", "runFullTrust")])

    def test_the_startup_task_is_shell_cores_and_starts_off(self):
        tasks = self.app.findall("m:Extensions/desktop:Extension[@Category='windows.startupTask']/desktop:StartupTask", NS)
        self.assertEqual(len(tasks), 1)
        rust = (REPO / "apps" / "desktop" / "shell-core" / "src" / "package.rs").read_text("utf-8")
        self.assertEqual(re.findall(r'pub const STARTUP_TASK: &str = "([^"]+)";', rust), [tasks[0].get("TaskId")])
        self.assertEqual(tasks[0].get("Enabled"), "false")

    def test_the_alias_and_the_file_type(self):
        aliases = self.app.findall("m:Extensions/uap3:Extension[@Category='windows.appExecutionAlias']/uap3:AppExecutionAlias/desktop:ExecutionAlias", NS)
        self.assertEqual([a.get("Alias") for a in aliases], ["desktop-buddies.exe"])
        types = self.app.findall("m:Extensions/uap:Extension[@Category='windows.fileTypeAssociation']/uap:FileTypeAssociation", NS)
        self.assertEqual([t.get("Name") for t in types], ["buddy"])
        self.assertEqual([f.text for f in types[0].findall("uap:SupportedFileTypes/uap:FileType", NS)], [".buddy"])

    def test_every_image_it_names_is_drawn(self):
        named = set(re.findall(r"Assets\\([A-Za-z0-9]+)\.png", self.text))
        drawn = {name.split(".")[0] for name, *_ in icons.plan()}
        self.assertEqual(named, drawn)
        for base in named:
            for s in icons.SCALES:
                self.assertIn(f"{base}.scale-{s}.png", [n for n, *_ in icons.plan()])


class Icons(unittest.TestCase):
    def test_the_sizes(self):
        sizes = {name: (w, h, side) for name, w, h, side in icons.plan()}
        self.assertEqual(len(sizes), 6 * 5 + 10)
        self.assertEqual(sizes["Square44x44Logo.scale-100.png"], (44, 44, 44))
        self.assertEqual(sizes["Square150x150Logo.scale-125.png"], (188, 188, 113))
        self.assertEqual(sizes["Wide310x150Logo.scale-200.png"], (620, 300, 180))
        self.assertEqual(sizes["Square310x310Logo.scale-400.png"], (1240, 1240, 744))
        self.assertEqual(sizes["StoreLogo.scale-150.png"], (75, 75, 75))
        self.assertEqual(sizes["Square71x71Logo.scale-100.png"], (71, 71, 43))
        self.assertEqual(sizes["Square44x44Logo.targetsize-24_altform-unplated.png"], (24, 24, 24))

    def test_a_png_reads_back(self):
        rgba = bytes(range(256)) * 4
        self.assertEqual(icons.read_png(icons.write_png(16, 16, rgba)), (16, 16, rgba))

    def test_every_filter_and_rgb_read(self):
        # A 3x2 RGB image, one row with Paeth and one with Average, as encoders write them.
        rows = [bytes([10, 20, 30, 40, 50, 60, 70, 80, 90]), bytes([1, 2, 3, 4, 5, 6, 7, 8, 9])]
        def paeth(a, b, c):
            p = a + b - c
            pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
            return a if pa <= pb and pa <= pc else b if pb <= pc else c
        r0 = bytes([4]) + bytes((rows[0][i] - paeth(rows[0][i - 3] if i >= 3 else 0, 0, 0)) & 255 for i in range(9))
        r1 = bytes([3]) + bytes((rows[1][i] - (((rows[1][i - 3] if i >= 3 else 0) + rows[0][i]) >> 1)) & 255 for i in range(9))
        def chunk(kind, body):
            return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
        data = icons.SIG + chunk(b"IHDR", struct.pack(">IIBBBBB", 3, 2, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(r0 + r1)) + chunk(b"IEND", b"")
        w, h, rgba = icons.read_png(data)
        self.assertEqual((w, h), (3, 2))
        self.assertEqual(rgba, b"".join(bytes(r[i:i + 3]) + b"\xff" for r in rows for i in range(0, 9, 3)))

    def test_other_pngs_are_refused(self):
        with self.assertRaises(ValueError):
            icons.read_png(b"GIF89a")
        def chunk(kind, body):
            return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
        for depth, color in ((16, 6), (8, 3), (8, 0)):
            with self.assertRaises(ValueError):
                icons.read_png(icons.SIG + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, depth, color, 0, 0, 0)) + chunk(b"IEND", b""))

    def test_a_flat_colour_stays_that_colour_at_any_size(self):
        for side in (1, 5, 16, 40):
            out = icons.resize(16, 16, bytes((160, 132, 230, 255)) * 256, side)
            self.assertEqual(set(out[i:i + 4] for i in range(0, len(out), 4)), {bytes((160, 132, 230, 255))}, side)

    def test_clear_pixels_bleed_no_colour(self):
        # Half clear red, half solid blue: every pixel that shows any of it is blue.
        rgba = b"".join((bytes((255, 0, 0, 0)) if x < 8 else bytes((0, 0, 255, 255))) for y in range(16) for x in range(16))
        out = icons.resize(16, 16, rgba, 7)
        seen = {out[i:i + 3] for i in range(0, len(out), 4) if out[i + 3]}
        self.assertEqual(seen, {bytes((0, 0, 255))})
        self.assertIn(bytes((0, 0, 0, 0)), {out[i:i + 4] for i in range(0, len(out), 4)})

    def test_shrinking_loses_nothing_in_a_corner(self):
        # One lit pixel in a corner still shows when 16 pixels become 2: each output pixel takes in
        # all of its source.
        rgba = bytearray(16 * 16 * 4)
        rgba[0:4] = bytes((255, 255, 255, 255))
        out = icons.resize(16, 16, bytes(rgba), 2)
        self.assertGreater(out[3], 0)
        self.assertEqual(out[4 * 3 + 3], 0, "the far corner sees none of it")

    def test_the_icon_sits_in_the_middle(self):
        out = icons.place(6, 4, 2, bytes((9, 9, 9, 255)) * 4)
        lit = [(i // 4) for i in range(0, len(out), 4) if out[i + 3]]
        self.assertEqual([(p % 6, p // 6) for p in lit], [(2, 1), (3, 1), (2, 2), (3, 2)])

    def test_the_real_icon_reads_and_draws(self):
        real = (REPO / "apps" / "desktop" / "src-tauri" / "icons" / "icon.png").read_bytes()
        w, h, rgba = icons.read_png(real)
        self.assertEqual((w, h), (512, 512))
        a = icons.resize(w, h, rgba, 24)
        self.assertGreater(sum(1 for i in range(3, len(a), 4) if a[i] == 255), 24 * 24 // 2, "mostly solid")


class Stage(unittest.TestCase):
    """The whole layout, on a stand-in repo with a small icon, so it's quick."""

    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp(prefix="buddies-msix-test-"))
        d = self.dir
        for name in ("msix.py", "icons.py", "AppxManifest.xml", "identity.json"):
            self.put(f"apps/desktop/packaging/msix/{name}", (MSIX / name).read_bytes())
        self.put("apps/desktop/src-tauri/icons/icon.png", png(8, 8, (160, 132, 230, 255)))
        self.put("package.json", json.dumps({"name": "desktop-buddies", "version": "1.0.0"}).encode())
        for name in ("LICENSE", "NOTICE", "TRADEMARKS.md"):
            self.put(name, name.encode())
        self.put("apps/desktop/dist/app/hub.html", b"<p>hub</p>")
        self.put("apps/desktop/dist/app/fonts/a.woff2", b"font")
        self.put("in/desktop-buddies.exe", b"MZ a stand-in exe")
        self.put("in/notices.txt", b"notices")
        self.put("in/identity.json", json.dumps(IDENTITY).encode())

    def tearDown(self):
        shutil.rmtree(self.dir)

    def put(self, rel, data):
        p = self.dir / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def run_msix(self, *more):
        return subprocess.run([sys.executable, "-I", str(self.dir / "apps/desktop/packaging/msix/msix.py"), "--exe", str(self.dir / "in/desktop-buddies.exe"), *more],
                              capture_output=True, text=True)

    def test_the_layout(self):
        out = self.dir / "out"
        r = self.run_msix("--stage", str(out), "--stage-only", "--notices", str(self.dir / "in/notices.txt"), "--identity", str(self.dir / "in/identity.json"))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("warning", r.stdout)
        self.assertIn("family Test.DesktopBuddies_", r.stdout)
        files = sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file())
        assets = sorted("Assets/" + n for n, *_ in icons.plan())
        self.assertEqual(files, sorted(["AppxManifest.xml", "desktop-buddies.exe", "LICENSE", "NOTICE", "TRADEMARKS.md", "THIRD-PARTY-NOTICES.txt", "app/hub.html", "app/fonts/a.woff2", *assets]))
        self.assertEqual((out / "desktop-buddies.exe").read_bytes(), b"MZ a stand-in exe")
        m = ET.fromstring((out / "AppxManifest.xml").read_bytes())
        self.assertEqual(m.find("m:Identity", NS).get("Version"), "1.0.0.0")
        self.assertEqual(m.find("m:Identity", NS).get("Name"), "Test.DesktopBuddies")
        for name, w, h, _ in icons.plan():
            self.assertEqual(size_of((out / "Assets" / name).read_bytes()), (w, h), name)

    def test_the_repo_identity_warns_that_it_is_a_placeholder(self):
        r = self.run_msix("--stage-only")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("::warning::msix: identity.json holds placeholders", r.stdout)

    def test_refusals(self):
        self.put("in/not.exe", b"not an exe")
        r = subprocess.run([sys.executable, "-I", str(self.dir / "apps/desktop/packaging/msix/msix.py"), "--exe", str(self.dir / "in/not.exe"), "--stage-only"], capture_output=True, text=True)
        self.assertIn("isn't a Windows exe", r.stderr)
        r = self.run_msix("--stage-only", "--app", str(self.dir / "in"))
        self.assertIn("has no hub.html", r.stderr)
        self.put("full/x", b"x")
        r = self.run_msix("--stage-only", "--stage", str(self.dir / "full"))
        self.assertIn("isn't empty", r.stderr)
        r = self.run_msix()
        self.assertNotEqual(r.returncode, 0)
        self.put("package.json", json.dumps({"version": "1.2"}).encode())
        r = self.run_msix("--stage-only")
        self.assertIn("isn't like 1.2.3", r.stderr)

    def test_a_version_the_store_refuses_stages_nothing(self):
        out = self.dir / "out"
        for v, why in (("0.1.0", "starts with 0"), ("1.65536.0", "over 65535")):
            self.put("package.json", json.dumps({"version": v}).encode())
            r = self.run_msix("--stage-only", "--stage", str(out))
            self.assertNotEqual(r.returncode, 0)
            self.assertIn(f"package.json's version {v} as {v}.0", r.stderr)
            self.assertIn(why, r.stderr)
            self.assertIn("Nothing was staged", r.stderr)
            self.assertFalse(out.exists(), v)

    def test_a_test_package_can_have_its_own_version_by_the_same_rule(self):
        self.put("package.json", json.dumps({"version": "0.1.0"}).encode())
        out = self.dir / "out"
        r = self.run_msix("--stage-only", "--stage", str(out), "--version", "2.3.4.0")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(ET.fromstring((out / "AppxManifest.xml").read_bytes()).find("m:Identity", NS).get("Version"), "2.3.4.0")
        r = self.run_msix("--stage-only", "--version", "2.3.4.5")
        self.assertIn("--version: '2.3.4.5' doesn't end in 0", r.stderr)


if __name__ == "__main__":
    unittest.main()
