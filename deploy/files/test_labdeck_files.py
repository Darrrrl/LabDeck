import os
import tempfile
import unittest
import sys
from pathlib import Path
from unittest.mock import patch

from labdeck_files import Share


class ShareTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name) / "share"
        control = Path(self.temp.name) / "control"
        root.mkdir()
        control.mkdir()
        self.root = root
        with patch("labdeck_files.mount_is_remote", return_value=True):
            self.share = Share(str(root), str(control))
        self.addCleanup(lambda: os.close(self.share.root))
        self.addCleanup(lambda: os.close(self.share.temps))

    def call(self, request):
        with patch("labdeck_files.mount_is_remote", return_value=True):
            return self.share.execute(request)

    def test_resumable_upload_collision_rename_and_empty_directory_delete(self):
        self.call({"action": "mkdir", "path": "folder"})
        started = self.call({"action": "start", "path": "folder/file.txt", "size": 3})
        token = started["uploadId"]
        (self.root / ".labdeck-uploads" / token).write_bytes(b"partial")
        self.assertEqual(self.call({"action": "start", "path": "folder/file.txt", "size": 3, "resumeId": token})["offset"], 0)
        self.assertEqual((self.root / ".labdeck-uploads" / token).stat().st_size, 0)
        self.call({"action": "chunk", "uploadId": token, "offset": 0, "data": "YWJj"})
        self.assertEqual(self.call({"action": "start", "path": "folder/file.txt", "size": 3, "resumeId": token})["offset"], 3)
        self.call({"action": "finish", "uploadId": token})
        self.assertEqual((self.root / "folder/file.txt").read_bytes(), b"abc")
        with self.assertRaises(ValueError):
            self.call({"action": "start", "path": "folder/file.txt", "size": 3})
        if sys.platform == "darwin":
            class RenameShim:
                @staticmethod
                def renameat2(first, old, second, new, _flags):
                    os.rename(old, new, src_dir_fd=first, dst_dir_fd=second)
                    return 0
            with patch("labdeck_files.LIBC", RenameShim()):
                self.call({"action": "rename", "from": "folder/file.txt", "to": "folder/renamed.txt"})
        else:
            self.call({"action": "rename", "from": "folder/file.txt", "to": "folder/renamed.txt"})
        with self.assertRaises(OSError):
            self.call({"action": "delete", "path": "folder"})
        self.call({"action": "delete", "path": "folder/renamed.txt"})
        self.call({"action": "delete", "path": "folder"})

    def test_traversal_and_symlinks_are_rejected(self):
        (self.root / "outside").symlink_to(self.temp.name)
        for path in ("../escape", "/absolute", "outside/file", ".labdeck-uploads/file"):
            with self.subTest(path=path), self.assertRaises((ValueError, OSError)):
                self.call({"action": "start", "path": path, "size": 1})

    def test_listing_is_bounded_and_hides_upload_state(self):
        for number in range(205):
            (self.root / f"item-{number:03}").write_text("x")
        first = self.call({"action": "list", "path": ""})
        self.assertEqual(len(first["entries"]), 200)
        self.assertIsNotNone(first["nextCursor"])
        second = self.call({"action": "list", "path": "", "cursor": first["nextCursor"]})
        self.assertEqual(len(second["entries"]), 5)
        self.assertIsNone(second["nextCursor"])
        self.assertNotIn(".labdeck-uploads", [entry["name"] for entry in first["entries"]])


if __name__ == "__main__":
    unittest.main()
