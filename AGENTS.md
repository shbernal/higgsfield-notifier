# AI project guidelines

`higgsfield-notifier`: Manifest V3 extension for Chromium and Firefox that sends a notification when a higgsfield.ai generation finishes or fails, with optional phone push through ntfy.

- Plain JavaScript. `extension/` is the Chromium extension, loaded unpacked as is. `scripts/build-firefox.mjs` copies it to `dist-firefox/` and rewrites only the manifest; code branches on `IS_GECKO` where the browsers differ.
- The version lives in `extension/manifest.json`, `package.json`, the `VERSION` constant in `extension/content.js` and the footer of `extension/popup.html`. Bump them together.

- Key commands
  - `pnpm lint`
  - `pnpm format`
  - `pnpm package`, `pnpm package:firefox`
  - `pnpm lint:firefox`

- Iron Laws
  - State of the art AI models/harnesses need minimal guidance. Don't repeat yourself, don't babysit, don't be over-specific.
  - Only document items here when model diverges repeatedly from expected behavior. Don't document behaviors implemented without errors.
  - No journaling: code comments / documentation describe current state, they don't carry a log of their own edit history.
