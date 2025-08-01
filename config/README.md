# Configuration

## Blacklist Configuration

`blacklist.json` 파일을 통해 특정 조직이나 레포지토리를 오픈소스 기여 목록에서 제외할 수 있습니다.

### 설정 방법

```json
{
  "organizations": [
    "company-name",
    "private-org"
  ],
  "repositories": [
    "owner/repo-name",
    "another-owner/another-repo"
  ]
}
```

### 예시

```json
{
  "organizations": [
    "fourhe",
    "YukiKoNeko", 
    "GaeChwiPpo"
  ],
  "repositories": [
    "example/private-repo"
  ]
}
```

### 필터링 규칙

- **Organizations**: 해당 조직의 모든 레포지토리가 제외됩니다
- **Repositories**: 특정 레포지토리만 제외됩니다
- 본인 소유 레포지토리는 자동으로 제외됩니다
- 개인 프로젝트나 회사 프로젝트를 숨기고 순수 오픈소스 기여만 표시할 때 유용합니다

### 적용

설정 변경 후 GitHub Actions가 자동으로 적용하거나, 수동으로 워크플로우를 실행하면 됩니다.