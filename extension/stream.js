// stream.js — runs in the page's MAIN world on higgsfield.ai.
// ---------------------------------------------------------------------------------
// Higgsfield pushes a `job:status_changed` server-sent event for every job on the
// account, whatever page is open, over the same stream its own UI listens to. This
// script opens that stream with the page's own Clerk session token, and when a job
// reaches a final status it fetches the job once to learn its media type, then hands
// { id, status, jobSetType, mediaType } to content.js as a "hfn:job" DOM event.
//
// It runs in the page world because the token lives on window.Clerk and the requests
// then go out exactly like the page's own. The isolated content script switches it on
// and off with "hfn:stream" events ({ on }), and gets "hfn:stream-state" back.

(() => {
  "use strict";

  const API = "https://fnf-api-gw.higgsfield.ai";
  const STREAM_URL = API + "/fnf-notification/notifications/stream";
  const JOB_URL = (id) => API + "/fnf/jobs/" + encodeURIComponent(id);
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

  // results.raw.type of a finished job: "image", "video", ...
  function resultKind(job) {
    const r = job && job.results;
    const t = String((r && ((r.raw && r.raw.type) || (r.min && r.min.type))) || "").toLowerCase();
    if (t === "image" || t === "video" || t === "audio") return t;
    if (/3d|model|mesh|glb/.test(t)) return "3d";
    return "";
  }

  const api = { parseSSE, resultKind, FINAL };
  if (typeof window === "undefined" || typeof document === "undefined") {
    globalThis.HFStream = api;
    return;
  }
  if (window.__hfnStreamLoaded) return;
  window.__hfnStreamLoaded = true;

  // ---- connection ----
  let wanted = false;
  let state = "off"; // off | connecting | open | signed-out | error
  let ctrl = null;
  let retryTimer = null;
  let failures = 0;

  function setState(s) {
    state = s;
    window.dispatchEvent(new CustomEvent("hfn:stream-state", { detail: s }));
  }

  async function token() {
    const c = window.Clerk;
    if (!c || !c.loaded) return undefined; // Clerk not ready yet
    if (!c.session) return null; // signed out
    try {
      return (await c.session.getToken()) || null;
    } catch {
      return undefined;
    }
  }

  async function authFetch(url, init) {
    const t = await token();
    if (!t) return null;
    const headers = Object.assign({ Authorization: "Bearer " + t }, (init && init.headers) || {});
    return fetch(url, Object.assign({}, init, { headers, credentials: "include" }));
  }

  async function mediaKindFor(id) {
    try {
      const r = await authFetch(JOB_URL(id), { signal: AbortSignal.timeout(10000) });
      if (r && r.ok) return resultKind(await r.json());
    } catch {}
    return "";
  }

  async function onJob(raw) {
    let ev;
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    const id = ev.job_id || ev.id;
    const status = String(ev.status || "").toLowerCase();
    if (!id || !FINAL.has(status)) return;
    const mediaType = status === "completed" ? await mediaKindFor(id) : "";
    const detail = JSON.stringify({ id, status, jobSetType: ev.job_set_type || "", mediaType });
    window.dispatchEvent(new CustomEvent("hfn:job", { detail }));
  }

  function scheduleRetry(ms) {
    clearTimeout(retryTimer);
    if (!wanted) return;
    retryTimer = setTimeout(connect, ms);
  }
  function backoff() {
    failures++;
    return Math.min(60000, 2000 * 2 ** Math.min(failures, 5)) * (0.5 + Math.random() / 2);
  }

  async function connect() {
    if (!wanted || ctrl) return;
    const t = await token();
    if (t === undefined) return scheduleRetry(2000);
    if (t === null) {
      setState("signed-out");
      return scheduleRetry(30000);
    }
    const my = (ctrl = new AbortController());
    setState("connecting");
    try {
      const res = await fetch(STREAM_URL, {
        headers: { Authorization: "Bearer " + t, Accept: "text/event-stream" },
        credentials: "include",
        signal: my.signal,
      });
      if (!res.ok || !res.body) throw new Error("HTTP " + res.status);
      setState("open");
      failures = 0;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const parsed = parseSSE(buf + dec.decode(value, { stream: true }));
        buf = parsed.rest;
        for (const e of parsed.events) if (e.event === "job:status_changed") onJob(e.data);
      }
      throw new Error("stream closed");
    } catch {
      if (ctrl !== my) return; // stopped on purpose
      ctrl = null;
      setState("error");
      scheduleRetry(backoff());
    }
  }

  function stop() {
    wanted = false;
    clearTimeout(retryTimer);
    if (ctrl) {
      const c = ctrl;
      ctrl = null;
      c.abort();
    }
    setState("off");
  }

  window.addEventListener("hfn:stream", (e) => {
    let on = false;
    try {
      on = !!JSON.parse(e.detail).on;
    } catch {}
    if (on && !wanted) {
      wanted = true;
      failures = 0;
      connect();
    } else if (!on && wanted) stop();
  });
  // A dropped stream reconnects right away when the tab comes back or the network returns.
  const wake = () => {
    if (wanted && !ctrl) {
      failures = 0;
      scheduleRetry(0);
    }
  };
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") wake();
  });
  window.dispatchEvent(new CustomEvent("hfn:stream-ready", { detail: state }));
})();
