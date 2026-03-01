/**
 * session-classifier.test.js
 * Unit tests for classifyClose() and getBackoffDelay()
 * Run: node --test session-classifier.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyClose, getBackoffDelay, Classification } from "./session-classifier.js";

// ─── Helper: build a mock lastDisconnect object ───────────────────
function mockDisconnect(statusCode, message = "", errorCode = null) {
  return {
    error: {
      output: {
        statusCode,
        payload: { message },
      },
      message: message,
      code: errorCode,
    },
  };
}

// ─── classifyClose tests ──────────────────────────────────────────

describe("classifyClose — TERMINAL_LOGOUT", () => {
  it("should classify 401 as TERMINAL_LOGOUT", () => {
    const result = classifyClose(mockDisconnect(401));
    assert.equal(result.classification, Classification.TERMINAL_LOGOUT);
    assert.equal(result.code, 401);
  });

  it("should classify badSession reason as TERMINAL_LOGOUT", () => {
    const result = classifyClose(mockDisconnect(null, "badSession"));
    assert.equal(result.classification, Classification.TERMINAL_LOGOUT);
  });

  it("should classify unauthorized reason as TERMINAL_LOGOUT", () => {
    const result = classifyClose(mockDisconnect(null, "unauthorized"));
    assert.equal(result.classification, Classification.TERMINAL_LOGOUT);
  });

  it("should classify logged_out reason as TERMINAL_LOGOUT", () => {
    const result = classifyClose(mockDisconnect(null, "logged_out"));
    assert.equal(result.classification, Classification.TERMINAL_LOGOUT);
  });

  it("should classify loggedOut (no underscore) as TERMINAL_LOGOUT", () => {
    const result = classifyClose(mockDisconnect(null, "loggedOut"));
    assert.equal(result.classification, Classification.TERMINAL_LOGOUT);
  });
});

describe("classifyClose — TRANSIENT", () => {
  it("should classify 408 (timeout) as TRANSIENT", () => {
    const result = classifyClose(mockDisconnect(408));
    assert.equal(result.classification, Classification.TRANSIENT);
    assert.equal(result.code, 408);
  });

  it("should classify 500 as TRANSIENT", () => {
    const result = classifyClose(mockDisconnect(500));
    assert.equal(result.classification, Classification.TRANSIENT);
  });

  it("should classify 503 as TRANSIENT", () => {
    const result = classifyClose(mockDisconnect(503));
    assert.equal(result.classification, Classification.TRANSIENT);
  });

  it("should classify 515 (restartRequired) as TRANSIENT", () => {
    const result = classifyClose(mockDisconnect(515));
    assert.equal(result.classification, Classification.TRANSIENT);
  });

  it("should classify connectionClosed reason as TRANSIENT", () => {
    const result = classifyClose(mockDisconnect(null, "connectionClosed"));
    assert.equal(result.classification, Classification.TRANSIENT);
  });

  it("should classify streamError reason as TRANSIENT", () => {
    const result = classifyClose(mockDisconnect(null, "streamError"));
    assert.equal(result.classification, Classification.TRANSIENT);
  });

  it("should classify ECONNRESET error code as TRANSIENT", () => {
    const result = classifyClose(mockDisconnect(null, "", "ECONNRESET"));
    assert.equal(result.classification, Classification.TRANSIENT);
  });

  it("should classify ETIMEDOUT error code as TRANSIENT", () => {
    const result = classifyClose(mockDisconnect(null, "", "ETIMEDOUT"));
    assert.equal(result.classification, Classification.TRANSIENT);
  });

  it("should classify ENOTFOUND error code as TRANSIENT", () => {
    const result = classifyClose(mockDisconnect(null, "", "ENOTFOUND"));
    assert.equal(result.classification, Classification.TRANSIENT);
  });
});

describe("classifyClose — UNKNOWN", () => {
  it("should classify empty lastDisconnect as UNKNOWN", () => {
    const result = classifyClose({});
    assert.equal(result.classification, Classification.UNKNOWN);
  });

  it("should classify null lastDisconnect as UNKNOWN", () => {
    const result = classifyClose(null);
    assert.equal(result.classification, Classification.UNKNOWN);
  });

  it("should classify undefined lastDisconnect as UNKNOWN", () => {
    const result = classifyClose(undefined);
    assert.equal(result.classification, Classification.UNKNOWN);
  });

  it("should classify unrecognized code as UNKNOWN", () => {
    const result = classifyClose(mockDisconnect(999, "somethingWeird"));
    assert.equal(result.classification, Classification.UNKNOWN);
    assert.equal(result.code, 999);
  });
});

// ─── getBackoffDelay tests ────────────────────────────────────────

describe("getBackoffDelay", () => {
  it("attempt 0 should be ~1000ms", () => {
    const delay = getBackoffDelay(0);
    assert.ok(delay >= 1000 && delay <= 1200, `Expected ~1000ms, got ${delay}`);
  });

  it("attempt 1 should be ~2000ms", () => {
    const delay = getBackoffDelay(1);
    assert.ok(delay >= 2000 && delay <= 2400, `Expected ~2000ms, got ${delay}`);
  });

  it("attempt 2 should be ~4000ms", () => {
    const delay = getBackoffDelay(2);
    assert.ok(delay >= 4000 && delay <= 4800, `Expected ~4000ms, got ${delay}`);
  });

  it("attempt 4 should be ~16000ms", () => {
    const delay = getBackoffDelay(4);
    assert.ok(delay >= 16000 && delay <= 19200, `Expected ~16000ms, got ${delay}`);
  });

  it("attempt 10 should be capped at ~30000ms", () => {
    const delay = getBackoffDelay(10);
    assert.ok(delay <= 33000, `Expected cap at ~30000ms, got ${delay}`);
  });
});
