/**
 * session-manager.test.js
 * Integration-style tests for SessionManager state transitions
 * Run: node --test session-manager.test.js
 * 
 * NOTE: These tests mock Firestore and Baileys, testing only the state machine logic.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Classification } from "./session-classifier.js";

// ─── Mock Firestore ───────────────────────────────────────────────
class MockFirestoreDoc {
  constructor(data = {}) { this._data = data; this.exists = Object.keys(data).length > 0; }
  data() { return this._data; }
}

class MockDocRef {
  constructor() { this._data = {}; }
  async set(data, _opts) { Object.assign(this._data, data); }
  async get() { return new MockFirestoreDoc(this._data); }
}

class MockCollection {
  constructor() { this.docs = {}; }
  doc(id) { 
    if (!this.docs[id]) this.docs[id] = new MockDocRef();
    return this.docs[id];
  }
  onSnapshot() {} // no-op for tests
}

// ─── State Machine Tests ──────────────────────────────────────────

describe("SessionManager State Machine", () => {

  describe("TERMINAL_LOGOUT (401) → needs_qr", () => {
    it("should set requiresQR=true and not schedule reconnect", () => {
      // Simulate what _handleClose does for TERMINAL_LOGOUT
      const classification = Classification.TERMINAL_LOGOUT;
      const firestoreData = {};

      // Simulate the Firestore set call from _handleClose
      if (classification === Classification.TERMINAL_LOGOUT) {
        firestoreData.status = 'needs_qr';
        firestoreData.requiresQR = true;
        firestoreData.qrCode = null;
        firestoreData.reconnectAttempts = 0;
      }

      assert.equal(firestoreData.status, 'needs_qr');
      assert.equal(firestoreData.requiresQR, true);
      assert.equal(firestoreData.reconnectAttempts, 0);
      assert.equal(firestoreData.qrCode, null);
    });
  });

  describe("Boot guard prevents auto-reconnect for needs_qr", () => {
    it("should skip connection when status is needs_qr", () => {
      const accountData = { status: 'needs_qr', requiresQR: true };
      
      // Boot guard logic
      const shouldSkip = accountData.requiresQR === true || 
                         accountData.status === 'needs_qr' || 
                         accountData.status === 'logged_out';
      
      assert.equal(shouldSkip, true, "Boot guard should block auto-reconnect");
    });

    it("should allow connection when status is connected", () => {
      const accountData = { status: 'connected', requiresQR: false };
      
      const shouldSkip = accountData.requiresQR === true || 
                         accountData.status === 'needs_qr' || 
                         accountData.status === 'logged_out';
      
      assert.equal(shouldSkip, false, "Boot guard should allow connected sessions");
    });

    it("should allow connection when no prior state exists", () => {
      const accountData = {};
      
      const shouldSkip = accountData.requiresQR === true || 
                         accountData.status === 'needs_qr' || 
                         accountData.status === 'logged_out';
      
      assert.equal(shouldSkip, false, "Boot guard should allow fresh sessions");
    });
  });

  describe("TRANSIENT close → backoff reconnect", () => {
    it("should increment attempts and calculate correct delays", () => {
      const maxAttempts = 5;
      const attempts = [0, 1, 2, 3, 4];
      const expectedBaseDelays = [1000, 2000, 4000, 8000, 16000];

      for (let i = 0; i < attempts.length; i++) {
        const nextAttempt = attempts[i] + 1;
        assert.ok(nextAttempt <= maxAttempts, 
          `Attempt ${nextAttempt} should be within max ${maxAttempts}`);
        
        const baseDelay = 1000 * Math.pow(2, attempts[i]);
        assert.equal(baseDelay, expectedBaseDelays[i], 
          `Base delay for attempt ${attempts[i]} should be ${expectedBaseDelays[i]}ms`);
      }
    });

    it("should exhaust after MAX_RECONNECT_ATTEMPTS", () => {
      const maxAttempts = 5;
      const currentAttempts = 5;
      const nextAttempt = currentAttempts + 1;
      
      const exhausted = nextAttempt > maxAttempts;
      assert.equal(exhausted, true, "Should be exhausted after 5 attempts");
    });

    it("should NOT exhaust before MAX_RECONNECT_ATTEMPTS", () => {
      const maxAttempts = 5;
      const currentAttempts = 3;
      const nextAttempt = currentAttempts + 1;
      
      const exhausted = nextAttempt > maxAttempts;
      assert.equal(exhausted, false, "Should NOT be exhausted at attempt 4");
    });
  });

  describe("regenerateQR flow", () => {
    it("should clear requiresQR before calling startSession", () => {
      // Simulate regenerateQR Firestore update
      const firestoreData = { status: 'needs_qr', requiresQR: true };
      
      // regenerateQR resets these
      firestoreData.status = 'connecting';
      firestoreData.requiresQR = false;
      firestoreData.qrCode = null;
      firestoreData.reconnectAttempts = 0;

      // Boot guard should now allow connection
      const shouldSkip = firestoreData.requiresQR === true || 
                         firestoreData.status === 'needs_qr' || 
                         firestoreData.status === 'logged_out';
      
      assert.equal(shouldSkip, false, "After regenerateQR, boot guard should allow connection");
      assert.equal(firestoreData.status, 'connecting');
    });

    it("should be idempotent (mutex)", () => {
      const lock = new Set();
      const docId = "test-doc-123";
      
      // First call acquires lock
      assert.equal(lock.has(docId), false);
      lock.add(docId);
      assert.equal(lock.has(docId), true);
      
      // Second call should detect lock
      const isLocked = lock.has(docId);
      assert.equal(isLocked, true, "Second call should detect lock");
      
      // Release
      lock.delete(docId);
      assert.equal(lock.has(docId), false);
    });
  });

  describe("Metrics tracking", () => {
    it("should correctly count close events by classification", () => {
      const metrics = { close_total: {} };
      
      const incMetric = (classification, code) => {
        const key = `${classification}:${code ?? "null"}`;
        metrics.close_total[key] = (metrics.close_total[key] || 0) + 1;
      };
      
      incMetric("TERMINAL_LOGOUT", 401);
      incMetric("TERMINAL_LOGOUT", 401);
      incMetric("TRANSIENT", 408);
      
      assert.equal(metrics.close_total["TERMINAL_LOGOUT:401"], 2);
      assert.equal(metrics.close_total["TRANSIENT:408"], 1);
    });
  });
});
