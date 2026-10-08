#!/usr/bin/env python3
import argparse
import contextlib
import datetime
import fcntl
import json
import os
import re
import shutil
import signal
import socket
import sqlite3
import stat
import subprocess
import tempfile
import threading
import time
import urllib.parse
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

MAX_BYTES = 100 * 1024 ** 3
ACTIVE = {'preparing', 'queued', 'downloading', 'processing'}
TERMINAL = {'completed', 'partially-completed', 'failed', 'cancelled', 'interrupted'}
VIDEO_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')
BASE_FLAGS = ['--ignore-config', '--no-plugin-dirs', '--no-cache-dir', '--no-progress',
              '--no-warnings', '--socket-timeout', '20', '--retries', '2',
              '--fragment-retries', '2', '--no-js-runtimes', '--js-runtimes', 'node',
              '--no-remote-components', '--proxy', '', '--no-write-info-json',
              '--no-write-thumbnail', '--no-write-subs', '--no-write-auto-subs', '--age-limit', '17']


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')


def media_name(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 120:
        raise ValueError('invalid-name')
    value = value.strip()
    if value in {'.', '..'} or re.search(r'[\\/\x00-\x1f]', value):
        raise ValueError('invalid-name')
    if len(value.encode()) > 180:
        raise ValueError('invalid-name')
    return value


def safe_name(value):
    value = media_name(value)
    value = re.sub(r'[<>:"|?*\x7f]', '_', value).rstrip('. ')
    if not value or len(value.encode()) > 180:
        raise ValueError('invalid-name')
    return value


def extracted_name(value, fallback):
    value = re.sub(r'[\\/\x00-\x1f]', '_', value if isinstance(value, str) and value else fallback)[:100]
    while len(value.encode()) > 170:
        value = value[:-1]
    return media_name(value) if value.strip('. ') else fallback


def source_id(source):
    if not isinstance(source, str) or len(source) > 512:
        raise ValueError('invalid-source')
    url = urllib.parse.urlsplit(source)
    if url.scheme != 'https' or url.username or url.password or url.port or url.fragment:
        raise ValueError('invalid-source')
    query = urllib.parse.parse_qs(url.query, keep_blank_values=True)
    if any(len(values) != 1 for values in query.values()) or set(query) - {'v', 'list'}:
        raise ValueError('invalid-source')
    if url.hostname == 'youtu.be' and not query and VIDEO_ID.fullmatch(url.path[1:]):
        return 'video', url.path[1:]
    if url.hostname not in {'youtube.com', 'www.youtube.com', 'm.youtube.com'}:
        raise ValueError('invalid-source')
    if url.path == '/watch' and set(query) == {'v'} and VIDEO_ID.fullmatch(query['v'][0]):
        return 'video', query['v'][0]
    if url.path == '/playlist' and set(query) == {'list'} and re.fullmatch(r'[A-Za-z0-9_-]{10,100}', query['list'][0]):
        return 'playlist', query['list'][0]
    raise ValueError('invalid-source')


def source_url(kind, identity):
    return f'https://www.youtube.com/{"watch?v=" if kind == "video" else "playlist?list="}{identity}'


def nfo(tag, fields):
    root = ET.Element(tag)
    for key, value in fields.items():
        if value is not None:
            ET.SubElement(root, key).text = str(value)
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)


def destination(job, item):
    name = safe_name(job['name'])
    if job['kind'] == 'movie':
        return f'{name}/{name}.mp4'
    if job['kind'] == 'tv':
        return f"{name}/Season 01/{name} - S01E{item['number']:02d}.mp4"
    return f"{safe_name(job['artist'])}/{safe_name(job['album'])}/{item['number']:02d} - {safe_name(item['title'])}.mp3"


@contextlib.contextmanager
def directory(root, relative, create=False):
    descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for component in relative.split('/') if relative else []:
            if component in {'', '.', '..'}:
                raise ValueError('invalid-path')
            if create:
                try:
                    os.mkdir(component, 0o750, dir_fd=descriptor)
                except FileExistsError:
                    pass
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        yield descriptor
    finally:
        os.close(descriptor)


class Worker:
    def __init__(self, config):
        self.config = config
        self.state = Path(config['stateDirectory'])
        if not self.state.is_absolute() or self.state.resolve() != self.state:
            raise ValueError('unsafe-state-directory')
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.state.is_symlink():
            raise ValueError('unsafe-state-directory')
        self.instance_lock = os.open(self.state / 'worker.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(self.instance_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(self.instance_lock)
            raise ValueError('worker-already-running') from None
        self.roots = {kind: Path(config['roots'][kind]) for kind in ['movie', 'tv', 'music']}
        for root in self.roots.values():
            if not root.is_absolute() or root.resolve() != root or not root.is_dir():
                raise ValueError('unsafe-library-root')
            if self.state.resolve().is_relative_to(root):
                raise ValueError('staging-inside-library')
        self.lock = threading.RLock()
        self.connection = sqlite3.connect(self.state / 'jobs.sqlite', check_same_thread=False)
        version = self.connection.execute('PRAGMA user_version').fetchone()[0]
        if version not in {0, 1}:
            raise ValueError('unsupported-database-version')
        self.connection.execute('PRAGMA journal_mode=WAL')
        self.connection.execute('PRAGMA synchronous=FULL')
        self.connection.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, document TEXT NOT NULL)')
        self.connection.execute('PRAGMA user_version=1')
        self.connection.commit()
        self.jobs = {identity: json.loads(document) for identity, document in self.connection.execute('SELECT id,document FROM jobs')}
        self.stopping = threading.Event()
        self.wake = threading.Event()
        self.process = None
        self.running = set()
        self.failed = False
        for job in self.jobs.values():
            for item in job['items']:
                self.rollback(job, item)
            if job['state'] in ACTIVE:
                job['state'] = 'interrupted'
                job['error'] = 'worker-restarted'
                for item in job['items']:
                    if item['state'] not in {'completed', 'unavailable'}:
                        item['state'] = 'interrupted'
                self.save(job)
        for path in self.state.iterdir():
            if path.name.startswith(('job-', 'item-')) and path.is_dir() and not path.is_symlink():
                shutil.rmtree(path)
        self.prune()

    def save(self, job):
        job['updatedAt'] = now()
        self.connection.execute('INSERT OR REPLACE INTO jobs VALUES (?,?)', (job['id'], json.dumps(job)))
        self.connection.commit()

    def prune(self):
        terminal = sorted((job for job in self.jobs.values() if job['state'] in TERMINAL | {'ready'} and job['id'] not in self.running), key=lambda job: job['updatedAt'], reverse=True)
        cutoff = time.time() - 30 * 86400
        for index, job in enumerate(terminal):
            if index >= 100 or datetime.datetime.fromisoformat(job['updatedAt'].replace('Z', '+00:00')).timestamp() < cutoff:
                self.connection.execute('DELETE FROM jobs WHERE id=?', (job['id'],))
                del self.jobs[job['id']]
        self.connection.commit()

    def public(self, job):
        return {key: job[key] for key in ['id', 'kind', 'name', 'state', 'createdAt', 'updatedAt', 'error']} | {
            'items': [{key: item[key] for key in ['number', 'title', 'destination', 'state', 'error']} for item in job['items']]}

    def command(self, request):
        with self.lock:
            self.prune()
            action = request.get('action')
            if action == 'status' and set(request) == {'action'}:
                return {'ok': True, 'jobs': [self.public(job) for job in sorted(self.jobs.values(), key=lambda job: job['createdAt'], reverse=True)]}
            if action == 'prepare' and set(request) == {'action', 'request'}:
                if sum(job['state'] in ACTIVE or job['id'] in self.running for job in self.jobs.values()) >= 21:
                    raise ValueError('queue-full')
                data = request['request']
                kind = data.get('kind')
                allowed = {'kind', 'source', 'artist', 'album'} if kind == 'music' else {'kind', 'source', 'name', 'year'} if kind == 'movie' else {'kind', 'source', 'name'}
                if kind not in self.roots or set(data) - allowed:
                    raise ValueError('invalid-request')
                source_kind, identity = source_id(data.get('source'))
                if (kind == 'movie' and source_kind != 'video') or (kind == 'tv' and source_kind != 'playlist'):
                    raise ValueError('wrong-source-kind')
                name = media_name(data.get('artist') if kind == 'music' else data.get('name'))
                year = data.get('year')
                if year is not None and (type(year) is not int or not 1888 <= year <= 9999):
                    raise ValueError('invalid-year')
                job = {'id': uuid.uuid4().hex, 'kind': kind, 'name': name, 'year': year,
                       'artist': name if kind == 'music' else None,
                       'album': media_name(data.get('album', 'Singles')) if kind == 'music' else None,
                       'sourceKind': source_kind, 'sourceId': identity, 'state': 'preparing',
                       'createdAt': now(), 'updatedAt': now(), 'error': None, 'items': [],
                       'deadline': time.time() + 86400, 'bytes': 0}
                self.jobs[job['id']] = job
                self.save(job)
                self.wake.set()
                return {'ok': True, 'id': job['id']}
            if action not in {'submit', 'cancel', 'retry'} or set(request) - {'action', 'id', 'titles'} or ('titles' in request and action != 'submit'):
                raise ValueError('invalid-request')
            job = self.jobs.get(request.get('id'))
            if not job:
                raise ValueError('unknown-job')
            if action == 'cancel':
                if job['state'] in TERMINAL:
                    raise ValueError('already-terminal')
                job['state'] = 'cancelled'
                for item in job['items']:
                    if item['state'] not in {'completed', 'unavailable'}:
                        item['state'] = 'cancelled'
            else:
                if job['id'] in self.running:
                    raise ValueError('job-still-stopping')
                if sum(other['state'] in ACTIVE or other['id'] in self.running for other in self.jobs.values()) >= 21:
                    raise ValueError('queue-full')
                if action == 'submit' and job['state'] != 'ready':
                    raise ValueError('not-ready')
                if action == 'retry' and job['state'] not in {'failed', 'partially-completed', 'cancelled', 'interrupted'}:
                    raise ValueError('not-retryable')
                titles = request.get('titles')
                if titles is not None:
                    if job['kind'] != 'music' or not isinstance(titles, list) or len(titles) != len(job['items']):
                        raise ValueError('invalid-titles')
                    normalized = [media_name(title) for title in titles]
                    for title in normalized:
                        safe_name(title)
                    for item, title in zip(job['items'], normalized):
                        item['title'] = title
                        item['destination'] = destination(job, item)
                job['state'] = 'queued' if job['items'] else 'preparing'
                job['error'] = None
                job['deadline'] = time.time() + 86400
                for item in job['items']:
                    if item['state'] not in {'completed', 'unavailable'}:
                        item['state'], item['error'] = 'pending', None
            self.save(job)
            self.wake.set()
            return {'ok': True, 'id': job['id']}

    def run_process(self, arguments, job, stage, metadata=False):
        if self.stopping.is_set() or job['state'] == 'cancelled':
            raise ValueError('cancelled')
        if time.time() > job['deadline']:
            raise ValueError('deadline-exceeded')
        if shutil.disk_usage(stage).free < 256 * 1024 ** 2:
            raise ValueError('low-disk-space')
        output = bytearray()
        overflow = threading.Event()
        environment = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': str(self.state), 'LANG': 'C.UTF-8'}
        process = subprocess.Popen(arguments, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE if metadata else subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, env=environment, start_new_session=True)
        self.process = process

        def read_output():
            while True:
                chunk = process.stdout.read(65536)
                if not chunk:
                    break
                if len(output) + len(chunk) > 4 * 1024 ** 2:
                    overflow.set()
                    break
                output.extend(chunk)

        reader = threading.Thread(target=read_output) if metadata else None
        if reader:
            reader.start()
        started = time.monotonic()
        try:
            while process.poll() is None:
                if self.stopping.is_set() or job['state'] == 'cancelled':
                    raise ValueError('cancelled')
                if overflow.is_set():
                    raise ValueError('metadata-too-large')
                if time.time() > job['deadline'] or (metadata and time.monotonic() - started > 180):
                    raise ValueError('deadline-exceeded')
                size = sum(path.stat().st_size for path in Path(stage).iterdir() if path.is_file())
                if size + job['bytes'] > MAX_BYTES:
                    raise ValueError('byte-limit')
                if shutil.disk_usage(stage).free < 256 * 1024 ** 2:
                    raise ValueError('low-disk-space')
                time.sleep(0.1)
            if process.returncode:
                raise ValueError('extraction-failed' if metadata else 'media-process-failed')
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            if reader:
                reader.join()
                process.stdout.close()
            self.process = None
        if overflow.is_set():
            raise ValueError('metadata-too-large')
        return bytes(output)

    def prepare(self, job, stage):
        arguments = [self.config['ytDlp'], *BASE_FLAGS, '--skip-download', '--dump-single-json', '--ignore-errors',
                     '--playlist-end', '201', '--flat-playlist', '--', source_url(job['sourceKind'], job['sourceId'])]
        data = json.loads(self.run_process(arguments, job, stage, metadata=True))
        entries = data.get('entries', []) if job['sourceKind'] == 'playlist' else [data]
        if not entries or len(entries) > 200:
            raise ValueError('playlist-limit-or-empty')
        items = []
        numbers = set()
        for index, entry in enumerate(entries, 1):
            entry = entry or {}
            number = entry.get('playlist_index') or index
            if type(number) is not int or not 1 <= number <= 200 or number in numbers:
                raise ValueError('invalid-playlist-order')
            numbers.add(number)
            identity = entry.get('id', '')
            unavailable = not VIDEO_ID.fullmatch(identity) or entry.get('availability') in {'private', 'premium_only', 'subscriber_only', 'needs_auth'} or entry.get('title') in {'[Deleted video]', '[Private video]'}
            if entry.get('is_live') or entry.get('live_status') in {'is_live', 'is_upcoming'}:
                raise ValueError('live-stream-not-supported')
            if isinstance(entry.get('age_limit'), (int, float)) and entry['age_limit'] >= 18:
                raise ValueError('age-restricted-not-supported')
            item = {'number': number, 'sourceId': identity if VIDEO_ID.fullmatch(identity) else None,
                    'title': extracted_name(entry.get('title'), f'{"Unavailable" if unavailable else "Untitled"} item {number}'),
                    'state': 'unavailable' if unavailable else 'pending', 'error': 'unavailable' if unavailable else None}
            item['destination'] = destination(job, item)
            items.append(item)
        with self.lock:
            if job['state'] == 'cancelled':
                return
            job['items'] = items
            self.check_collisions(job)
            job['state'] = 'ready'
            self.save(job)

    def check_collisions(self, job):
        if job['kind'] == 'tv' and not any(item['state'] == 'completed' for item in job['items']):
            try:
                with directory(self.roots['tv'], safe_name(job['name'])) as descriptor:
                    try:
                        os.stat('tvshow.nfo', dir_fd=descriptor, follow_symlinks=False)
                    except FileNotFoundError:
                        pass
                    else:
                        raise ValueError('destination-collision')
            except FileNotFoundError:
                pass
        for item in job['items']:
            if item['state'] in {'completed', 'unavailable'}:
                continue
            relative = item['destination']
            parent, filename = relative.rsplit('/', 1)
            try:
                with directory(self.roots[job['kind']], parent) as descriptor:
                    for target in [filename, filename.rsplit('.', 1)[0] + '.nfo'] if job['kind'] != 'music' else [filename]:
                        try:
                            os.stat(target, dir_fd=descriptor, follow_symlinks=False)
                        except FileNotFoundError:
                            continue
                        raise ValueError('destination-collision')
            except FileNotFoundError:
                pass

    def publish(self, job, item, media, metadata):
        root = self.roots[job['kind']]
        parent, filename = item['destination'].rsplit('/', 1)
        with directory(root, parent, create=True) as descriptor:
            if os.fstatvfs(descriptor).f_bavail * os.fstatvfs(descriptor).f_frsize < media.stat().st_size + 256 * 1024 ** 2:
                raise ValueError('low-disk-space')
            records = []
            sources = [(parent, filename.rsplit('.', 1)[0] + '.nfo', metadata)] if metadata else []
            if job['kind'] == 'tv' and not any(other['state'] == 'completed' for other in job['items']):
                sources.insert(0, (safe_name(job['name']), 'tvshow.nfo', nfo('tvshow', {'title': job['name']})))
            sources.append((parent, filename, media))
            try:
                for target_parent, target, source in sources:
                    temporary = f'.labdeck-{uuid.uuid4().hex}.part'
                    with directory(root, target_parent) as target_descriptor:
                        output = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o640, dir_fd=target_descriptor)
                    with os.fdopen(output, 'wb') as stream:
                        evidence = os.fstat(stream.fileno())
                        records.append({'parent': target_parent, 'temporary': temporary, 'target': target, 'inode': evidence.st_ino, 'device': evidence.st_dev})
                        item['publication'] = records
                        with self.lock:
                            self.save(job)
                        if isinstance(source, bytes):
                            stream.write(source)
                        else:
                            with source.open('rb') as input_stream:
                                while True:
                                    if job['state'] == 'cancelled' or self.stopping.is_set() or time.time() > job['deadline']:
                                        raise ValueError('cancelled-or-deadline')
                                    chunk = input_stream.read(1024 ** 2)
                                    if not chunk:
                                        break
                                    stream.write(chunk)
                        stream.flush()
                        os.fsync(stream.fileno())
                with self.lock:
                    if job['state'] == 'cancelled' or self.stopping.is_set() or time.time() > job['deadline']:
                        raise ValueError('cancelled-or-deadline')
                    for record in records:
                        with directory(root, record['parent']) as target_descriptor:
                            os.link(record['temporary'], record['target'], src_dir_fd=target_descriptor, dst_dir_fd=target_descriptor, follow_symlinks=False)
                            os.fsync(target_descriptor)
                    os.fsync(descriptor)
                    item['state'] = 'completed'
                    previous_bytes = job['bytes']
                    job['bytes'] += media.stat().st_size
                    try:
                        self.save(job)
                    except Exception:
                        self.connection.rollback()
                        item['state'] = 'processing'
                        job['bytes'] = previous_bytes
                        raise
                    for record in records:
                        with directory(root, record['parent']) as target_descriptor:
                            os.unlink(record['temporary'], dir_fd=target_descriptor)
                    item.pop('publication', None)
                    self.save(job)
            except Exception:
                if item['state'] != 'completed':
                    with self.lock:
                        self.rollback(job, item)
                raise

    def rollback(self, job, item):
        for record in item.get('publication', []):
            with directory(self.roots[job['kind']], record['parent']) as descriptor:
                for name in [record['target'], record['temporary']]:
                    try:
                        evidence = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
                        if (evidence.st_ino, evidence.st_dev) == (record['inode'], record['device']):
                            if item['state'] != 'completed' or name == record['temporary']:
                                os.unlink(name, dir_fd=descriptor)
                    except FileNotFoundError:
                        pass
                os.fsync(descriptor)
        item.pop('publication', None)

    def download(self, job, item, stage):
        with self.lock:
            if job['state'] == 'cancelled':
                raise ValueError('cancelled')
            item['state'] = job['state'] = 'downloading'
            self.save(job)
        arguments = [self.config['ytDlp'], *BASE_FLAGS, '--no-playlist', '--max-filesize', str(MAX_BYTES - job['bytes']),
                     '--match-filter', '!is_live & live_status != is_upcoming', '--format',
                     'bestaudio/best' if job['kind'] == 'music' else 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b[height<=1080]',
                     '--ffmpeg-location', self.config['ffmpeg'], '--output', str(Path(stage) / 'source.%(ext)s'),
                     '--', source_url('video', item['sourceId'])]
        self.run_process(arguments, job, stage)
        sources = [path for path in Path(stage).iterdir() if path.name.startswith('source.') and path.suffix not in {'.part', '.ytdl'}]
        if len(sources) != 1:
            raise ValueError('unavailable-or-live')
        with self.lock:
            if job['state'] == 'cancelled':
                raise ValueError('cancelled')
            item['state'] = job['state'] = 'processing'
            self.save(job)
        media = Path(stage) / ('complete.mp3' if job['kind'] == 'music' else 'complete.mp4')
        arguments = [self.config['ffmpeg'], '-nostdin', '-v', 'error', '-n', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,mp3,aac,ogg,flac,wav,mpegts', '-i', str(sources[0]), '-map_metadata', '-1']
        metadata = None
        if job['kind'] == 'music':
            arguments += ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-metadata', f"artist={job['artist']}", '-metadata', f"album={job['album']}", '-metadata', f"title={item['title']}", '-metadata', f"track={item['number']}"]
        else:
            arguments += ['-map', '0:v:0', '-map', '0:a:0?', '-vf', r'scale=w=min(1920\,iw):h=min(1080\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2', '-c:v', 'libx264', '-threads', '2', '-preset', 'fast', '-crf', '20', '-c:a', 'aac', '-movflags', '+faststart']
            metadata = nfo('movie', {'title': job['name'], 'year': job['year']}) if job['kind'] == 'movie' else nfo('episodedetails', {'title': item['title'], 'showtitle': job['name'], 'season': 1, 'episode': item['number']})
        arguments += [str(media)]
        self.run_process(arguments, job, stage)
        if not media.is_file() or media.stat().st_size == 0 or job['bytes'] + media.stat().st_size > MAX_BYTES:
            raise ValueError('invalid-or-oversized-media')
        with self.lock:
            if job['state'] == 'cancelled' or self.stopping.is_set() or time.time() > job['deadline']:
                raise ValueError('cancelled-or-deadline')
        self.publish(job, item, media, metadata)

    def execute(self, job):
        try:
            with tempfile.TemporaryDirectory(prefix='job-', dir=self.state) as stage:
                if job['state'] == 'preparing':
                    self.prepare(job, stage)
                    return
            for item in job['items']:
                if job['state'] == 'cancelled' or self.stopping.is_set():
                    break
                if item['state'] in {'completed', 'unavailable'}:
                    continue
                try:
                    with tempfile.TemporaryDirectory(prefix='item-', dir=self.state) as stage:
                        self.download(job, item, stage)
                except Exception as error:
                    with self.lock:
                        if item['state'] != 'completed':
                            item['state'] = 'cancelled' if job['state'] == 'cancelled' else 'failed'
                            item['error'] = str(error) if isinstance(error, ValueError) and re.fullmatch('[a-z-]{1,64}', str(error)) else 'worker-failed'
                        self.save(job)
                if time.time() > job['deadline']:
                    for remaining in job['items']:
                        if remaining['state'] == 'pending':
                            remaining['state'], remaining['error'] = 'failed', 'deadline-exceeded'
                    break
            with self.lock:
                if job['state'] != 'cancelled':
                    completed = sum(item['state'] == 'completed' for item in job['items'])
                    job['state'] = 'completed' if completed == len(job['items']) else 'partially-completed' if completed else 'failed'
                    if self.stopping.is_set():
                        job['state'] = 'interrupted'
                        for remaining in job['items']:
                            if remaining['state'] not in {'completed', 'unavailable'}:
                                remaining['state'] = 'interrupted'
                self.save(job)
        except Exception as error:
            with self.lock:
                if job['state'] != 'cancelled':
                    job['state'] = 'failed'
                    job['error'] = str(error) if isinstance(error, ValueError) and re.fullmatch('[a-z-]{1,64}', str(error)) else 'preparation-failed'
                self.save(job)

    def loop(self):
        while not self.stopping.is_set():
            try:
                with self.lock:
                    self.prune()
                    job = next((job for job in self.jobs.values() if job['state'] in {'preparing', 'queued'}), None)
                    if job:
                        self.running.add(job['id'])
            except Exception:
                self.failed = True
                self.stopping.set()
                return
            if job:
                try:
                    self.execute(job)
                except Exception:
                    self.failed = True
                    self.stopping.set()
                finally:
                    with self.lock:
                        self.running.discard(job['id'])
            else:
                self.wake.wait(1)
                self.wake.clear()


def serve(config):
    worker = Worker(config)
    socket_path = Path(config['socketPath'])
    if not socket_path.is_absolute() or socket_path.parent.resolve() != socket_path.parent:
        raise ValueError('unsafe-socket')
    if socket_path.exists():
        if not stat.S_ISSOCK(socket_path.lstat().st_mode):
            raise ValueError('unsafe-socket')
        socket_path.unlink()
    server = socket.socket(socket.AF_UNIX)
    server.bind(str(socket_path))
    os.chmod(socket_path, 0o660)
    server.listen(8)
    server.settimeout(1)
    thread = threading.Thread(target=worker.loop)
    thread.start()

    def stop(_signal, _frame):
        worker.stopping.set()
        worker.wake.set()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        while not worker.stopping.is_set():
            try:
                client, _address = server.accept()
            except socket.timeout:
                continue
            with client:
                client.settimeout(2)
                try:
                    request = bytearray()
                    while not request.endswith(b'\n'):
                        chunk = client.recv(4096)
                        if not chunk or len(request) + len(chunk) > 65536:
                            raise ValueError('invalid-request')
                        request.extend(chunk)
                    reply = worker.command(json.loads(request))
                except Exception:
                    reply = {'ok': False, 'error': 'rejected'}
                try:
                    client.sendall(json.dumps(reply).encode() + b'\n')
                except (OSError, socket.timeout):
                    pass
    finally:
        worker.stopping.set()
        thread.join()
        server.close()
        socket_path.unlink(missing_ok=True)
        worker.connection.close()
        os.close(worker.instance_lock)
    if worker.failed:
        raise RuntimeError('worker-storage-failed')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    arguments = parser.parse_args()
    config_path = Path(arguments.config)
    evidence = config_path.lstat()
    if not stat.S_ISREG(evidence.st_mode) or evidence.st_uid != 0 or evidence.st_mode & 0o022:
        raise ValueError('configuration-must-be-root-owned')
    config = json.loads(config_path.read_text())
    for key in ['ytDlp', 'ffmpeg']:
        path = Path(config[key])
        if not path.is_absolute() or not path.is_file() or path.stat().st_uid != 0 or path.stat().st_mode & 0o022:
            raise ValueError('unsafe-executable')
    serve(config)


if __name__ == '__main__':
    main()
