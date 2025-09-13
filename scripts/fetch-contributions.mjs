import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

const username = process.env.GITHUB_USERNAME;

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

// 마지막 업데이트 시간 저장
function saveLastUpdate() {
  try {
    const lastUpdatePath = path.join(process.cwd(), 'config', 'last-update.json');
    const lastUpdateData = {
      lastUpdate: new Date().toISOString(),
      description: "Last update timestamp for incremental contribution fetching"
    };
    
    fs.writeFileSync(lastUpdatePath, JSON.stringify(lastUpdateData, null, 2));
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
    const lastUpdate = loadLastUpdate();
    const contributions = [];
    
    console.log(`Fetching new contributions since: ${lastUpdate.toISOString()}`);
    
    // GitHub API를 사용하여 최근 PR만 가져오기 (증분 업데이트)
    try {
      const sinceDate = lastUpdate.toISOString().split('T')[0];
      const searchQuery = `author:Han5991 type:pr created:>=${sinceDate}`;
      
      const searchResults = await octokit.rest.search.issuesAndPullRequests({
        q: searchQuery,
        sort: 'created',
        order: 'desc',
        per_page: 50
      });
      
      console.log(`Found ${searchResults.data.items.length} recent PRs from GitHub API`);
      
      for (const item of searchResults.data.items) {
        const repo = item.repository_url.replace('https://api.github.com/repos/', '');
        const isOwn = repo.startsWith('Han5991/');
        const prDate = new Date(item.created_at);
        
        // 본인 레포지토리 제외, 블랙리스트 확인, 마지막 업데이트 이후만
        if (!isOwn && !isBlacklisted(repo, blacklist) && prDate > lastUpdate && item.pull_request) {
          // Search API에서 제공하는 정보로 merged 상태 판단
          const isMerged = item.pull_request.merged_at !== null;
          
          contributions.push({
            repository: repo,
            type: 'Pull Request',
            title: item.title,
            url: item.html_url,
            date: new Date(item.created_at).toISOString().split('T')[0],
            state: item.state,
            merged: isMerged
          });
        }
      }
    } catch (apiError) {
      console.log('No new PRs found or GitHub API error:', apiError.message);
    }
    
    // 날짜순으로 정렬 (최신순)
    contributions.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    console.log(`Found ${contributions.length} new external contributions`);
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
      const contribMatches = repoContent.match(/- (🔄|✅|❌) \*\*Pull Request\*\*: \[([^\]]+)\]\(([^)]+)\) \*\(([^)]+)\)\*/g);
      
      if (contribMatches) {
        for (const contribMatch of contribMatches) {
          const parts = contribMatch.match(/- (🔄|✅|❌) \*\*Pull Request\*\*: \[([^\]]+)\]\(([^)]+)\) \*\(([^)]+)\)\*/);
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
  }
  
  console.log(`Parsed ${contributions.length} existing contributions from README (after blacklist filter)`);
  return contributions;
}

// 오픈 PR들의 현재 상태 업데이트
async function updateOpenPRStatus(existingContributions) {
  const updatedContributions = [];
  
  for (const contrib of existingContributions) {
    if (contrib.type === 'Pull Request' && contrib.state === 'open') {
      try {
        console.log(`Checking status of open PR: ${contrib.title}`);
        
        // URL에서 repository와 PR 번호 추출
        const urlMatch = contrib.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
        if (urlMatch) {
          const [, owner, repo, prNumber] = urlMatch;
          
          // 현재 PR 상태 확인
          const pr = await octokit.rest.pulls.get({
            owner,
            repo,
            pull_number: parseInt(prNumber)
          });
          
          // 상태 업데이트
          const updatedContrib = {
            ...contrib,
            state: pr.data.state,
            merged: pr.data.merged || pr.data.merged_at !== null
          };
          
          if (updatedContrib.state !== contrib.state || updatedContrib.merged !== contrib.merged) {
            console.log(`Status updated for ${contrib.title}: ${contrib.state} -> ${updatedContrib.state}, merged: ${updatedContrib.merged}`);
          }
          
          updatedContributions.push(updatedContrib);
        } else {
          // URL 파싱 실패시 기존 상태 유지
          updatedContributions.push(contrib);
        }
      } catch (error) {
        console.log(`Error checking PR status for ${contrib.title}:`, error.message);
        // 에러 발생시 기존 상태 유지
        updatedContributions.push(contrib);
      }
    } else {
      // 머지된 PR이나 이슈는 그대로 유지
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
    
    // 기존 + 새로운 기여 병합 (중복 제거)
    const allContributions = [...updatedExistingContributions];
    const existingKeys = new Set(updatedExistingContributions.map(c => `${c.repository}-${c.url}`));
    
    for (const newContrib of newContributions) {
      const key = `${newContrib.repository}-${newContrib.url}`;
      if (!existingKeys.has(key)) {
        allContributions.push(newContrib);
        console.log(`Added new contribution: ${newContrib.repository} - ${newContrib.title}`);
      }
    }
    
    console.log(`Total contributions: ${allContributions.length} (${existingContributions.length} existing + ${newContributions.length} new)`);
    
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
    
    // 통계 계산 (PR만 카운트)
    const totalContributions = uniqueContributions.length;
    const totalRepos = sortedRepos.length;
    const prCount = uniqueContributions.filter(c => c.type === 'Pull Request').length;
    const mergedCount = uniqueContributions.filter(c => c.merged).length;
    
    // 기여 섹션 생성
    let contributionSection = `## 🚀 Open Source Contributions\n\n`;
    contributionSection += `📊 **${totalContributions} contributions** across **${totalRepos} repositories**\n`;
    contributionSection += `🔀 ${prCount} Pull Requests • ✅ ${mergedCount} Merged\n\n`;
    
    for (const repo of sortedRepos) {
      const repoContribs = groupedContributions[repo];
      const repoLink = `[${repo}](https://github.com/${repo})`;
      
      contributionSection += `### ${repoLink}\n`;
      contributionSection += `**${repoContribs.length} contribution${repoContribs.length > 1 ? 's' : ''}**\n\n`;
      
      // 각 기여를 날짜순으로 정렬 (최신순)
      repoContribs.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      for (const contrib of repoContribs) {
        const titleLink = `[${contrib.title}](${contrib.url})`;
        
        // 상태 이모지 (PR만 처리)
        let statusEmoji = '🔄'; // open (기본값)
        
        if (contrib.type === 'Pull Request') {
          // PR의 경우: merged > closed > open 순으로 우선순위
          if (contrib.merged) statusEmoji = '✅'; // merged
          else if (contrib.state === 'closed') statusEmoji = '❌'; // closed but not merged  
          else statusEmoji = '🔄'; // open
        }
        
        contributionSection += `- ${statusEmoji} **${contrib.type}**: ${titleLink} *(${contrib.date})*\n`;
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
    console.log(`Updated README with ${allContributions.length} total contributions`);
    
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