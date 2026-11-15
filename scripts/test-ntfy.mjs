// Runs extension/background.js in a Node vm with a fake `chrome`, sends it the same
// messages the popup and content script send, and checks on ntfy.sh that the right
// pushes arrived on a random throwaway topic (and that disabled setups push nothing).

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import vm from "node:vm";
import assert from "node:assert/strict";

const SERVER = "https://ntfy.sh";
const SOURCE = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");

function loadBackground({ phone, gecko }) {
  const sent = [];
  let listener;
  const chrome = {
    storage: {
      local: { get: (_key, cb) => queueMicrotask(() => cb({ hfNotif: { phone } })) },
    },
    runtime: {
      onMessage: { addListener: (fn) => (listener = fn) },
      getURL: (p) => "chrome-extension://test/" + p,
      lastError: undefined,
    },
    notifications: { create: (_id, _opts, cb) => cb && cb() },
  };
  const context = {
    chrome,
    console,
    fetch: (url, init) => {
      const p = fetch(url, init);
      sent.push(p);
      return p;
    },
  };
  if (gecko)
    context.browser = {
      runtime: { getBrowserInfo: () => Promise.resolve({ name: "Firefox" }) },
      permissions: { contains: () => Promise.resolve(gecko.consent) },
    };
  vm.createContext(context);
  vm.runInContext(SOURCE, context, { filename: "background.js" });
  assert.ok(listener, "background.js registered no onMessage listener");
  return { listener, sent };
}

function send(listener, msg) {
  return new Promise((resolve) => {
    // Round-trip through JSON: replies are objects from the vm realm.
    const keepOpen = listener(msg, {}, (r) => resolve(JSON.parse(JSON.stringify(r))));
    if (keepOpen !== true) resolve(undefined);
  });
}

const settle = () => new Promise((r) => setTimeout(r, 200));

async function poll(topic, want) {
  for (let i = 0; i < 10; i++) {
    const res = await fetch(`${SERVER}/${topic}/json?poll=1`);
    assert.ok(res.ok, `poll failed: HTTP ${res.status}`);
    const msgs = (await res.text())
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((m) => m.event === "message");
    if (msgs.length >= want) return msgs;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`expected ${want} messages on ${topic}, timed out`);
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`ok   ${name}`);
  } catch (e) {
    results.push(false);
    console.log(`FAIL ${name}\n     ${e.message}`);
  }
}

const topic = "hf-test-" + randomBytes(8).toString("hex");
console.log(`topic: ${SERVER}/${topic}\n`);

await check("pushes reach ntfy with the right fields", async () => {
  const { listener, sent } = loadBackground({ phone: { on: true, topic, server: SERVER } });

  const res = await send(listener, { type: "phone-test" });
  assert.deepEqual(res, { ok: true, status: 200 });

  await send(listener, {
    type: "notify",
    kind: "done",
    title: "Video ready ✓",
    message: "Kling 3.0 finished",
    url: "https://higgsfield.ai/asset/123",
  });
  await send(listener, {
    type: "notify",
    kind: "fail",
    title: "Failed",
    message: "Out of credits",
  });
  await settle();
  const statuses = (await Promise.all(sent)).map((r) => r.status);
  assert.deepEqual(statuses, [200, 200, 200]);

  const msgs = await poll(topic, 3);
  assert.equal(msgs.length, 3);
  const byTitle = Object.fromEntries(msgs.map((m) => [m.title, m]));

  const t = byTitle["Higgsfield Notifier"];
  assert.ok(t, "test push missing");
  assert.equal(t.priority, 4);
  assert.deepEqual(t.tags, ["bell"]);

  const done = byTitle["Video ready ✓"];
  assert.ok(done, "finish push missing");
  assert.equal(done.message, "Kling 3.0 finished");
  assert.equal(done.priority, 4);
  assert.deepEqual(done.tags, ["white_check_mark"]);
  assert.equal(done.click, "https://higgsfield.ai/asset/123");

  const fail = byTitle["Failed"];
  assert.ok(fail, "failure push missing");
  assert.equal(fail.message, "Out of credits");
  assert.equal(fail.priority, 5);
  assert.deepEqual(fail.tags, ["warning"]);
});

const gates = [
  ["phone alerts off", { phone: { on: false, topic } }],
  ["empty topic", { phone: { on: true, topic: "  " } }],
  ["Firefox without consent", { phone: { on: true, topic }, gecko: { consent: false } }],
];
for (const [name, setup] of gates)
  await check(`no push when ${name}`, async () => {
    const { listener, sent } = loadBackground(setup);
    await send(listener, { type: "notify", kind: "done", title: "x", message: "y" });
    await settle();
    assert.equal(sent.length, 0);
  });

await check("Firefox with consent pushes", async () => {
  const t2 = topic + "-ff";
  const { listener, sent } = loadBackground({
    phone: { on: true, topic: t2, server: SERVER },
    gecko: { consent: true },
  });
  await send(listener, { type: "notify", kind: "done", title: "ff", message: "ok" });
  await settle();
  assert.equal(sent.length, 1);
  assert.equal((await sent[0]).status, 200);
  await poll(t2, 1);
});

await check("phone-test reports a missing topic", async () => {
  const { listener } = loadBackground({ phone: { on: true, topic: "" } });
  assert.deepEqual(await send(listener, { type: "phone-test" }), {
    ok: false,
    error: "no topic set",
  });
});

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
