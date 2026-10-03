#!/usr/bin/env python3
"""Single-share file service. Run as an unprivileged host user, never in the web app."""
import argparse
import base64
import binascii
import ctypes
import errno
import fcntl
import heapq
import json
import os
import re
import socket
import stat
import sys
import threading
import uuid

MAX_SIZE = 100 * 1024 ** 3
CHUNK_SIZE = 4 * 1024 ** 2
MAX_REQUEST = 6 * 1024 ** 2
NAME = re.compile(r"^[^/\x00]{1,255}$")
TOKEN = re.compile(r"^[a-f0-9]{32}$")
RENAME_NOREPLACE = 1
LIBC = ctypes.CDLL(None, use_errno=True)
if hasattr(LIBC, "renameat2"):
    LIBC.renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    LIBC.renameat2.restype = ctypes.c_int


def reject(reason="rejected"):
    raise ValueError(reason)


def parts(path):
    if not isinstance(path, str) or not path or len(path) > 2048 or path.startswith("/"):
        reject("invalid-path")
    value = path.split("/")
    if any(not NAME.fullmatch(p) or p in (".", "..") or p == ".labdeck-uploads" for p in value):
        reject("invalid-path")
    return value


def mount_is_remote(path):
    encoded = path.replace("\\", "\\134").replace(" ", "\\040")
    kind = None
    with open("/proc/self/mountinfo", encoding="utf-8") as mounts:
        for line in mounts:
            left, marker, right = line.partition(" - ")
            fields = left.split()
            if marker and len(fields) > 4 and fields[4] == encoded:
                kind = right.split()[0]
    return kind in ("nfs", "nfs4", "cifs", "smb3")


def mount_id(fd):
    if not sys.platform.startswith("linux"):
        return None  # Unit tests on macOS; the service is Linux-only.
    with open(f"/proc/self/fdinfo/{fd}", encoding="ascii") as source:
        for line in source:
            if line.startswith("mnt_id:"):
                return int(line.split()[1])
    reject("mount-identity-unavailable")


class Share:
    def __init__(self, root_path, control_dir):
        if not mount_is_remote(root_path):
            reject("share-offline")
        self.root_path = root_path
        self.root = os.open(root_path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        current = os.stat(root_path, follow_symlinks=False)
        opened = os.fstat(self.root)
        if not mount_is_remote(root_path) or (current.st_dev, current.st_ino) != (opened.st_dev, opened.st_ino):
            reject("share-offline")
        self.device = os.fstat(self.root).st_dev
        self.mount_id = mount_id(self.root)
        verify_fd = os.open(root_path, getattr(os, "O_PATH", os.O_RDONLY) | os.O_NOFOLLOW)
        try:
            if mount_id(verify_fd) != self.mount_id:
                reject("share-offline")
        finally:
            os.close(verify_fd)
        self.control_dir = control_dir
        self.lock = threading.Lock()
        try:
            os.mkdir(".labdeck-uploads", 0o700, dir_fd=self.root)
        except FileExistsError:
            pass
        self.temps = os.open(".labdeck-uploads", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self.root)
        meta = os.fstat(self.temps)
        if meta.st_dev != self.device or mount_id(self.temps) != self.mount_id or meta.st_uid != os.geteuid() or meta.st_mode & 0o077:
            reject("unsafe-upload-directory")

    def parent(self, path):
        names = parts(path)
        fd = os.dup(self.root)
        try:
            for name in names[:-1]:
                next_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = next_fd
                if os.fstat(fd).st_dev != self.device or mount_id(fd) != self.mount_id:
                    reject("nested-mount")
            return fd, names[-1]
        except Exception:
            os.close(fd)
            raise

    def directory(self, path):
        if path == "":
            return os.dup(self.root)
        parent, name = self.parent(path)
        try:
            fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            if os.fstat(fd).st_dev != self.device or mount_id(fd) != self.mount_id:
                os.close(fd)
                reject("nested-mount")
            return fd
        finally:
            os.close(parent)

    def existing(self, parent, name):
        fd = os.open(name, getattr(os, "O_PATH", os.O_RDONLY) | os.O_NOFOLLOW, dir_fd=parent)
        try:
            item = os.fstat(fd)
            same_mount = mount_id(fd) == self.mount_id
        finally:
            os.close(fd)
        if item.st_dev != self.device or not same_mount or not (stat.S_ISREG(item.st_mode) or stat.S_ISDIR(item.st_mode)):
            reject("unsupported-entry")
        return item

    def list(self, request):
        path = request.get("path", "")
        cursor = request.get("cursor", "")
        if not isinstance(cursor, str) or len(cursor) > 255:
            reject("invalid-request")
        fd = self.directory(path)
        try:
            with os.scandir(fd) as entries:
                names = heapq.nsmallest(201, (e.name for e in entries if e.name > cursor and e.name != ".labdeck-uploads"))
            result = []
            for name in names[:200]:
                try:
                    item = self.existing(fd, name)
                except (OSError, ValueError):
                    continue
                result.append({"name": name, "kind": "directory" if stat.S_ISDIR(item.st_mode) else "file", "size": item.st_size if stat.S_ISREG(item.st_mode) else None, "modifiedAt": int(item.st_mtime * 1000)})
            return {"entries": result, "nextCursor": names[199] if len(names) > 200 else None}
        finally:
            os.close(fd)

    def metadata(self, token):
        if not isinstance(token, str) or not TOKEN.fullmatch(token):
            reject("invalid-upload")
        path = os.path.join(self.control_dir, token + ".json")
        with open(path, encoding="utf-8") as source:
            data = source.read(4097)
        if len(data) > 4096:
            reject("invalid-upload")
        meta = json.loads(data)
        if not isinstance(meta, dict) or set(meta) != {"path", "size", "offset"} or type(meta["size"]) is not int or type(meta["offset"]) is not int or meta["offset"] < 0 or meta["offset"] > meta["size"] or meta["size"] > MAX_SIZE:
            reject("invalid-upload")
        parts(meta["path"])
        return meta

    def start(self, request):
        path, size = request.get("path"), request.get("size")
        if type(size) is not int or size < 0 or size > MAX_SIZE:
            reject("invalid-size")
        parent, name = self.parent(path)
        try:
            try:
                os.stat(name, dir_fd=parent, follow_symlinks=False)
                reject("collision")
            except FileNotFoundError:
                pass
        finally:
            os.close(parent)
        resume = request.get("resumeId")
        if resume is not None:
            meta = self.metadata(resume)
            if meta["path"] != path or meta["size"] != size:
                reject("invalid-upload")
            fd = os.open(resume, os.O_RDWR | os.O_NOFOLLOW, dir_fd=self.temps)
            try:
                if os.fstat(fd).st_size < meta["offset"]:
                    reject("invalid-upload")
                if os.fstat(fd).st_size > meta["offset"]:
                    os.ftruncate(fd, meta["offset"])
                    os.fsync(fd)
            finally:
                os.close(fd)
            return {"uploadId": resume, "offset": meta["offset"]}
        token = uuid.uuid4().hex
        fd = os.open(token, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=self.temps)
        os.close(fd)
        meta = {"path": path, "size": size, "offset": 0}
        metadata_fd = os.open(os.path.join(self.control_dir, token + ".json"), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(metadata_fd, "w", encoding="utf-8") as target:
            json.dump(meta, target)
        return {"uploadId": token, "offset": 0}

    def chunk(self, request):
        token, offset, encoded = request.get("uploadId"), request.get("offset"), request.get("data")
        if type(offset) is not int or not isinstance(encoded, str) or len(encoded) > CHUNK_SIZE * 4 // 3 + 8:
            reject("invalid-request")
        meta = self.metadata(token)
        if offset != meta["offset"]:
            reject("offset-mismatch")
        try:
            data = base64.b64decode(encoded, validate=True)
        except binascii.Error:
            reject("invalid-request")
        if not data or len(data) > CHUNK_SIZE or offset + len(data) > meta["size"]:
            reject("invalid-chunk")
        fd = os.open(token, os.O_WRONLY | os.O_NOFOLLOW, dir_fd=self.temps)
        try:
            if os.fstat(fd).st_size != offset:
                reject("offset-mismatch")
            os.lseek(fd, offset, os.SEEK_SET)
            view = memoryview(data)
            while view:
                view = view[os.write(fd, view):]
            os.fsync(fd)
        finally:
            os.close(fd)
        meta["offset"] += len(data)
        self.save_meta(token, meta)
        return {"offset": meta["offset"]}

    def save_meta(self, token, meta):
        path = os.path.join(self.control_dir, token + ".json")
        temporary = path + ".new"
        metadata_fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(metadata_fd, "w", encoding="utf-8") as output:
            json.dump(meta, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)

    def finish(self, request):
        token = request.get("uploadId")
        meta = self.metadata(token)
        if meta["offset"] != meta["size"]:
            reject("incomplete-upload")
        parent, name = self.parent(meta["path"])
        try:
            os.link(token, name, src_dir_fd=self.temps, dst_dir_fd=parent, follow_symlinks=False)
            os.unlink(token, dir_fd=self.temps)
            os.unlink(os.path.join(self.control_dir, token + ".json"))
        finally:
            os.close(parent)
        return {"status": "completed"}

    def rename(self, request):
        source, destination = request.get("from"), request.get("to")
        first, old_name = self.parent(source)
        second, new_name = self.parent(destination)
        try:
            self.existing(first, old_name)
            if LIBC.renameat2(first, old_name.encode(), second, new_name.encode(), RENAME_NOREPLACE) != 0:
                code = ctypes.get_errno()
                if code == errno.EEXIST:
                    reject("collision")
                raise OSError(code, os.strerror(code))
        finally:
            os.close(first)
            os.close(second)
        return {"status": "completed"}

    def delete(self, request):
        parent, name = self.parent(request.get("path"))
        try:
            item = self.existing(parent, name)
            if stat.S_ISDIR(item.st_mode):
                os.rmdir(name, dir_fd=parent)
            else:
                os.unlink(name, dir_fd=parent)
        finally:
            os.close(parent)
        return {"status": "completed"}

    def mkdir(self, request):
        parent, name = self.parent(request.get("path"))
        try:
            os.mkdir(name, 0o750, dir_fd=parent)
        finally:
            os.close(parent)
        return {"status": "completed"}

    def execute(self, request):
        if not isinstance(request, dict) or len(request) > 6:
            reject("invalid-request")
        action = request.get("action")
        if action not in ("list", "start", "chunk", "finish", "rename", "delete", "mkdir"):
            reject("invalid-request")
        with self.lock:
            current_fd = os.open(self.root_path, getattr(os, "O_PATH", os.O_RDONLY) | os.O_NOFOLLOW)
            try:
                current = os.fstat(current_fd)
                current_mount_id = mount_id(current_fd)
            finally:
                os.close(current_fd)
            opened = os.fstat(self.root)
            if not mount_is_remote(self.root_path) or current_mount_id != self.mount_id or (current.st_dev, current.st_ino) != (opened.st_dev, opened.st_ino):
                reject("share-offline")
            return getattr(self, action)(request)


def serve(config_path, share_id, control_dir):
    details = os.stat(config_path, follow_symlinks=False)
    if details.st_uid != 0 or not stat.S_ISREG(details.st_mode) or details.st_mode & 0o022:
        reject("unsafe-config")
    with open(config_path, encoding="utf-8") as source:
        data = source.read(1_048_577)
    if len(data) > 1_048_576:
        reject("unsafe-config")
    configuration = json.loads(data)
    matches = [item for item in configuration.get("fileShares", []) if item.get("id") == share_id]
    if len(matches) != 1 or not os.path.isabs(matches[0]["path"]) or os.path.normpath(matches[0]["path"]) != matches[0]["path"]:
        reject("invalid-share")
    root_path = matches[0]["path"]
    control = os.stat(control_dir, follow_symlinks=False)
    if not stat.S_ISDIR(control.st_mode) or control.st_uid != os.geteuid() or control.st_mode & 0o022:
        reject("unsafe-control-directory")
    share = Share(root_path, control_dir)
    lock = os.open(os.path.join(control_dir, "files.lock"), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    socket_path = os.path.join(control_dir, "files.sock")
    try:
        existing = os.stat(socket_path, follow_symlinks=False)
        if not stat.S_ISSOCK(existing.st_mode):
            reject("unsafe-control-socket")
        os.unlink(socket_path)
    except FileNotFoundError:
        pass
    server = socket.socket(socket.AF_UNIX)
    server.bind(socket_path)
    os.chmod(socket_path, 0o660)
    server.listen(8)
    while True:
        connection, _ = server.accept()
        with connection:
            connection.settimeout(45)
            try:
                line = bytearray()
                while len(line) <= MAX_REQUEST:
                    data = connection.recv(min(65536, MAX_REQUEST + 1 - len(line)))
                    if not data or b"\n" in data:
                        line.extend(data.split(b"\n", 1)[0])
                        break
                    line.extend(data)
                if len(line) > MAX_REQUEST:
                    reject("invalid-request")
                result = share.execute(json.loads(line))
                answer = {"ok": True, **result}
            except (ValueError, OSError, KeyError, TypeError, json.JSONDecodeError) as error:
                code = str(error) if isinstance(error, ValueError) else "file-error"
                answer = {"ok": False, "error": code}
            connection.sendall(json.dumps(answer, separators=(",", ":")).encode() + b"\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--share-id", required=True)
    parser.add_argument("--control-dir", required=True)
    arguments = parser.parse_args()
    serve(arguments.config, arguments.share_id, arguments.control_dir)
