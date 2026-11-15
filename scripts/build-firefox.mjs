// Builds the Firefox package into dist-firefox/ from extension/, which stays the
// Chromium source. Only the manifest differs between the two.
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const src = new URL("../extension/", import.meta.url);
const out = new URL("../dist-firefox/", import.meta.url);

rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });

const manifest = JSON.parse(readFileSync(new URL("manifest.json", src), "utf8"));
// Firefox runs MV3 backgrounds as event pages, not service workers.
manifest.background = { scripts: [manifest.background.service_worker] };
manifest.browser_specific_settings = {
  gecko: {
    id: "higgsfield-notifier@shbernal.github.io",
    // 140 is the floor for data_collection_permissions.
    strict_min_version: "140.0",
    // Phone alerts send the Higgsfield page URL and the generation status to ntfy.
    // Asked for in the popup when the user turns phone alerts on.
    data_collection_permissions: {
      required: ["none"],
      optional: ["browsingActivity", "websiteContent"],
    },
  },
};
writeFileSync(new URL("manifest.json", out), JSON.stringify(manifest, null, 2) + "\n");
