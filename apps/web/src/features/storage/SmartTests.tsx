import { useState } from 'react';
import type { StorageResponse } from '@labdeck/contracts';

type Disk = StorageResponse['smart']['disks'][number];
export function SmartTests({ disk }: { disk: Disk }) {
  const test = disk.selfTest;
  return <section className="smart-tests" aria-label={`${disk.label} self-tests`}><h4>SMART self-tests</h4>
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
