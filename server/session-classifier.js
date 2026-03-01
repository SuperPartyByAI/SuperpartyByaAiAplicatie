/**
 * session-classifier.js
 * 
 * Classifies WhatsApp Baileys disconnect reasons into actionable categories.
 * 
 * ┌─────────────────────────────────────┬────────────────────┬──────────────────────────────────┐
 * │ Code / Reason                       │ Classification     │ Action                           │
 * ├─────────────────────────────────────┼────────────────────┼──────────────────────────────────┤
 * │ 401, loggedOut, badSession          │ TERMINAL_LOGOUT    │ Stop, clear auth, set needs_qr   │
 * │ unauthorized                        │ TERMINAL_LOGOUT    │ Same                             │
 * │ 408 + "qr refs attempts ended"      │ QR_EXPIRED         │ Set needs_qr, keep auth, no retry│
 * │ 408, timeout, timedOut              │ TRANSIENT          │ Retry with backoff               │
 * │ 500, 503, connectionClosed          │ TRANSIENT          │ Retry with backoff               │
 * │ connectionLost, streamError         │ TRANSIENT          │ Retry with backoff               │
 * │ restartRequired                     │ TRANSIENT          │ Retry with backoff               │
 * │ ECONNRESET, ENOTFOUND, ETIMEDOUT   │ TRANSIENT          │ Retry with backoff               │
 * │ WS close 1006, 1001                │ TRANSIENT          │ Retry with backoff               │
 * │ Unknown                            │ UNKNOWN            │ Transient with max 3 attempts    │
 * └─────────────────────────────────────┴────────────────────┴──────────────────────────────────┘
 */

import { DisconnectReason } from "@whiskeysockets/baileys";

export const Classification = Object.freeze({
  TERMINAL_LOGOUT: "TERMINAL_LOGOUT",
  QR_EXPIRED:      "QR_EXPIRED",
  TRANSIENT:       "TRANSIENT",
  UNKNOWN:         "UNKNOWN",
});

// Status codes that mean "session is permanently dead"
const TERMINAL_CODES = new Set([
  401,
  DisconnectReason.loggedOut,   // Baileys constant (usually 401)
]);

// Reason strings (lowercased) that mean permanent logout
const TERMINAL_REASONS = new Set([
  "loggedout",
  "logged_out",
  "badsession",
  "unauthorized",
]);

// Status codes that mean "temporary issue, retry"
const TRANSIENT_CODES = new Set([
  408, 500, 503, 515,
  DisconnectReason.connectionClosed,  
  DisconnectReason.connectionLost,    
  DisconnectReason.connectionReplaced,
  DisconnectReason.timedOut,          
  DisconnectReason.restartRequired,   
]);

// Reason strings (lowercased) that mean transient
const TRANSIENT_REASONS = new Set([
  "connectionclosed",
  "connectionlost",
  "connectionreplaced",
  "timedout",
  "timeout",
  "restartRequired",
  "restartrequired",
  "streamerror",
]);

// Network error codes that are transient
const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
  "EHOSTUNREACH",
]);

// WebSocket close codes that are transient
const TRANSIENT_WS_CODES = new Set([1001, 1006, 1011, 1012, 1013, 1014]);

/**
 * Classify a Baileys connection close event.
 * 
 * @param {object} lastDisconnect - The lastDisconnect object from connection.update
 * @returns {{ classification: string, code: number|null, reason: string }}
 */
export function classifyClose(lastDisconnect) {
  const error = lastDisconnect?.error;
  const statusCode = error?.output?.statusCode ?? null;
  const reasonStr  = (error?.output?.payload?.message || error?.message || "").toLowerCase().trim();
  const errorCode  = error?.code || null;

  // 1. Check terminal codes
  if (statusCode !== null && TERMINAL_CODES.has(statusCode)) {
    return { classification: Classification.TERMINAL_LOGOUT, code: statusCode, reason: reasonStr || "loggedOut" };
  }

  // 2. Check terminal reason strings
  if (reasonStr && TERMINAL_REASONS.has(reasonStr.replace(/[\s_-]/g, ""))) {
    return { classification: Classification.TERMINAL_LOGOUT, code: statusCode, reason: reasonStr };
  }

  // 2.5 Check QR expiry (MUST be before transient code check since 408 is also transient)
  if (reasonStr && (reasonStr.includes("qr") && reasonStr.includes("ended"))) {
    return { classification: Classification.QR_EXPIRED, code: statusCode, reason: reasonStr };
  }

  // 3. Check transient codes
  if (statusCode !== null && TRANSIENT_CODES.has(statusCode)) {
    return { classification: Classification.TRANSIENT, code: statusCode, reason: reasonStr || "transient" };
  }

  // 4. Check transient reason strings
  if (reasonStr && TRANSIENT_REASONS.has(reasonStr.replace(/[\s_-]/g, ""))) {
    return { classification: Classification.TRANSIENT, code: statusCode, reason: reasonStr };
  }

  // 5. Check network error codes
  if (errorCode && TRANSIENT_ERROR_CODES.has(errorCode)) {
    return { classification: Classification.TRANSIENT, code: statusCode, reason: errorCode };
  }

  // 6. Check WebSocket close codes
  const wsCode = error?.output?.statusCode;
  if (wsCode && TRANSIENT_WS_CODES.has(wsCode)) {
    return { classification: Classification.TRANSIENT, code: wsCode, reason: "websocket_close" };
  }

  // 7. Default: UNKNOWN
  return { classification: Classification.UNKNOWN, code: statusCode, reason: reasonStr || "unknown" };
}

/**
 * Calculate exponential backoff delay.
 * @param {number} attempt - 0-indexed attempt number
 * @param {number} maxDelayMs - Maximum delay cap (default 30s)
 * @returns {number} Delay in milliseconds
 */
export function getBackoffDelay(attempt, maxDelayMs = 30_000) {
  const baseDelay = 1000; // 1 second
  const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelayMs);
  // Add 10% jitter to prevent thundering herd
  const jitter = delay * 0.1 * Math.random();
  return Math.round(delay + jitter);
}
