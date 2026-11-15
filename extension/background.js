// background.js — service worker.
// Two jobs: (1) turn a "notify" message from the content watcher into a real Chrome
// system notification, and (2) mirror that same alert to the phone via ntfy when phone
// alerts are switched on. It also answers a "phone-test" from the popup so you can
// confirm the whole chain end to end.

const NTFY_DEFAULT = "https://ntfy.sh";

function localNotify(msg) {
  chrome.notifications.create("hfn-" + Date.now(), {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon128.png"),
    title: msg.title || "Higgsfield",
    message: msg.message || "",
    priority: 2,
    requireInteraction: false
  }, () => { if (chrome.runtime.lastError) console.warn("[HF Notifier] notification blocked:", chrome.runtime.lastError.message); });
}

// POST to ntfy using the JSON-publish form (topic in the body) so unicode in the title
// or message can't trip over latin-1 HTTP header limits.
function ntfyPost(phone, payload) {
  const server = (phone.server || NTFY_DEFAULT).replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json" };
  if (phone.token) headers["Authorization"] = "Bearer " + phone.token;
  return fetch(server + "/", { method: "POST", headers, body: JSON.stringify(payload) });
}

function pushToPhone(msg) {
  chrome.storage.local.get("hfNotif", (o) => {
    const phone = (o && o.hfNotif && o.hfNotif.phone) || null;
    if (!phone || !phone.on) return;
    const topic = (phone.topic || "").trim();
    if (!topic) return;
    const fail = msg.kind === "fail";
    const payload = {
      topic,
      title: msg.title || "Higgsfield",
      message: msg.message || "",
      tags: [fail ? "warning" : "white_check_mark"],
      priority: fail ? 5 : 4
    };
    if (msg.url) payload.click = msg.url;
    ntfyPost(phone, payload).catch((e) => console.warn("[HF Notifier] phone push failed:", e && e.message));
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "notify") {
    localNotify(msg);
    pushToPhone(msg);
    return; // fire and forget
  }

  if (msg.type === "phone-test") {
    chrome.storage.local.get("hfNotif", (o) => {
      const phone = (o && o.hfNotif && o.hfNotif.phone) || {};
      const topic = (phone.topic || "").trim();
      if (!topic) { sendResponse({ ok: false, error: "no topic set" }); return; }
      ntfyPost(phone, {
        topic,
        title: "Higgsfield Notifier",
        message: "Test push \u2713 your phone alerts are working.",
        tags: ["bell"],
        priority: 4
      })
        .then((r) => sendResponse({ ok: r.ok, status: r.status }))
        .catch((e) => sendResponse({ ok: false, error: (e && e.message) || "network error" }));
    });
    return true; // keep the message channel open for the async reply
  }
});
