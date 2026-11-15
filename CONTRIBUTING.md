# Contributing

Fully AI-generated issues and pull requests are welcome.

## Setup

```sh
pnpm install
```

- Chromium: load `extension/` unpacked from `chrome://extensions` with Developer mode on, and reload it after each change.
- Firefox: `pnpm dev:firefox` builds `dist-firefox/` and opens Firefox with it installed. Rerun it after each change.

## Checks

CI runs these on every pull request:

- `pnpm format` (`pnpm format:write` fixes it)
- `pnpm lint`
- `pnpm check:version`, which checks the four copies of the version agree
- `pnpm test`, the tests for the store publishing scripts
- `pnpm package` and `pnpm package:firefox`, which build the zips into `release/`
- `pnpm lint:firefox`, which runs `web-ext lint` on the Firefox build
- `pnpm publish:amo --dry-run`, which checks the AMO listing

Releasing to the stores is covered in [docs/releasing.md](docs/releasing.md).

## Commits and pull requests

- Commit messages carry no AI attribution: no `Co-authored-by:` trailer for a tool, no "Generated with" line.
- The pull request description carries an `AI disclosure:` line instead, naming the harness and model, or "written by hand".
