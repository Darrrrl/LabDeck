import { createConnection } from 'node:net';
import { z } from 'zod';

const responseSchema = z.object({ status: z.enum(['completed', 'rejected', 'invalid-request']) }).strict();
export function runDockerAction(path: string, request: { kind: 'container' | 'project'; id: string; action: 'start' | 'stop' | 'restart' }): Promise<'completed' | 'rejected'> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let data = '';
    socket.setTimeout(70_000);
    socket.on('connect', () => socket.end(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk: Buffer) => { data += chunk.toString('utf8'); if (data.length > 1024) socket.destroy(new Error('oversized response')); });
    socket.on('timeout', () => socket.destroy(new Error('Docker action timeout')));
    socket.on('error', reject);
    socket.on('end', () => {
      try { const parsed = responseSchema.parse(JSON.parse(data)); resolve(parsed.status === 'completed' ? 'completed' : 'rejected'); }
      catch { reject(new Error('invalid Docker action response')); }
    });
  });
}
