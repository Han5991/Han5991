# Repository Guidelines

## Project Structure & Module Organization
This repository powers the auto-generated README. Core automation code lives in `scripts/fetch-contributions.mjs` (Octokit client, blacklist + incremental fetch). Runtime configuration sits in `config/`, where `blacklist.json` filters orgs/repos and `last-update.json` tracks incremental windows; keep both formatted JSON so GitHub Actions can diff cleanly. Bundled artifacts land in `dist/fetch-contributions.js` via Rollup; never edit files under `dist/` directly. Presentation assets (README, CLAUDE) stay at the repo root. `rollup.config.js` defines module entry and output, so add new bundles there rather than in ad-hoc scripts.

## Build, Test, and Development Commands
- `npm run build`: Rollup-compiles `scripts/fetch-contributions.mjs` into `dist/fetch-contributions.js` and marks it executable; run whenever source or dependencies change.
- `npm run build:local`: Shell helper that installs dependencies on demand before delegating to the standard build—useful on fresh clones.
- `npm run update-contributions`: Executes the source script directly to refresh `README.md` using the current `GITHUB_TOKEN`/`GITHUB_USERNAME`.
- `npm run test:bundle`: Runs the compiled dist script; treat it as a smoke test before committing automation changes.

## Coding Style & Naming Conventions
Code is ESM-first (see `"type": "module"`), so prefer `import`/`export` and top-level `await` patterns. Follow the existing 2-space indentation, trailing commas in multi-line literals, and single quotes for strings unless JSON requires double quotes. Use descriptive kebab-case for new shell scripts, and camelCase for JavaScript identifiers with verbs for async helpers (e.g., `loadBlacklist`). Keep configuration keys lowercase snake_case only when mirroring external APIs.

## Testing Guidelines
There is no traditional unit test harness; validation means exercising both the source and bundled scripts. Run `GITHUB_TOKEN=<scoped-token> GITHUB_USERNAME=<handle> npm run update-contributions` to ensure network calls succeed, then `npm run test:bundle` to confirm the compiled output behaves identically. When changing filtering logic, temporarily point `config/blacklist.json` at lightweight repos and verify the README diff contains only expected entries. Avoid committing mutated config fixtures—document the scenario instead.

## Commit & Pull Request Guidelines
Git history favors concise, present-tense subjects (`Update README.md`, `🤖 Auto-update: ...`). Keep summaries under ~65 characters, optionally prefixing with a relevant emoji for automation. For PRs, include: purpose statement, summary of commands run (build/test), notable config changes, screenshots only if README formatting shifts. Link any tracked GitHub issues and call out secret handling when touching credentials or tokens.
