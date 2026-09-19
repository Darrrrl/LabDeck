import { stdin, stdout } from 'node:process';
import { hashPassword } from './password.js';

async function readPassword(): Promise<string> {
  if (!stdin.isTTY) {
    let value = '';
    stdin.setEncoding('utf8');
    for await (const chunk of stdin) value += chunk;
    return value.replace(/[\r\n]+$/, '');
  }
  stdout.write('Enter owner password: ');
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  try {
    return await new Promise<string>((resolve, reject) => {
      let value = '';
      const onData = (key: string) => {
        if (key === '\u0003') { stdin.off('data', onData); reject(new Error('Cancelled')); return; }
        if (key === '\r' || key === '\n') { stdin.off('data', onData); resolve(value); return; }
        if (key === '\u007f') { value = value.slice(0, -1); return; }
        value += key;
      };
      stdin.on('data', onData);
    });
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
    stdout.write('\n');
  }
}

try {
  stdout.write(`${await hashPassword(await readPassword())}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unable to hash password'}\n`);
  process.exitCode = 1;
}
