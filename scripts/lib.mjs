import fs from 'node:fs';
import path from 'node:path';

const GITHUB_API_BASE = 'https://api.github.com';

export const username = process.env.GITHUB_USERNAME || 'Han5991';

export async function githubRequest(pathname, searchParams = {}) {
  const url = new URL(pathname, GITHUB_API_BASE);
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, String(value));
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': `${username}-profile-updater`
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} ${response.statusText} on ${url.pathname}: ${body.slice(0, 200)}`);
  }

  return response.json();
}

export function configPath(fileName) {
  return path.join(process.cwd(), 'config', fileName);
}

// 블랙리스트 로드
export function loadBlacklist() {
  try {
    const blacklistData = fs.readFileSync(configPath('blacklist.json'), 'utf8');
    const blacklist = JSON.parse(blacklistData);

    console.log(`Loaded blacklist: ${blacklist.organizations?.length || 0} orgs, ${blacklist.repositories?.length || 0} repos`);
    return blacklist;
  } catch (error) {
    console.log('No blacklist found or error loading, using empty blacklist');
    return { organizations: [], repositories: [] };
  }
}

// 기여가 블랙리스트에 있는지 확인
export function isBlacklisted(repoFullName, blacklist) {
  const [owner] = repoFullName.split('/');

  // 조직 블랙리스트 확인
  if (blacklist.organizations && blacklist.organizations.includes(owner)) {
    return true;
  }

  // 특정 레포지토리 블랙리스트 확인
  if (blacklist.repositories && blacklist.repositories.includes(repoFullName)) {
    return true;
  }

  return false;
}

// PR이 실제로 랜딩됐는지 확인.
// nodejs의 `git node land`는 커밋을 base 브랜치에 리베이스해서 올리므로 head SHA가
// 남지 않아 API가 merged=false를 돌려준다. 대신 랜딩 커밋에 `PR-URL:` 트레일러가 붙는다.
// 트레일러를 줄 끝까지 정확히 맞춰야 /pull/6378 이 /pull/63780 에 걸리지 않는다.
export async function findLandingCommit(repoFullName, pullRequestUrl) {
  const trailer = `PR-URL: ${pullRequestUrl}`;

  try {
    const results = await githubRequest('/search/commits', {
      q: `repo:${repoFullName} "${trailer}"`,
      per_page: 10
    });

    const match = (results.items || []).find(item => {
      const message = item.commit?.message || '';
      return message.includes(`${trailer}\n`) || message.endsWith(trailer);
    });

    return match ? match.sha : null;
  } catch (error) {
    console.log(`Commit search failed for ${pullRequestUrl}: ${error.message}`);
    return null;
  }
}
