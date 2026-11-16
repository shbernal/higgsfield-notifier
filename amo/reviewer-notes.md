# Reviewer Notes

The package is the `extension/` directory as committed, with only `manifest.json` rewritten for Firefox by `scripts/build-firefox.mjs`. Nothing is bundled, minified or transpiled, so AMO needs no source archive.

## Notes To Reviewer

`scripts/publish-amo.mjs` sends the quoted block below as the version's "Notes to Reviewer". That field is plain text, so the block carries no Markdown.

> The package is unbundled, unminified source: every file is as written in the public repository, https://github.com/shbernal/higgsfield-notifier, under extension/. Only manifest.json differs from the Chromium build, in background.scripts and browser_specific_settings.
>
> The content script runs on higgsfield.ai only. It watches the result tiles for status changes and asks the background script to show a notification. It never clicks, types or submits anything on the page.
>
> stream.js runs in the page's MAIN world on higgsfield.ai only. It listens to the same job-status event stream the Higgsfield site itself uses (fnf-api-gw.higgsfield.ai), authenticated with the signed-in user's own Clerk session token from window.Clerk, so a generation that finishes while the user is on another Higgsfield page is still reported. When a job finishes it reads that one job from the same API to learn whether it is an image, video or audio. The token never leaves the page and nothing is written to Higgsfield.
>
> Phone alerts are off by default. When the user turns them on, the popup requests the optional browsingActivity and websiteContent data collection permissions, and only once they are granted does the background script POST each alert (title, status text and the higgsfield.ai page link) to the ntfy server the user configured, https://ntfy.sh by default. Nothing else is sent anywhere.
>
> To test without an account on higgsfield.ai: open the popup and use "Send a test notification", and under Phone alerts, "Send a test to my phone" with any topic name, which can be watched at https://ntfy.sh/<topic>.
