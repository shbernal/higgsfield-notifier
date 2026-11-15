# Releasing

Publishing a GitHub Release with a `v*` tag publishes to both stores. Each store has its own workflow, and one failing does not roll the other back.

1. Bump the version in `package.json`, `extension/manifest.json`, `VERSION` in `extension/content.js` and the footer of `extension/popup.html`. `pnpm check:version` confirms they agree.
2. Review the store copy against what changed: `assets/store/description.txt`, `amo/listing.json`, `amo/previews.json`, `amo/reviewer-notes.md`, `amo/data-collection.md` and `chrome-web-store/privacy-justifications.md`. A new permission or a new destination for user data needs an answer in both privacy files, and for Firefox, a `data_collection_permissions` change in `scripts/build-firefox.mjs`.
3. Run `pnpm package:firefox && pnpm publish:amo --dry-run`. It validates the listing's tags and categories against AMO's vocabularies and size-checks every screenshot. AMO only rejects bad metadata on the call that creates the version, after the release is already published.
4. If a screenshot changed, run `pnpm publish:amo --assets-only` locally and commit the `amo/previews.lock.json` it writes before tagging (see below).
5. Commit, then publish a release tagged `v<version>`.

Both workflows check the tag against the version before touching a store. Actions are pinned by commit SHA, write access is limited to a separate `attach` job that uploads the zips to the release, and each publish workflow is its own queued concurrency group.

## Chrome Web Store

`.github/workflows/publish-cws.yml` runs in the `chrome-web-store` environment, authenticates through GCP workload identity federation (no stored credential), uploads `pnpm package`'s zip, waits for processing and submits it for review.

Repository variables (`vars`, not secrets): `CWS_EXTENSION_ID`, `CWS_PUBLISHER_ID`, `GCP_PROJECT_ID`, `GCP_SERVICE_ACCOUNT`, `GCP_WORKLOAD_IDENTITY_PROVIDER`. The GCP values are shared with the other extensions on the account.

Before the first CI release:

- The item has to exist, so the first version is uploaded by hand in the Developer Dashboard. That gives `CWS_EXTENSION_ID`.
- This repository has to be added to the workload identity provider's attribute condition and get a `workloadIdentityUser` binding on the service account, or the "Authenticate to Google Cloud" step fails.

The provider only trusts tag refs, so the workflow has no `workflow_dispatch`. Retry a failed publish by re-running the release-triggered run.

The workflow never touches the listing. The description, screenshots (`assets/store/`), promo tile and privacy answers are pasted into the dashboard by hand.

## addons.mozilla.org

`.github/workflows/publish-amo.yml` runs in the `addons-mozilla-org` environment with the secrets `MOZILLA_ADDON_JWT_ISSUER` and `MOZILLA_ADDON_JWT_SECRET` (account-scoped). It builds and lints the Firefox package, then `scripts/publish-amo.mjs` uploads it, waits for validation, and `PUT`s the version with `amo/listing.json`, `assets/store/description.txt` and the reviewer notes from `amo/reviewer-notes.md`. The first release creates the add-on and claims `higgsfield-notifier@shbernal.github.io` for good.

The package is unbundled, so no source archive is attached. A listed version waits for human review: the workflow succeeds on "awaiting review".

After the version, the script brings the listing icon (`extension/icon128.png`) and screenshots (`amo/previews.json`) in line with the repository. AMO allows 3 writes a minute, 10 an hour and 24 a day per account, shared with every extension on it, and a request it rejects still counts. So the script paces itself, and `amo/previews.lock.json` records what was uploaded and what AMO called it, so only the difference is sent. A release costs one call plus whatever changed. Work that does not fit the hour, in practice a full replace because the lock is empty or stale, is deferred with the command that finishes it: `pnpm publish:amo --assets-only --sync-previews`.

The lock a CI run writes is thrown away with the runner. That is why screenshot changes go out ahead of the tag with a local `--assets-only` run and a committed lock. The first release starts with an empty lock and four screenshots, which is nine calls on top of the version and the icon, so it will defer; run the command it prints and commit the lock.

`pnpm publish:amo --help` lists the other flags: `--check` verifies the credentials, `--validate-only` puts a package through AMO's validator without submitting anything.

## Local credentials

`.env` (git-ignored, loaded by direnv through `.envrc`) uses the names in `.env.example`, shared with the other extensions on the account. Only the Mozilla pair is read here, by `scripts/publish-amo.mjs`.
