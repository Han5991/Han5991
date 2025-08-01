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
    console.log(`Fetching contributions for ${username}...`);
    
    const blacklist = loadBlacklist();
    const lastUpdate = loadLastUpdate();
    const contributions = [];
    const seen = new Set();
    
    console.log(`Fetching contributions since: ${lastUpdate.toISOString()}`);
    
    // 1. 최근 이벤트에서 PR 가져오기 (최근 90일)
    console.log('Fetching recent events...');
    const events = await octokit.rest.activity.listEventsForAuthenticatedUser({
      username,
      per_page: 100
    });
    
    for (const event of events.data) {
      if (event.type === 'PullRequestEvent') {
        const repo = event.repo.name;
        const isOwn = repo.startsWith(`${username}/`);
        const eventDate = new Date(event.created_at);
        
        // 마지막 업데이트 이후의 이벤트만 처리
        if (!isOwn && event.payload.action === 'opened' && !isBlacklisted(repo, blacklist) && eventDate > lastUpdate) {
          const key = `${repo}-${event.payload.number}`;
          
          if (!seen.has(key)) {
            seen.add(key);
            
            const pr = event.payload.pull_request;
            contributions.push({
              repository: repo,
              type: 'Pull Request',
              title: pr.title,
              url: pr.html_url,
              date: new Date(event.created_at).toISOString().split('T')[0],
              state: pr.state,
              merged: pr.merged
            });
          }
        }
      }
    }
    
    // 2. Search API로 더 많은 PR 검색 (증분 업데이트)
    console.log('Searching for recent PRs...');
    try {
      const sinceDate = lastUpdate.toISOString().split('T')[0]; // YYYY-MM-DD 형식
      const searchQuery = `author:${username} type:pr created:>=${sinceDate}`;
      const searchResults = await octokit.rest.search.issuesAndPullRequests({
        q: searchQuery,
        sort: 'created',
        order: 'desc',
        per_page: 100
      });
      
      for (const item of searchResults.data.items) {
        const repo = item.repository_url.replace('https://api.github.com/repos/', '');
        const isOwn = repo.startsWith(`${username}/`);
        
        if (!isOwn && item.pull_request && !isBlacklisted(repo, blacklist)) {
          const key = `${repo}-${item.number}`;
          
          if (!seen.has(key)) {
            seen.add(key);
            
            contributions.push({
              repository: repo,
              type: 'Pull Request',
              title: item.title,
              url: item.html_url,
              date: new Date(item.created_at).toISOString().split('T')[0],
              state: item.state,
              merged: item.pull_request.merged_at ? true : false
            });
          }
        }
      }
    } catch (searchError) {
      console.log('Search API error (rate limited?):', searchError.message);
    }
    
    // 2.1. Search API로 이슈도 검색 (증분 업데이트)
    console.log('Searching for recent issues...');
    try {
      const sinceDate = lastUpdate.toISOString().split('T')[0]; // YYYY-MM-DD 형식
      const issueQuery = `author:${username} type:issue created:>=${sinceDate}`;
      const issueResults = await octokit.rest.search.issuesAndPullRequests({
        q: issueQuery,
        sort: 'created',
        order: 'desc',
        per_page: 100
      });
      
      for (const item of issueResults.data.items) {
        const repo = item.repository_url.replace('https://api.github.com/repos/', '');
        const isOwn = repo.startsWith(`${username}/`);
        
        if (!isOwn && !item.pull_request && !isBlacklisted(repo, blacklist)) {
          const key = `${repo}-issue-${item.number}`;
          
          if (!seen.has(key)) {
            seen.add(key);
            
            contributions.push({
              repository: repo,
              type: 'Issue',
              title: item.title,
              url: item.html_url,
              date: new Date(item.created_at).toISOString().split('T')[0],
              state: item.state,
              merged: false
            });
          }
        }
      }
    } catch (searchError) {
      console.log('Issue search error (rate limited?):', searchError.message);
    }
    
    // 3. 내 레포의 contributor 정보에서 외부 기여 찾기
    console.log('Checking contributions to repositories...');
    try {
      const repos = await octokit.rest.repos.listForAuthenticatedUser({
        per_page: 100,
        sort: 'updated'
      });
      
      // 포크된 레포들에서 원본 레포로의 기여 찾기
      for (const repo of repos.data) {
        if (repo.fork && repo.parent) {
          try {
            const prs = await octokit.rest.pulls.list({
              owner: repo.parent.owner.login,
              repo: repo.parent.name,
              creator: username,
              state: 'all',
              per_page: 50
            });
            
            for (const pr of prs.data) {
              const key = `${repo.parent.full_name}-${pr.number}`;
              
              if (!seen.has(key) && !isBlacklisted(repo.parent.full_name, blacklist)) {
                seen.add(key);
                
                contributions.push({
                  repository: repo.parent.full_name,
                  type: 'Pull Request',
                  title: pr.title,
                  url: pr.html_url,
                  date: new Date(pr.created_at).toISOString().split('T')[0],
                  state: pr.state,
                  merged: pr.merged_at ? true : false
                });
              }
            }
          } catch (prError) {
            // 권한 없거나 레포가 없는 경우 무시
          }
        }
      }
    } catch (repoError) {
      console.log('Repository search error:', repoError.message);
    }
    
    // 날짜순으로 정렬 (최신순)
    contributions.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    console.log(`Found ${contributions.length} total contributions`);
    return contributions.slice(0, 50); // 최근 50개
    
  } catch (error) {
    console.error('Error fetching contributions:', error);
    return [];
  }
}

// 기존 기여 데이터 파싱
function parseExistingContributions(readme) {
  const contributions = [];
  const contributionSectionRegex = /## 🚀 Open Source Contributions[\s\S]*?(?=\n---\n\n<div align="center">|\n$)/;
  const match = readme.match(contributionSectionRegex);
  
  if (match) {
    const section = match[0];
    // 각 레포지토리 섹션에서 기여 파싱
    const repoSections = section.split(/### \[([^\]]+)\]/);
    
    for (let i = 1; i < repoSections.length; i += 2) {
      const repoName = repoSections[i];
      const repoContent = repoSections[i + 1];
      
      // 각 기여 항목 파싱
      const contribMatches = repoContent.match(/- (🔄|✅|❌|🟢|🔴) \*\*([^*]+)\*\*: \[([^\]]+)\]\(([^)]+)\) \*\(([^)]+)\)\*/g);
      
      if (contribMatches) {
        for (const contribMatch of contribMatches) {
          const parts = contribMatch.match(/- (🔄|✅|❌|🟢|🔴) \*\*([^*]+)\*\*: \[([^\]]+)\]\(([^)]+)\) \*\(([^)]+)\)\*/);
          if (parts) {
            const [, emoji, type, title, url, date] = parts;
            
            // 상태와 merged 정보 추론
            let state = 'open';
            let merged = false;
            
            if (type === 'Pull Request') {
              if (emoji === '✅') { state = 'closed'; merged = true; }
              else if (emoji === '❌') { state = 'closed'; merged = false; }
              else { state = 'open'; merged = false; }
            } else if (type === 'Issue') {
              if (emoji === '🟢') { state = 'closed'; }
              else { state = 'open'; }
            }
            
            contributions.push({
              repository: repoName,
              type,
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
  
  console.log(`Parsed ${contributions.length} existing contributions from README`);
  return contributions;
}

async function updateReadme(newContributions) {
  try {
    let readme = fs.readFileSync('README.md', 'utf8');
    
    // 기존 기여 데이터 파싱
    const existingContributions = parseExistingContributions(readme);
    
    // 기존 + 새로운 기여 병합 (중복 제거)
    const allContributions = [...existingContributions];
    const existingKeys = new Set(existingContributions.map(c => `${c.repository}-${c.url}`));
    
    for (const newContrib of newContributions) {
      const key = `${newContrib.repository}-${newContrib.url}`;
      if (!existingKeys.has(key)) {
        allContributions.push(newContrib);
        console.log(`Added new contribution: ${newContrib.repository} - ${newContrib.title}`);
      }
    }
    
    console.log(`Total contributions: ${allContributions.length} (${existingContributions.length} existing + ${newContributions.length} new)`);
    
    // 레포지토리별로 그룹핑
    const groupedContributions = {};
    for (const contrib of allContributions) {
      if (!groupedContributions[contrib.repository]) {
        groupedContributions[contrib.repository] = [];
      }
      groupedContributions[contrib.repository].push(contrib);
    }
    
    // 레포지토리별 기여 수로 정렬
    const sortedRepos = Object.keys(groupedContributions)
      .sort((a, b) => groupedContributions[b].length - groupedContributions[a].length);
    
    // 통계 계산
    const totalContributions = allContributions.length;
    const totalRepos = sortedRepos.length;
    const prCount = allContributions.filter(c => c.type === 'Pull Request').length;
    const issueCount = allContributions.filter(c => c.type === 'Issue').length;
    const mergedCount = allContributions.filter(c => c.merged).length;
    
    // 기여 섹션 생성
    let contributionSection = `## 🚀 Open Source Contributions\n\n`;
    contributionSection += `📊 **${totalContributions} contributions** across **${totalRepos} repositories**\n`;
    contributionSection += `🔀 ${prCount} Pull Requests • 🐛 ${issueCount} Issues • ✅ ${mergedCount} Merged\n\n`;
    
    for (const repo of sortedRepos) {
      const repoContribs = groupedContributions[repo];
      const repoLink = `[${repo}](https://github.com/${repo})`;
      
      contributionSection += `### ${repoLink}\n`;
      contributionSection += `**${repoContribs.length} contribution${repoContribs.length > 1 ? 's' : ''}**\n\n`;
      
      // 각 기여를 날짜순으로 정렬 (최신순)
      repoContribs.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      for (const contrib of repoContribs) {
        const titleLink = `[${contrib.title}](${contrib.url})`;
        
        // 상태 이모지 (타입별로 다르게 처리)
        let statusEmoji = '🔄'; // open (기본값)
        
        if (contrib.type === 'Pull Request') {
          // PR의 경우: merged > closed > open 순으로 우선순위
          if (contrib.merged) statusEmoji = '✅'; // merged
          else if (contrib.state === 'closed') statusEmoji = '❌'; // closed but not merged  
          else statusEmoji = '🔄'; // open
        } else if (contrib.type === 'Issue') {
          // 이슈의 경우: closed는 해결됨으로 간주
          if (contrib.state === 'closed') statusEmoji = '🟢'; // closed (resolved)
          else statusEmoji = '🔴'; // open (needs attention)
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