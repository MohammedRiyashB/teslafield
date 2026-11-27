"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { IdempotencyError, IdempotencyStore } = require("../idempotency");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("concurrent matching requests execute once and share the result", async () => {
  const store = new IdempotencyStore();
  const gate = deferred();
  let calls = 0;
  const operation = async () => {
    calls += 1;
    await gate.promise;
    return { reply: "one response" };
  };

  const first = store.run("user-1:key-0001", "fingerprint-a", operation);
  const second = store.run("user-1:key-0001", "fingerprint-a", operation);
  gate.resolve();

  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(a, { reply: "one response" });
  assert.deepEqual(b, { reply: "one response" });
});

test("a completed matching request reuses the cached result", async () => {
  const store = new IdempotencyStore();
  let calls = 0;
  const operation = async () => ({ count: ++calls });

  assert.deepEqual(await store.run("user-1:key-0002", "same", operation), { count: 1 });
  assert.deepEqual(await store.run("user-1:key-0002", "same", operation), { count: 1 });
  assert.equal(calls, 1);
});

test("reusing a key with a different request fingerprint is rejected", async () => {
  const store = new IdempotencyStore();
  await store.run("user-1:key-0003", "first", async () => "cached");

  await assert.rejects(
    store.run("user-1:key-0003", "different", async () => "must not run"),
    (error) => error instanceof IdempotencyError && error.code === "IDEMPOTENCY_KEY_CONFLICT"
  );
});

test("a failed operation releases the key so a safe retry can execute", async () => {
  const store = new IdempotencyStore();
  let calls = 0;
  await assert.rejects(store.run("user-1:key-0004", "same", async () => {
    calls += 1;
    throw new Error("temporary upstream failure");
  }), /temporary upstream failure/);

  const result = await store.run("user-1:key-0004", "same", async () => {
    calls += 1;
    return "recovered";
  });
  assert.equal(result, "recovered");
  assert.equal(calls, 2);
});

test("expired completed entries can be executed again", async () => {
  let now = 1000;
  const store = new IdempotencyStore({ ttlMs: 50, now: () => now });
  let calls = 0;
  const operation = async () => ++calls;

  assert.equal(await store.run("user-1:key-0005", "same", operation), 1);
  now += 51;
  assert.equal(await store.run("user-1:key-0005", "same", operation), 2);
});

test("capacity evicts completed entries but never evicts an in-flight entry", async () => {
  const store = new IdempotencyStore({ maxEntries: 1 });
  const gate = deferred();
  const pending = store.run("user-1:pending-key", "pending", async () => {
    await gate.promise;
    return "done";
  });

  await assert.rejects(
    store.run("user-1:other-key", "other", async () => "no room"),
    (error) => error instanceof IdempotencyError && error.code === "IDEMPOTENCY_STORE_FULL"
  );

  gate.resolve();
  await pending;
  assert.equal(await store.run("user-1:other-key", "other", async () => "room available"), "room available");
});
