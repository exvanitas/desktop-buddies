#!/usr/bin/env python3
"""Writes the winget manifests for a release: the version, installer and defaultLocale files.

    python3 -I packaging/winget/manifest.py --version X.Y.Z --sums <SHA256SUMS.txt> [--url <url>] [--out <dir>]
    python3 -I packaging/winget/manifest.py --version X.Y.Z --sha256 <hex> [--url <url>] [--out <dir>]

The installer's hash comes from the release's own SHA256SUMS.txt, or is given. The URL is the GitHub
release asset, desktop-buddies-X.Y.Z-setup-x64.exe under the vX.Y.Z tag, unless --url names another
https URL for that file. The files go into <dir>, by default
packaging/winget/manifests/e/exvanitas/DesktopBuddies/X.Y.Z/, laid out as in microsoft/winget-pkgs.
Each one is checked against the winget schema in packaging/winget/schema/ before it's written, and
nothing is written if any fails. packaging/winget/README.md says how they go to winget.
"""
import argparse
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
SCHEMA = "1.28.0"
ID = "exvanitas.DesktopBuddies"
REPO = "https://github.com/exvanitas/desktop-buddies"
NAME = "Desktop Buddies"
PUBLISHER = "exvanitas"
LOCALE = "en-US"
SHORT = "Little characters that live on your Windows desktop."
DESCRIPTION = ("Little characters that live on your Windows desktop. They walk along your windows, climb the sides, "
               "hang underneath, nap, chat and get thrown about. Make your own in the Maker from one picture or a full "
               "set of poses, or bring in a Shimeji folder. No buddies are included.")
TAGS = ["desktop-pet", "shimeji", "mascot", "pet", "animation"]


def stop(why):
    sys.exit(f"manifest: {why}")


def setup_name(version):
    return f"desktop-buddies-{version}-setup-x64.exe"


def manifests(version, url, sha256):
    """The three manifests, by file name, as data."""
    head = {"PackageIdentifier": ID, "PackageVersion": version}
    tail = {"ManifestVersion": SCHEMA}
    return {
        f"{ID}.yaml": {**head, "DefaultLocale": LOCALE, "ManifestType": "version", **tail},
        f"{ID}.installer.yaml": {
            **head,
            "InstallerLocale": LOCALE,
            "InstallerType": "nullsoft",
            "Scope": "user",
            "InstallModes": ["interactive", "silent", "silentWithProgress"],
            "UpgradeBehavior": "install",
            "ProductCode": NAME,
            "AppsAndFeaturesEntries": [{"DisplayName": NAME, "Publisher": PUBLISHER, "ProductCode": NAME}],
            "InstallationMetadata": {"DefaultInstallLocation": f"%LocalAppData%\\{NAME}"},
            "Installers": [{"Architecture": "x64", "InstallerUrl": url, "InstallerSha256": sha256.upper()}],
            "ManifestType": "installer", **tail,
        },
        f"{ID}.locale.{LOCALE}.yaml": {
            **head,
            "PackageLocale": LOCALE,
            "Publisher": PUBLISHER,
            "PublisherUrl": "https://github.com/exvanitas",
            "PublisherSupportUrl": f"{REPO}/issues",
            "PackageName": NAME,
            "PackageUrl": REPO,
            "License": "MIT",
            "LicenseUrl": f"{REPO}/blob/main/LICENSE",
            "ShortDescription": SHORT,
            "Description": DESCRIPTION,
            "Tags": TAGS,
            "ReleaseNotesUrl": f"{REPO}/releases/tag/v{version}",
            "ManifestType": "defaultLocale", **tail,
        },
    }


def schema_for(manifest):
    kind = manifest["ManifestType"]
    return json.loads((HERE / "schema" / SCHEMA / f"manifest.{kind}.{SCHEMA}.json").read_text("utf-8"))


# The JSON Schema keywords the winget schemas use, and no more. Unknown fields are refused, as winget
# validate refuses them, though the schemas themselves allow them.
TYPES = {"string": str, "array": list, "object": dict, "integer": int, "boolean": bool, "number": (int, float), "null": type(None)}


def problems(value, schema, root, where="manifest"):
    """Each way value breaks schema, as a line naming where."""
    if "$ref" in schema:
        node = root
        for part in schema["$ref"].lstrip("#/").split("/"):
            node = node[part]
        return problems(value, node, root, where)
    out = []
    types = schema.get("type")
    if types is not None:
        types = types if isinstance(types, list) else [types]
        if not any(isinstance(value, TYPES[t]) and not (t in ("integer", "number") and isinstance(value, bool)) for t in types):
            return [f"{where} is a {type(value).__name__}, not {'/'.join(types)}"]
    if "const" in schema and value != schema["const"]:
        out.append(f"{where} is {value!r}, not {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        out.append(f"{where} is {value!r}, not one of {schema['enum']}")
    if isinstance(value, str):
        if "pattern" in schema and not re.search(schema["pattern"], value):
            out.append(f"{where} doesn't match {schema['pattern']}")
        if len(value) < schema.get("minLength", 0) or len(value) > schema.get("maxLength", len(value)):
            out.append(f"{where} is {len(value)} characters long")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if value < schema.get("minimum", value) or value > schema.get("maximum", value):
            out.append(f"{where} is out of range")
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0) or len(value) > schema.get("maxItems", len(value)):
            out.append(f"{where} has {len(value)} items")
        if schema.get("uniqueItems") and len({json.dumps(v, sort_keys=True) for v in value}) != len(value):
            out.append(f"{where} has an item twice")
        for i, item in enumerate(value):
            out += problems(item, schema.get("items", {}), root, f"{where}[{i}]")
    if isinstance(value, dict):
        props = schema.get("properties", {})
        out += [f"{where} has no {k}" for k in schema.get("required", []) if k not in value]
        for k, v in value.items():
            if k not in props:
                out.append(f"{where} has a field winget doesn't know, {k}")
            else:
                out += problems(v, props[k], root, f"{where}.{k}")
    if "oneOf" in schema and sum(not problems(value, s, root, where) for s in schema["oneOf"]) != 1:
        out.append(f"{where} doesn't match exactly one of its forms")
    if "not" in schema and not problems(value, schema["not"], root, where):
        out.append(f"{where} matches a form it mustn't")
    return out


# YAML out. Plain where it's plainly a string to every YAML reader, else double-quoted as JSON writes
# it, which YAML reads the same.
PLAIN = re.compile(r"[A-Za-z][A-Za-z0-9 ._/:,()%\\-]*")
WORDS = {"y", "n", "yes", "no", "true", "false", "on", "off", "null"}


def scalar(s):
    if re.fullmatch(r"\d+(\.\d+){2,}", s):
        return s  # a version with two dots is never a number
    if PLAIN.fullmatch(s) and s.lower() not in WORDS and ": " not in s and not s.endswith((":", " ")):
        return s
    return json.dumps(s, ensure_ascii=False)


def yaml_lines(value, indent=""):
    out = []
    for k, v in value.items():
        if isinstance(v, dict):
            out.append(f"{indent}{k}:")
            out += yaml_lines(v, indent + "  ")
        elif isinstance(v, list):
            out.append(f"{indent}{k}:")
            for item in v:
                if isinstance(item, dict):
                    inner = yaml_lines(item, indent + "  ")
                    out.append(f"{indent}- {inner[0].strip()}")
                    out += inner[1:]
                else:
                    out.append(f"{indent}- {scalar(item)}")
        else:
            out.append(f"{indent}{k}: {scalar(v)}")
    return out


def to_yaml(manifest):
    kind = manifest["ManifestType"]
    return f"# yaml-language-server: $schema=https://aka.ms/winget-manifest.{kind}.{SCHEMA}.schema.json\n\n" + "\n".join(yaml_lines(manifest)) + "\n"


def hash_from_sums(path, name):
    for line in path.read_text("utf-8").splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1].lstrip("*") == name:
            return parts[0]
    stop(f"{path} has no line for {name}")


def main():
    args = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    args.add_argument("--version", required=True, metavar="X.Y.Z")
    found = args.add_mutually_exclusive_group(required=True)
    found.add_argument("--sums", type=pathlib.Path, help="the release's SHA256SUMS.txt")
    found.add_argument("--sha256", help="the installer's SHA-256")
    args.add_argument("--url")
    args.add_argument("--out", type=pathlib.Path)
    o = args.parse_args()

    if not re.fullmatch(r"\d+\.\d+\.\d+", o.version):
        stop(f"{o.version!r} isn't a version like 1.2.3")
    name = setup_name(o.version)
    sha256 = o.sha256 if o.sums is None else hash_from_sums(o.sums, name)
    if not re.fullmatch(r"[0-9A-Fa-f]{64}", sha256):
        stop(f"{sha256!r} isn't a SHA-256")
    url = o.url or f"{REPO}/releases/download/v{o.version}/{name}"
    if not url.startswith("https://") or not url.endswith(f"/{name}"):
        stop(f"{url} isn't an https URL for {name}")

    files = manifests(o.version, url, sha256)
    wrong = [f"{file}: {p}" for file, m in files.items() for p in problems(m, schema_for(m), schema_for(m))]
    if wrong:
        stop("the manifests don't fit the winget schema: " + "; ".join(wrong))
    out = o.out or HERE / "manifests" / "e" / "exvanitas" / "DesktopBuddies" / o.version
    out.mkdir(parents=True, exist_ok=True)
    for file, m in files.items():
        (out / file).write_text(to_yaml(m), "utf-8", newline="\n")
    print(f"{out}: {', '.join(files)}, installer sha256 {sha256.upper()}")


if __name__ == "__main__":
    main()
