import type { PullRequest, ProviderConfig, Repository } from '@worktree/contracts'

export async function lookupPullRequest(
  branch: string,
  repository: Repository,
  globalTokens?: { github?: string; azure?: string }
): Promise<PullRequest | undefined> {
  const provider = repository.provider
  if (!provider) return undefined

  const token =
    provider.personalAccessToken ||
    (provider.type === 'github' ? globalTokens?.github : globalTokens?.azure)

  if (!token) return undefined

  // Azure AAD tokens from `az account get-access-token` are JWTs and need Bearer auth.
  const isJwt = token.includes('.')

  const withToken: ProviderConfig = { ...provider, personalAccessToken: token }

  if (withToken.type === 'github') {
    return lookupGitHubPullRequest(branch, withToken)
  }

  if (withToken.type === 'azure') {
    return lookupAzureDevOpsPullRequest(branch, withToken, isJwt)
  }

  return undefined
}

async function lookupGitHubPullRequest(
  branch: string,
  provider: ProviderConfig
): Promise<PullRequest | undefined> {
  const { organization, repository, personalAccessToken } = provider
  let owner = organization
  let repo = repository
  if (repository.includes('/')) {
    const [o, r] = repository.split('/')
    if (o) owner = o
    if (r) repo = r
  }
  if (!owner || !repo || !personalAccessToken) return undefined

  const url = `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&head=${owner}:${encodeURIComponent(branch)}&sort=updated&direction=desc`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${personalAccessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  if (!response.ok) return undefined
  const data = (await response.json()) as Array<{
    number: number
    title: string
    html_url: string
    state: string
    draft?: boolean
    merged?: boolean
  }>

  const pr = data[0]
  if (!pr) return undefined

  let state: PullRequest['state'] = pr.draft ? 'draft' : pr.state === 'open' ? 'open' : 'closed'
  if (pr.state === 'closed' && pr.merged) state = 'merged'

  return {
    id: `gh-${pr.number}`,
    title: pr.title,
    url: pr.html_url,
    state,
    branch,
  }
}

async function lookupAzureDevOpsPullRequest(
  branch: string,
  provider: ProviderConfig,
  isJwt = false
): Promise<PullRequest | undefined> {
  const { organization, project, repository, personalAccessToken } = provider
  if (!organization || !project || !repository || !personalAccessToken) return undefined

  const encodedProject = encodeURIComponent(project)
  const encodedRepo = encodeURIComponent(repository)
  const url = `https://dev.azure.com/${organization}/${encodedProject}/_apis/git/repositories/${encodedRepo}/pullrequests?searchCriteria.sourceRefName=refs/heads/${encodeURIComponent(branch)}&searchCriteria.status=all&api-version=7.1-preview.1`

  const bearerHeader = `Bearer ${personalAccessToken}`
  const basicHeader = `Basic ${Buffer.from(`:${personalAccessToken}`).toString('base64')}`
  const authHeaders = isJwt ? [bearerHeader, basicHeader] : [basicHeader, bearerHeader]

  for (const authHeader of authHeaders) {
    const response = await fetch(url, {
      redirect: 'manual',
      headers: {
        Accept: 'application/json',
        Authorization: authHeader,
      },
    })

    if (!response.ok) continue
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('application/json')) continue

    const data = (await response.json()) as {
      value?: Array<{
        pullRequestId: number
        title: string
        url: string
        status: string
        creationDate?: string
        isDraft?: boolean
      }>
    }
    const pr = data.value
      ?.slice()
      .sort((a, b) => +(b.creationDate ?? 0) - +(a.creationDate ?? 0))[0]
    if (!pr) return undefined

    let state: PullRequest['state'] = pr.isDraft ? 'draft' : 'open'
    if (pr.status === 'completed') state = 'merged'
    else if (pr.status === 'abandoned') state = 'closed'
    // Azure API returns api url; build a web URL when possible
    const webUrl =
      pr.url && pr.url.includes('_apis')
        ? `https://dev.azure.com/${organization}/${encodedProject}/_git/${encodedRepo}/pullrequest/${pr.pullRequestId}`
        : pr.url

    return {
      id: `ado-${pr.pullRequestId}`,
      title: pr.title,
      url: webUrl,
      state,
      branch,
    }
  }

  return undefined
}
