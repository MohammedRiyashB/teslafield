"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const app = fs.readFileSync(path.resolve(__dirname, "../../app.js"), "utf8");

function functionSource(name, nextName) {
  const start = app.indexOf("async function " + name + "(");
  const end = app.indexOf("async function " + nextName + "(", start + 1);
  assert.ok(start >= 0 && end > start, "Could not locate " + name + " function");
  return app.slice(start, end);
}

test("sendMessage locks before awaiting Firebase authentication", () => {
  const source = functionSource("sendMessage", "regenerateLast");
  assert.match(source, /if \(!text \|\| generating \|\| sendPending\) return;/);
  const lockAt = source.indexOf("sendPending = true;");
  const authAt = source.indexOf("await requireAuthentication(text)");
  assert.ok(lockAt >= 0 && authAt > lockAt, "The lock must be acquired before the auth await");
  assert.match(source, /finally \{\s*sendPending = false;\s*\}/);
});

test("regenerateLast shares the same in-flight guard", () => {
  const start = app.indexOf("async function regenerateLast()");
  const end = app.indexOf("function renderAttachments()", start + 1);
  assert.ok(start >= 0 && end > start, "Could not locate regenerateLast function");
  const source = app.slice(start, end);
  assert.match(source, /if \(!chat \|\| generating \|\| sendPending\) return;/);
  assert.match(source, /sendPending = true;/);
  assert.match(source, /finally \{\s*sendPending = false;\s*\}/);
});


test("requestReply uses the selected model and retries the streaming endpoint", () => {
  const start = app.indexOf("async function requestReply(chat)");
  const end = app.indexOf("function showGuestContinueCard()", start + 1);
  assert.ok(start >= 0 && end > start, "Could not locate requestReply function");
  const source = app.slice(start, end);
  const requestAt = source.indexOf("const chatRequest =");
  const retryAt = source.indexOf("for (let attempt = 0; attempt < 3; attempt += 1)");
  const streamAt = source.indexOf('/api/v1/chat/stream');
  assert.ok(requestAt >= 0 && retryAt > requestAt && streamAt > retryAt);
  assert.match(source, /model: userPreferences\.model/);
  assert.match(source, /"Accept": "text\/event-stream, text\/plain"/);
  assert.doesNotMatch(source, /Idempotency-Key/);
});

test("voice capture prevents duplicate microphone permission requests", () => {
  const start = app.indexOf("async function startVoiceRecording()");
  const end = app.indexOf("function resetVoiceModeUI()", start + 1);
  assert.ok(start >= 0 && end > start, "Could not locate startVoiceRecording");
  const source = app.slice(start, end);
  assert.match(source, /if \(voiceStartPending \|\| \(mediaRecorder && mediaRecorder\.state !== "inactive"\)\) return;/);
  assert.ok(source.indexOf("voiceStartPending = true;") < source.indexOf("await navigator.mediaDevices.getUserMedia"));
  assert.match(source, /finally \{\s*if \(attempt === voiceStartAttempt\) voiceStartPending = false;/);
});

test("cancelling while permission is pending invalidates a late microphone grant", () => {
  const start = app.indexOf("async function startVoiceRecording()");
  const end = app.indexOf("function resetVoiceModeUI()", start + 1);
  const source = app.slice(start, end);
  assert.match(source, /if \(attempt !== voiceStartAttempt \|\| !currentUser\) \{\s*stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\);\s*return;/);
  const cancelStart = app.indexOf("function cancelVoiceRecording()");
  const cancelEnd = app.indexOf("function stopVoiceRecording()", cancelStart + 1);
  const cancel = app.slice(cancelStart, cancelEnd);
  assert.match(cancel, /voiceStartAttempt \+= 1;/);
  assert.match(cancel, /voiceStartPending = false;/);
});

test("recorder errors release microphone tracks and clear active recorder references", () => {
  const start = app.indexOf("async function startVoiceRecording()");
  const end = app.indexOf("function resetVoiceModeUI()", start + 1);
  const source = app.slice(start, end);
  const errorStart = source.indexOf("recorder.onerror = () =>");
  const errorEnd = source.indexOf("recorder.onstop =", errorStart);
  assert.ok(errorStart >= 0 && errorEnd > errorStart);
  const handler = source.slice(errorStart, errorEnd);
  assert.match(handler, /clearTimeout\(recordingTimer\)/);
  assert.match(handler, /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(handler, /mediaRecorder = null/);
  assert.match(handler, /mediaRecorderStream = null/);
});

test("recorder failure does not fall through into transcription", () => {
  const start = app.indexOf("async function startVoiceRecording()");
  const end = app.indexOf("function resetVoiceModeUI()", start + 1);
  const source = app.slice(start, end);
  assert.match(source, /recorder\.failed = true;/);
  assert.match(source, /if \(recorder\.cancelled \|\| recorder\.failed\)/);
});

test("chat requests send the selected preferred model", () => {
  const start = app.indexOf("async function requestReply(chat)");
  const end = app.indexOf("function showGuestC", start + 1);
  assert.ok(start >= 0 && end > start);
  assert.match(app.slice(start, end), /model: userPreferences\.model/);
});

test("model preference is restored, saved and safely falls back to TeslafieldAI", () => {
  const readStart = app.indexOf("function readPersonalization()");
  const readEnd = app.indexOf("function applyPersonalization()", readStart + 1);
  const read = app.slice(readStart, readEnd);
  assert.match(read, /saved\.model/);
  assert.match(read, /"teslafield"/);
  const saveStart = app.indexOf("function savePersonalize()");
  const saveEnd = app.indexOf("function renderModelSelector()", saveStart + 1);
  assert.match(app.slice(saveStart, saveEnd), /model: userPreferences\.model/);
  assert.match(app, /userPreferences\.model = selected/);
});


test("stream parser tracks completion and model token-limit finish reasons", () => {
  const start = app.indexOf("async function consumeChatStream(response, onText)");
  const end = app.indexOf("function createStreamingAssistantBubble()", start + 1);
  assert.ok(start >= 0 && end > start);
  const source = app.slice(start, end);
  assert.match(source, /payloadText === "\[DONE\]"/);
  assert.match(source, /choice\.finish_reason/);
  assert.match(source, /finish_reason/);
});

test("long streams continue the same selected model and keep one live bubble", () => {
  const start = app.indexOf("async function requestReply(chat)");
  const end = app.indexOf("function showGuestContinueCard()", start + 1);
  const source = app.slice(start, end);
  assert.match(source, /continuationCount >= 2/);
  assert.match(source, /Continue exactly where the previous response stopped/);
  assert.match(source, /model: userPreferences\.model/);
  assert.match(source, /streamingBubble\.body\.textContent = accumulatedText/);
  assert.match(source, /streamingBubble\.body\.classList\.remove\("is-revealing"\)/);
});

test("new share links store response on the API and use a short ID-only URL", () => {
  const start = app.indexOf("async function shareAssistantMessage(content)");
  const end = app.indexOf("function base64UrlEncode(", start + 1);
  const source = app.slice(start, end);
  assert.match(source, /API \+ "\/api\/v1\/shares"/);
  assert.match(source, /location\.origin \+ "\/share\/" \+ result\.id/);
  assert.doesNotMatch(source, /\?data=/);
});

test("shared response page supports old compressed links and fetches new ID links", () => {
  const start = app.indexOf("async function openSharedMessagePage()");
  const end = app.indexOf("\n  function ", start + 5);
  const source = app.slice(start, end);
  assert.match(source, /legacyPayload/);
  assert.match(source, /API \+ "\/api\/v1\/shares\/" \+/);
  assert.match(source, /DecompressionStream/);
});

 
test("share creation falls back to the legacy compressed URL when short storage is unavailable", () => {
  const start = app.indexOf("async function shareAssistantMessage(content)");
  const end = app.indexOf("function base64UrlEncode(", start + 1);
  const source = app.slice(start, end);
  assert.match(source, /compatibilityUrl/);
  assert.match(source, /CompressionStream\("gzip"\)/);
  assert.match(source, /\?data=/);
  assert.match(source, /Short share storage is unavailable/);
});
