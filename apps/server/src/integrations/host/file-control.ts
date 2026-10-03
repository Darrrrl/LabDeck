import { createConnection } from 'node:net';
import { fileOperationReplySchema } from '@labdeck/contracts';

export type FileReply = ReturnType<typeof fileOperationReplySchema.parse>;

export function fileOperation(path: string, request: Record<string, unknown>): Promise<FileReply> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let response = '';
    socket.setTimeout(45_000);
    socket.on('connect', () => socket.end(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString('utf8');
      if (response.length > 128 * 1024) socket.destroy(new Error('file response too large'));
    });
    socket.on('error', (error: Error) => reject(error));
    socket.on('timeout', () => socket.destroy(new Error('file service timeout')));
    socket.on('end', () => {
      try {
        resolve(fileOperationReplySchema.parse(JSON.parse(response)));
      } catch (error) { reject(error instanceof Error ? error : new Error('invalid file response')); }
    });
  });
}
