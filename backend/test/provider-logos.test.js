"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { resolveProviderLogoDomain, serveProviderLogo } = require("../provider-logos");

function responseRecorder() {
  return {
    headers: null, status: null, body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; }
  };
}

test("provider logo lookup uses only known official provider domains", () => {
  assert.equal(resolveProviderLogoDomain("nvidia"), "nvidia.com");
  assert.equal(resolveProviderLogoDomain("deepseek"), "deepseek.com");
  assert.equal(resolveProviderLogoDomain("qwen"), "qwen.ai");
  assert.equal(resolveProviderLogoDomain("attacker.example"), null);
});

test("provider logo proxy returns image bytes with cross-origin embedding support", async () => {
  const res = responseRecorder();
  let requestedUrl = "";
  const served = await serveProviderLogo(res, "nvidia", async (url, options) => {
    requestedUrl = url;
    assert.match(url, /domain=nvidia\.com&sz=64/);
    assert.ok(options.headers.Accept.includes("image/png"));
    return {
      ok: true,
      headers: { get: (name) => name === "content-type" ? "image/png" : null },
      arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer
    };
  });
  assert.equal(served, true);
  assert.match(requestedUrl, /^https:\/\/www\.google\.com\/s2\/favicons/);
  assert.equal(res.status, 200);
  assert.equal(res.headers["Content-Type"], "image/png");
  assert.equal(res.headers["Cross-Origin-Resource-Policy"], "cross-origin");
  assert.equal(res.body.length, 4);
});

test("provider logo proxy refuses unknown slugs without an upstream request", async () => {
  const res = responseRecorder();
  let calls = 0;
  const served = await serveProviderLogo(res, "unknown-provider", async () => { calls += 1; });
  assert.equal(served, false);
  assert.equal(calls, 0);
});

test("provider logo proxy rejects non-image upstream responses", async () => {
  const res = responseRecorder();
  await serveProviderLogo(res, "google", async () => ({
    ok: true,
    headers: { get: () => "text/html" },
    arrayBuffer: async () => new ArrayBuffer(1)
  }));
  assert.equal(res.status, 502);
});
