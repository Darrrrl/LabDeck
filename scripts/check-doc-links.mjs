import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

async function files(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.filter((entry) => entry.name !== 'node_modules' && entry.name !== '.git').map(async (entry) => {
    const target = resolve(path, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  }));
  return nested.flat();
}

const markdown = (await files(process.cwd())).filter((file) => file.endsWith('.md'));
const broken = [];
for (const file of markdown) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = match[1];
    if (!link || /^(?:https?:|#)/.test(link)) continue;
    const target = resolve(dirname(file), decodeURIComponent(link.split('#')[0]));
    try { await stat(target); } catch { broken.push(`${file}: ${link}`); }
  }
}
if (broken.length) { console.error(broken.join('\n')); process.exitCode = 1; }
else console.log(`Validated local links in ${markdown.length} Markdown files.`);
