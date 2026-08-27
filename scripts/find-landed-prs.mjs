import fs from 'node:fs';

import {
  configPath,
  findLandingCommit,
  githubRequest,
  isBlacklisted,
  loadBlacklist,
  username
} from './lib.mjs';

const SEARCH_PER_PAGE = 100;
const MAX_SEARCH_PAGES = Number(process.env.LANDED_MAX_PAGES || 5);
// 커밋 검색은 인증 상태에서도 분당 30회 제한이라 후보 사이에 간격을 둔다.
const COMMIT_SEARCH_DELAY_MS = Number(process.env.LANDED_SEARCH_DELAY_MS || 2500);
// 주 1회 실행에 14일 창이면 연속 실행이 7일씩 겹친다.
// 랜딩 직후에는 커밋 검색 인덱싱이 늦어 놓칠 수 있으므로 다음 실행이 재시도하게 둔다.
const DEFAULT_LOOKBACK_DAYS = 14;

const MANUAL_FILE = 'manual-contributions.json';
const DEFAULT_DESCRIPTION =
  'PRs that landed but GitHub does not report as merged, e.g. nodejs\' `git node land` rebases ' +
  'commits onto main and closes the PR, so the head SHA never appears in the base branch. ' +
  'Verify with `PR-URL: <url>` in the landing commit before adding an entry.';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// 검색 창은 PR을 연 날짜가 아니라 닫은 날짜 기준이다.
// 오래전에 연 PR이 오늘 랜딩되어도 창 안에 들어온다.
// 전체 이력을 다시 훑고 싶으면 LANDED_SINCE에 충분히 과거 날짜를 넣는다.
function getSearchStartDate() {
  const overrideSince = process.env.LANDED_SINCE;
  if (overrideSince) {
    const overrideDate = new Date(overrideSince);
    if (!isNaN(overrideDate)) {
      console.log(`Using override start date from LANDED_SINCE: ${overrideDate.toISOString()}`);
      return overrideDate;
    }

    console.warn(`Invalid LANDED_SINCE value "${overrideSince}", falling back to the default lookback`);
  }

  const rawLookback = process.env.LANDED_LOOKBACK_DAYS;
  const parsedLookback = Number(rawLookback);
  let lookbackDays = DEFAULT_LOOKBACK_DAYS;

  if (rawLookback) {
    if (Number.isFinite(parsedLookback) && parsedLookback >= 0) {
      lookbackDays = parsedLookback;
    } else {
      console.warn(`Invalid LANDED_LOOKBACK_DAYS value "${rawLookback}", using ${DEFAULT_LOOKBACK_DAYS}`);
    }
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);

  console.log(`Using closed lookback of ${lookbackDays} day(s): ${startDate.toISOString()}`);
  return startDate;
}

function loadManualContributions() {
  try {
    const manualData = fs.readFileSync(configPath(MANUAL_FILE), 'utf8');
    const parsed = JSON.parse(manualData);
    return {
      contributions: parsed.contributions || [],
      description: parsed.description || DEFAULT_DESCRIPTION
    };
  } catch (error) {
    console.log(`No ${MANUAL_FILE} found, starting a new one`);
    return { contributions: [], description: DEFAULT_DESCRIPTION };
  }
}

// 이미 프로필에 반영된 PR은 후보에서 제외한다.
// README에 있는 PR은 fetch-contributions.mjs가 merged로 보고 유지하므로 다시 등록할 필요가 없다.
function loadKnownUrls(manualContributions) {
  const known = new Set(manualContributions.map(contrib => contrib.url));

  try {
    const readme = fs.readFileSync('README.md', 'utf8');
    for (const match of readme.matchAll(/https:\/\/github\.com\/[^/\s)]+\/[^/\s)]+\/pull\/\d+/g)) {
      known.add(match[0]);
    }
  } catch (error) {
    console.log('Unable to read README.md, relying on manual contributions only');
  }

  return known;
}

async function fetchClosedUnmergedPRs(blacklist, knownUrls, sinceDate) {
  const candidates = [];
  const searchQuery = `author:${username} is:pr is:closed is:unmerged closed:>=${sinceDate}`;
  let page = 1;

  while (page <= MAX_SEARCH_PAGES) {
    const searchResults = await githubRequest('/search/issues', {
      q: searchQuery,
      sort: 'updated',
      order: 'desc',
      per_page: SEARCH_PER_PAGE,
      page
    });

    const items = searchResults.items || [];
    if (!items.length) {
      break;
    }

    for (const item of items) {
      const repository = item.repository_url.replace('https://api.github.com/repos/', '');

      if (repository.startsWith(`${username}/`) || isBlacklisted(repository, blacklist)) {
        continue;
      }

      if (knownUrls.has(item.html_url)) {
        continue;
      }

      candidates.push({
        repository,
        title: item.title,
        url: item.html_url,
        date: item.created_at.split('T')[0]
      });
    }

    if (items.length < SEARCH_PER_PAGE) {
      break;
    }

    page += 1;
  }

  return candidates;
}

function writeManualContributions(manual) {
  const contributions = [...manual.contributions]
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const payload = { contributions, description: manual.description };
  fs.writeFileSync(configPath(MANUAL_FILE), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${MANUAL_FILE} with ${contributions.length} entries`);
}

async function main() {
  const blacklist = loadBlacklist();
  const manual = loadManualContributions();
  const knownUrls = loadKnownUrls(manual.contributions);

  const startDate = getSearchStartDate();
  const sinceDate = startDate.toISOString().split('T')[0];

  const candidates = await fetchClosedUnmergedPRs(blacklist, knownUrls, sinceDate);
  console.log(`Checking ${candidates.length} PRs closed since ${sinceDate} for landing commits`);

  const landed = [];
  for (const [index, candidate] of candidates.entries()) {
    if (index > 0) {
      await delay(COMMIT_SEARCH_DELAY_MS);
    }

    const sha = await findLandingCommit(candidate.repository, candidate.url);
    if (!sha) {
      continue;
    }

    console.log(`Landed: ${candidate.url} as ${sha.slice(0, 11)} - ${candidate.title}`);
    landed.push({
      repository: candidate.repository,
      title: candidate.title,
      url: candidate.url,
      date: candidate.date,
      note: `landed as ${sha.slice(0, 11)}`
    });
  }

  if (!landed.length) {
    console.log('No newly landed PRs found');
    return;
  }

  manual.contributions.push(...landed);
  writeManualContributions(manual);
  console.log(`Added ${landed.length} landed PR${landed.length > 1 ? 's' : ''} to ${MANUAL_FILE}`);
}

main();
