import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fileOperation, getFileActions, getFileShares, type FileEntry } from '../../app/api.js';
import { bytes, relativeTime } from '../../components/format.js';
import { Status } from '../../components/Status.js';

const chunkSize = 4 * 1024 * 1024;
async function encode(file: File, offset: number) {
  const data = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer());
  const pieces: string[] = [];
  for (let i = 0; i < data.length; i += 16_384) pieces.push(String.fromCharCode(...data.subarray(i, i + 16_384)));
  return btoa(pieces.join(''));
}

export function FilesPage() {
  const query = useQuery({ queryKey: ['file-shares'], queryFn: getFileShares, refetchInterval: 30_000 });
  const data = query.data;
  const share = data?.shares.find((item) => item.id === data.control?.shareId);
  const enabled = Boolean(data?.control?.available && data.freshness === 'fresh' && share?.state === 'ok');
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [folderName, setFolderName] = useState('');
  const [renameFrom, setRenameFrom] = useState('');
  const [renameTo, setRenameTo] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const actions = useQuery({ queryKey: ['file-actions', revision], queryFn: getFileActions, enabled: Boolean(data?.control?.available) });
  const child = (name: string) => [path, name].filter(Boolean).join('/');

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void fileOperation({ action: 'list', path }).then((result) => {
      if (active) { setEntries(result.entries ?? []); setCursor(result.nextCursor ?? null); }
    }).catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : 'Unable to list files.'); });
    return () => { active = false; };
  }, [enabled, path, revision]);

  async function run(request: Record<string, unknown>) {
    setBusy(true); setMessage('');
    try { await fileOperation(request); setRevision((value) => value + 1); setMessage('Completed.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'File operation failed.'); }
    finally { setBusy(false); }
  }

  async function upload(file: File) {
    if (file.size > 100 * 1024 ** 3) { setMessage('Uploads are limited to 100 GiB.'); return; }
    setBusy(true); setProgress(0); setMessage('');
    const destination = child(file.name);
    const key = `labdeck-upload:${data?.control?.shareId}:${destination}:${file.size}:${file.lastModified}`;
    try {
      const resumeId = localStorage.getItem(key);
      const started = await fileOperation({ action: 'start', path: destination, size: file.size, ...(resumeId ? { resumeId } : {}) });
      if (!started.uploadId || started.offset === undefined) throw new Error('Invalid upload session.');
      const uploadId = started.uploadId;
      localStorage.setItem(key, uploadId);
      let offset = started.offset;
      while (offset < file.size) {
        const reply = await fileOperation({ action: 'chunk', uploadId, offset, data: await encode(file, offset) });
        if (reply.offset === undefined || reply.offset <= offset) throw new Error('Upload did not advance.');
        offset = reply.offset;
        setProgress(Math.round(offset / file.size * 100));
      }
      await fileOperation({ action: 'finish', uploadId });
      localStorage.removeItem(key); setProgress(null); setMessage('Upload complete.'); setRevision((value) => value + 1);
    } catch (error) { setMessage(`${error instanceof Error ? error.message : 'Upload failed.'} Select the same file again to resume.`); }
    finally { setBusy(false); }
  }

  return <main id="main-content" tabIndex={-1}><header className="page-header"><div><p className="eyebrow">MOUNTED SHARES</p><h1>Files</h1></div></header>
    {query.isPending ? <section className="notice">Loading share status…</section> : null}
    {query.isError ? <section className="notice" role="alert">Cached share status is unavailable.</section> : null}
    {data && !data.configured ? <section className="notice"><Status tone="unknown">Not configured</Status><p>Add an approved SMB or NFS mount in the host collector configuration.</p></section> : null}
    {data?.configured ? <><p className="muted">Share inventory observed {relativeTime(data.observedAt)} · {data.freshness}. Offline shares retain their last measured capacity with its original time.</p><section className="disk-list" aria-label="Mounted file shares">{data.shares.map((item) => <article className="panel" key={item.id}><div className="section-heading"><div><h2>{item.id}</h2><p>{item.path} · {item.kind.toUpperCase()}</p></div><Status tone={data.freshness !== 'fresh' || item.state !== 'ok' ? 'unknown' : 'healthy'}>{item.state}</Status></div><p>Available: <strong>{item.availableBytes === null ? 'Unknown' : bytes(item.availableBytes)}</strong> · Total: <strong>{item.totalBytes === null ? 'Unknown' : bytes(item.totalBytes)}</strong></p><p className="fine-print">Status observed {relativeTime(item.observedAt)} · capacity evidence {relativeTime(item.evidenceAt)}</p></article>)}</section></> : null}
    {data?.control?.available && share ? <section className="panel"><h2>Browse {share.id}</h2><p>/{path}</p><div className="file-toolbar"><button type="button" disabled={busy || !enabled || !path} onClick={() => setPath(path.split('/').slice(0, -1).join('/'))}>Up</button><button type="button" disabled={busy || !enabled} onClick={() => setRevision((value) => value + 1)}>Refresh</button></div>
      {!enabled ? <p role="status">File operations are paused while this share is offline or its status is stale.</p> : null}{message ? <p role="status">{message}</p> : null}
      {enabled ? <><ul className="file-list">{entries.map((entry) => <li key={entry.name}><span>{entry.kind === 'directory' ? 'Folder' : 'File'}: </span>{entry.kind === 'directory' ? <button type="button" disabled={busy} onClick={() => setPath(child(entry.name))}>{entry.name}</button> : <strong>{entry.name}</strong>}{entry.size === null ? null : <span> · {bytes(entry.size)}</span>} <button type="button" disabled={busy} onClick={() => { setRenameFrom(child(entry.name)); setRenameTo(entry.name); }}>Rename</button> <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Delete ${entry.name}? Folders must be empty.`)) void run({ action: 'delete', path: child(entry.name) }); }}>Delete</button></li>)}</ul>{entries.length === 0 ? <p>This folder is empty.</p> : null}{cursor ? <button type="button" disabled={busy} onClick={() => { void fileOperation({ action: 'list', path, cursor }).then((result) => { setEntries((current) => [...current, ...(result.entries ?? [])]); setCursor(result.nextCursor ?? null); }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Unable to list more files.')); }}>Load more</button> : null}</> : null}
      {renameFrom ? <form onSubmit={(event) => { event.preventDefault(); void run({ action: 'rename', from: renameFrom, to: child(renameTo) }); setRenameFrom(''); }}><label>New name <input value={renameTo} onChange={(event) => setRenameTo(event.target.value)} required /></label><button type="submit" disabled={busy || !enabled}>Save name</button><button type="button" onClick={() => setRenameFrom('')}>Cancel</button></form> : null}
      <form onSubmit={(event) => { event.preventDefault(); void run({ action: 'mkdir', path: child(folderName) }); setFolderName(''); }}><label>New folder <input value={folderName} onChange={(event) => setFolderName(event.target.value)} required /></label><button type="submit" disabled={busy || !enabled}>Create folder</button></form>
      <label>Upload file (up to 100 GiB) <input type="file" disabled={busy || !enabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} /></label>{progress !== null ? <p role="status">Upload {progress}%</p> : null}
      {actions.data?.actions.length ? <div><h3>Recent actions</h3><ul>{actions.data.actions.map((item) => <li key={item.id}>{item.action} · {item.result} · {relativeTime(item.requestedAt)}</li>)}</ul></div> : null}
    </section> : null}
  </main>;
}
