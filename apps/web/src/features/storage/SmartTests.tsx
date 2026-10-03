import { useState } from 'react';
import type { StorageResponse } from '@labdeck/contracts';
import { startSmartTest } from '../../app/api.js';

type Disk = StorageResponse['smart']['disks'][number];
export function SmartTests({ disk, controlAvailable, canStart }: { disk: Disk; controlAvailable: boolean; canStart: boolean }) {
  const test = disk.selfTest;
  const [starting, setStarting] = useState<'short' | 'extended' | null>(null);
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const start = async (type: 'short' | 'extended') => {
    setStarting(type); setMessage('');
    try { await startSmartTest(disk.id, type); setAcceptedAt(disk.observedAt); setMessage(`${type === 'short' ? 'Short' : 'Extended'} test accepted by the host. Results appear after the next SMART observation.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not start the test.'); }
    finally { setStarting(null); }
  };
  return <section className="smart-tests" aria-label={`${disk.label} self-tests`}><h4>SMART self-tests</h4>
    {!controlAvailable && disk.protocol === 'ATA' ? <p className="fine-print">To start tests here, enable the optional SMART control service on the host.</p> : null}
    {controlAvailable && disk.protocol === 'ATA' ? <><div className="container-controls"><button type="button" disabled={!canStart || acceptedAt === disk.observedAt || starting !== null} onClick={() => void start('short')}>Start short test</button><button type="button" disabled={!canStart || acceptedAt === disk.observedAt || starting !== null} onClick={() => void start('extended')}>Start extended test</button></div><p className="fine-print">Starting a test can wake a sleeping drive. Extended tests may take hours. Only one test should run on a drive at a time.</p>{!canStart ? <p className="muted">A test is running or current readable SMART evidence is unavailable.</p> : null}{message ? <p role="status">{message}</p> : null}</> : null}
    {!test ? <p className="muted">Self-test evidence unavailable. Progress and results currently support ATA disks with a compatible collector.</p> : <>
      <p><strong>{test.state === 'running' ? 'Test in progress' : test.state === 'idle' ? 'No test running at observation' : 'Current test state unknown'}</strong>{test.state === 'running' && test.remainingPercent !== null ? ` · ${test.remainingPercent}% remaining` : ''}</p>
      {test.state === 'running' && test.remainingPercent !== null ? <progress aria-label={`${disk.label} test completion at observation`} max={100} value={100 - test.remainingPercent} /> : null}
      <p className="fine-print">Drive estimates: short {test.shortMinutes ?? 'unknown'} min · extended {test.extendedMinutes ?? 'unknown'} min. Actual duration can vary with disk activity.</p>
      {test.history.length ? <ul className="smart-test-history">{test.history.map((entry, index) => <li key={index}><strong>{entry.type} · {entry.result}</strong><span>{entry.lifetimeHours === null ? 'Disk lifetime unknown' : `At ${entry.lifetimeHours.toLocaleString()} power-on hours`}</span></li>)}</ul> : <p>No self-test entries reported.</p>}
      <p className="fine-print">Latest reported tests, newest first. Disk power-on hours are not calendar dates. Progress uses the health evidence timestamp above.</p>
    </>}
  </section>;
}

export function SmartSchedule() {
  const [day, setDay] = useState('7');
  const [hour, setHour] = useState('03');
  const schedule = `(S/../../[1-6]/${hour}|L/../../${day}/${hour})`;
  return <details className="panel smart-schedule"><summary>Plan SMART tests</summary>
    <p>Schedule short tests Monday–Saturday and an extended test on your chosen day. If both match, smartd chooses the extended test. The server runs the schedule even when this browser is closed.</p>
    <div className="container-controls"><label>Extended test day<select value={day} onChange={(event) => setDay(event.target.value)}>{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label><label>Start hour (server local time)<select value={hour} onChange={(event) => setHour(event.target.value)}>{Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0')).map((value) => <option key={value} value={value}>{value}:00–{value}:59</option>)}</select></label></div>
    <pre className="schedule-config"><code>{`/dev/disk/by-id/REPLACE_WITH_REVIEWED_DISK_ID -d auto -a -n standby,q -s ${schedule}`}</code></pre>
    <p className="fine-print">Configuration preview · not installed or active. Add one reviewed disk entry to /etc/smartd.conf on the server, choose its correct device type, validate with smartd -q showtests, and reload smartmontools. Stagger disks to avoid overlapping long tests. Sleeping disks may defer tests. LabDeck reads results through the separate SMART helper; it cannot verify the schedule is installed.</p>
  </details>;
}
