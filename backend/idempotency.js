"use strict";

class IdempotencyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "IdempotencyError";
    this.code = code;
  }
}

class IdempotencyStore {
  constructor({ ttlMs = 5 * 60 * 1000, maxEntries = 1000, now = Date.now } = {}) {
    if (!Number.isFinite(ttlMs) || ttlMs < 1) throw new TypeError("ttlMs must be a positive number");
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new TypeError("maxEntries must be a positive integer");
    if (typeof now !== "function") throw new TypeError("now must be a function");
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map();
  }

  prune() {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (!entry.pending && entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  makeRoom() {
    this.prune();
    if (this.entries.size < this.maxEntries) return;
    for (const [key, entry] of this.entries) {
      if (!entry.pending) {
        this.entries.delete(key);
        return;
      }
    }
    throw new IdempotencyError(
      "IDEMPOTENCY_STORE_FULL",
      "The request deduplication store is busy. Retry shortly."
    );
  }

  run(key, fingerprint, operation) {
    if (typeof key !== "string" || !key || key.length > 256) {
      return Promise.reject(new TypeError("A valid idempotency key is required"));
    }
    if (typeof fingerprint !== "string" || !fingerprint) {
      return Promise.reject(new TypeError("A request fingerprint is required"));
    }
    if (typeof operation !== "function") {
      return Promise.reject(new TypeError("operation must be a function"));
    }

    const existing = this.entries.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(new IdempotencyError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "This idempotency key was already used for a different request."
        ));
      }
      if (existing.pending) return existing.promise;
      if (existing.expiresAt > this.now()) return Promise.resolve(existing.result);
      this.entries.delete(key);
    }

    try {
      this.makeRoom();
    } catch (error) {
      return Promise.reject(error);
    }

    const entry = {
      fingerprint,
      pending: true,
      promise: null,
      result: undefined,
      expiresAt: Number.POSITIVE_INFINITY
    };
    this.entries.set(key, entry);

    entry.promise = Promise.resolve()
      .then(operation)
      .then((result) => {
        entry.pending = false;
        entry.result = result;
        entry.expiresAt = this.now() + this.ttlMs;
        return result;
      })
      .catch((error) => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
        throw error;
      });

    return entry.promise;
  }
}

module.exports = { IdempotencyError, IdempotencyStore };
