#!/usr/bin/env python3
"""Checks a release tag against the version everywhere it's written, and writes that version's notes.

    python3 -I tools/release/version.py v1.2.3 [--notes <notes.md>]

The tag must be vX.Y.Z, and X.Y.Z must be the version in package.json, the top section of
CHANGELOG.md, the first line of apps/desktop/preview/README.txt and apps/desktop/src-tauri/tauri.conf.json,
which the installer takes its version from. Prints the version. The notes are the body of that
CHANGELOG section.
"""
import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
TAG = re.compile(r"v(\d+\.\d+\.\d+)")
SECTION = re.compile(r"## (\S+)")


def stop(why):
    sys.exit(f"version: {why}")


def read(rel):
    try:
        return (ROOT / rel).read_text("utf-8")
    except FileNotFoundError:
        stop(f"there's no {rel}")


def changelog_top(text):
    """The top section's version and body, or stop."""
    lines = text.splitlines()
    starts = [i for i, line in enumerate(lines) if SECTION.match(line)]
    if not starts:
        stop("CHANGELOG.md has no '## <version>' section")
    first = starts[0]
    end = starts[1] if len(starts) > 1 else len(lines)
    body = "\n".join(lines[first + 1:end]).strip()
    if not body:
        stop("CHANGELOG.md's top section is empty")
    return SECTION.match(lines[first]).group(1), body + "\n"


def main():
    args = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    args.add_argument("tag")
    args.add_argument("--notes", type=pathlib.Path)
    o = args.parse_args()

    m = TAG.fullmatch(o.tag)
    if not m:
        stop(f"{o.tag!r} isn't a release tag like v1.2.3")
    version = m.group(1)

    found = {"package.json": json.loads(read("package.json")).get("version")}
    found["CHANGELOG.md's top section"], notes = changelog_top(read("CHANGELOG.md"))
    readme = (read("apps/desktop/preview/README.txt").splitlines() or [""])[0].strip()
    found["preview/README.txt's first line"] = readme.rsplit(" ", 1)[-1]
    found["tauri.conf.json"] = json.loads(read("apps/desktop/src-tauri/tauri.conf.json")).get("version")
    wrong = [f"{where} says {got}" for where, got in found.items() if got != version]
    if wrong:
        stop(f"the tag {o.tag} doesn't match: " + "; ".join(wrong) + ". Update them and tag again")

    if o.notes:
        o.notes.parent.mkdir(parents=True, exist_ok=True)
        o.notes.write_text(notes, "utf-8", newline="\n")
    print(version)


if __name__ == "__main__":
    main()
