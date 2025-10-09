# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an automated GitHub profile repository that maintains a README.md with up-to-date open source contributions. The system uses the GitHub API to fetch pull requests and automatically updates the profile daily via GitHub Actions.

## Development Commands

### Build
```bash
npm run build              # Build with rollup and make executable
npm run build:local        # Run local build script (installs deps if needed)
```

### Run
```bash
npm run update-contributions   # Fetch contributions and update README
npm run test:bundle           # Test the bundled script
```

### Setup
```bash
npm install
npm run prepare           # Setup husky hooks
```

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
- `fetchContributions()`: Queries GitHub Search API for PRs created since last update
- `parseExistingContributions()`: Extracts contribution data from current README markdown
- `updateOpenPRStatus()`: Checks API for current status of open PRs
- `updateReadme()`: Merges existing + new contributions and regenerates markdown

### Build System

**Rollup configuration** (`rollup.config.js`):
- Bundles `scripts/fetch-contributions.mjs` → `dist/fetch-contributions.js`
- ES module format with shebang for direct execution
- Externalizes Node.js built-ins (fs, path, url)
- Includes @octokit dependencies in bundle

### Automation

**Git hooks** (`.husky/pre-commit`):
- Auto-builds bundle when source files change (scripts/, config/, rollup.config.js, package.json)
- Automatically adds dist/ to commit

**GitHub Actions** (`.github/workflows/update-contributions.yml`):
- Runs daily at midnight UTC (9 AM KST)
- Requires pre-built `dist/fetch-contributions.js` (fails if missing)
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
# Test the bundle locally with environment variables
GITHUB_TOKEN=$GITHUB_TOKEN GITHUB_USERNAME=Han5991 node dist/fetch-contributions.js
```

### Deployment Workflow
1. Modify source files in `scripts/` or configuration in `config/`
2. Pre-commit hook automatically rebuilds `dist/fetch-contributions.js`
3. Commit and push (dist/ is tracked in git)
4. GitHub Actions uses the committed bundle for daily updates

## Key Design Decisions

1. **Bundled deployment**: CI uses pre-built bundle (no npm install in production) for faster, more reliable runs
2. **Incremental updates**: Fetches only recent PRs to minimize API calls and processing time
3. **Stateful tracking**: Maintains open PR status across runs to show real-time merge/close events
4. **Regex parsing**: Extracts existing contributions from README to enable additive updates
5. **Blacklist system**: Allows filtering private/company repositories from public profile