import { chmodSync, linkSync, lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

function regularSource(path: string): void {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('source must be a regular non-symlink SQLite file');
}

function verify(database: Database.Database): void {
  const integrity = database.pragma('integrity_check') as { integrity_check: string }[];
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') throw new Error('SQLite integrity check failed');
  if ((database.pragma('foreign_key_check') as unknown[]).length) throw new Error('SQLite foreign key check failed');
  const versions = database.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[];
  if (!versions.length || versions.some(({ version }) => !Number.isSafeInteger(version) || version < 1 || version > 4)) throw new Error('unsupported database schema');
}

export async function maintainDatabase(mode: 'backup' | 'restore', source: string, target: string): Promise<void> {
  const input = resolve(source); const output = resolve(target);
  if (input === output) throw new Error('source and target must differ');
  regularSource(input);
  const destinationParent = dirname(output);
  if (!lstatSync(destinationParent).isDirectory()) throw new Error('target parent must be a directory');
  const temporaryDirectory = mkdtempSync(join(destinationParent, '.labdeck-db-'));
  const staged = join(temporaryDirectory, 'snapshot.db');
  try {
    const original = new Database(input, { readonly: true, fileMustExist: true });
    try { verify(original); await original.backup(staged); } finally { original.close(); }
    const copy = new Database(staged);
    try {
      verify(copy);
      if (mode === 'restore') {
        copy.pragma('journal_mode = DELETE');
        copy.prepare('DELETE FROM sessions').run();
        verify(copy);
      }
    } finally { copy.close(); }
    chmodSync(staged, 0o600);
    linkSync(staged, output); // atomic create; never overwrites an existing target
  } finally { rmSync(temporaryDirectory, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, ...arguments_] = process.argv.slice(2);
  const options = new Map(arguments_.map((argument) => { const match = /^--(source|target)=(.+)$/.exec(argument); if (!match) throw new Error('usage: maintenance-cli backup|restore --source=/absolute/file --target=/absolute/new-file'); return [match[1]!, match[2]!] as const; }));
  if ((mode !== 'backup' && mode !== 'restore') || arguments_.length !== 2 || !options.get('source') || !options.get('target')) throw new Error('usage: maintenance-cli backup|restore --source=/absolute/file --target=/absolute/new-file');
  await maintainDatabase(mode, options.get('source')!, options.get('target')!);
  process.stdout.write(`${mode} verified; new file created.\n`);
}
