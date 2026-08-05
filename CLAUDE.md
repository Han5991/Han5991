# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an automated GitHub profile repository that maintains a README.md with up-to-date open source contributions. The system uses the GitHub API to fetch pull requests and automatically updates the profile daily via GitHub Actions.

## Development Commands

```bash
npm run update-contributions   # Fetch contributions and update README
```

There is no build step, no bundle, and no dependencies to install. The script has zero
runtime dependencies and runs directly on Node (version pinned in `.tool-versions`).

## Architecture

### Core Script: `scripts/fetch-contributions.mjs`

**Entry point**: `main()` function orchestrates the entire update process

**Key workflows**:
1. **Incremental fetching**: Uses `config/last-update.json` timestamp to fetch only recent PRs via GitHub Search API
2. **State management**: Tracks open PR status changes and updates merged/closed states
3. **Blacklist filtering**: Filters out organizations and repositories from `config/blacklist.json`
4. **Deduplication**: Parses existing README contributions and merges with new ones
5. **Grouping**: Groups contributions by repository and sorts by contribution count

**Important functions**:
- `githubRequest()`: Minimal GitHub REST client built on Node's global `fetch`; sets auth/version headers and throws on non-2xx
- `fetchContributions()`: Queries GitHub Search API for PRs created since last update
- `parseExistingContributions()`: Extracts contribution data from current README markdown
- `updateOpenPRStatus()`: Checks API for current status of open PRs
- `updateReadme()`: Merges existing + new contributions and regenerates markdown

### Automation

**GitHub Actions** (`.github/workflows/update-contributions.yml`):
- Runs daily at 9 AM KST
- Reads the Node version from `.tool-versions` via `actions/setup-node`'s `node-version-file`
- Runs `scripts/fetch-contributions.mjs` directly — no install, no build
- Uses repository GITHUB_TOKEN for API access
- Auto-commits README updates with message: "🤖 Auto-update: Open source contributions"

### Configuration Files

**`config/blacklist.json`**: Organizations and repositories to exclude from display
**`config/last-update.json`**: Timestamp for incremental API queries (auto-updated)

## Development Notes

### Environment Variables
- `GITHUB_TOKEN`: Required for API access (rate limits apply)
- `GITHUB_USERNAME`: Target username for contribution search

### API Rate Limits
- Search API limited to 30 requests/minute authenticated
- Script performs one search query per run plus individual PR status checks

### Contribution States
- 🔄 Open PR
- ✅ Merged PR
- ❌ Closed (not merged) PR

### Local Testing
```bash
# Run locally with environment variables
GITHUB_TOKEN=$GITHUB_TOKEN GITHUB_USERNAME=Han5991 node scripts/fetch-contributions.mjs
```

Note that this rewrites `README.md` and `config/last-update.json` in place. To test without
touching the working tree, copy `scripts/`, `config/`, and `README.md` to a temp directory and
run it there.

### Deployment Workflow
1. Modify source files in `scripts/` or configuration in `config/`
2. Commit and push
3. GitHub Actions runs the source file directly on the next scheduled run

## Key Design Decisions

1. **Zero dependencies**: The script uses Node's built-in `fetch` instead of an SDK, so CI needs no `npm install` and no bundle — the code that runs in CI is the code in the repo
2. **Incremental updates**: Fetches only recent PRs to minimize API calls and processing time
3. **Stateful tracking**: Maintains open PR status across runs to show real-time merge/close events
4. **Regex parsing**: Extracts existing contributions from README to enable additive updates
5. **Blacklist system**: Allows filtering private/company repositories from public profile