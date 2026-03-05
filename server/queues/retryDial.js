import { Queue, Worker } from 'bullmq';
import { createTwilioCallAndJoin } from '../services/twilioService.js';

const connection = { 
  host: process.env.REDIS_HOST || '127.0.0.1', 
  port: process.env.REDIS_PORT || 6379 
};

export const retryQueue = new Queue('retryDial', { connection });

export function enqueueRetry(conf, toNumber, attempt = 1) {
  // Exponential backoff: 5s, 10s, 20s
  const delay = Math.min(30000, 5000 * Math.pow(2, attempt - 1));
  return retryQueue.add('retryDial', { conf, toNumber, attempt }, { delay, attempts: 3 });
}

const retryWorker = new Worker('retryDial', async job => {
  const { conf, toNumber, attempt } = job.data;
  console.log('[retryQueue] processing job', job.id, 'for conf', conf, 'attempt', attempt);
  
  // Actually create the outbound leg
  const res = await createTwilioCallAndJoin(conf, toNumber);
  
  if (!res.ok) {
    throw new Error('Twilio create failed: ' + (res.error || 'unknown'));
  }
}, { connection });
