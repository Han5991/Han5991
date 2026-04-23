import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

const username = process.env.GITHUB_USERNAME || 'Han5991';
const prStatusCache = new Map();
const SEARCH_PER_PAGE = Number(process.env.CONTRIB_SEARCH_PER_PAGE || 50);
const MAX_SEARCH_PAGES = Number(process.env.CONTRIB_MAX_PAGES || 5);
const VISIBLE_CONTRIBUTIONS_PER_REPO = Number(process.env.CONTRIB_VISIBLE_LIMIT || 5);
const DEFAULT_MERGED_LOOKBACK_DAYS = 7;

function getRepoParts(repoFullName) {
  const [owner, repo] = repoFullName.split('/');
  return { owner, repo };
}

function getPrCacheKey(owner, repo, pullNumber) {
  return `${owner}/${repo}#${pullNumber}`;
}

async function fetchPullRequestStatus(owner, repo, pullNumber, fallbackState = 'open') {
  const cacheKey = getPrCacheKey(owner, repo, pullNumber);
  if (prStatusCache.has(cacheKey)) {
    return prStatusCache.get(cacheKey);
  }

  try {
    const { data } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber
    });

    const status = {
      state: data.state,
      merged: data.merged || data.merged_at !== null,
      mergedAt: data.merged_at,
      updatedAt: data.updated_at
    };

    prStatusCache.set(cacheKey, status);
    return status;
  } catch (error) {
    console.log(`Unable to fetch PR #${pullNumber} for ${owner}/${repo}: ${error.message}`);
    const fallback = {
      state: fallbackState,
      merged: false,
      mergedAt: null,
      updatedAt: null
    };
    prStatusCache.set(cacheKey, fallback);
    return fallback;
  }
}

// 블랙리스트 로드
function loadBlacklist() {
  try {
    const blacklistPath = path.join(process.cwd(), 'config', 'blacklist.json');
    const blacklistData = fs.readFileSync(blacklistPath, 'utf8');
    const blacklist = JSON.parse(blacklistData);

    console.log(`Loaded blacklist: ${blacklist.organizations?.length || 0} orgs, ${blacklist.repositories?.length || 0} repos`);
    return blacklist;
  } catch (error) {
    console.log('No blacklist found or error loading, using empty blacklist');
    return { organizations: [], repositories: [] };
  }
}

// 마지막 업데이트 시간 로드
function loadLastUpdate() {
  try {
    const lastUpdatePath = path.join(process.cwd(), 'config', 'last-update.json');
    const lastUpdateData = fs.readFileSync(lastUpdatePath, 'utf8');
    const { lastUpdate } = JSON.parse(lastUpdateData);
    
    const lastUpdateDate = new Date(lastUpdate);
    console.log(`Last update: ${lastUpdateDate.toISOString()}`);
    return lastUpdateDate;
  } catch (error) {
    console.log('No last update found, using 30 days ago as baseline');
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return thirtyDaysAgo;
  }
}

function getFetchStartDate() {
  const overrideSince = process.env.CONTRIB_SINCE;
  if (overrideSince) {
    const overrideDate = new Date(overrideSince);
    if (!isNaN(overrideDate)) {
      console.log(`Using override start date from CONTRIB_SINCE: ${overrideDate.toISOString()}`);
      return overrideDate;
    }
    
    console.warn(`Invalid CONTRIB_SINCE value "${overrideSince}", falling back to last update`);
  }

  const lastUpdate = loadLastUpdate();
  const lookbackDays = getMergedLookbackDays();
  const fetchStartDate = new Date(lastUpdate);
  fetchStartDate.setDate(fetchStartDate.getDate() - lookbackDays);

  console.log(`Using merged search lookback of ${lookbackDays} day(s): ${fetchStartDate.toISOString()}`);
  return fetchStartDate;
}

function getMergedLookbackDays() {
  const rawValue = process.env.CONTRIB_MERGED_LOOKBACK_DAYS;
  if (!rawValue) {
    return DEFAULT_MERGED_LOOKBACK_DAYS;
  }

  const parsedValue = Number(rawValue);
  if (Number.isFinite(parsedValue) && parsedValue >= 0) {
    return parsedValue;
  }
  
  console.warn(`Invalid CONTRIB_MERGED_LOOKBACK_DAYS value "${rawValue}", using ${DEFAULT_MERGED_LOOKBACK_DAYS}`);
  return DEFAULT_MERGED_LOOKBACK_DAYS;
}

// 마지막 업데이트 시간 저장
function saveLastUpdate() {
  try {
    const lastUpdatePath = path.join(process.cwd(), 'config', 'last-update.json');
    const lastUpdateData = {
      lastUpdate: new Date().toISOString(),
      description: "Last update timestamp for incremental contribution fetching"
    };
    
    fs.writeFileSync(lastUpdatePath, `${JSON.stringify(lastUpdateData, null, 2)}\n`);
    console.log(`Updated last update timestamp: ${lastUpdateData.lastUpdate}`);
  } catch (error) {
    console.error('Error saving last update timestamp:', error);
  }
}

// 기여가 블랙리스트에 있는지 확인
function isBlacklisted(repoFullName, blacklist) {
  const [owner, repo] = repoFullName.split('/');
  
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

async function fetchContributions() {
  try {
    const blacklist = loadBlacklist();
    const lastUpdate = getFetchStartDate();
    const contributions = [];
    const sinceDate = lastUpdate.toISOString().split('T')[0];
    const searchQuery = `author:${username} is:pr is:merged merged:>=${sinceDate}`;
    let page = 1;
    let processed = 0;
    
    console.log(`Fetching merged contributions since: ${lastUpdate.toISOString()}`);
    
    while (page <= MAX_SEARCH_PAGES) {
      try {
        const searchResults = await octokit.rest.search.issuesAndPullRequests({
          q: searchQuery,
          sort: 'updated',
          order: 'desc',
          per_page: SEARCH_PER_PAGE,
          page
        });
        
        const items = searchResults.data.items || [];
        if (!items.length) {
          break;
        }
        
        console.log(`Page ${page}: processing ${items.length} PRs from GitHub API`);
        
        for (const item of items) {
          const repo = item.repository_url.replace('https://api.github.com/repos/', '');
          const isOwn = repo.startsWith(`${username}/`);

          if (isOwn || isBlacklisted(repo, blacklist) || !item.pull_request) {
            continue;
          }

          const prNumberMatch = item.html_url.match(/\/pull\/(\d+)/);
          const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : null;
          let prState = item.state;
          let prMerged = false;

          if (!prNumber) {
            console.log(`Unable to parse PR number from ${item.html_url}`);
            continue;
          }

          const { owner, repo: repoName } = getRepoParts(repo);
          const status = await fetchPullRequestStatus(owner, repoName, prNumber, item.state);
          prState = status.state;
          prMerged = status.merged;
          
          if (!prMerged) {
            continue;
          }
          
          contributions.push({
            repository: repo,
            type: 'Pull Request',
            title: item.title,
            url: item.html_url,
            date: new Date(item.created_at).toISOString().split('T')[0],
            state: prState,
            merged: prMerged
          });
        }
        
        processed += items.length;
        if (items.length < SEARCH_PER_PAGE) {
          break;
        }
        
        page += 1;
      } catch (apiError) {
        console.log('GitHub API error while fetching contributions:', apiError.message);
        break;
      }
    }

    contributions.sort((a, b) => new Date(b.date) - new Date(a.date));

    console.log(`Found ${contributions.length} new external contributions across ${Math.min(page, MAX_SEARCH_PAGES)} page(s)`);
    return contributions;
    
  } catch (error) {
    console.error('Error fetching contributions:', error);
    return [];
  }
}

// 기존 기여 데이터 파싱
function parseExistingContributions(readme) {
  const contributions = [];
  const blacklist = loadBlacklist();
  const contributionSectionRegex = /## 🚀 Open Source Contributions[\s\S]*?(?=\n---\n\n<div align="center">|\n$)/;
  const match = readme.match(contributionSectionRegex);
  
  if (match) {
    const section = match[0];
    // 각 레포지토리 섹션에서 기여 파싱
    const repoSections = section.split(/### \[([^\]]+)\]/);
    
    for (let i = 1; i < repoSections.length; i += 2) {
      const repoName = repoSections[i];
      const repoContent = repoSections[i + 1];

      // 블랙리스트에 있는 레포지토리는 건너뛰기
      if (isBlacklisted(repoName, blacklist)) {
        console.log(`Skipping blacklisted repository: ${repoName}`);
        continue;
      }
      
      // PR만 파싱 (이슈는 제외)
      const contribRegex = /^- (🔄|✅|❌) \*\*Pull Request\*\*: \[(.*)\]\((https:\/\/github\.com\/[^)]+\/pull\/\d+)\) \*\(([^)]+)\)\*$/;
      
      for (const line of repoContent.split('\n')) {
        const parts = line.match(contribRegex);
        if (parts) {
          const [, emoji, title, url, date] = parts;

          // 상태와 merged 정보 추론
          let state = 'open';
          let merged = false;

          if (emoji === '✅') { state = 'closed'; merged = true; }
          else if (emoji === '❌') { state = 'closed'; merged = false; }
          else { state = 'open'; merged = false; }

          contributions.push({
            repository: repoName,
            type: 'Pull Request',
            title,
            url,
            date,
            state,
            merged
          });
        }
      }
    }
  }
  
  console.log(`Parsed ${contributions.length} existing contributions from README (after blacklist filter)`);
  return contributions;
}

// 오픈 PR들의 현재 상태 업데이트
async function updateOpenPRStatus(existingContributions) {
  const updatedContributions = [];
  
  for (const contrib of existingContributions) {
    if (contrib.type === 'Pull Request' && (contrib.state === 'open' || !contrib.merged)) {
      try {
        console.log(`Checking status of PR: ${contrib.title}`);
        
        const urlMatch = contrib.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
        if (urlMatch) {
          const [, owner, repo, prNumber] = urlMatch;
          const status = await fetchPullRequestStatus(owner, repo, parseInt(prNumber), contrib.state);
          
          const updatedContrib = {
            ...contrib,
            state: status.state,
            merged: status.merged
          };
          
          if (updatedContrib.state !== contrib.state || updatedContrib.merged !== contrib.merged) {
            console.log(`Status updated for ${contrib.title}: ${contrib.state} -> ${updatedContrib.state}, merged: ${updatedContrib.merged}`);
          }
          
          updatedContributions.push(updatedContrib);
        } else {
          updatedContributions.push(contrib);
        }
      } catch (error) {
        console.log(`Error checking PR status for ${contrib.title}:`, error.message);
        updatedContributions.push(contrib);
      }
    } else {
      updatedContributions.push(contrib);
    }
  }
  
  return updatedContributions;
}

async function updateReadme(newContributions) {
  try {
    let readme = fs.readFileSync('README.md', 'utf8');

    // 기존 기여 데이터 파싱
    const existingContributions = parseExistingContributions(readme);

    // 오픈 PR들의 상태 업데이트
    const updatedExistingContributions = await updateOpenPRStatus(existingContributions);
    const mergedExistingContributions = updatedExistingContributions.filter(contrib => contrib.merged);
    const mergedNewContributions = newContributions.filter(contrib => contrib.merged);

    console.log(`Keeping ${mergedExistingContributions.length} merged existing contributions`);

    // 기존 + 새로운 기여 병합 (중복 제거)
    const allContributions = [...mergedExistingContributions];
    const existingKeys = new Set(mergedExistingContributions.map(c => `${c.repository}-${c.url}`));
    
    for (const newContrib of mergedNewContributions) {
      const key = `${newContrib.repository}-${newContrib.url}`;
      if (!existingKeys.has(key)) {
        allContributions.push(newContrib);
        console.log(`Added new contribution: ${newContrib.repository} - ${newContrib.title}`);
      }
    }
    
    console.log(`Total merged contributions: ${allContributions.length} (${mergedExistingContributions.length} existing + ${mergedNewContributions.length} new)`);
    
    // 중복 제거 (URL 기준)
    const uniqueContributions = [];
    const seenUrls = new Set();
    
    for (const contrib of allContributions) {
      if (!seenUrls.has(contrib.url)) {
        seenUrls.add(contrib.url);
        uniqueContributions.push(contrib);
      }
    }
    
    console.log(`After deduplication: ${uniqueContributions.length} unique contributions`);
    
    // 레포지토리별로 그룹핑
    const groupedContributions = {};
    for (const contrib of uniqueContributions) {
      if (!groupedContributions[contrib.repository]) {
        groupedContributions[contrib.repository] = [];
      }
      groupedContributions[contrib.repository].push(contrib);
    }
    
    // 레포지토리별 기여 수로 정렬
    const sortedRepos = Object.keys(groupedContributions)
      .sort((a, b) => groupedContributions[b].length - groupedContributions[a].length);
    
    // 통계 계산 (merged PR만 카운트)
    const totalContributions = uniqueContributions.length;
    const totalRepos = sortedRepos.length;
    
    // 기여 섹션 생성
    let contributionSection = `## 🚀 Open Source Contributions\n\n`;
    contributionSection += `📊 **${totalContributions} merged pull requests** across **${totalRepos} repositories**\n\n`;
    
    for (const repo of sortedRepos) {
      const repoContribs = groupedContributions[repo];
      const repoLink = `[${repo}](https://github.com/${repo})`;
      
      contributionSection += `### ${repoLink}\n`;
      contributionSection += `**${repoContribs.length} merged pull request${repoContribs.length > 1 ? 's' : ''}**\n\n`;
      
      // 각 기여를 날짜순으로 정렬 (최신순)
      repoContribs.sort((a, b) => new Date(b.date) - new Date(a.date));

      const formatContributionLine = (contrib) => {
        const titleLink = `[${contrib.title}](${contrib.url})`;
        return `- ✅ **${contrib.type}**: ${titleLink} *(${contrib.date})*`;
      };

      const visibleContributions = repoContribs.slice(0, VISIBLE_CONTRIBUTIONS_PER_REPO);
      const hiddenContributions = repoContribs.slice(VISIBLE_CONTRIBUTIONS_PER_REPO);

      for (const contrib of visibleContributions) {
        contributionSection += `${formatContributionLine(contrib)}\n`;
      }

      if (hiddenContributions.length) {
        contributionSection += '<details>\n';
        contributionSection += `<summary>Show older contributions (${hiddenContributions.length} more)</summary>\n\n`;
        
        for (const contrib of hiddenContributions) {
          contributionSection += `${formatContributionLine(contrib)}\n`;
        }

        contributionSection += '</details>\n';
      }
      
      contributionSection += '\n';
    }
    
    contributionSection += '---\n\n';
    
    // README에서 기여 섹션 찾아서 교체
    const contributionSectionRegex = /## 🚀 Open Source Contributions[\s\S]*?(?=\n---\n\n<div align="center">|\n$)/;
    
    if (contributionSectionRegex.test(readme)) {
      readme = readme.replace(contributionSectionRegex, contributionSection);
    } else {
      // 기여 섹션이 없으면 추가
      readme = readme.replace('## Hi there 👋', `## Hi there 👋\n\n${contributionSection}`);
    }
    
    fs.writeFileSync('README.md', readme);
    console.log(`Updated README with ${uniqueContributions.length} merged contributions`);
    
  } catch (error) {
    console.error('Error updating README:', error);
  }
}

async function main() {
  const contributions = await fetchContributions();
  console.log(`Found ${contributions.length} new contributions`);
  
  await updateReadme(contributions);
  
  // 성공적으로 완료되면 마지막 업데이트 시간 저장
  saveLastUpdate();
}

main();
