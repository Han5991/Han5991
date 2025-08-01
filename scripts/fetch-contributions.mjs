import { Octokit } from '@octokit/rest';
import fs from 'fs';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

const username = process.env.GITHUB_USERNAME;

async function fetchContributions() {
  try {
    console.log(`Fetching contributions for ${username}...`);
    
    // 최근 100개 이벤트 가져오기
    const events = await octokit.rest.activity.listEventsForAuthenticatedUser({
      username,
      per_page: 100
    });
    
    // PR만 필터링 (오픈소스 기여만)
    const contributions = [];
    const seen = new Set();
    
    for (const event of events.data) {
      // PR 이벤트만 처리
      if (event.type === 'PullRequestEvent') {
        const repo = event.repo.name;
        const isOwn = repo.startsWith(`${username}/`);
        
        // 자신의 레포지토리가 아닌 경우만 (오픈소스 기여)
        // 그리고 PR이 opened된 경우만
        if (!isOwn && event.payload.action === 'opened') {
          const key = `${repo}-${event.payload.number}`;
          
          if (!seen.has(key)) {
            seen.add(key);
            
            const pr = event.payload.pull_request;
            const contribution = {
              repository: repo,
              type: 'Pull Request',
              title: pr.title,
              url: pr.html_url,
              date: new Date(event.created_at).toISOString().split('T')[0],
              state: pr.state, // open, closed, merged
              merged: pr.merged
            };
            
            contributions.push(contribution);
          }
        }
      }
    }
    
    // 날짜순으로 정렬 (최신순)
    contributions.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    return contributions.slice(0, 10); // 최근 10개만
    
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