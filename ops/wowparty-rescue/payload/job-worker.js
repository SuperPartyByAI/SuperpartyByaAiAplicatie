'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const supabase = require('../supabase');
const { processJob, shutdown: shutdownAgent } = require('./wowparty-agent');

const WORKER_ID = `wowparty-agent-${process.pid}-${Date.now()}`;
const POLL_INTERVAL_MS = Number(process.env.WOWPARTY_AGENT_POLL_MS || 5000);
const LOCK_SECONDS = Number(process.env.WOWPARTY_AGENT_LOCK_SECONDS || 300);
let running = true;
let currentJobId = null;
let currentHeartbeat = null;

function missingRpc(error) {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return /PGRST202|could not find the function|function .* does not exist/i.test(text);
}

function retryAt(attempts) {
  const delaySeconds = Math.min(300, 5 * (2 ** Math.max(0, attempts - 1)));
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

async function claimWithRpc() {
  const { data, error } = await supabase.rpc('claim_agent_job', { p_worker_id: WORKER_ID });
  if (error) throw error;
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

async function claimFallback() {
  const now = new Date().toISOString();
  const { data: jobs, error: findError } = await supabase
    .from('agent_processing_jobs')
    .select('*')
    .eq('status', 'pending')
    .lte('next_attempt_at', now)
    .order('created_at', { ascending: true })
    .limit(1);
  if (findError) throw findError;
  if (!jobs?.length) return null;

  const target = jobs[0];
  const { data: claimed, error: claimError } = await supabase
    .from('agent_processing_jobs')
    .update({
      status: 'running',
      locked_by: WORKER_ID,
      locked_until: new Date(Date.now() + LOCK_SECONDS * 1000).toISOString(),
      attempts: (target.attempts || 0) + 1,
      updated_at: now,
    })
    .eq('id', target.id)
    .eq('status', 'pending')
    .select('*');
  if (claimError) throw claimError;
  return claimed?.[0] || null;
}

async function claimNextJob() {
  try {
    return await claimWithRpc();
  } catch (error) {
    if (!missingRpc(error)) throw error;
    return claimFallback();
  }
}

async function heartbeat(jobId) {
  try {
    const { error } = await supabase.rpc('heartbeat_agent_job', {
      p_job_id: jobId,
      p_worker_id: WORKER_ID,
    });
    if (error && !missingRpc(error)) throw error;
    if (!error) return;
  } catch (error) {
    if (!missingRpc(error)) throw error;
  }

  const { error } = await supabase
    .from('agent_processing_jobs')
    .update({
      locked_until: new Date(Date.now() + LOCK_SECONDS * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('locked_by', WORKER_ID)
    .eq('status', 'running');
  if (error) throw error;
}

async function failJob(job, failure) {
  const message = String(failure?.message || failure || 'unknown_error').slice(0, 1000);
  try {
    const { error } = await supabase.rpc('fail_agent_job', {
      p_job_id: job.id,
      p_error: message,
    });
    if (error && !missingRpc(error)) throw error;
    if (!error) return;
  } catch (error) {
    if (!missingRpc(error)) throw error;
  }

  const attempts = Number(job.attempts || 0);
  const maxAttempts = Number(job.max_attempts || 3);
  const terminal = attempts >= maxAttempts;
  const { error } = await supabase
    .from('agent_processing_jobs')
    .update({
      status: terminal ? 'failed' : 'pending',
      result: { error: message },
      error_message: message,
      next_attempt_at: terminal ? null : retryAt(attempts),
      locked_by: null,
      locked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id)
    .eq('locked_by', WORKER_ID);
  if (error) throw error;
}

function stopHeartbeat() {
  if (currentHeartbeat) clearInterval(currentHeartbeat);
  currentHeartbeat = null;
}

async function processClaimedJob(job) {
  currentJobId = job.id;
  currentHeartbeat = setInterval(() => {
    heartbeat(job.id).catch((error) => {
      console.error(`[JobWorker] Heartbeat failed for ${job.id}: ${error.message}`);
    });
  }, Math.min(30000, Math.floor((LOCK_SECONDS * 1000) / 3)));

  try {
    await processJob(job);
  } catch (error) {
    console.error(`[JobWorker] Job ${job.id} failed: ${error.message}`);
    await failJob(job, error);
  } finally {
    stopHeartbeat();
    currentJobId = null;
  }
}

async function poll() {
  while (running) {
    try {
      const job = await claimNextJob();
      if (job) await processClaimedJob(job);
    } catch (error) {
      console.error(`[JobWorker] Poll failed: ${error.message}`);
    }

    if (running) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

async function releaseCurrentJob() {
  if (!currentJobId) return;
  const { error } = await supabase
    .from('agent_processing_jobs')
    .update({
      status: 'pending',
      locked_by: null,
      locked_until: null,
      next_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', currentJobId)
    .eq('locked_by', WORKER_ID)
    .eq('status', 'running');
  if (error) console.error(`[JobWorker] Release failed: ${error.message}`);
}

async function shutdown(signal) {
  if (!running) return;
  running = false;
  stopHeartbeat();
  console.log(`[JobWorker] Shutting down (${signal})`);
  try {
    await releaseCurrentJob();
    await shutdownAgent();
  } catch (error) {
    console.error(`[JobWorker] Shutdown error: ${error.message}`);
  } finally {
    process.exit(0);
  }
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

console.log(`[JobWorker] Started as ${WORKER_ID}; outbound WhatsApp is disabled`);
if (process.send) process.send('ready');
poll().catch((error) => {
  console.error(`[JobWorker] Fatal: ${error.message}`);
  process.exit(1);
});
