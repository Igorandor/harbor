"""Offline regression checks for the exact Embedded Python methods shipped to IRIS."""
from pathlib import Path
import json
import re
import sys
import tempfile
import types
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "iris" / "Harbor" / "LogReader.cls"


def embedded(method, arguments):
    text = SOURCE.read_text(encoding="utf-8-sig")
    match = re.search(r"ClassMethod " + method + r"\([^\n]+\[ Language = python \]\n\{\n(.*?)\n\}", text, re.S)
    if not match:
        raise AssertionError("Embedded method missing: " + method)
    namespace = {}
    exec("def run(" + arguments + "):\n" + match.group(1), namespace)
    return namespace["run"]


class LogReaderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="harbor-log-pages-")
        self.root = Path(self.temp.name)
        self.old_iris = sys.modules.get("iris")
        sys.modules["iris"] = types.SimpleNamespace(system=types.SimpleNamespace(Util=types.SimpleNamespace(ManagerDirectory=lambda: str(self.root))))
        self.window = embedded("Window", "file, offset='', snapshot='', identity='', limit=200")
        self.catalog = embedded("Catalog", "")

    def tearDown(self):
        if self.old_iris is None:
            sys.modules.pop("iris", None)
        else:
            sys.modules["iris"] = self.old_iris
        self.temp.cleanup()

    def page(self, name="messages.log", **kwargs):
        return json.loads(self.window(name, **kwargs))

    def test_pages_have_no_duplicate_or_missing_short_lines(self):
        content = "".join("line-%04d\n" % number for number in range(1000))
        (self.root / "messages.log").write_text(content)
        offsets = set()
        pages = []
        current = self.page(limit=73)
        while True:
            pages.append(current)
            self.assertLessEqual(current["scannedBytes"], 262144)
            for line in current["lines"]:
                self.assertNotIn(line["offset"], offsets)
                offsets.add(line["offset"])
            if current["olderOffset"] is None:
                break
            current = self.page(offset=str(current["olderOffset"]), snapshot=str(current["snapshotBytes"]), identity=current["identity"], limit=73)
        recovered = [line["text"] for page in reversed(pages) for line in page["lines"]]
        self.assertEqual(recovered, content.splitlines())

    def test_append_keeps_snapshot_but_truncate_and_rewrite_invalidate_it(self):
        path = self.root / "messages.log"
        path.write_text("original-entry\n" * 100)
        first = self.page(limit=20)
        with path.open("a") as stream:
            stream.write("new-entry\n")
        older = self.page(offset=str(first["olderOffset"]), snapshot=str(first["snapshotBytes"]), identity=first["identity"])
        self.assertEqual(older["snapshotBytes"], first["snapshotBytes"])
        self.assertGreater(older["currentBytes"], first["snapshotBytes"])
        path.write_text("different-entry\n" * 200)
        rewritten = self.page(offset=str(first["olderOffset"]), snapshot=str(first["snapshotBytes"]), identity=first["identity"])
        self.assertEqual(rewritten["status"], 409)
        path.write_text("short")
        self.assertEqual(self.page(snapshot=str(first["snapshotBytes"]))["status"], 409)

    def test_long_partial_line_is_omitted_with_a_bounded_window(self):
        for name in ["messages.log", "messages.old_20260928"]:
            with self.subTest(name=name):
                (self.root / name).write_bytes(b"x" * 300000)
                page = self.page(name)
                self.assertEqual(page["scannedBytes"], 262144)
                self.assertEqual(page["lines"], [])
                self.assertGreater(page["olderOffset"], 0)

    def test_masking_unicode_and_line_clipping(self):
        (self.root / "messages.log").write_text("password=example\n" + "ż" * 20000 + "\n", encoding="utf-8")
        page = self.page()
        self.assertNotIn("example", json.dumps(page))
        self.assertTrue(page["lines"][-1]["clipped"])
        self.assertTrue(page["lines"][-1]["text"].startswith("żż"))

    def test_catalog_and_window_reject_paths_and_unrecognized_archives(self):
        for name in ["messages.log", "alerts.log.1", "messages.log-2026-09-26", "private.log", "messages.log.gz"]:
            (self.root / name).write_text("record\n")
        names = {item["id"] for item in json.loads(self.catalog())["files"]}
        self.assertEqual(names, {"messages.log", "alerts.log.1", "messages.log-2026-09-26"})
        for name in ["../messages.log", "/etc/passwd", "messages.log.gz"]:
            self.assertEqual(self.page(name)["status"], 400)

    def test_native_message_rotations_are_catalogued_and_read(self):
        rotated = ["messages.old_20260928", "messages.old_2026-09-28_10-23-04"]
        for name in ["messages.log", "alerts.log.1", *rotated]:
            (self.root / name).write_text("retained-entry\n" * 90)
        files = json.loads(self.catalog())["files"]
        self.assertEqual(files[0]["id"], "messages.log")
        by_name = {item["id"]: item for item in files}
        for name in rotated:
            with self.subTest(name=name):
                self.assertIn(name, by_name)
                self.assertEqual(by_name[name]["source"], "messages")
                self.assertFalse(by_name[name]["active"])
                first = self.page(name, limit=20)
                self.assertEqual(len(first["lines"]), 20)
                older = self.page(name, offset=str(first["olderOffset"]), snapshot=str(first["snapshotBytes"]), identity=first["identity"], limit=20)
                self.assertEqual(older["end"], first["start"])
                self.assertEqual(older["identity"], first["identity"])
                (self.root / name).write_text("replacement\n" * 90)
                self.assertEqual(self.page(name, identity=first["identity"])["status"], 409)

    def test_native_rotation_allowlist_remains_narrow(self):
        rejected = ["messages.old_", "messages.old_backup", "messages.old_20260928.gz", "messages.old_" + "9" * 41, "alerts.old_20260928", "private.old_20260928"]
        for name in rejected:
            (self.root / name).write_text("not-a-supported-log\n")
        (self.root / "messages.old_20260928").mkdir()
        self.assertEqual(json.loads(self.catalog())["files"], [])
        for name in [*rejected, "../messages.old_20260928", "messages.old_20260928/private.log", "messages.old_20260928\\private.log"]:
            with self.subTest(name=name):
                self.assertEqual(self.page(name)["status"], 400)
        self.assertEqual(self.page("messages.old_20260928")["status"], 404)

    def test_symlinks_are_never_catalogued_or_opened(self):
        real = self.root / "private.log"
        real.write_text("private-data")
        for name in ["messages.log", "messages.old_20260928"]:
            link = self.root / name
            try:
                link.symlink_to(real)
            except OSError:
                self.skipTest("Symlink privilege unavailable on this platform")
            self.assertEqual(self.page(link.name)["status"], 404)
        self.assertEqual(json.loads(self.catalog())["files"], [])


if __name__ == "__main__":
    unittest.main()
