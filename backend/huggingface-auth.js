"use strict";

function clientOptions(token) {
  return typeof token === "string" && token ? { hf_token: token } : {};
}

function requestHeaders(url, token) {
  if (typeof token !== "string" || !token) return {};
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return {};
  }
  const isHuggingFace = hostname === "hf.space" || hostname.endsWith(".hf.space") ||
    hostname === "huggingface.co" || hostname.endsWith(".huggingface.co");
  return isHuggingFace ? { Authorization: "Bearer " + token } : {};
}

module.exports = { clientOptions, requestHeaders };
