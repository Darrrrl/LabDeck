import argparse
import json
import socket
import time


def command(path, request):
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(5)
        client.connect(path)
        client.sendall(json.dumps(request).encode() + b'\n')
        client.shutdown(socket.SHUT_WR)
        response = bytearray()
        while True:
            chunk = client.recv(65536)
            if not chunk:
                break
            if len(response) + len(chunk) > 64 * 1024 ** 2:
                raise RuntimeError('response-too-large')
            response.extend(chunk)
    reply = json.loads(response)
    if reply.get('ok') is not True:
        raise RuntimeError('worker-rejected')
    return reply


def main():
    parser = argparse.ArgumentParser(description='Opt-in installed-worker smoke check; preparation only unless --confirm-download is supplied.')
    parser.add_argument('--socket', required=True)
    parser.add_argument('--source', required=True, help='Public YouTube content you are permitted to save')
    parser.add_argument('--kind', choices=['movie', 'tv', 'music'], required=True)
    parser.add_argument('--name', required=True, help='Movie/show name or music artist')
    parser.add_argument('--album', default='Singles')
    parser.add_argument('--confirm-download', action='store_true', help='Explicitly authorize writing completed files to the configured libraries')
    arguments = parser.parse_args()
    request = {'kind': arguments.kind, 'source': arguments.source}
    request.update({'artist': arguments.name, 'album': arguments.album} if arguments.kind == 'music' else {'name': arguments.name})
    identity = command(arguments.socket, {'action': 'prepare', 'request': request})['id']
    submitted = False
    deadline = time.monotonic() + (86400 if arguments.confirm_download else 900)
    try:
        while time.monotonic() < deadline:
            jobs = command(arguments.socket, {'action': 'status'})['jobs']
            job = next((item for item in jobs if item['id'] == identity), None)
            if job is None:
                raise RuntimeError('job-not-found')
            if job['state'] == 'ready':
                print(json.dumps({'id': identity, 'state': 'ready', 'destinations': [item['destination'] for item in job['items']]}))
                if not arguments.confirm_download:
                    command(arguments.socket, {'action': 'cancel', 'id': identity})
                    return
                command(arguments.socket, {'action': 'submit', 'id': identity})
                submitted = True
            elif job['state'] in {'completed', 'partially-completed', 'failed', 'cancelled', 'interrupted'}:
                print(json.dumps({'id': identity, 'state': job['state'], 'items': job['items']}))
                if not submitted or job['state'] != 'completed':
                    raise RuntimeError('live-check-not-complete')
                return
            time.sleep(2)
        raise RuntimeError('live-check-timeout')
    finally:
        try:
            jobs = command(arguments.socket, {'action': 'status'})['jobs']
            job = next((item for item in jobs if item['id'] == identity), None)
            if job and job['state'] not in {'completed', 'partially-completed', 'failed', 'cancelled', 'interrupted'}:
                command(arguments.socket, {'action': 'cancel', 'id': identity})
        except (OSError, RuntimeError):
            pass


if __name__ == '__main__':
    main()
