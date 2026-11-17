// popup.js — control panel for the Generation Notifier.
"use strict";
const $ = (id) => document.getElementById(id);
const IS_GECKO = typeof browser !== "undefined" && !!browser.runtime.getBrowserInfo;
function on(id, ev, fn) {
  const el = $(id);
  if (el) el.addEventListener(ev, fn);
  else console.warn("[HF Notifier] missing #" + id);
}
function escHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

const DEFAULTS = {
  on: true,
  onComplete: true,
  onFail: true,
  sound: true,
  keepAlive: false,
  types: { video: true, image: true, audio: true, "3d": true, other: true },
  phone: { on: false, topic: "", server: "https://ntfy.sh" },
};
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
    if (v.phone) out.phone = Object.assign(clone(DEFAULTS.phone), v.phone);
  }
  return out;
}
let CFG = clone(DEFAULTS);
function saveCfg() {
  chrome.storage.local.set({ hfNotif: CFG });
}

// checkbox id -> getter/setter on CFG (text/phone fields wired separately)
const BINDINGS = [
  ["mMaster", () => CFG.on, (v) => (CFG.on = v)],
  ["tVideo", () => CFG.types.video, (v) => (CFG.types.video = v)],
  ["tImage", () => CFG.types.image, (v) => (CFG.types.image = v)],
  ["tAudio", () => CFG.types.audio, (v) => (CFG.types.audio = v)],
  ["t3d", () => CFG.types["3d"], (v) => (CFG.types["3d"] = v)],
  ["tOther", () => CFG.types.other, (v) => (CFG.types.other = v)],
  ["eDone", () => CFG.onComplete, (v) => (CFG.onComplete = v)],
  ["eFail", () => CFG.onFail, (v) => (CFG.onFail = v)],
  ["sChime", () => CFG.sound, (v) => (CFG.sound = v)],
  ["kAlive", () => CFG.keepAlive, (v) => (CFG.keepAlive = v)],
];
BINDINGS.forEach(([id, , set]) =>
  on(id, "change", () => {
    const el = $(id);
    if (!el) return;
    set(el.checked);
    saveCfg();
    if (id === "mMaster") syncEnabled();
  }),
);

function applyToUI() {
  BINDINGS.forEach(([id, get]) => {
    const el = $(id);
    if (el) el.checked = !!get();
  });
  const pOn = $("pOn");
  if (pOn) pOn.checked = !!CFG.phone.on;
  const pTopic = $("pTopic");
  if (pTopic) pTopic.value = CFG.phone.topic || "";
  syncEnabled();
}
function syncEnabled() {
  const st = $("masterstate");
  if (st) {
    st.textContent = CFG.on ? "On" : "Off";
    st.className = "mstate " + (CFG.on ? "mon" : "moff");
  }
  const sub = $("subcards");
  if (sub) sub.classList.toggle("dim", !CFG.on);
  [
    "tVideo",
    "tImage",
    "tAudio",
    "t3d",
    "tOther",
    "eDone",
    "eFail",
    "sChime",
    "kAlive",
    "pOn",
  ].forEach((id) => {
    const e = $(id);
    if (e) e.disabled = !CFG.on;
  });
  const pOK = CFG.on && CFG.phone.on;
  const pc = $("pconfig");
  if (pc) pc.classList.toggle("off", !pOK);
  ["pTopic", "pRand", "pTest"].forEach((id) => {
    const e = $(id);
    if (e) e.disabled = !pOK;
  });
}

/* ---- phone (ntfy) ---- */
function randTopic() {
  const cs = "abcdefghijkmnpqrstuvwxyz23456789"; // no ambiguous l/o/0/1
  let out = "";
  try {
    const a = new Uint32Array(12);
    crypto.getRandomValues(a);
    for (let i = 0; i < 12; i++) out += cs[a[i] % cs.length];
  } catch {
    for (let i = 0; i < 12; i++) out += cs[Math.floor(Math.random() * cs.length)];
  }
  return "hf-" + out;
}
/* Firefox asks for consent before an extension sends browsing data off the device.
   Phone pushes carry the Higgsfield page URL, so turning them on asks for it. The
   request has to start inside the click handler, before any await. */
const PHONE_DATA = { data_collection: ["browsingActivity", "websiteContent"] };
async function phoneConsent() {
  if (!IS_GECKO) return true;
  try {
    return await browser.permissions.request(PHONE_DATA);
  } catch {
    return false;
  }
}
on("pOn", "change", async () => {
  if ($("pOn").checked && !(await phoneConsent())) {
    $("pOn").checked = false;
    const d = $("pdiag");
    if (d) d.textContent = "Firefox needs your consent to send alerts to your phone.";
    return;
  }
  CFG.phone.on = $("pOn").checked;
  if (CFG.phone.on && !(CFG.phone.topic || "").trim()) {
    const t = randTopic();
    CFG.phone.topic = t;
    if ($("pTopic")) $("pTopic").value = t;
  }
  saveCfg();
  syncEnabled();
});
on("pTopic", "input", () => {
  CFG.phone.topic = ($("pTopic").value || "").trim();
  saveCfg();
});
on("pRand", "click", () => {
  const t = randTopic();
  CFG.phone.topic = t;
  if ($("pTopic")) $("pTopic").value = t;
  saveCfg();
  const d = $("pdiag");
  if (d) d.textContent = "New topic set \u2014 re-subscribe to it in the ntfy app.";
});
on("pTest", "click", async () => {
  const out = $("pdiag");
  let topic = (CFG.phone.topic || "").trim();
  if (!topic) {
    topic = randTopic();
    CFG.phone.topic = topic;
    if ($("pTopic")) $("pTopic").value = topic;
    saveCfg();
  }
  if (out) out.textContent = "Sending\u2026";
  const res = await sendRuntime({ type: "phone-test" });
  if (!res) {
    if (out)
      out.innerHTML =
        "<b style='color:#ff8a8a'>No response</b> \u2014 reload the extension and try again.";
    return;
  }
  if (res.ok) {
    if (out)
      out.innerHTML =
        "<b style='color:#D0FE17'>Sent \u2713</b> \u2014 if the ntfy app is subscribed to <b>" +
        escHtml(topic) +
        "</b>, your phone should buzz.";
  } else {
    if (out)
      out.innerHTML =
        "<b style='color:#ff8a8a'>Failed:</b> " +
        escHtml(res.error || "status " + res.status) +
        " \u2014 check the topic and your connection.";
  }
});

/* ---- platform awareness ----
   The notification API is identical on every OS — what differs is WHERE the user has
   to go to unblock it. Detect the platform so the test button gives real instructions
   instead of telling a Mac user to check Focus Assist. */
let PLATFORM = "";
try {
  chrome.runtime.getPlatformInfo((i) => {
    PLATFORM = (i && i.os) || "";
    paintEnv();
  });
} catch {}

function browserName() {
  const ua = navigator.userAgent || "";
  if (IS_GECKO) return "Firefox";
  if (/OPR\//.test(ua)) return "Opera"; // covers Opera and Opera GX
  if (/Edg\//.test(ua)) return "Edge";
  if (/Vivaldi/.test(ua)) return "Vivaldi";
  if (/Brave/.test(ua) || (navigator.brave && navigator.brave.isBrave)) return "Brave";
  return "Chrome";
}
function osName() {
  return (
    {
      win: "Windows",
      mac: "macOS",
      linux: "Linux",
      cros: "ChromeOS",
      openbsd: "OpenBSD",
      android: "Android",
    }[PLATFORM] || ""
  );
}
/* Where this OS hides notifications, and how to let them through. */
function osFix() {
  const b = browserName();
  switch (PLATFORM) {
    case "mac":
      return (
        "macOS is holding it back. Open <b>System Settings \u25B8 Notifications \u25B8 " +
        b +
        "</b> and switch <b>Allow Notifications</b> on. Then check you're not in a <b>Focus</b> mode " +
        "(Do Not Disturb) \u2014 that silences banners even when they're allowed."
      );
    case "linux":
      return (
        "Your desktop is holding it back. Make sure a <b>notification daemon</b> is running \u2014 GNOME " +
        "and KDE have one built in; on a minimal window manager you'll need <b>dunst</b> or <b>mako</b>. " +
        "Then turn off <b>Do Not Disturb</b> in your desktop settings."
      );
    case "cros":
      return (
        "ChromeOS is holding it back. Open <b>Quick Settings</b> (clock, bottom-right), turn off " +
        "<b>Do Not Disturb</b>, and make sure notifications are allowed for " +
        b +
        "."
      );
    case "win":
      return (
        "Windows is hiding it. Turn off <b>Focus Assist / Do Not Disturb</b>, then allow " +
        b +
        " under <b>Settings \u25B8 System \u25B8 Notifications</b>."
      );
    default:
      return (
        "Your operating system is hiding it. Open your system notification settings, allow " +
        b +
        ", and turn off Do Not Disturb."
      );
  }
}
/* Quietly show what we detected, so people on Mac/Linux can see they're supported. */
function paintEnv() {
  const el = $("env");
  if (!el) return;
  const os = osName();
  el.textContent = os ? browserName() + " \u00b7 " + os : browserName();
}
document.addEventListener("DOMContentLoaded", paintEnv);

/* ---- sound: shared context + preview buttons ---- */
let PCTX = null;
function actx() {
  try {
    if (!PCTX) PCTX = new (window.AudioContext || window.webkitAudioContext)();
    if (PCTX.state === "suspended") PCTX.resume().catch(() => {});
    return PCTX;
  } catch {
    return null;
  }
}
function playSnd(kind, type) {
  const c = actx();
  if (c && window.HFSounds) {
    try {
      window.HFSounds.play(c, kind, type);
    } catch {}
  }
}
document.querySelectorAll(".prev").forEach((btn) => {
  btn.addEventListener("click", () => {
    const s = btn.getAttribute("data-snd");
    if (s === "fail") playSnd("fail", null);
    else playSnd("done", s);
  });
});

/* ---- messaging helpers ---- */
function sendRuntime(msg) {
  return new Promise((res) => {
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        void chrome.runtime.lastError;
        res(r || null);
      });
    } catch {
      res(null);
    }
  });
}
function sendTab(tabId, msg) {
  return new Promise((res) => {
    try {
      chrome.tabs.sendMessage(tabId, msg, (r) => {
        void chrome.runtime.lastError;
        res(r || null);
      });
    } catch {
      res(null);
    }
  });
}

/* ---- live status strip ---- */
function setStatus(live, text) {
  const dot = $("statusdot"),
    t = $("statustext");
  if (dot) dot.className = "dot" + (live ? " live" : "");
  if (t) t.textContent = text;
}
function showWarn(html) {
  const w = $("warn");
  if (w) {
    w.innerHTML = html;
    w.style.display = "block";
  }
}
function hideWarn() {
  const w = $("warn");
  if (w) w.style.display = "none";
}
async function poll() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !(tab.url || "").startsWith("https://higgsfield.ai/")) {
      showWarn("Open <b>higgsfield.ai</b> in this tab to start watching your generations.");
      setStatus(false, "Not on Higgsfield");
      return;
    }
    hideWarn();
    const res = await sendTab(tab.id, { type: "notif-status" });
    if (!res) {
      setStatus(false, "Starting on the page\u2026 refresh the tab if this stays");
      return;
    }
    if (res.active > 0)
      setStatus(
        true,
        res.active === 1 ? "1 generation running now" : res.active + " generations running now",
      );
    else if (res.stream === "open") setStatus(false, "Watching all your generations");
    else setStatus(false, "Watching \u2014 nothing rendering right now");
  } catch {
    setStatus(false, "Watching");
  }
}

/* ---- desktop test notification (diagnoses Chrome vs Windows suppression) ---- */
on("btnTest", "click", () => {
  const out = $("testdiag");
  if (CFG.sound) playSnd("done", "other");
  if (out) out.textContent = "Testing\u2026";
  try {
    chrome.notifications.create(
      "hfn-test-" + Date.now(),
      {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icon128.png"),
        title: "Higgsfield Notifier",
        message: "Test notification \u2713",
        ...(IS_GECKO ? {} : { priority: 2, requireInteraction: true }),
      },
      (id) => {
        const err = chrome.runtime.lastError;
        if (err) {
          if (out)
            out.innerHTML = "<b style='color:#ff8a8a'>API error:</b> " + escHtml(err.message);
        } else if (id) {
          if (out)
            out.innerHTML =
              "<b style='color:#D0FE17'>" +
              browserName() +
              " accepted it \u2713</b> \u2014 if no banner appeared, " +
              osFix();
        } else {
          if (out)
            out.innerHTML =
              "<b style='color:#ffd35a'>No id returned</b> \u2014 likely blocked by the OS.";
        }
      },
    );
  } catch (e) {
    if (out) out.innerHTML = "<b style='color:#ff8a8a'>create failed:</b> " + escHtml(e.message);
  }
});

/* ---- boot ---- */
async function init() {
  try {
    const o = await chrome.storage.local.get("hfNotif");
    CFG = mergeCfg(o && o.hfNotif);
  } catch {
    CFG = clone(DEFAULTS);
  }
  applyToUI();
  poll();
  setInterval(poll, 1500);
}
document.addEventListener("DOMContentLoaded", init);
