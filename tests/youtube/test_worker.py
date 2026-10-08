import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('worker', Path(__file__).parents[2] / 'deploy/scripts/labdeck_youtube.py')
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name).resolve()
        roots = {}
        for kind in ['movie', 'tv', 'music']:
            root = self.directory / kind
            root.mkdir()
            roots[kind] = str(root)
        self.config = {'roots': roots, 'stateDirectory': str(self.directory / 'state'), 'ytDlp': '/usr/bin/yt-dlp', 'ffmpeg': '/usr/bin/ffmpeg'}
        self.worker = module.Worker(self.config)
        self.arguments = []

    def tearDown(self):
        self.worker.connection.close()
        os.close(self.worker.instance_lock)
        self.temporary.cleanup()

    def job(self, kind='movie'):
        request = {'kind': kind, 'source': 'https://youtu.be/abcdefghijk', 'name': 'Film & Friends', 'year': 2020}
        if kind == 'tv':
            request = {'kind': kind, 'source': 'https://www.youtube.com/playlist?list=PLabcdefghijk', 'name': 'Show & Friends'}
        if kind == 'music':
            request = {'kind': kind, 'source': 'https://youtu.be/abcdefghijk', 'artist': 'Artist'}
        identity = self.worker.command({'action': 'prepare', 'request': request})['id']
        return self.worker.jobs[identity]

    def fake_process(self, arguments, job, stage, metadata=False):
        self.arguments.append(arguments)
        if metadata:
            return json.dumps({'id': 'abcdefghijk', 'title': 'Original <Title>'}).encode()
        if arguments[0] == self.config['ytDlp']:
            (Path(stage) / 'source.webm').write_bytes(b'video source')
        else:
            Path(arguments[-1]).write_bytes(b'complete media')
        return b''

    def ready(self, job, fixture=None):
        with tempfile.TemporaryDirectory(dir=self.worker.state) as stage:
            with patch.object(self.worker, 'run_process', side_effect=self.fake_process if fixture is None else lambda *args, **kwargs: json.dumps(fixture).encode()):
                self.worker.prepare(job, stage)

    def complete(self, job):
        self.worker.command({'action': 'submit', 'id': job['id']})
        with patch.object(self.worker, 'run_process', side_effect=self.fake_process):
            self.worker.execute(job)

    def test_movie_preview_publication_nfo_and_privacy(self):
        job = self.job()
        self.ready(job)
        self.assertEqual(job['items'][0]['destination'], 'Film & Friends/Film & Friends.mp4')
        self.complete(job)
        self.assertEqual(job['state'], 'completed')
        root = Path(self.config['roots']['movie']) / 'Film & Friends'
        self.assertEqual((root / 'Film & Friends.mp4').read_bytes(), b'complete media')
        xml = ET.parse(root / 'Film & Friends.nfo').getroot()
        self.assertEqual(xml.findtext('title'), 'Film & Friends')
        self.assertEqual(xml.findtext('year'), '2020')
        self.assertIsNone(xml.find('premiered'))
        self.assertFalse(list(root.glob('*.part')))
        document = self.worker.connection.execute('SELECT document FROM jobs').fetchone()[0]
        self.assertNotIn('https:', document)
        self.assertNotIn('watch?v', document)
        public = self.worker.command({'action': 'status'})['jobs'][0]
        self.assertNotIn('sourceId', json.dumps(public))
        self.assertIn('--ignore-config', self.arguments[0])
        self.assertIn('--no-plugin-dirs', self.arguments[0])
        self.assertIn('libx264', self.arguments[-1])

    def test_tv_unavailable_order_and_show_nfo(self):
        job = self.job('tv')
        self.ready(job, {'entries': [{'id': 'abcdefghijk', 'title': 'First & <episode>', 'playlist_index': 1}, None, {'id': 'lmnopqrstuv', 'title': 'Third', 'playlist_index': 3}]})
        self.assertEqual([item['number'] for item in job['items']], [1, 2, 3])
        self.assertEqual(job['items'][1]['state'], 'unavailable')
        self.complete(job)
        self.assertEqual(job['state'], 'partially-completed')
        root = Path(self.config['roots']['tv']) / 'Show & Friends'
        self.assertEqual(ET.parse(root / 'tvshow.nfo').findtext('title'), 'Show & Friends')
        self.assertTrue((root / 'Season 01/Show & Friends - S01E03.mp4').exists())
        self.assertFalse((root / 'Season 01/Show & Friends - S01E02.mp4').exists())
        self.assertEqual(ET.parse(root / 'Season 01/Show & Friends - S01E01.nfo').findtext('episode'), '1')
        self.assertEqual(ET.parse(root / 'Season 01/Show & Friends - S01E01.nfo').findtext('title'), 'First & <episode>')

    def test_music_edits_tags_and_default_album(self):
        job = self.job('music')
        self.ready(job)
        self.worker.command({'action': 'submit', 'id': job['id'], 'titles': ['Edited: Track']})
        with patch.object(self.worker, 'run_process', side_effect=self.fake_process):
            self.worker.execute(job)
        self.assertTrue((Path(self.config['roots']['music']) / 'Artist/Singles/01 - Edited_ Track.mp3').exists())
        arguments = self.arguments[-1]
        for value in ['artist=Artist', 'album=Singles', 'title=Edited: Track', 'track=1', 'libmp3lame']:
            self.assertIn(value, arguments)

    def test_reject_urls_names_and_extra_fields(self):
        for source in ['http://youtu.be/abcdefghijk', 'https://evil.test/watch?v=abcdefghijk', 'https://user:pass@youtube.com/watch?v=abcdefghijk', 'https://youtube.com/watch?v=abcdefghijk&x=1', 'https://youtube.com/watch?v=abcdefghijk&v=lmnopqrstuv', 'https://youtube.com:443/watch?v=abcdefghijk', 'https://youtube.com/watch?v=abcdefghijk#fragment', 'https://youtube.com/../watch?v=abcdefghijk']:
            with self.subTest(source=source), self.assertRaises((ValueError, TypeError)):
                module.source_id(source)
        for name in ['../escape', '..', 'a\\b', 'a\x00b', '']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                module.safe_name(name)
        with self.assertRaises(ValueError):
            self.worker.command({'action': 'prepare', 'request': {'kind': 'movie', 'source': 'https://youtu.be/abcdefghijk', 'name': 'Movie', 'path': '/tmp'}})

    def test_playlist_limits_and_live_rejection(self):
        job = self.job('tv')
        for fixture in [{'entries': []}, {'entries': [{}] * 201}, {'entries': [{'id': 'abcdefghijk', 'title': 'Live', 'is_live': True}]}, {'entries': [{'id': 'abcdefghijk', 'title': 'Restricted', 'age_limit': 18}]}]:
            with self.assertRaises(ValueError):
                self.ready(job, fixture)
        self.assertEqual(module.extracted_name({'unexpected': 'raw payload'}, 'Untitled item 1'), 'Untitled item 1')

    def test_collision_and_symlink_do_not_overwrite(self):
        job = self.job()
        self.ready(job)
        root = Path(self.config['roots']['movie'])
        (root / job['name']).mkdir()
        media = root / job['items'][0]['destination']
        media.write_bytes(b'existing')
        self.complete(job)
        self.assertEqual(job['state'], 'failed')
        self.assertEqual(media.read_bytes(), b'existing')
        self.assertFalse(media.with_suffix('.nfo').exists())
        self.assertFalse(list(media.parent.glob('*.part')))
        other = self.job()
        other['name'] = 'Symlink'
        (root / 'Symlink').symlink_to(self.directory / 'music', target_is_directory=True)
        with self.assertRaises(OSError):
            self.ready(other)

    def test_cancel_and_retry_skip_completed_items(self):
        job = self.job('tv')
        self.ready(job, {'entries': [{'id': 'abcdefghijk', 'title': 'One'}, {'id': 'lmnopqrstuv', 'title': 'Two'}]})
        self.worker.command({'action': 'submit', 'id': job['id']})
        calls = []

        def fail_second(arguments, current, stage, metadata=False):
            if arguments[0] == self.config['ytDlp']:
                calls.append(arguments[-1])
                if 'lmnopqrstuv' in arguments[-1]:
                    raise ValueError('media-process-failed')
            return self.fake_process(arguments, current, stage, metadata)

        with patch.object(self.worker, 'run_process', side_effect=fail_second):
            self.worker.execute(job)
        self.assertEqual(job['state'], 'partially-completed')
        self.worker.command({'action': 'retry', 'id': job['id']})
        with patch.object(self.worker, 'run_process', side_effect=self.fake_process):
            self.worker.execute(job)
        self.assertEqual(job['state'], 'completed')
        self.assertEqual(sum('abcdefghijk' in call for call in calls), 1)
        cancelled = self.job('music')
        self.ready(cancelled)
        self.worker.command({'action': 'cancel', 'id': cancelled['id']})
        self.assertEqual(cancelled['items'][0]['state'], 'cancelled')

    def test_queue_retention_and_restart(self):
        first = self.job()
        self.ready(first)
        self.worker.command({'action': 'submit', 'id': first['id']})
        for _index in range(20):
            self.job()
        with self.assertRaisesRegex(ValueError, 'queue-full'):
            self.job()
        self.worker.connection.close()
        os.close(self.worker.instance_lock)
        self.worker = module.Worker(self.config)
        self.assertEqual(self.worker.jobs[first['id']]['state'], 'interrupted')
        self.assertEqual(self.worker.jobs[first['id']]['items'][0]['state'], 'interrupted')
        self.worker.command({'action': 'retry', 'id': first['id']})
        self.assertEqual(self.worker.jobs[first['id']]['state'], 'queued')
        for job in self.worker.jobs.values():
            job['state'] = 'failed'
            job['updatedAt'] = '2000-01-01T00:00:00Z'
        self.worker.prune()
        self.assertEqual(len(self.worker.jobs), 0)

    def test_process_timeout_cancellation_low_disk_and_byte_limit(self):
        job = self.job()
        arguments = ['/bin/sleep', '20']
        with tempfile.TemporaryDirectory(dir=self.worker.state) as stage:
            job['deadline'] = time.time() - 1
            with self.assertRaisesRegex(ValueError, 'deadline-exceeded'):
                self.worker.run_process(arguments, job, stage)
            job['deadline'] = time.time() + 86400
            job['state'] = 'cancelled'
            with self.assertRaisesRegex(ValueError, 'cancelled'):
                self.worker.run_process(arguments, job, stage)
            job['state'] = 'preparing'
            with patch.object(module.shutil, 'disk_usage', return_value=shutil._ntuple_diskusage(100, 100, 0)):
                with self.assertRaisesRegex(ValueError, 'low-disk-space'):
                    self.worker.run_process(arguments, job, stage)
            job['bytes'] = module.MAX_BYTES
            (Path(stage) / 'data').write_bytes(b'one')
            with self.assertRaisesRegex(ValueError, 'byte-limit'):
                self.worker.run_process(arguments, job, stage)

    def test_publication_journal_recovery_does_not_remove_foreign_file(self):
        job = self.job()
        self.ready(job)
        item = job['items'][0]
        root = Path(self.config['roots']['movie'])
        parent = root / job['name']
        parent.mkdir()
        temporary = parent / '.labdeck-journal.part'
        temporary.write_bytes(b'complete')
        media = parent / 'Film & Friends.mp4'
        os.link(temporary, media)
        info = temporary.stat()
        item['publication'] = [{'parent': job['name'], 'temporary': temporary.name, 'target': media.name, 'inode': info.st_ino, 'device': info.st_dev}]
        job['state'] = 'processing'
        item['state'] = 'processing'
        self.worker.save(job)
        self.worker.connection.close()
        os.close(self.worker.instance_lock)
        self.worker = module.Worker(self.config)
        self.assertFalse(media.exists())
        self.assertFalse(temporary.exists())
        self.assertEqual(self.worker.jobs[job['id']]['state'], 'interrupted')

    def test_running_process_cancellation_and_deadline_kill_group(self):
        job = self.job()
        with tempfile.TemporaryDirectory(dir=self.worker.state) as stage:
            job['deadline'] = time.time() + 0.05
            with patch.object(module.os, 'killpg', wraps=module.os.killpg) as kill:
                with self.assertRaisesRegex(ValueError, 'deadline-exceeded'):
                    self.worker.run_process(['/bin/sleep', '20'], job, stage)
                kill.assert_called_once()
            job['deadline'] = time.time() + 86400
            cancellation = threading.Timer(0.05, lambda: self.worker.command({'action': 'cancel', 'id': job['id']}))
            cancellation.start()
            try:
                with patch.object(module.os, 'killpg', wraps=module.os.killpg) as kill:
                    with self.assertRaisesRegex(ValueError, 'cancelled'):
                        self.worker.run_process(['/bin/sleep', '20'], job, stage)
                    kill.assert_called_once()
            finally:
                cancellation.join()
            self.assertIsNone(self.worker.process)

    def test_restart_preserves_completed_items_and_foreign_collisions(self):
        completed = self.job('music')
        self.ready(completed)
        self.complete(completed)
        music = Path(self.config['roots']['music']) / completed['items'][0]['destination']
        job = self.job()
        self.ready(job)
        item = job['items'][0]
        parent = Path(self.config['roots']['movie']) / job['name']
        parent.mkdir()
        temporary = parent / '.labdeck-test.part'
        temporary.write_bytes(b'own data')
        target = parent / 'Film & Friends.mp4'
        target.write_bytes(b'foreign file')
        evidence = temporary.stat()
        item['publication'] = [{'parent': job['name'], 'temporary': temporary.name, 'target': target.name, 'inode': evidence.st_ino, 'device': evidence.st_dev}]
        job['state'] = item['state'] = 'processing'
        self.worker.save(job)
        self.worker.connection.close()
        os.close(self.worker.instance_lock)
        self.worker = module.Worker(self.config)
        self.assertEqual(target.read_bytes(), b'foreign file')
        self.assertFalse(temporary.exists())
        self.assertEqual(music.read_bytes(), b'complete media')
        self.assertEqual(self.worker.jobs[completed['id']]['state'], 'completed')
        self.assertEqual(self.worker.jobs[job['id']]['state'], 'interrupted')

    def test_cancel_during_publication_and_database_failure(self):
        job = self.job()
        self.ready(job)
        item = job['items'][0]
        source = self.directory / 'complete.mp4'
        source.write_bytes(b'media')
        job['state'] = 'cancelled'
        with self.assertRaisesRegex(ValueError, 'cancelled-or-deadline'):
            self.worker.publish(job, item, source, module.nfo('movie', {'title': job['name']}))
        root = Path(self.config['roots']['movie']) / job['name']
        self.assertFalse(list(root.glob('*.part')))
        self.assertFalse(list(root.glob('*.mp4')))
        job['state'] = 'processing'
        original = self.worker.save

        def fail_commit(current):
            if item['state'] == 'completed':
                raise module.sqlite3.OperationalError('disk full')
            return original(current)

        with patch.object(self.worker, 'save', side_effect=fail_commit):
            with self.assertRaises(module.sqlite3.OperationalError):
                self.worker.publish(job, item, source, module.nfo('movie', {'title': job['name']}))
        self.assertFalse(list(root.glob('*.mp4')))
        self.assertFalse(list(root.glob('*.nfo')))
        self.assertFalse(list(root.glob('*.part')))
        self.assertEqual(job['bytes'], 0)

    @unittest.skipUnless(os.getenv('LABDECK_YOUTUBE_FFMPEG_TEST') == '1', 'opt-in real FFmpeg/ffprobe check')
    def test_real_mp4_conversion_and_mp3_tags(self):
        ffmpeg, probe = shutil.which('ffmpeg'), shutil.which('ffprobe')
        self.assertIsNotNone(ffmpeg)
        self.assertIsNotNone(probe)
        self.config['ffmpeg'] = ffmpeg
        source = self.directory / 'fixture.webm'
        subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3', '-c:v', 'libvpx', '-c:a', 'libopus', '-shortest', str(source)], check=True)
        original = self.worker.run_process

        def fixture_process(arguments, job, stage, metadata=False):
            if arguments[0] == self.config['ytDlp']:
                shutil.copyfile(source, Path(stage) / 'source.webm')
                return b''
            return original(arguments, job, stage, metadata)

        for kind in ['movie', 'music']:
            job = self.job(kind)
            self.ready(job)
            self.worker.command({'action': 'submit', 'id': job['id']})
            with patch.object(self.worker, 'run_process', side_effect=fixture_process):
                self.worker.execute(job)
            self.assertEqual(job['state'], 'completed', job['items'][0]['error'])
            media = Path(self.config['roots'][kind]) / job['items'][0]['destination']
            result = json.loads(subprocess.check_output([probe, '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(media)]))
            if kind == 'movie':
                self.assertIn('mp4', result['format']['format_name'])
                self.assertEqual(result['streams'][0]['codec_name'], 'h264')
            else:
                self.assertEqual(result['format']['format_name'], 'mp3')
                self.assertEqual(result['format']['tags']['artist'], 'Artist')
                self.assertEqual(result['format']['tags']['album'], 'Singles')
                self.assertEqual(result['format']['tags']['track'], '1')


if __name__ == '__main__':
    unittest.main()
