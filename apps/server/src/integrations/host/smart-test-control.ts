import { createConnection } from 'node:net';
import { z } from 'zod';

const responseSchema = z.object({ status: z.enum(['started', 'invalid-request', 'unknown-disk', 'rate-limited', 'already-running', 'device-unavailable', 'rejected']) }).strict();
export type SmartTestStatus = z.infer<typeof responseSchema>['status'];

export function startSmartTest(path: string, diskId: string, type: 'short' | 'extended'): Promise<SmartTestStatus> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let data = '';
    socket.setTimeout(35_000);
    socket.on('connect', () => socket.end(`${JSON.stringify({ diskId, type })}\n`));
    socket.on('data', (chunk: Buffer) => {
      data += chunk.toString('utf8');
      if (data.length > 1024) socket.destroy(new Error('oversized response'));
    });
    socket.on('timeout', () => socket.destroy(new Error('control timeout')));
    socket.on('error', reject);
    socket.on('end', () => {
      try { resolve(responseSchema.parse(JSON.parse(data)).status); }
      catch { reject(new Error('invalid control response')); }
    });
  });
}
