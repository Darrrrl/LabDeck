import { describe, expect, it } from 'vitest';
import { youtubeCommandSchema, youtubeSourceSchema } from './index.js';

describe('YouTube boundary', () => {
  it('accepts only fixed public YouTube sources and path-free commands', () => {
    expect(youtubeSourceSchema.safeParse('https://youtu.be/abcdefghijk').success).toBe(true);
    for (const source of ['https://user:secret@youtube.com/watch?v=abcdefghijk', 'https://127.0.0.1/watch?v=abcdefghijk', 'https://youtube.com/watch?v=abcdefghijk&flags=evil', 'https://youtube.com/watch?v=abcdefghijk&v=lmnopqrstuv']) {
      expect(youtubeSourceSchema.safeParse(source).success).toBe(false);
    }
    expect(youtubeCommandSchema.safeParse({ action: 'prepare', request: { kind: 'movie', source: 'https://youtu.be/abcdefghijk', name: '../escape' } }).success).toBe(false);
    expect(youtubeCommandSchema.safeParse({ action: 'retry', id: 'a'.repeat(32), path: '/srv' }).success).toBe(false);
    expect(youtubeCommandSchema.safeParse({ action: 'prepare', request: { kind: 'music', source: 'https://youtu.be/abcdefghijk', artist: 'Artist' } }).success).toBe(true);
  });
});
