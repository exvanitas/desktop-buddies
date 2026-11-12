"""The winget manifest writer, on a copy of it with its schemas, and against the installer builder.

    python3 -I tools/release/tests/test_winget.py
"""
import hashlib
import importlib.util
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO = pathlib.Path(__file__).resolve().parent.parent.parent.parent
WINGET = REPO / "packaging" / "winget"
SHA = hashlib.sha256(b"a stand-in setup").hexdigest()
SETUP = "desktop-buddies-0.2.0-setup-x64.exe"
DIR = "manifests/e/exvanitas/DesktopBuddies/0.2.0"


def load(path, name):
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


M = load(WINGET / "manifest.py", "manifest")
INSTALLER = load(REPO / "apps/desktop/scripts/installer.py", "installer")


def read_yaml(text):
    """The YAML the writer makes, read by YAML's rules for it: block maps, block lists of scalars or of
    maps, plain scalars, and double-quoted ones, which read as JSON strings. Anything else fails."""
    lines = [l for l in text.split("\n") if l.strip() and not l.lstrip().startswith("#")]
    for l in lines:
        assert "\t" not in l, f"a tab: {l!r}"

    def value(s):
        if s.startswith('"'):
            return json.loads(s)
        assert not s.startswith(("'", "[", "{", "&", "*", "!", "|", ">", "%", "@", "`", "-", "?")), f"not a plain scalar: {s!r}"
        assert ": " not in s and " #" not in s and not s.endswith(":"), f"not a plain scalar: {s!r}"
        return s

    def block(i, indent):
        out = {}
        while i < len(lines):
            l = lines[i]
            ind = len(l) - len(l.lstrip(" "))
            if ind < indent:
                break
            assert ind == indent, f"indented wrong: {l!r}"
            key, _, rest = l.strip().partition(":")
            assert key and key not in out, f"bad or repeated key: {l!r}"
            if rest.strip():
                out[key] = value(rest.strip())
                i += 1
            elif i + 1 < len(lines) and lines[i + 1].lstrip().startswith("- ") and len(lines[i + 1]) - len(lines[i + 1].lstrip(" ")) == indent:
                out[key], i = seq(i + 1, indent)
            else:
                out[key], i = block(i + 1, indent + 2)
        return out, i

    def seq(i, indent):
        out = []
        while i < len(lines) and lines[i].startswith(" " * indent + "- "):
            item = lines[i][indent + 2:]
            if ": " in item and not item.startswith('"'):
                # a map: its first line after the dash, the rest under it
                lines[i] = " " * (indent + 2) + item
                m, i = block(i, indent + 2)
                out.append(m)
            else:
                out.append(value(item))
                i += 1
        return out, i

    data, end = block(0, 0)
    assert end == len(lines), f"left over: {lines[end:]}"
    return data


class Writer(unittest.TestCase):
    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp(prefix="buddies-winget-"))
        self.addCleanup(shutil.rmtree, self.dir)
        (self.dir / "winget").mkdir()
        shutil.copy(WINGET / "manifest.py", self.dir / "winget" / "manifest.py")
        shutil.copytree(WINGET / "schema", self.dir / "winget" / "schema")
        (self.dir / "SHA256SUMS.txt").write_text(f"{'0' * 64}  desktop-buddies-0.2.0-windows-x64.zip\n{SHA}  {SETUP}\n")

    def run_it(self, *args):
        return subprocess.run([sys.executable, "-I", str(self.dir / "winget" / "manifest.py"), *map(str, args)],
                              cwd=self.dir, capture_output=True, text=True)

    def written(self, rel=f"winget/{DIR}"):
        return {f.name: f.read_text() for f in sorted((self.dir / rel).iterdir())}

    def refused(self, r, words):
        self.assertNotEqual(r.returncode, 0, r.stdout)
        self.assertIn(words, r.stderr)
        self.assertFalse((self.dir / "winget" / "manifests").exists(), "nothing written")

    def test_writes_the_three_files_in_winget_pkgs_layout(self):
        r = self.run_it("--version", "0.2.0", "--sums", "SHA256SUMS.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        files = self.written()
        self.assertEqual(sorted(files), ["exvanitas.DesktopBuddies.installer.yaml", "exvanitas.DesktopBuddies.locale.en-US.yaml",
                                         "exvanitas.DesktopBuddies.yaml"])
        for name, text in files.items():
            data = read_yaml(text)
            kind = data["ManifestType"]
            self.assertTrue(text.startswith(f"# yaml-language-server: $schema=https://aka.ms/winget-manifest.{kind}.1.28.0.schema.json\n\n"), name)
            self.assertEqual((data["PackageIdentifier"], data["PackageVersion"], data["ManifestVersion"]), ("exvanitas.DesktopBuddies", "0.2.0", "1.28.0"))
            schema = json.loads((WINGET / f"schema/1.28.0/manifest.{kind}.1.28.0.json").read_text())
            self.assertEqual(M.problems(data, schema, schema), [], name)
            self.assertNotIn("\r", text)
            try:
                import yaml  # a real YAML reader too, where there is one
            except ImportError:
                continue
            self.assertEqual(yaml.safe_load(text), data, name)

    def test_the_installer_entry(self):
        self.assertEqual(self.run_it("--version", "0.2.0", "--sums", "SHA256SUMS.txt").returncode, 0)
        data = read_yaml(self.written()["exvanitas.DesktopBuddies.installer.yaml"])
        # the new setup runs over the old install, which keeps the Run value and data, and replaces the
        # app folder whole itself (installer-hooks.nsh)
        self.assertEqual((data["InstallerType"], data["Scope"], data["UpgradeBehavior"]), ("nullsoft", "user", "install"))
        self.assertEqual(data["Installers"], [{"Architecture": "x64", "InstallerSha256": SHA.upper(),
                                               "InstallerUrl": f"https://github.com/exvanitas/desktop-buddies/releases/download/v0.2.0/{SETUP}"}])
        self.assertEqual(data["AppsAndFeaturesEntries"], [{"DisplayName": "Desktop Buddies", "Publisher": "exvanitas", "ProductCode": "Desktop Buddies"}])
        self.assertEqual(data["InstallationMetadata"], {"DefaultInstallLocation": "%LocalAppData%\\Desktop Buddies"})

    def test_the_locale_entry(self):
        self.assertEqual(self.run_it("--version", "0.2.0", "--sha256", SHA).returncode, 0)
        data = read_yaml(self.written()["exvanitas.DesktopBuddies.locale.en-US.yaml"])
        self.assertEqual((data["Publisher"], data["PackageName"], data["License"]), ("exvanitas", "Desktop Buddies", "MIT"))
        self.assertEqual(data["LicenseUrl"], "https://github.com/exvanitas/desktop-buddies/blob/main/LICENSE")
        self.assertEqual(data["ReleaseNotesUrl"], "https://github.com/exvanitas/desktop-buddies/releases/tag/v0.2.0")
        self.assertIn("shimeji", data["Tags"])

    def test_takes_another_url_and_folder(self):
        url = f"https://example.org/mirror/{SETUP}"
        r = self.run_it("--version", "0.2.0", "--sha256", SHA, "--url", url, "--out", "elsewhere")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(read_yaml(self.written("elsewhere")["exvanitas.DesktopBuddies.installer.yaml"])["Installers"][0]["InstallerUrl"], url)

    def test_refuses_what_isnt_right(self):
        self.refused(self.run_it("--version", "0.2", "--sha256", SHA), "isn't a version")
        self.refused(self.run_it("--version", "0.2.0", "--sha256", SHA[:-1]), "isn't a SHA-256")
        self.refused(self.run_it("--version", "0.3.0", "--sums", "SHA256SUMS.txt"), "no line for desktop-buddies-0.3.0-setup-x64.exe")
        self.refused(self.run_it("--version", "0.2.0", "--sha256", SHA, "--url", f"http://example.org/{SETUP}"), "isn't an https URL")
        self.refused(self.run_it("--version", "0.2.0", "--sha256", SHA, "--url", "https://example.org/desktop-buddies-0.1.0-setup-x64.exe"), "isn't an https URL")
        self.refused(self.run_it("--version", "0.2.0", "--sha256", SHA, "--sums", "SHA256SUMS.txt"), "not allowed with")

    def test_writes_nothing_that_breaks_the_schema(self):
        (self.dir / "winget/manifest.py").write_text((WINGET / "manifest.py").read_text().replace('"Scope": "user"', '"Scope": "everyone"'))
        self.refused(self.run_it("--version", "0.2.0", "--sha256", SHA), "Scope is 'everyone', not one of")


class Schema(unittest.TestCase):
    """The checker against the real schemas, each way a manifest can break one."""

    def good(self):
        return M.manifests("0.2.0", f"https://example.org/{SETUP}", SHA)[f"{M.ID}.installer.yaml"]

    def check(self, m):
        s = M.schema_for(m)
        return M.problems(m, s, s)

    def test_the_real_manifests_fit(self):
        for m in M.manifests("0.2.0", f"https://example.org/{SETUP}", SHA).values():
            self.assertEqual(self.check(m), [])

    def test_each_break(self):
        def broken(change):
            m = json.loads(json.dumps(self.good()))
            change(m)
            return " | ".join(self.check(m))
        self.assertIn("has no Installers", broken(lambda m: m.pop("Installers")))
        self.assertIn("doesn't know, Silent", broken(lambda m: m.update(Silent=True)))
        self.assertIn("InstallerType is 'nsis'", broken(lambda m: m.update(InstallerType="nsis")))
        self.assertIn("InstallerSha256 doesn't match", broken(lambda m: m["Installers"][0].update(InstallerSha256="xyz")))
        self.assertIn("InstallerUrl doesn't match", broken(lambda m: m["Installers"][0].update(InstallerUrl="ftp://x/y")))
        self.assertIn("ProductCode is 256 characters", broken(lambda m: m.update(ProductCode="x" * 256)))
        self.assertIn("InstallModes has an item twice", broken(lambda m: m.update(InstallModes=["silent", "silent"])))
        self.assertIn("Installers has 0 items", broken(lambda m: m.update(Installers=[])))
        self.assertIn("PackageVersion is a int", broken(lambda m: m.update(PackageVersion=2)))
        self.assertIn("ManifestVersion doesn't match", broken(lambda m: m.update(ManifestVersion="1.28")))

    def test_a_ref_and_oneof(self):
        root = {"definitions": {"S": {"type": "string", "maxLength": 2}}}
        self.assertEqual(M.problems("ab", {"$ref": "#/definitions/S"}, root), [])
        self.assertTrue(M.problems("abc", {"$ref": "#/definitions/S"}, root))
        either = {"oneOf": [{"type": "string"}, {"type": "string", "maxLength": 1}]}
        self.assertTrue(M.problems("a", either, root), "both match: not exactly one")
        self.assertEqual(M.problems("ab", either, root), [])
        self.assertTrue(M.problems(True, {"type": "integer"}, root), "a bool isn't an integer")


class Scalars(unittest.TestCase):
    def test_quoted_where_yaml_would_read_another_thing(self):
        for s in ("yes", "No", "on", "true", "null", "1.0", "12", "a: b", "a #b", "%LocalAppData%\\x", "-x", "x ", "", "é"):
            out = M.scalar(s)
            self.assertTrue(out.startswith('"'), (s, out))
            self.assertEqual(json.loads(out), s)
        for s in ("Desktop Buddies", "0.2.0", "1.28.0", "https://github.com/exvanitas/desktop-buddies", "en-US", "nullsoft"):
            self.assertEqual(M.scalar(s), s)
        try:
            import yaml
        except ImportError:
            return
        for s in ("yes", "on", "1.0", "a: b", "%x", "Desktop Buddies", "0.2.0", "https://a.b/c:d", "a, b (c)", "x\\y"):
            self.assertEqual(yaml.safe_load(f"k: {M.scalar(s)}"), {"k": s}, s)


class Agrees(unittest.TestCase):
    """What winget is told matches what the installer does."""

    def test_with_the_installer_builder(self):
        m = M.manifests("0.2.0", f"https://example.org/{SETUP}", SHA)[f"{M.ID}.installer.yaml"]
        # the uninstall entry Tauri's NSIS script writes: its key and DisplayName are the product name,
        # its Publisher the bundle's publisher
        self.assertEqual(m["ProductCode"], INSTALLER.PRODUCT)
        self.assertEqual(m["AppsAndFeaturesEntries"][0], {"DisplayName": INSTALLER.PRODUCT, "Publisher": INSTALLER.BUNDLE["publisher"], "ProductCode": INSTALLER.PRODUCT})
        self.assertEqual(m["Scope"], "user")
        self.assertEqual(INSTALLER.BUNDLE["windows"]["nsis"]["installMode"], "currentUser")
        self.assertEqual(m["InstallationMetadata"]["DefaultInstallLocation"], f"%LocalAppData%\\{INSTALLER.PRODUCT}")
        self.assertEqual(M.setup_name("0.2.0"), SETUP)
        self.assertIn('f"desktop-buddies-{o.release}-setup-x64.exe"', (REPO / "apps/desktop/scripts/installer.py").read_text())
        self.assertEqual(M.SHORT, INSTALLER.BUNDLE["shortDescription"])

    def test_with_the_mcp_servers_default(self):
        """The MCP server's first choice, the zip's place, is where the installer puts the exe, with the
        data in %APPDATA% as the installed app keeps it."""
        server = (REPO / "tools/mcp/server.mjs").read_text()
        self.assertIn("local = env.LOCALAPPDATA || 'C:\\\\'", server)
        self.assertIn("zip: { exe: win.join(local, 'Desktop Buddies', 'desktop-buddies.exe'), dataDir: win.join(env.APPDATA || 'C:\\\\', DATA) }", server)
        self.assertIn("'dev.exvanitas.desktop-buddies'", server)


if __name__ == "__main__":
    unittest.main(verbosity=2)
