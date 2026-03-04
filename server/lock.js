import IORedis from 'ioredis';
import Redlock from 'redlock';

const client = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

// Configure Redlock with 0 retryCount to ensure immediate failure if lock is held
export const redlock = new Redlock([client], { retryCount: 0 });

export async function acquireLock(key, ttl = 60000) {
  // Return the lock instance so the caller can release it in a `finally` block
  return await redlock.acquire([`locks:${key}`], ttl);
}
