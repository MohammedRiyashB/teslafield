"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { clientOptions, requestHeaders } = require("../huggingface-auth");

test("Gradio client receives a token only when configured", () => {
  assert.deepEqual(clientOptions(""), {});
  assert.deepEqual(clientOptions("hf_test_token"), { hf_token: "hf_test_token" });
});

test("Hugging Face bearer token is sent only to Hugging Face hosts", () => {
  assert.deepEqual(requestHeaders("https://example.com/file.wav", "hf_test_token"), {});
  assert.deepEqual(requestHeaders("not a URL", "hf_test_token"), {});
  assert.deepEqual(requestHeaders("https://earthaioa-openwhisper-small.hf.space/file.wav", "hf_test_token"), {
    Authorization: "Bearer hf_test_token"
  });
  assert.deepEqual(requestHeaders("https://huggingface.co/spaces/a/b", "hf_test_token"), {
    Authorization: "Bearer hf_test_token"
  });
  assert.deepEqual(requestHeaders("https://evil-hf.space.example.com/file", "hf_test_token"), {});
});
