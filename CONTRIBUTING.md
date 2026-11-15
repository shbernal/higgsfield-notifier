# Contributing

Fully AI-generated issues and pull requests are welcome.

## Setup

```sh
pnpm install
```

Load `extension/` unpacked from `chrome://extensions` with Developer mode on, and reload it after each change.

## Checks

CI runs these on every pull request:

- `pnpm format` (`pnpm format:write` fixes it)
- `pnpm lint`
- `pnpm package`, which builds the zip into `release/`

## Commits and pull requests

- Commit messages carry no AI attribution: no `Co-authored-by:` trailer for a tool, no "Generated with" line.
- The pull request description carries an `AI disclosure:` line instead, naming the harness and model, or "written by hand".
