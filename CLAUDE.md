# CLAUDE.md

Automated GitHub profile: `README.md` is regenerated daily from merged pull requests
fetched through the GitHub REST API.

## Commands

```bash
npm run update-contributions   # same command CI runs
```

**This rewrites `README.md` and `config/*.json` in place.** For a smoke test, copy
`scripts/`, `config/`, and `README.md` into a temp directory and run it there.

Requires `GITHUB_TOKEN` (Search API is rate limited to 30 req/min authenticated) and
optionally `GITHUB_USERNAME`.

## Constraints worth preserving

- **Zero dependencies, zero build steps.** The script uses Node's built-in `fetch`
  instead of an SDK, so CI needs no `npm install` and no bundle — the code that runs in
  CI is the code in the repo. Adding a dependency brings back an install step or a
  committed bundle, so weigh it against that.
- **The Node version lives in `package.json` under `devEngines.runtime`**, which CI reads
  via `actions/setup-node`'s `node-version-file`. Local version managers like asdf do not
  read that field, so a local run may sit on a different Node than CI — deliberate, since
  this is run in CI almost exclusively. `npm` warns about the mismatch (`onFail: "warn"`)
  without blocking anything.

## Layout

`scripts/fetch-contributions.mjs` is the whole program: it queries the Search API for
merged PRs since `config/last-update.json`, re-checks previously open PRs, merges with
contributions parsed back out of the existing README, and regenerates the section.

`config/blacklist.json` hides orgs/repos (company and private work) from the public
profile. `config/summary.json` is written for external consumers so they can read
`.mergedPRs` instead of scraping README badges.

## Conventions

Concise present-tense commit subjects under ~65 chars; the automation's own commits use
`🤖 Auto-update: Open source contributions`. Never add AI attribution trailers.
