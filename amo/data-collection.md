# Data Collection

The Firefox manifest, written by `scripts/build-firefox.mjs`, declares:

```json
"data_collection_permissions": {
  "required": ["none"],
  "optional": ["browsingActivity", "websiteContent"]
}
```

Last reviewed against `extension/` at version 1.5.0.

## Basis

- `required: ["none"]`: with phone alerts off, nothing leaves the device. Settings live in `storage.local`. The content script reads only the status attributes and media of Higgsfield result tiles, plus the job-status events the Higgsfield page itself receives (read from the page's own stream, with no requests of the extension's own), and the background script turns them into local notifications.
- `optional`: phone alerts POST the alert title, the status text and the Higgsfield page URL to an ntfy server (`https://ntfy.sh` unless the user sets another). The page URL is browsing activity and the generation status is website content. The popup calls `permissions.request` for both when the user turns phone alerts on, and `background.js` checks `permissions.contains` before every push.

Anything else sent off the device, such as analytics or a remote config, needs a new category here and in the manifest before it ships.

## Permission Justifications

Answer text is pasted into plain-text fields, so it stays free of Markdown and each answer is one line.

### `notifications`

Shows a system notification when a Higgsfield generation finishes or fails, which is the extension's whole purpose.

### `storage`

Saves the user's settings: which media types and events to alert on, sound choices, the keep-alive switch, and the phone alert topic and server.

### Host permission `https://higgsfield.ai/*`

The content script runs only on higgsfield.ai to watch the user's own generations for completion or failure.

### Host permission `https://ntfy.sh/*`

Lets the background script deliver phone alerts to ntfy.sh, the default ntfy server, when the user has turned phone alerts on.
