<div align="center">

<img src="extension/icon128.png" alt="" width="96" height="96">

# Higgsfield Notifier

Get a notification when a Higgsfield generation finishes or fails.

[![CI][ci-badge]][ci]
[![License][license-badge]][license]

---

[Install](#install) • [Quickstart](#quickstart) • [Phone alerts](#phone-alerts) • [How it works](#how-it-works)

---

</div>

<!-- TODO: screenshot of the popup next to a desktop notification -->

A browser extension that watches your open higgsfield.ai tabs and sends a system notification the moment a generation completes or fails.
It works for every kind of output: video, image, audio and 3D.
It only watches: it never clicks Generate, writes prompts or spends credits.

- Per-type filters: get pinged for videos only, or for everything.
- Separate switches for finished and failed generations.
- A distinct chime per media type, plus a fail buzz, each with a preview button.
- A test button that tells you whether the browser accepted the notification or the OS is hiding it.
- Optional push to your phone through [ntfy](https://ntfy.sh).
- An opt-in keep-alive so detection keeps running when the window is minimized.

## Install

The extension is not on the Chrome Web Store or addons.mozilla.org yet, so you load it from a clone.
It runs in Chrome, Edge, Brave, Opera GX, Vivaldi and Firefox 140 or later.

```sh
git clone https://github.com/shbernal/higgsfield-notifier.git
```

<details>
<summary>Chromium browsers</summary>

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `extension` folder of the clone.
3. Refresh any open Higgsfield tab.

</details>

<details>
<summary>Firefox</summary>

Build the Firefox version with [pnpm](https://pnpm.io):

```sh
pnpm install && pnpm build:firefox
```

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and select `dist-firefox/manifest.json`.
3. Refresh any open Higgsfield tab.

Firefox removes temporary add-ons when it restarts.

</details>

## Quickstart

1. Open higgsfield.ai and start a generation.
2. Click the extension icon and pick which media types and events you want alerts for.
3. Hit **Send a test notification** to check that your OS shows it.
4. Switch tabs or minimize the window: the notification arrives when the generation is done.

## Phone alerts

Optional push to your phone through the free ntfy app.
Your computer, the browser and the Higgsfield tab must keep running: the phone gets a copy of the desktop alert, the detection still happens in the browser.

1. Install the **ntfy** app on your phone.
2. In the popup, open **Phone alerts (ntfy)** and turn on **Send to my phone**. A random secret topic is generated for you.
3. In the ntfy app, tap **+** and subscribe to that exact topic.
4. Hit **Send a test to my phone**.

Firefox asks for your consent to share browsing data when you turn this on, since each alert carries the Higgsfield page link.
Anyone who knows the topic name can read your alerts, so keep it private.
Phone alerts follow the same type and event switches as desktop alerts.

## How it works

Higgsfield marks each result tile with `data-asset-id` and `data-job-status`.
The content script watches those attributes with a `MutationObserver`, plus a slow fallback sweep:

- A tile that keeps `data-job-status` is still working, or has failed when the status is a failure like `failed` or `nsfw`.
- A tile that drops the attribute and shows media whose URL contains the asset id has finished.

The media type comes from the elements and file extensions in the tile, with the page path as a hint.
Video and image detection is the most tested; if audio or 3D alerts don't fire, that's the first thing to report.

## Lineage

Created by [The Mad Prompter](https://ismygendone.netlify.app/) and released under the MIT license with their agreement.
This repository starts from their version 1.4.0.

[ci]: https://github.com/shbernal/higgsfield-notifier/actions/workflows/ci.yml
[ci-badge]: https://img.shields.io/github/actions/workflow/status/shbernal/higgsfield-notifier/ci.yml?branch=main&style=for-the-badge&label=CI&labelColor=0a1207&color=D0FE17&logo=githubactions&logoColor=D0FE17
[license]: LICENSE
[license-badge]: https://img.shields.io/github/license/shbernal/higgsfield-notifier?style=for-the-badge&labelColor=0a1207&color=D0FE17
