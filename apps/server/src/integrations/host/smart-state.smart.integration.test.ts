import { readFileSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { smartSnapshotSchema, type SmartSnapshot } from '@labdeck/contracts';
import { openDatabase } from '../../db/database.js';
import { HostQueries } from '../../core/queries.js';
import { readSmartSnapshot } from './smart-reader.js';
import { SmartStateStore } from './smart-state.js';

const fixture = (): SmartSnapshot => smartSnapshotSchema.parse(JSON.parse(readFileSync('tests/fixtures/smart/snapshot-v1.json', 'utf8')));
function advance(value: SmartSnapshot, minutes: number) { const next = structuredClone(value); const at = new Date(Date.parse(value.generatedAt) + minutes * 60_000).toISOString(); next.generatedAt = at; for (const disk of next.disks) disk.observedAt = at; return next; }
const query = (database: ReturnType<typeof openDatabase>, now: number) => new HostQueries(database, false, () => true, () => now, undefined, [], undefined, new Set(), true).smart();

describe('SMART snapshot state', () => {
  it('retains original evidence time while asleep or unreadable', () => {
    const database = openDatabase(':memory:'); const state = new SmartStateStore(database); const first = fixture(); const at = Date.parse(first.generatedAt); state.ingest(first, at);
    const asleep = advance(first, 10); asleep.disks[0] = { ...asleep.disks[0]!, state: 'asleep', identity: '', serialSuffix: '', protocol: 'unknown', model: '', capacityBytes: null, temperatureCelsius: null, health: 'unknown', powerOnHours: null, ata: null, nvme: null, scsi: null };
    state.ingest(asleep, at + 600_000);
    expect(query(database, at + 600_000).disks[0]).toMatchObject({ state: 'asleep', health: 'passed', evidenceAt: first.generatedAt, observedAt: asleep.generatedAt });
    state.failure('permission', at + 700_000);
    expect(query(database, at + 700_000)).toMatchObject({ errorCode: 'permission', unavailable: 1 });
    database.close();
  });
  it('uses two actual samples for temperature warning and recovery; replay does not count twice', () => {
    const database = openDatabase(':memory:'); const state = new SmartStateStore(database); const first = fixture(); const at = Date.parse(first.generatedAt); state.ingest(first, at);
    const hot1 = advance(first, 10); hot1.disks[0]!.temperatureCelsius = 46; state.ingest(hot1, at + 600_000); state.ingest(hot1, at + 600_001);
    expect(query(database, at + 600_001).disks[0]?.temperatureWarning).toBe(false);
    const hot2 = advance(hot1, 10); state.ingest(hot2, at + 1_200_000);
    expect(query(database, at + 1_200_000).disks[0]?.temperatureWarning).toBe(true);
    const cool1 = advance(hot2, 10); cool1.disks[0]!.temperatureCelsius = 40; state.ingest(cool1, at + 1_800_000);
    const cool2 = advance(cool1, 10); state.ingest(cool2, at + 2_400_000);
    expect(query(database, at + 2_400_000).disks[0]?.temperatureWarning).toBe(false);
    expect(database.prepare("SELECT kind,count(*) AS count FROM events WHERE kind LIKE 'disk.temperature-%' GROUP BY kind ORDER BY kind").all()).toEqual([{ kind: 'disk.temperature-high', count: 1 }, { kind: 'disk.temperature-recovered', count: 1 }]);
    database.close();
  });
  it('observes counter increase, replacement, and immediate SMART failure without combining unrelated identities', () => {
    const database = openDatabase(':memory:'); const state = new SmartStateStore(database); const first = fixture(); const at = Date.parse(first.generatedAt); state.ingest(first, at);
    const next = advance(first, 10); next.disks[0]!.ata!.pending = '1'; next.disks[0]!.health = 'warning'; state.ingest(next, at + 600_000);
    expect(database.prepare("SELECT count(*) AS count FROM events WHERE kind='disk.error-increase'").get()).toEqual({ count: 1 });
    const resized = advance(next, 10); resized.disks[0]!.capacityBytes = 3_000_000_000_000; state.ingest(resized, at + 1_200_000);
    expect(database.prepare("SELECT count(*) AS count FROM events WHERE kind='disk.capacity-changed'").get()).toEqual({ count: 1 });
    const replaced = advance(resized, 10); replaced.disks[0]!.identity = 'cccccccccccccccccccccccccccccccc'; replaced.disks[0]!.ata!.pending = '0'; replaced.disks[0]!.health = 'failed'; state.ingest(replaced, at + 1_800_000);
    expect(database.prepare("SELECT count(*) AS count FROM events WHERE kind='disk.replaced-observed'").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM events WHERE kind='disk.smart-failed'").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM events WHERE kind='disk.error-increase'").get()).toEqual({ count: 1 });
    database.close();
  });
  it('rejects symlink, oversized and future-dated SMART snapshot files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'labdeck-smart-test-')); const path = join(directory, 'snapshot.json'); const link = join(directory, 'link.json');
    writeFileSync(path, JSON.stringify(fixture())); symlinkSync(path, link);
    expect(() => readSmartSnapshot(link, Date.parse(fixture().generatedAt))).toThrow();
    expect(() => readSmartSnapshot(path, Date.parse(fixture().generatedAt))).not.toThrow();
    writeFileSync(path, 'x'.repeat(2 * 1024 * 1024 + 1)); expect(() => readSmartSnapshot(path)).toThrow('oversized');
    writeFileSync(path, JSON.stringify(fixture())); expect(() => readSmartSnapshot(path, Date.parse(fixture().generatedAt) - 60_000)).toThrow('future-timestamp');
  });
});
