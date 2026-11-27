"use strict";

function pruneExpiredEntries(map, now = Date.now(), expiryField = "expiresAt") {
  if (!(map instanceof Map)) throw new TypeError("map must be a Map");
  for (const [key, value] of map) {
    const expiry = value && value[expiryField];
    if (Number.isFinite(expiry) && expiry <= now) map.delete(key);
  }
  return map.size;
}

function hasCapacity(map, maxEntries) {
  if (!(map instanceof Map) || !Number.isInteger(maxEntries) || maxEntries < 0) {
    throw new TypeError("A Map and non-negative integer capacity are required");
  }
  return map.size < maxEntries;
}

module.exports = { pruneExpiredEntries, hasCapacity };
