# Chrome Web Store Privacy Justifications

Paste-ready answers for the Developer Dashboard privacy form. Each answer below a heading goes into a plain-text field verbatim: no Markdown, one unwrapped line each.

Last reviewed against `extension/manifest.json` at version 1.5.0.

## Single Purpose

Notifies the user when a generation they started on higgsfield.ai finishes or fails, on the desktop and optionally on their phone through ntfy.

## Permission: `notifications`

Shows a system notification when a Higgsfield generation finishes or fails. This is the extension's single purpose.

## Permission: `storage`

Saves the user's settings in local extension storage: which media types and events to alert on, sound choices, the keep-alive switch, and the phone alert topic and server. Nothing else is stored.

## Host Permission: `https://higgsfield.ai/*` and `https://ntfy.sh/*`

The content script runs only on higgsfield.ai, where it watches the status of the user's own generation tiles and the job-status events Higgsfield's own API sends the signed-in user, so jobs that finish while another Higgsfield page is open are caught too. It never clicks, types or submits anything. ntfy.sh is the default server for the optional phone alerts: when the user turns them on, the background script posts each alert there so it reaches the ntfy app on the user's phone.

## Remote Code

No. All scripts are in the package.

## Data Usage Disclosures

Check "Web history" and "Website content" only. With phone alerts on, each alert sends the Higgsfield page URL and the generation status to the ntfy server the user chose. With them off, nothing leaves the device.

Confirm all three certifications:

- data is not sold or transferred to third parties, apart from the delivery the user configures;
- data is not used or transferred for purposes unrelated to the single purpose;
- data is not used or transferred to determine creditworthiness or for lending.
