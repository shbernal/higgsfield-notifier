// stream.js — runs in the page's MAIN world on higgsfield.ai, at document_start.
// ---------------------------------------------------------------------------------
// Higgsfield's own UI keeps a server-sent-events stream open for the signed-in account
// (fnf-api-gw.higgsfield.ai/fnf-notification/notifications/stream) and gets a
// `job:status_changed` event for every job, whatever page is open. This script makes
// no requests of its own: it wraps window.fetch before the page's scripts load, and
// when the page opens that stream it reads a clone of the response alongside the page.
// Each job that reaches a final status is handed to content.js as a "hfn:job" DOM event
// ({ id, status, jobSetType }); "hfn:stream-state" reports whether the stream is open.

(() => {
  "use strict";

  const STREAM_PATH = "/fnf-notification/notifications/stream";
  const FINAL = new Set(["completed", "failed", "nsfw", "ip_detected", "canceled"]);

  // ---- pure helpers (also exercised by tests/stream.test.mjs) ----

  // Splits buffered SSE text into complete events; returns them plus the unparsed tail.
  function parseSSE(buf) {
    const events = [];
    const blocks = buf.replace(/\r\n?/g, "\n").split("\n\n");
    const rest = blocks.pop();
    for (const block of blocks) {
      let event = "message";
      const data = [];
      for (const line of block.split("\n")) {
        if (!line || line[0] === ":") continue;
        const i = line.indexOf(":");
        const field = i < 0 ? line : line.slice(0, i);
        const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      if (data.length) events.push({ event, data: data.join("\n") });
    }
    return { events, rest };
  }

  // A final job event from the raw SSE data, or null.
  function finalJob(data) {
    let ev;
    try {
      ev = JSON.parse(data);
    } catch {
      return null;
    }
    const id = ev && (ev.job_id || ev.id);
    const status = String((ev && ev.status) || "").toLowerCase();
    if (!id || !FINAL.has(status)) return null;
    return { id, status, jobSetType: ev.job_set_type || "" };
  }

  function isStreamUrl(input) {
    try {
      const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new URL(u, location.href).pathname === STREAM_PATH;
    } catch {
      return false;
    }
  }

  const api = { parseSSE, finalJob, isStreamUrl, FINAL };
  if (typeof window === "undefined" || typeof document === "undefined") {
    globalThis.HFStream = api;
    return;
  }
  if (window.__hfnStreamLoaded) return;
  window.__hfnStreamLoaded = true;

  let open = 0; // page streams currently being read
  function report() {
    window.dispatchEvent(
      new CustomEvent("hfn:stream-state", { detail: open > 0 ? "open" : "off" }),
    );
  }

  async function tap(res) {
    if (!res.ok || !res.body) return;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    open++;
    report();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const parsed = parseSSE(buf + dec.decode(value, { stream: true }));
        buf = parsed.rest;
        for (const e of parsed.events) {
          if (e.event !== "job:status_changed") continue;
          const job = finalJob(e.data);
          if (job)
            window.dispatchEvent(new CustomEvent("hfn:job", { detail: JSON.stringify(job) }));
        }
      }
    } catch {
      // the page aborted or lost the stream; it reconnects on its own and we tap that one
    } finally {
      open--;
      report();
    }
  }

  const pageFetch = window.fetch;
  if (typeof pageFetch !== "function") return;
  window.fetch = function fetch(input, _init) {
    const p = pageFetch.apply(this, arguments);
    if (isStreamUrl(input)) {
      p.then(
        (res) => {
          try {
            tap(res.clone());
          } catch {}
        },
        () => {},
      );
    }
    return p;
  };

  window.addEventListener("hfn:stream-ping", report);
})();
