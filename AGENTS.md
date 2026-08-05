# Repository Guidelines

## Project Structure & Module Organization
This repository powers the auto-generated README. Core automation code lives in `scripts/fetch-contributions.mjs` (dependency-free GitHub REST client via `fetch`, blacklist + incremental fetch). Runtime configuration sits in `config/`, where `blacklist.json` filters orgs/repos and `last-update.json` tracks incremental windows; keep both formatted JSON so GitHub Actions can diff cleanly. There is no build step and no bundle—CI runs the source file directly, so `scripts/fetch-contributions.mjs` is the single source of truth. The Node version is pinned in `.tool-versions` and consumed by both asdf/mise locally and `actions/setup-node` in CI. Presentation assets (README, CLAUDE) stay at the repo root.

## Build, Test, and Development Commands
- `npm run update-contributions`: Executes the script to refresh `README.md` using the current `GITHUB_TOKEN`/`GITHUB_USERNAME`. This is the same command CI runs.
- The project has zero runtime and dev dependencies; `npm install` is not required to run or ship changes.

## Coding Style & Naming Conventions
Code is ESM-first (see `"type": "module"`), so prefer `import`/`export` and top-level `await` patterns. Follow the existing 2-space indentation, trailing commas in multi-line literals, and single quotes for strings unless JSON requires double quotes. Use descriptive kebab-case for new shell scripts, and camelCase for JavaScript identifiers with verbs for async helpers (e.g., `loadBlacklist`). Keep configuration keys lowercase snake_case only when mirroring external APIs.

## Testing Guidelines
There is no traditional unit test harness; validation means running the script against the live API. Run `GITHUB_TOKEN=<scoped-token> GITHUB_USERNAME=<handle> npm run update-contributions` to ensure network calls succeed and inspect the resulting `README.md` diff. Because the run rewrites `README.md` and `config/last-update.json` in place, prefer copying `scripts/`, `config/`, and `README.md` into a temp directory and running there when you only want a smoke test. When changing filtering logic, temporarily point `config/blacklist.json` at lightweight repos and verify the README diff contains only expected entries. Avoid committing mutated config fixtures—document the scenario instead.

## Commit & Pull Request Guidelines
Git history favors concise, present-tense subjects (`Update README.md`, `🤖 Auto-update: ...`). Keep summaries under ~65 characters, optionally prefixing with a relevant emoji for automation. For PRs, include: purpose statement, summary of commands run, notable config changes, screenshots only if README formatting shifts. Link any tracked GitHub issues and call out secret handling when touching credentials or tokens.
