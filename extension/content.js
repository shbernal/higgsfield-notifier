// content.js — Higgsfield Generation Notifier (passive watcher, notifications only)
// ---------------------------------------------------------------------------------
// Runs on every higgsfield.ai page. It reads the page's OWN per-tile job status —
// each result tile is <div data-asset-id="uuid" data-job-status="status" ...> — to
// know exactly when a generation finishes or fails, for ANY kind: video, image,
// audio, 3D. It then classifies the finished asset by media type and fires a system
// notification if that type (and that event) is switched on in the popup.
//
// It does NOT click Generate, set prompts, manage a queue, or touch credits. It only
// watches and notifies. Detection model:
//   working/failed  -> tile keeps data-job-status
//   success         -> attribute becomes "completed" (or is removed) and the finished
//                      media (URL contains the asset id) appears in the grid.
//
// Tiles only exist for the page on screen, so a video started on one page and finished
// while you're on another is caught by stream.js instead: it relays Higgsfield's
// account-wide job events here as "hfn:job". Both paths tag alerts with the job id
// (the tile's data-asset-id) and background.js fires once per job across all tabs.

(() => {
  "use strict";
  if (window.__hfNotifierLoaded) return;
  window.__hfNotifierLoaded = true;
  const VERSION = "1.5.0";
  const POLL_MS = 2000; // fallback sweep only — real-time detection is the MutationObserver below

  /* ============================ settings ============================ */
  const DEFAULTS = {
    on: true,
    onComplete: true,
    onFail: true,
    sound: true,
    keepAlive: false,
    types: { video: true, image: true, audio: true, "3d": true, other: true },
  };
  let CFG = clone(DEFAULTS);
  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }
  function mergeCfg(v) {
    const out = clone(DEFAULTS);
    if (v && typeof v === "object") {
      if (typeof v.on === "boolean") out.on = v.on;
      if (typeof v.onComplete === "boolean") out.onComplete = v.onComplete;
      if (typeof v.onFail === "boolean") out.onFail = v.onFail;
      if (typeof v.sound === "boolean") out.sound = v.sound;
      if (typeof v.keepAlive === "boolean") out.keepAlive = v.keepAlive;
      if (v.types) out.types = Object.assign(clone(DEFAULTS.types), v.types);
    }
    return out;
  }
  try {
    chrome.storage.local.get("hfNotif", (o) => {
      if (o && o.hfNotif) {
        CFG = mergeCfg(o.hfNotif);
        applyKeepAlive();
      }
      syncStream();
    });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === "local" && ch.hfNotif) {
        CFG = mergeCfg(ch.hfNotif.newValue);
        applyKeepAlive();
        syncStream();
      }
    });
  } catch {}

  /* ==================== job-status vocabulary ====================
     Higgsfield's own enum: waiting, queued, in_progress, ip_detect, dna, script, visuals,
     vision, flow (working) | failed, nsfw, ip_detected, canceled (failed) | completed.
     Known working/failed sets are explicit; any OTHER terminal status counts as a
     success, but only once real media for that asset is actually on the page. */
  const JOB_WORKING = new Set([
    "queued",
    "in_queue",
    "pending",
    "starting",
    "preparing",
    "processing",
    "in_progress",
    "running",
    "generating",
    "rendering",
    "uploading",
    "enqueued",
    "created",
    "initializing",
    "waiting",
    "ip_detect",
    "dna",
    "script",
    "visuals",
    "vision",
    "flow",
  ]);
  const JOB_FAILED = new Set([
    "nsfw",
    "failed",
    "error",
    "errored",
    "moderated",
    "rejected",
    "blocked",
    "canceled",
    "cancelled",
    "timeout",
    "timed_out",
    "declined",
    "content_moderated",
    "content_moderation",
    "ip_detected",
  ]);
  function classify(st) {
    if (JOB_WORKING.has(st)) return "working";
    if (JOB_FAILED.has(st)) return "failed";
    if (!st) return "unknown";
    return "success";
  }
  function esc(id) {
    return window.CSS && CSS.escape ? CSS.escape(id) : id;
  }
  function cardFor(id) {
    try {
      return document.querySelector('[data-asset-id="' + esc(id) + '"]');
    } catch {
      return (
        [...document.querySelectorAll("[data-asset-id]")].find(
          (x) => x.getAttribute("data-asset-id") === id,
        ) || null
      );
    }
  }

  /* ==================== media-type classification ==================== */
  const RE_VIDEO = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
  const RE_AUDIO = /\.(mp3|wav|m4a|ogg|oga|flac|aac)(\?|#|$)/i;
  const RE_3D = /\.(glb|gltf|usdz|obj|fbx|ply|stl)(\?|#|$)/i;
  const RE_IMAGE = /\.(png|jpe?g|webp|gif|avif|svg)(\?|#|$)/i;

  function urlType(u) {
    if (!u) return "";
    if (RE_VIDEO.test(u)) return "video";
    if (RE_AUDIO.test(u)) return "audio";
    if (RE_3D.test(u)) return "3d";
    if (/_thumbnail/i.test(u)) return "video"; // a *_thumbnail poster belongs to a video clip
    if (RE_IMAGE.test(u)) return "image";
    return "";
  }
  // what kind of thing is this page for? strong hint when the tile itself is ambiguous
  function pathType() {
    const p = (location.pathname + " " + location.search).toLowerCase();
    if (/(^|[/\-_ ])(3d|mesh)/.test(p)) return "3d";
    if (/(video|clip|dub|motion|reframe)/.test(p)) return "video";
    if (/(speech|audio|voice|tts|sound|music)/.test(p)) return "audio";
    if (/(image|photo|picture|soul|nano|seedream|upscale)/.test(p)) return "image";
    return "";
  }
  // gather media urls that reference an asset id, and note which element kinds appear
  function scanAsset(id) {
    const found = { urls: [], hasVideo: false, hasAudio: false, has3d: false, hasImg: false };
    const push = (u) => {
      if (u && u.indexOf("data:") !== 0 && u.indexOf(id) >= 0) found.urls.push(u);
    };
    const card = cardFor(id);
    if (card) {
      card.querySelectorAll("video").forEach((v) => {
        found.hasVideo = true;
        push(v.currentSrc || v.src || "");
        if (v.poster) push(v.poster);
        v.querySelectorAll("source").forEach((s) => push(s.src || s.getAttribute("src") || ""));
      });
      card.querySelectorAll("audio").forEach((a) => {
        found.hasAudio = true;
        push(a.currentSrc || a.src || "");
        a.querySelectorAll("source").forEach((s) => push(s.src || s.getAttribute("src") || ""));
      });
      card.querySelectorAll("img").forEach((im) => {
        found.hasImg = true;
        push(im.currentSrc || im.src || "");
      });
      if (card.querySelector("model-viewer, canvas")) found.has3d = true;
      card.querySelectorAll("a[href]").forEach((a) => push(a.getAttribute("href") || ""));
      card.querySelectorAll('[style*="background-image"]').forEach((el) => {
        const m = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(el).backgroundImage || "");
        if (m) push(m[1]);
      });
    }
    if (!found.urls.length) {
      // fallback: the finished media may not be inside the original tile — scan the grid
      document.querySelectorAll("video, audio, img, source, a[href]").forEach((el) => {
        const u = el.currentSrc || el.src || (el.getAttribute && el.getAttribute("href")) || "";
        if (u && u.indexOf(id) >= 0) {
          push(u);
          const tag = el.tagName.toLowerCase();
          if (tag === "video") found.hasVideo = true;
          else if (tag === "audio") found.hasAudio = true;
          else if (tag === "img") found.hasImg = true;
        }
      });
    }
    return found;
  }
  // Higgsfield's own label on a tile, e.g. data-tour-asset-kind="image"
  function tileKind(id) {
    const card = cardFor(id);
    const k = ((card && card.getAttribute("data-tour-asset-kind")) || "").toLowerCase();
    return k === "video" || k === "image" || k === "audio" || k === "3d" ? k : "";
  }
  // best guess from the job's model name (job_set_type), for jobs with no tile in view
  function jobSetKind(t) {
    t = String(t || "").toLowerCase();
    if (!t) return "";
    if (/(^|_)to_3d/.test(t)) return "3d";
    if (/speech|tts|elevenlabs|audio|music|sonilo|intone/.test(t)) return "audio";
    if (/image2video|video|draw_to|reference2video/.test(t)) return "video";
    if (
      /image|photo|headshot|outpaint|sticker|sprite|sheet|stylist|collage|cleaner|skin|relight|upscale|soul|banana|seedream|flux|gpt|ideogram|recraft|imagegen|hazel|canvas|keyframes|zooms|shots|location|cast|game_dump|matchcut|cinematic_studio_2_5/.test(
        t,
      )
    )
      return "image";
    if (
      /wan|kling|veo|seedance|sora|hailuo|minimax|lipsync|speak|animate|motion|reels|dramas|reframe|restyle|katana|talk|sync_so|beat_fit|transition|fps_boost|hyperion|omni|what_if|multiplier|hook|voice_change|mult_|influencer|evolution|cinematic_studio|hf_fnf|happy_horse|vibe|mixed_media|youtube|viral|concat|explainer|character_swap|grok/.test(
        t,
      )
    )
      return "video";
    return "";
  }
  function classifyAsset(id) {
    const kind = tileKind(id);
    if (kind) return kind;
    const s = scanAsset(id);
    let ut = "";
    for (const u of s.urls) {
      const t = urlType(u);
      if (t) {
        ut = t;
        if (t !== "image") break;
      }
    } // prefer a real clip/audio/3d over a thumbnail image
    if (s.hasVideo || ut === "video") return "video";
    if (s.hasAudio || ut === "audio") return "audio";
    if (s.has3d || ut === "3d") return "3d";
    if (ut === "image") return "image";
    if (s.hasImg) {
      return pathType() === "video" ? "video" : "image";
    }
    return pathType() || "other";
  }
  function assetHasMedia(id) {
    const s = scanAsset(id);
    return !!(s.urls.length || s.hasVideo || s.hasAudio || s.has3d || s.hasImg);
  }

  // authoritative state for a tracked asset
  function assetState(id) {
    const card = cardFor(id);
    if (card) {
      const st = (card.getAttribute("data-job-status") || "").toLowerCase().trim();
      if (st) return { status: st, cls: classify(st) };
      // Card still in the DOM but the job-status attribute is gone => the job left the
      // working state, i.e. it finished. We do NOT wait for the image/video to paint:
      // hidden/background tabs defer media loading, so requiring media here is exactly
      // what stopped alerts from firing unless you were looking at the tab.
      return { status: "", cls: "success" };
    }
    if (assetHasMedia(id)) return { status: "", cls: "success" };
    return { status: "", cls: "gone" };
  }

  /* ==================== notification gating + firing ==================== */
  function enabledFor(type) {
    const t = CFG.types || {};
    return type in t ? !!t[type] : !!t.other;
  }
  function typeLabel(t) {
    return t === "3d"
      ? "3D model"
      : t === "video"
        ? "Video"
        : t === "image"
          ? "Image"
          : t === "audio"
            ? "Audio"
            : "Generation";
  }
  let LAST = null;

  function notify(kind, type, jobId) {
    LAST = { kind, type, at: Date.now() };
    if (!CFG.on) return;
    if (kind === "done" && !CFG.onComplete) return;
    if (kind === "fail" && !CFG.onFail) return;
    if (!enabledFor(type)) return;
    const label = typeLabel(type);
    let title, message;
    if (kind === "done") {
      title = label + " ready \u2713";
      message = "Your " + label.toLowerCase() + " finished generating on Higgsfield.";
    } else {
      title = label + " failed \u2717";
      message =
        "Higgsfield couldn't finish this " + label.toLowerCase() + " \u2014 open the tab to retry.";
    }
    try {
      chrome.runtime.sendMessage(
        { type: "notify", title, message, kind, gtype: type, jobId, url: location.href },
        (res) => {
          void chrome.runtime.lastError;
          // background answers fired:false when another tab or path already alerted
          if (res && res.fired === false) return;
          if (CFG.sound) chime(kind, type);
        },
      );
    } catch {}
  }

  /* ==================== chime (best-effort, resumes on interaction) ==================== */
  let AC = null,
    hooked = false;
  function ac() {
    try {
      if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
      if (AC.state === "suspended") AC.resume().catch(() => {});
      return AC;
    } catch {
      return null;
    }
  }
  function hookResume() {
    if (hooked) return;
    hooked = true;
    const r = () => {
      ac();
      if (CFG.keepAlive) startKeepAlive();
    };
    window.addEventListener("pointerdown", r);
    window.addEventListener("keydown", r);
  }
  function chime(kind, type) {
    const c = ac();
    if (!c || !window.HFSounds) return;
    try {
      window.HFSounds.play(c, kind, type);
    } catch {}
  }
  hookResume();

  /* ==================== lifecycle tracking ==================== */
  // id -> { state, type, doneNotified, failNotified, terminal, goneCount }
  const tracked = new Map();

  function sweep() {
    // 1) tiles that currently carry a job status
    const live = new Set();
    document.querySelectorAll("[data-asset-id][data-job-status]").forEach((el) => {
      const id = el.getAttribute("data-asset-id");
      if (!id) return;
      const st = (el.getAttribute("data-job-status") || "").toLowerCase().trim();
      const cls = classify(st);
      live.add(id);
      let rec = tracked.get(id);
      if (!rec) {
        // first time we see this tile
        rec = {
          state: cls,
          type: classifyAsset(id),
          doneNotified: false,
          failNotified: false,
          terminal: false,
          goneCount: 0,
        };
        // suppress anything already terminal at first sight (prevents page-load spam)
        if (cls === "success") {
          rec.doneNotified = true;
          rec.terminal = true;
        }
        if (cls === "failed") {
          rec.failNotified = true;
          rec.terminal = true;
        }
        tracked.set(id, rec);
      }
      rec.state = cls;
      if (rec.terminal) return;
      if (cls === "failed" && !rec.failNotified) {
        rec.type = classifyAsset(id) || rec.type;
        notify("fail", rec.type, id);
        rec.failNotified = true;
        rec.terminal = true;
      } else if (cls === "success" && !rec.doneNotified) {
        // an explicit terminal-success status on the tile — the job is done; don't wait
        // for media (deferred in background tabs). classifyAsset falls back to the page
        // type when media isn't loaded yet, so the alert is still labelled correctly.
        rec.type = classifyAsset(id) || rec.type;
        notify("done", rec.type, id);
        rec.doneNotified = true;
        rec.terminal = true;
      }
    });

    // 2) tracked ids no longer carrying a status — attribute was removed (the success path)
    tracked.forEach((rec, id) => {
      if (rec.terminal || live.has(id)) return;
      const s = assetState(id);
      if (s.cls === "failed" && !rec.failNotified) {
        rec.type = classifyAsset(id) || rec.type;
        notify("fail", rec.type, id);
        rec.failNotified = true;
        rec.terminal = true;
        return;
      }
      if (s.cls === "success" && !rec.doneNotified) {
        rec.type = classifyAsset(id) || rec.type;
        notify("done", rec.type, id);
        rec.doneNotified = true;
        rec.terminal = true;
        return;
      }
      if (s.cls === "gone") {
        rec.goneCount = (rec.goneCount || 0) + 1;
        if (rec.goneCount > 6) tracked.delete(id);
      } // tile vanished without resolving — forget quietly
    });

    // keep the map from growing forever
    if (tracked.size > 400)
      tracked.forEach((r, id) => {
        if (r.terminal) tracked.delete(id);
      });
  }
  /* ==================== real-time detection ====================
     A MutationObserver is the primary trigger. Unlike setInterval, its callback fires
     from the page's OWN DOM changes, so it keeps working when this tab is in the
     background or the browser is minimized — the moment Higgsfield flips a tile's
     data-job-status (or the finished media lands), we re-check and fire immediately.
     The interval below is now just a slow safety net. */
  let sweepQueued = false;
  function scheduleSweep() {
    if (sweepQueued) return;
    sweepQueued = true;
    // microtask, not setTimeout — microtasks are NOT throttled in background tabs
    Promise.resolve().then(() => {
      sweepQueued = false;
      try {
        sweep();
      } catch {}
    });
  }
  let observer = null;
  function startObserver() {
    if (observer) return;
    try {
      observer = new MutationObserver((muts) => {
        for (let i = 0; i < muts.length; i++) {
          const m = muts[i];
          if (m.type === "attributes") {
            scheduleSweep();
            return;
          }
          if (m.type === "childList" && (m.addedNodes.length || m.removedNodes.length)) {
            scheduleSweep();
            return;
          }
        }
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-job-status", "src"],
        attributeOldValue: true,
      });
    } catch {}
  }
  startObserver();
  setInterval(sweep, POLL_MS); // fallback net
  sweep();

  /* ==================== optional keep-alive ====================
     Some pages throttle their OWN status updates when hidden. Playing a silent, looping
     track keeps this tab flagged as "playing audio", which exempts it from background
     throttling so alerts stay instant even minimized. Off by default; starts only after
     a user gesture (browsers block autoplay). Costs nothing when off. */
  const SILENT_WAV =
    "data:audio/wav;base64,UklGRsQPAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  let keepEl = null;
  function applyKeepAlive() {
    if (CFG.keepAlive) startKeepAlive();
    else stopKeepAlive();
  }
  function startKeepAlive() {
    try {
      if (!keepEl) {
        keepEl = new Audio(SILENT_WAV);
        keepEl.loop = true;
        keepEl.volume = 1.0;
      }
      const p = keepEl.play();
      if (p && p.catch) p.catch(() => {}); // resumes on next gesture if blocked
    } catch {}
  }
  function stopKeepAlive() {
    try {
      if (keepEl) keepEl.pause();
    } catch {}
  }

  /* ==================== account-wide job stream (stream.js) ==================== */
  let STREAM = "off";
  function syncStream() {
    window.dispatchEvent(new CustomEvent("hfn:stream", { detail: JSON.stringify({ on: CFG.on }) }));
  }
  window.addEventListener("hfn:stream-ready", syncStream);
  window.addEventListener("hfn:stream-state", (e) => {
    STREAM = String(e.detail || "");
  });
  window.addEventListener("hfn:job", (e) => {
    let ev;
    try {
      ev = JSON.parse(e.detail);
    } catch {
      return;
    }
    if (!ev || !ev.id) return;
    const cls = classify(ev.status);
    if (cls !== "success" && cls !== "failed") return;
    const rec = tracked.get(ev.id);
    if (rec && (cls === "success" ? rec.doneNotified : rec.failNotified)) return;
    const type =
      ev.mediaType || tileKind(ev.id) || (rec && rec.type) || jobSetKind(ev.jobSetType) || "other";
    if (rec) {
      rec.state = cls;
      rec.terminal = true;
      rec.doneNotified = rec.doneNotified || cls === "success";
      rec.failNotified = rec.failNotified || cls === "failed";
    }
    notify(cls === "success" ? "done" : "fail", type, ev.id);
  });
  syncStream();

  /* ==================== popup status channel ==================== */
  try {
    chrome.runtime.onMessage.addListener((msg, _s, reply) => {
      if (!msg || msg.type !== "notif-status") return;
      let active = 0;
      tracked.forEach((r) => {
        if (!r.terminal && (r.state === "working" || r.state === "unknown")) active++;
      });
      reply({
        version: VERSION,
        onHiggsfield: true,
        pageType: pathType() || "",
        active,
        liveTiles: document.querySelectorAll("[data-asset-id][data-job-status]").length,
        stream: STREAM,
        last: LAST,
      });
      return true;
    });
  } catch {}
})();
