import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const src = readFileSync(new URL("../extension/stream.js", import.meta.url), "utf8");
const ctx = vm.createContext({});
vm.runInContext(src, ctx);
const { parseSSE, resultKind } = ctx.HFStream;

// Frames as captured from fnf-api-gw.higgsfield.ai/fnf-notification/notifications/stream
const PING = 'event: ping\ndata: {"time":"2026-11-16T10:28:06Z"}\n\n';
const DONE =
  'event: job:status_changed\ndata: {"id":"d501d414","job_id":"d501d414","job_set_type":"nano_banana_2","status":"completed"}\n\n';

test("parseSSE splits complete events and keeps the partial tail", () => {
  const cut = DONE.length - 10;
  const first = parseSSE(PING + DONE.slice(0, cut));
  assert.equal(first.events.map((e) => e.event).join(), "ping");
  const second = parseSSE(first.rest + DONE.slice(cut));
  assert.equal(second.rest, "");
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].event, "job:status_changed");
  assert.equal(JSON.parse(second.events[0].data).status, "completed");
});

test("parseSSE handles CRLF, comments and multi-line data", () => {
  const { events } = parseSSE(": keepalive\r\n\r\nevent: x\r\ndata: a\r\ndata: b\r\n\r\n");
  assert.equal(events.length, 1);
  assert.equal(events[0].data, "a\nb");
});

test("resultKind reads results.raw.type", () => {
  assert.equal(resultKind({ results: { raw: { type: "image" } } }), "image");
  assert.equal(resultKind({ results: { raw: { type: "video" } } }), "video");
  assert.equal(resultKind({ results: { min: { type: "audio" } } }), "audio");
  assert.equal(resultKind({ results: { raw: { type: "model_glb" } } }), "3d");
  assert.equal(resultKind({ result: null }), "");
  assert.equal(resultKind(null), "");
});
