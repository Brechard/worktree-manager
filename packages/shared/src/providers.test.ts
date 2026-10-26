import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { Repository } from '@worktree/contracts'
import { clearProviderLookupCache, lookupPullRequest } from './providers.js'

const repository = {
  id: 'repo',
  name: 'repo',
  path: '/fixture',
  baseBranch: 'main',
  favorite: false,
  actions: [],
  provider: {
    type: 'github',
    organization: 'owner',
    repository: 'repo',
    personalAccessToken: 'project-token',
  },
} satisfies Repository
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  clearProviderLookupCache()
})

test('401 is an authentication error and project token takes precedence', async () => {
  let authorization = ''
  // Bun augments fetch with preconnect; these fixture functions intentionally replace only calls.
  // @ts-expect-error test fixture omits preconnect
  globalThis.fetch = async (_url, init) => {
    authorization = new Headers(init?.headers).get('Authorization') ?? ''
    return new Response('{}', { status: 401 })
  }
  const result = await lookupPullRequest('feature', repository, { github: 'global-token' })
  assert.equal(authorization, 'Bearer project-token')
  assert.equal(result.state, 'error')
  assert.equal(result.credentialSource, 'project')
  assert.equal(result.error?.kind, 'authentication')
  assert.equal(JSON.stringify(result).includes('project-token'), false)
})

test('verified empty list is distinct from forbidden and rate limited', async () => {
  for (const [status, kind] of [
    [403, 'forbidden'],
    [429, 'rate-limited'],
  ] as const) {
    clearProviderLookupCache()
    // Bun augments fetch with preconnect; these fixture functions intentionally replace only calls.
    // @ts-expect-error test fixture omits preconnect
    globalThis.fetch = async () => new Response('{}', { status })
    const result = await lookupPullRequest('feature', repository)
    assert.equal(result.state, 'error')
    assert.equal(result.error?.kind, kind)
  }
  // Bun augments fetch with preconnect; these fixture functions intentionally replace only calls.
  clearProviderLookupCache()
  // @ts-expect-error test fixture omits preconnect
  globalThis.fetch = async () => Response.json([])
  const absent = await lookupPullRequest('feature', repository)
  assert.equal(absent.state, 'none')
  assert.ok(absent.lastSuccessAt)
})

test('merged result identifies its head and target branch', async () => {
  // Bun augments fetch with preconnect; these fixture functions intentionally replace only calls.
  // @ts-expect-error test fixture omits preconnect
  globalThis.fetch = async () =>
    Response.json([
      {
        number: 5,
        title: 'Merged',
        html_url: 'https://github.com/owner/repo/pull/5',
        state: 'closed',
        merged_at: '2026-01-01',
        base: { ref: 'main' },
        head: { sha: 'a'.repeat(40) },
      },
    ])
  const result = await lookupPullRequest('feature', repository)
  assert.equal(result.state, 'found')
  assert.equal(result.pullRequest?.state, 'merged')
  assert.equal(result.pullRequest?.headCommit, 'a'.repeat(40))
})

test('network and invalid response are errors without response bodies', async () => {
  // Bun augments fetch with preconnect; these fixture functions intentionally replace only calls.
  // @ts-expect-error test fixture omits preconnect
  globalThis.fetch = async () => {
    throw new Error('Bearer secret-token')
  }
  const network = await lookupPullRequest('feature', repository)
  assert.equal(network.error?.kind, 'network')
  assert.equal(JSON.stringify(network).includes('secret-token'), false)
  clearProviderLookupCache()
  // Bun augments fetch with preconnect; these fixture functions intentionally replace only calls.
  // @ts-expect-error test fixture omits preconnect
  globalThis.fetch = async () =>
    new Response('{secret-token', { headers: { 'content-type': 'application/json' } })
  const invalid = await lookupPullRequest('feature', repository)
  assert.equal(invalid.error?.kind, 'invalid-response')
  assert.equal(JSON.stringify(invalid).includes('secret-token'), false)
})

test('Azure alternate authentication never hides a failed lookup', async () => {
  let calls = 0
  const azure: Repository = {
    ...repository,
    provider: {
      type: 'azure',
      organization: 'org',
      project: 'project',
      repository: 'repo',
      personalAccessToken: 'pat',
    },
  }
  // Bun augments fetch with preconnect; these fixture functions intentionally replace only calls.
  // @ts-expect-error test fixture omits preconnect
  globalThis.fetch = async () => {
    calls++
    return new Response('{}', { status: calls === 1 ? 401 : 403 })
  }
  const result = await lookupPullRequest('feature', azure)
  assert.equal(calls, 2)
  assert.equal(result.error?.kind, 'forbidden')
})

test('Azure rejects malformed status and mismatched source branch', async () => {
  const azure: Repository = {
    ...repository,
    provider: {
      type: 'azure',
      organization: 'org',
      project: 'project',
      repository: 'repo',
      personalAccessToken: 'pat',
    },
  }
  // @ts-expect-error test fixture omits preconnect
  globalThis.fetch = async () =>
    Response.json({
      value: [
        {
          pullRequestId: 1,
          title: 'Unknown',
          status: 'future',
          sourceRefName: 'refs/heads/feature',
          targetRefName: 'refs/heads/main',
        },
      ],
    })
  assert.equal((await lookupPullRequest('feature', azure)).error?.kind, 'invalid-response')
  // @ts-expect-error test fixture omits preconnect
  globalThis.fetch = async () =>
    Response.json({
      value: [
        {
          pullRequestId: 1,
          title: 'Wrong branch',
          status: 'completed',
          sourceRefName: 'refs/heads/other',
          targetRefName: 'refs/heads/main',
        },
      ],
    })
  assert.equal((await lookupPullRequest('feature', azure)).error?.kind, 'invalid-response')
})

test('repeated failing lookups share a request; a forced check retries', async () => {
  let calls = 0
  // @ts-expect-error test fixture omits preconnect
  globalThis.fetch = async () => {
    calls++
    return new Response('{}', { status: 401 })
  }
  const results = await Promise.all([
    lookupPullRequest('feature', repository),
    lookupPullRequest('feature', repository),
  ])
  assert.equal(calls, 1)
  assert.ok(results.every((result) => result.error?.kind === 'authentication'))
  await lookupPullRequest('feature', repository)
  assert.equal(calls, 1)
  await lookupPullRequest('feature', repository, undefined, undefined, true)
  assert.equal(calls, 2)
  await lookupPullRequest('other-feature', repository)
  assert.equal(calls, 3)
  await lookupPullRequest('feature', {
    ...repository,
    provider: { ...repository.provider!, personalAccessToken: 'replacement-token' },
  })
  assert.equal(calls, 4)
})

test('failure cache separates effective credential sources', async () => {
  let calls = 0
  const noOverride: Repository = {
    ...repository,
    provider: { ...repository.provider!, personalAccessToken: undefined },
  }
  // @ts-expect-error test fixture omits preconnect
  globalThis.fetch = async () => {
    calls++
    return new Response('{}', { status: 401 })
  }
  const environment = await lookupPullRequest(
    'feature',
    noOverride,
    { github: 'token' },
    'environment'
  )
  const cli = await lookupPullRequest('feature', noOverride, { github: 'token' }, 'cli')
  assert.equal(environment.credentialSource, 'environment')
  assert.equal(cli.credentialSource, 'cli')
  assert.equal(calls, 2)
})

test('Azure distinguishes empty, active, completed, and network failure', async () => {
  const azure: Repository = {
    ...repository,
    provider: {
      type: 'azure',
      organization: 'org',
      project: 'project',
      repository: 'repo',
      personalAccessToken: 'pat',
    },
  }
  const base = {
    pullRequestId: 7,
    title: 'PR',
    sourceRefName: 'refs/heads/feature',
    targetRefName: 'refs/heads/main',
    lastMergeSourceCommit: { commitId: 'a'.repeat(40) },
  }
  for (const [body, state] of [
    [{ value: [] }, 'none'],
    [{ value: [{ ...base, status: 'active' }] }, 'open'],
    [{ value: [{ ...base, status: 'completed' }] }, 'merged'],
  ] as const) {
    clearProviderLookupCache()
    // @ts-expect-error test fixture omits preconnect
    globalThis.fetch = async () => Response.json(body)
    const result = await lookupPullRequest('feature', azure)
    assert.equal(result.state === 'none' ? 'none' : result.pullRequest?.state, state)
  }
  clearProviderLookupCache()
  // @ts-expect-error test fixture omits preconnect
  globalThis.fetch = async () => {
    throw new Error('secret response')
  }
  const failed = await lookupPullRequest('feature', azure)
  assert.equal(failed.error?.kind, 'network')
  assert.equal(JSON.stringify(failed).includes('secret response'), false)
})
