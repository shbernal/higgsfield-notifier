import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  EMPTY_LOCK,
  MAX_IMAGE_BYTES,
  checkImageBytes,
  describeDeferredPlan,
  describeSyncStart,
  iconNeedsUpload,
  imageContentType,
  isPlanEmpty,
  lockPreviews,
  parseAssetLock,
  parsePreviewManifest,
  planCalls,
  planPreviewSync,
} from "../scripts/amo-previews.mjs";

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

const preview = (file, caption) => ({ file, caption: { "en-US": caption } });

const valid = [preview("assets/store/a.png", "first"), preview("assets/store/b.png", "second")];

// The three sides a sync reconciles: the manifest, the lock, and what AMO says
// it holds.
const digests = new Map([
  ["assets/store/a.png", "aaa"],
  ["assets/store/b.png", "bbb"],
]);

const lockOf = (...rows) => ({ icon: null, previews: rows });

const row = (file, sha256, id) => ({ file, sha256, id });

const published = (id, caption, position) => ({
  id,
  caption: { "en-US": caption },
  position,
});

const synced = lockOf(row("assets/store/a.png", "aaa", 11), row("assets/store/b.png", "bbb", 12));

const remoteSynced = [published(11, "first", 0), published(12, "second", 1)];

describe("imageContentType", () => {
  it("maps the formats AMO accepts", () => {
    assert.equal(imageContentType("a.png"), "image/png");
    assert.equal(imageContentType("a.jpg"), "image/jpeg");
    assert.equal(imageContentType("a.JPEG"), "image/jpeg");
  });

  it("rejects anything else", () => {
    assert.throws(() => imageContentType("a.gif"), /PNG or JPEG/);
    assert.throws(() => imageContentType("a"), /PNG or JPEG/);
  });
});

describe("checkImageBytes", () => {
  it("accepts a file at the limit", () => {
    assert.doesNotThrow(() => checkImageBytes("a.png", MAX_IMAGE_BYTES));
  });

  it("rejects a file over the limit", () => {
    assert.throws(() => checkImageBytes("a.png", MAX_IMAGE_BYTES + 1), /over 4MB/);
  });
});

describe("parsePreviewManifest", () => {
  it("keeps the file order it was given", () => {
    assert.deepEqual(
      parsePreviewManifest(valid).map((entry) => entry.file),
      ["assets/store/a.png", "assets/store/b.png"],
    );
  });

  it("rejects a manifest that is not an array", () => {
    assert.throws(() => parsePreviewManifest({}), /must be an array/);
  });

  it("rejects an empty manifest rather than emptying the listing", () => {
    assert.throws(() => parsePreviewManifest([]), /no previews/);
  });

  it("rejects an entry with no file", () => {
    assert.throws(
      () => parsePreviewManifest([{ caption: { "en-US": "x" } }]),
      /entry 0 has no "file"/,
    );
  });

  it("rejects a file AMO would not accept", () => {
    assert.throws(() => parsePreviewManifest([preview("a.gif", "x")]), /PNG or JPEG/);
  });

  it("rejects the same file listed twice", () => {
    assert.throws(() => parsePreviewManifest([valid[0], valid[0]]), /entry 1 repeats/);
  });

  it("rejects an entry with no en-US caption", () => {
    assert.throws(
      () => parsePreviewManifest([{ file: "a.png", caption: { de: "x" } }]),
      /no "en-US" caption/,
    );

    assert.throws(() => parsePreviewManifest([preview("a.png", "  ")]), /no "en-US" caption/);
  });

  it("names the source file in its errors", () => {
    assert.throws(() => parsePreviewManifest({}, "amo/previews.json"), {
      message: /^amo\/previews\.json: /,
    });
  });
});

describe("parseAssetLock", () => {
  it("reads back what a sync writes", () => {
    assert.deepEqual(parseAssetLock(synced), synced);
  });

  // A bookkeeping file must never be able to block a release: anything it
  // cannot vouch for is simply not reusable.
  it("treats junk as nothing recorded rather than failing", () => {
    for (const raw of [undefined, null, "nonsense", {}, { previews: {} }]) {
      assert.deepEqual(parseAssetLock(raw), EMPTY_LOCK);
    }
  });

  it("drops rows that are missing the pairing they exist to record", () => {
    const raw = {
      previews: [
        row("a.png", "aaa", 11),
        { file: "b.png", sha256: "bbb" },
        { file: "c.png", id: 13 },
        { file: "d.png", sha256: "ddd", id: "14" },
      ],
    };

    assert.deepEqual(parseAssetLock(raw).previews, [row("a.png", "aaa", 11)]);
  });
});

describe("planPreviewSync", () => {
  it("uploads everything when nothing was ever recorded", () => {
    const plan = planPreviewSync([], valid, EMPTY_LOCK, digests);

    assert.deepEqual(plan.uploads, [
      { ...valid[0], position: 0 },
      { ...valid[1], position: 1 },
    ]);
    assert.deepEqual(plan.patches, []);
    assert.deepEqual(plan.deletes, []);
  });

  it("sends nothing when the listing already matches", () => {
    const plan = planPreviewSync(remoteSynced, valid, synced, digests);

    assert.equal(isPlanEmpty(plan), true);
    assert.deepEqual(plan.kept, [11, 12]);
  });

  // The whole point of the digest: a screenshot swapped on disk cannot pass as
  // the one that was uploaded, however similar it looks.
  it("replaces a screenshot whose bytes have changed", () => {
    const changed = new Map(digests).set("assets/store/a.png", "zzz");
    const plan = planPreviewSync(remoteSynced, valid, synced, changed);

    assert.deepEqual(plan.uploads, [{ ...valid[0], position: 0 }]);
    assert.deepEqual(plan.deletes, [11]);
    assert.equal(planCalls(plan), 3);
  });

  // Caption and position are ordinary writable fields; only the image is
  // create-only. That is what makes a re-word cost one call instead of three.
  it("patches a re-worded caption without touching the image", () => {
    const reworded = [valid[0], preview("assets/store/b.png", "clearer")];
    const plan = planPreviewSync(remoteSynced, reworded, synced, digests);

    assert.deepEqual(plan.uploads, []);
    assert.deepEqual(plan.deletes, []);
    assert.deepEqual(plan.patches, [
      {
        id: 12,
        file: "assets/store/b.png",
        caption: { "en-US": "clearer" },
      },
    ]);
  });

  it("patches position when the manifest is reordered", () => {
    const plan = planPreviewSync(remoteSynced, [valid[1], valid[0]], synced, digests);

    assert.deepEqual(plan.patches, [
      { id: 12, file: "assets/store/b.png", position: 0 },
      { id: 11, file: "assets/store/a.png", position: 1 },
    ]);
  });

  it("leaves translations it does not write alone", () => {
    const remote = [
      {
        ...published(11, "first", 0),
        caption: { "en-US": "first", de: "eins" },
      },
      published(12, "second", 1),
    ];

    assert.equal(isPlanEmpty(planPreviewSync(remote, valid, synced, digests)), true);
  });

  // A recorded id that AMO no longer has is a preview someone removed by hand,
  // or one an interrupted run never finished.
  it("re-uploads when the recorded preview is gone from AMO", () => {
    const plan = planPreviewSync([remoteSynced[1]], valid, synced, digests);

    assert.deepEqual(plan.uploads, [{ ...valid[0], position: 0 }]);
    assert.deepEqual(plan.deletes, []);
  });

  it("drops previews the manifest no longer lists", () => {
    const plan = planPreviewSync(
      [...remoteSynced, published(13, "stray", 2)],
      [valid[0]],
      synced,
      digests,
    );

    assert.deepEqual(plan.deletes, [12, 13]);
    assert.deepEqual(plan.uploads, []);
  });
});

describe("describeSyncStart", () => {
  it("counts the work, in the singular where there is one of it", () => {
    const reworded = [valid[0], preview("assets/store/b.png", "clearer")];
    const plan = planPreviewSync(remoteSynced, reworded, synced, digests);

    assert.equal(describeSyncStart(plan), "syncing previews: 1 metadata fix in 1 call");
  });
});

describe("describeDeferredPlan", () => {
  // The case that reaches it is the expensive one: nothing recorded, so every
  // image goes up again and the ones already published come down.
  it("says what the work is, what it costs, and who should do it", () => {
    const plan = planPreviewSync(remoteSynced, valid, EMPTY_LOCK, digests);
    const line = describeDeferredPlan(plan, 3);

    assert.equal(planCalls(plan), 6);
    assert.ok(line.includes("2 uploads, 2 removals"));
    assert.ok(line.includes("needs 6 calls and only 3 are left this hour"));
    assert.ok(line.includes("--sync-previews"));
  });

  it("counts one of a thing as one", () => {
    const changed = new Map(digests).set("assets/store/a.png", "zzz");
    const plan = planPreviewSync(remoteSynced, valid, synced, changed);

    assert.ok(describeDeferredPlan(plan, 0).includes("1 upload, 1 removal"));
  });
});

describe("iconNeedsUpload", () => {
  const applied = { icon: { file: "icon.png", sha256: "aaa" }, previews: [] };
  const live = "https://addons.mozilla.org/user-media/addon_icons/1/1-64.png";

  it("skips an icon already applied from the same bytes", () => {
    assert.equal(iconNeedsUpload(applied, "icon.png", "aaa", live), false);
  });

  it("sends a changed icon", () => {
    assert.equal(iconNeedsUpload(applied, "icon.png", "zzz", live), true);
    assert.equal(iconNeedsUpload(EMPTY_LOCK, "icon.png", "aaa", live), true);
  });

  // The lock says what was sent, not what AMO kept. A placeholder is proof no
  // icon was ever accepted.
  it("sends it anyway while AMO serves its placeholder", () => {
    const placeholder = "https://addons.mozilla.org/static/img/addon-icons/default-64.png";

    assert.equal(iconNeedsUpload(applied, "icon.png", "aaa", placeholder), true);
    assert.equal(iconNeedsUpload(applied, "icon.png", "aaa", undefined), true);
  });
});

describe("lockPreviews", () => {
  it("records the manifest order, not the order things were uploaded", () => {
    const ids = new Map([
      ["assets/store/b.png", 12],
      ["assets/store/a.png", 11],
    ]);

    assert.deepEqual(lockPreviews(valid, digests, ids), synced.previews);
  });

  it("forgets a screenshot the manifest no longer lists", () => {
    const ids = new Map([
      ["assets/store/a.png", 11],
      ["assets/store/gone.png", 99],
    ]);

    assert.deepEqual(lockPreviews(valid, digests, ids), [synced.previews[0]]);
  });

  it("holds nothing for an entry that has not been uploaded yet", () => {
    assert.deepEqual(lockPreviews(valid, digests, new Map()), []);
  });
});

// The manifest points at files the publish script uploads by path, so a moved
// or deleted screenshot has to fail here rather than partway through a release.
describe("the checked-in previews manifest", () => {
  const entries = parsePreviewManifest(readJson("../amo/previews.json"));

  for (const { file } of entries) {
    it(`${file} is present and valid`, () => {
      const { size } = statSync(resolve(import.meta.dirname, "..", file));

      assert.ok(size > 0);
      assert.ok(size <= MAX_IMAGE_BYTES);
    });
  }

  // A lock that has stopped parsing would silently turn every sync back into a
  // full replace, which is the cost this file exists to avoid.
  it("has a lock file the sync can read", () => {
    const lockFile = readJson("../amo/previews.lock.json");

    assert.deepEqual(parseAssetLock(lockFile), lockFile);
  });
});
