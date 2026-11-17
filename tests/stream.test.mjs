import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const src = readFileSync(new URL("../extension/stream.js", import.meta.url), "utf8");
const ctx = vm.createContext({ URL, location: { href: "https://higgsfield.ai/" } });
vm.runInContext(src, ctx);
const { parseSSE, finalJob, isStreamUrl } = ctx.HFStream;

// Frames as captured from fnf-api-gw.higgsfield.ai/fnf-notification/notifications/stream
const PING = 'event: ping\ndata: {"time":"2026-11-16T10:28:06Z"}\n\n';
const job = (status) =>
  `{"id":"d501d414","job_id":"d501d414","job_set_type":"nano_banana_2","status":"${status}"}`;
const DONE = `event: job:status_changed\ndata: ${job("completed")}\n\n`;

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

test("finalJob keeps only final statuses", () => {
  assert.equal(finalJob(job("in_progress")), null);
  assert.equal(finalJob(job("queued")), null);
  assert.equal(finalJob("not json"), null);
  const done = finalJob(job("completed"));
  assert.equal(done.id, "d501d414");
  assert.equal(done.status, "completed");
  assert.equal(done.jobSetType, "nano_banana_2");
  assert.equal(finalJob(job("nsfw")).status, "nsfw");
});

test("isStreamUrl matches only the notification stream", () => {
  const base = "https://fnf-api-gw.higgsfield.ai/fnf-notification/notifications/stream";
  assert.equal(isStreamUrl(base), true);
  assert.equal(isStreamUrl(base + "?lastEventId=42"), true);
  assert.equal(isStreamUrl({ url: base }), true);
  assert.equal(isStreamUrl("https://fnf-api-gw.higgsfield.ai/fnf/jobs/status-batch"), false);
  assert.equal(isStreamUrl(undefined), false);
});
