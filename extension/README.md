# Higgsfield Generation Notifier

A tiny, focused sibling to the Autopilot extension. It does **one thing**: watches
every Higgsfield page and sends you a system notification the moment **any**
generation finishes or fails — videos, images, audio, 3D, anything.

No queue, no auto-clicking, no prompt writing, no credits. It only watches and notifies.

## How it knows
It reads Higgsfield's own per-tile job status straight from the page
(`data-asset-id` / `data-job-status`) — the same ground-truth signal the Autopilot
uses — then classifies each finished asset by media type so the popup checkmarks can
filter what you get pinged about.

## Popup controls
- **Notifications** — master on/off.
- **Notify me about** — Videos · Images · Audio · 3D · Everything else.
- **When to alert** — when a generation finishes · when one fails.
- **Sound** — a distinct chime per type (video / image / audio / 3D / other), plus a universal fail buzz. Preview buttons let you audition each.
- **Send a test notification** — fires a real notification and tells you whether
  Chrome accepted it or Windows is hiding it (with the fix).

## Phone alerts (iPhone via ntfy)
Optional. Get a push on your phone when a generation finishes or fails — handy for
overnight or away-from-desk batches.

**Important:** this mirrors the desktop detection, so your computer + Chrome + the
Higgsfield tab must still be running. It does not let you close the laptop and walk away.

Setup:
1. Install the free **ntfy** app on your iPhone (App Store).
2. In the popup, open **Phone alerts (ntfy)** and switch **Send to my phone** on — a
   secret topic is generated for you (or type your own; the ↻ button re-rolls it).
3. In the ntfy app, tap **+** and subscribe to that exact topic.
4. Hit **Send a test to my phone** — it should buzz within a second or two.

Keep the topic private: anyone who knows the name can read your alerts. The phone push
respects the same type/event switches as your desktop alerts.

## Install (Chrome, Manifest V3)
1. Go to `chrome://extensions`, enable **Developer mode** (top right).
2. Remove any older copy of this extension first.
3. **Load unpacked** → select this `higgsfield-notifier` folder.
4. Refresh your Higgsfield tab.
5. Open the popup — the version at the bottom should read **v1.2.0**.

## Note on detection coverage
Video and image completion/failure ride on the exact model already proven in
Autopilot. Audio and 3D detection reuse the same status attributes plus media-type
sniffing, but those pages haven't been battle-tested yet — if a type doesn't fire,
that's the first thing to check.
