import argon2 from 'argon2';

const options = { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 1024) throw new Error('Password must be between 12 and 1024 characters');
  return argon2.hash(password, options);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  if (password.length > 1024) return false;
  try { return await argon2.verify(hash, password); } catch { return false; }
}
