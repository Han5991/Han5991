import { Octokit } from '@octokit/rest';
import fs from 'fs';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

const username = process.env.GITHUB_USERNAME;

async function fetchContributions() {
  try {
    console.log(`Fetching contributions for ${username}...`);
    
    const contributions = [];
    const seen = new Set();
    
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
        
        if (!isOwn && event.payload.action === 'opened') {
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
    
    // 2. Search API로 더 많은 PR 검색 (전체 히스토리)
    console.log('Searching for all PRs...');
    try {
      const searchQuery = `author:${username} type:pr`;
      const searchResults = await octokit.rest.search.issuesAndPullRequests({
        q: searchQuery,
        sort: 'created',
        order: 'desc',
        per_page: 100
      });
      
      for (const item of searchResults.data.items) {
        const repo = item.repository_url.replace('https://api.github.com/repos/', '');
        const isOwn = repo.startsWith(`${username}/`);
        
        if (!isOwn && item.pull_request) {
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
    
    // 2.1. Search API로 이슈도 검색 (버그 리포트, 기능 요청 등)
    console.log('Searching for issues...');
    try {
      const issueQuery = `author:${username} type:issue`;
      const issueResults = await octokit.rest.search.issuesAndPullRequests({
        q: issueQuery,
        sort: 'created',
        order: 'desc',
        per_page: 100
      });
      
      for (const item of issueResults.data.items) {
        const repo = item.repository_url.replace('https://api.github.com/repos/', '');
        const isOwn = repo.startsWith(`${username}/`);
        
        if (!isOwn && !item.pull_request) {
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
              
              if (!seen.has(key)) {
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

async function updateReadme(contributions) {
  try {
    let readme = fs.readFileSync('README.md', 'utf8');
    
    // 기여 테이블 생성
    let contributionTable = `## 🚀 Open Source Contributions

| Repository | Type | Title | Status | Date |
|------------|------|-------|--------|------|
`;
    
    for (const contrib of contributions) {
      const repoLink = `[${contrib.repository}](https://github.com/${contrib.repository})`;
      const titleLink = `[${contrib.title}](${contrib.url})`;
      
      // PR 상태 이모지
      let statusEmoji = '🔄'; // open
      if (contrib.merged) statusEmoji = '✅'; // merged
      else if (contrib.state === 'closed') statusEmoji = '❌'; // closed
      
      contributionTable += `| ${repoLink} | ${contrib.type} | ${titleLink} | ${statusEmoji} | ${contrib.date} |\n`;
    }
    
    contributionTable += '\n';
    
    // README에서 기여 섹션 찾아서 교체
    const contributionSectionRegex = /## 🚀 Open Source Contributions[\s\S]*?(?=\n## |\n---|\n<|\n$)/;
    
    if (contributionSectionRegex.test(readme)) {
      readme = readme.replace(contributionSectionRegex, contributionTable);
    } else {
      // 기여 섹션이 없으면 추가
      readme = readme.replace('## Hi there 👋', `## Hi there 👋\n\n${contributionTable}`);
    }
    
    fs.writeFileSync('README.md', readme);
    console.log(`Updated README with ${contributions.length} contributions`);
    
  } catch (error) {
    console.error('Error updating README:', error);
  }
}

async function main() {
  const contributions = await fetchContributions();
  console.log(`Found ${contributions.length} contributions`);
  
  await updateReadme(contributions);
}

main();