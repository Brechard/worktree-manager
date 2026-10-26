import type { PullRequest, PullRequestLookup, Repository } from '@worktree/contracts'
import { createHash } from 'node:crypto'

const REQUEST_TIMEOUT_MS = 8000
const validSha = (value: string): boolean => /^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(value)
const validWebUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
const failure = (
  kind: NonNullable<PullRequestLookup['error']>['kind'],
  message: string,
  source: PullRequestLookup['credentialSource']
): PullRequestLookup => ({
  state: 'error',
  checkedAt: Date.now(),
  credentialSource: source,
  error: { kind, message },
})

function outcome(
  state: 'found' | 'none',
  source: PullRequestLookup['credentialSource'],
  pullRequest?: PullRequest
): PullRequestLookup {
  return {
    state,
    checkedAt: Date.now(),
    lastSuccessAt: Date.now(),
    credentialSource: source,
    ...(pullRequest ? { pullRequest } : {}),
  }
}

function responseFailure(
  response: Response,
  source: PullRequestLookup['credentialSource']
): PullRequestLookup {
  if (response.status === 401)
    return failure(
      'authentication',
      'Provider authentication failed. Check the effective credential.',
      source
    )
  if (response.status === 403)
    return failure('forbidden', 'Provider access was denied. Check repository permissions.', source)
  if (response.status === 429)
    return failure('rate-limited', 'Provider rate limit reached. Try again later.', source)
  return failure(
    response.status >= 500 ? 'network' : 'configuration',
    `Provider request failed (HTTP ${response.status}).`,
    source
  )
}

async function request(
  url: string,
  authorization: string,
  accept: string,
  source: PullRequestLookup['credentialSource']
): Promise<Response | PullRequestLookup> {
  try {
    return await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: accept, Authorization: authorization },
    })
  } catch (error) {
    return failure(
      'network',
      error instanceof Error && error.name === 'TimeoutError'
        ? 'Provider request timed out.'
        : 'Could not reach the provider.',
      source
    )
  }
}

function isLookup(value: Response | PullRequestLookup): value is PullRequestLookup {
  return !(value instanceof Response)
}

async function json(
  response: Response,
  source: PullRequestLookup['credentialSource']
): Promise<unknown | PullRequestLookup> {
  if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('json')) {
    return failure('invalid-response', 'Provider returned a non-JSON response.', source)
  }
  try {
    return await response.json()
  } catch {
    return failure('invalid-response', 'Provider returned malformed JSON.', source)
  }
}

function isError(value: unknown): value is PullRequestLookup {
  return (
    !!value &&
    typeof value === 'object' &&
    'state' in value &&
    (value as PullRequestLookup).state === 'error'
  )
}

const FAILURE_TTL_MS = 20_000
const failureCache = new Map<string, { result: PullRequestLookup; expiresAt: number }>()
const inFlight = new Map<string, Promise<PullRequestLookup>>()

export function clearProviderLookupCache(): void {
  failureCache.clear()
  inFlight.clear()
}

export async function lookupPullRequest(
  branch: string,
  repository: Repository,
  globalTokens?: { github?: string; azure?: string },
  credentialSource?: PullRequestLookup['credentialSource'],
  force = false
): Promise<PullRequestLookup> {
  const provider = repository.provider
  if (!provider) return { state: 'not-configured', checkedAt: Date.now(), credentialSource: 'none' }
  const local = provider.personalAccessToken
  const token = local || (provider.type === 'github' ? globalTokens?.github : globalTokens?.azure)
  const source = local ? 'project' : token ? (credentialSource ?? 'global') : 'none'
  if (!token) return failure('configuration', 'No provider credential is available.', source)
  const key = JSON.stringify([
    provider.type,
    provider.organization,
    provider.project,
    provider.repository,
    repository.baseBranch,
    branch,
    source,
    createHash('sha256').update(token).digest('hex'),
  ])
  if (!force) {
    const cached = failureCache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.result
  }
  const pending = inFlight.get(key)
  if (pending) return pending
  const lookup = (
    provider.type === 'github'
      ? lookupGitHub(branch, repository.baseBranch || 'main', repository, token, source)
      : lookupAzure(branch, repository.baseBranch || 'main', repository, token, source)
  )
    .then((result) => {
      if (result.state === 'error')
        failureCache.set(key, { result, expiresAt: Date.now() + FAILURE_TTL_MS })
      else failureCache.delete(key)
      return result
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, lookup)
  return lookup
}

async function lookupGitHub(
  branch: string,
  base: string,
  repository: Repository,
  token: string,
  source: PullRequestLookup['credentialSource']
): Promise<PullRequestLookup> {
  const provider = repository.provider!
  const parts = provider.repository.split('/')
  const owner = parts.length === 2 ? parts[0] : provider.organization
  const repo = parts.length === 2 ? parts[1] : provider.repository
  if (!owner || !repo)
    return failure('configuration', 'GitHub owner and repository are required.', source)
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&sort=updated&direction=desc`
  const response = await request(url, `Bearer ${token}`, 'application/vnd.github+json', source)
  if (isLookup(response)) return response
  if (!response.ok) return responseFailure(response, source)
  const data = await json(response, source)
  if (isError(data)) return data
  if (
    !Array.isArray(data) ||
    !data.every(
      (item) =>
        item &&
        typeof item.number === 'number' &&
        typeof item.title === 'string' &&
        typeof item.html_url === 'string' &&
        validWebUrl(item.html_url) &&
        ['open', 'closed'].includes(item.state) &&
        (item.head?.sha === undefined ||
          (typeof item.head.sha === 'string' && validSha(item.head.sha))) &&
        (item.head?.ref === undefined || item.head.ref === branch) &&
        (item.base?.ref === undefined || typeof item.base.ref === 'string') &&
        (item.merged_at == null ||
          (typeof item.merged_at === 'string' && !Number.isNaN(Date.parse(item.merged_at))))
    )
  )
    return failure('invalid-response', 'Provider returned an unexpected pull request list.', source)
  const candidates = data as Array<{
    number: number
    title: string
    html_url: string
    state: string
    draft?: boolean
    merged?: boolean
    merged_at?: string | null
    base?: { ref?: string }
    head?: { sha?: string }
  }>
  const pr =
    candidates.find((item) => item.state === 'open') ??
    candidates.find(
      (item) =>
        item.state === 'closed' && !!(item.merged_at || item.merged) && item.base?.ref === base
    ) ??
    candidates[0]
  if (!pr) return outcome('none', source)
  const merged = !!(pr.merged_at || pr.merged)
  return outcome('found', source, {
    id: `gh-${pr.number}`,
    title: pr.title,
    url: pr.html_url,
    state: pr.state === 'open' ? (pr.draft ? 'draft' : 'open') : merged ? 'merged' : 'closed',
    branch,
    ...(pr.base?.ref ? { targetBranch: pr.base.ref } : {}),
    ...(pr.head?.sha ? { headCommit: pr.head.sha } : {}),
  })
}

async function lookupAzure(
  branch: string,
  base: string,
  repository: Repository,
  token: string,
  source: PullRequestLookup['credentialSource']
): Promise<PullRequestLookup> {
  const provider = repository.provider!
  const { organization, project } = provider
  const repo = provider.repository
  if (!organization || !project || !repo)
    return failure(
      'configuration',
      'Azure organization, project, and repository are required.',
      source
    )
  const url = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests?searchCriteria.sourceRefName=${encodeURIComponent(`refs/heads/${branch}`)}&searchCriteria.status=all&api-version=7.1-preview.1`
  const basic = `Basic ${Buffer.from(`:${token}`).toString('base64')}`
  const bearer = `Bearer ${token}`
  const headers = token.split('.').length === 3 ? [bearer, basic] : [basic, bearer]
  for (let index = 0; index < headers.length; index++) {
    const response = await request(url, headers[index]!, 'application/json', source)
    if (isLookup(response)) return response
    if (response.status === 401 && index === 0) continue
    if (!response.ok) return responseFailure(response, source)
    const data = await json(response, source)
    if (isError(data)) return data
    if (!data || typeof data !== 'object' || !Array.isArray((data as { value?: unknown }).value))
      return failure(
        'invalid-response',
        'Provider returned an unexpected pull request list.',
        source
      )
    const candidates = (
      data as {
        value: Array<{
          pullRequestId: number
          title: string
          url: string
          status: string
          creationDate?: string
          isDraft?: boolean
          targetRefName?: string
          lastMergeSourceCommit?: { commitId?: string }
          sourceRefName?: string
        }>
      }
    ).value
    if (
      !candidates.every(
        (item) =>
          item &&
          typeof item.pullRequestId === 'number' &&
          Number.isSafeInteger(item.pullRequestId) &&
          item.pullRequestId > 0 &&
          typeof item.title === 'string' &&
          ['active', 'completed', 'abandoned'].includes(item.status) &&
          item.sourceRefName === `refs/heads/${branch}` &&
          typeof item.targetRefName === 'string' &&
          item.targetRefName.startsWith('refs/heads/') &&
          (item.lastMergeSourceCommit?.commitId === undefined ||
            (typeof item.lastMergeSourceCommit.commitId === 'string' &&
              validSha(item.lastMergeSourceCommit.commitId)))
      )
    )
      return failure('invalid-response', 'Provider returned malformed pull request data.', source)
    const ordered = candidates
      .slice()
      .sort(
        (a, b) => (Date.parse(b.creationDate ?? '') || 0) - (Date.parse(a.creationDate ?? '') || 0)
      )
    const pr =
      ordered.find((item) => item.status === 'active') ??
      ordered.find(
        (item) => item.status === 'completed' && item.targetRefName === `refs/heads/${base}`
      ) ??
      ordered[0]
    if (!pr) return outcome('none', source)
    const webUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${pr.pullRequestId}`
    return outcome('found', source, {
      id: `ado-${pr.pullRequestId}`,
      title: pr.title,
      url: webUrl,
      state:
        pr.status === 'active'
          ? pr.isDraft
            ? 'draft'
            : 'open'
          : pr.status === 'completed'
            ? 'merged'
            : 'closed',
      branch,
      ...(pr.targetRefName ? { targetBranch: pr.targetRefName.replace(/^refs\/heads\//, '') } : {}),
      ...(pr.lastMergeSourceCommit?.commitId
        ? { headCommit: pr.lastMergeSourceCommit.commitId }
        : {}),
    })
  }
  return failure(
    'authentication',
    'Provider authentication failed. Check the effective credential.',
    source
  )
}
