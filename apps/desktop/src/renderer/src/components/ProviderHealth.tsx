import { Button } from './ui/Button'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react'
import type { PullRequestLookup, Repository, Worktree, WorktreeStatus } from '@worktree/contracts'
import { api } from '../api'
import { providerHealthVisible } from '../lib/providerHealthVisibility'

interface ProviderHealthProps {
  repository: Repository
  statuses: Record<string, WorktreeStatus>
  worktrees: Worktree[]
  onManageProject: () => void
  onManageGlobal: () => void
  onRefresh: () => void
}

function latestLookup(
  repositoryId: string,
  worktrees: Worktree[],
  statuses: Record<string, WorktreeStatus>
): PullRequestLookup | undefined {
  const ids = new Set(
    worktrees
      .filter((worktree) => worktree.repositoryId === repositoryId)
      .map((worktree) => worktree.id)
  )
  const lookups = Object.values(statuses)
    .filter((status) => ids.has(status.worktreeId))
    .map((status) => status.prLookup)
    .filter((lookup): lookup is PullRequestLookup => Boolean(lookup))
  // Base and detached branches should not hide failed feature branch lookups.
  const meaningful = lookups.filter((lookup) => lookup.state !== 'not-applicable')
  const candidates = meaningful.length > 0 ? meaningful : lookups
  return candidates.sort(
    (a, b) =>
      (b.state === 'error' ? 2 : b.state === 'found' ? 1 : 0) -
        (a.state === 'error' ? 2 : a.state === 'found' ? 1 : 0) || b.checkedAt - a.checkedAt
  )[0]
}

function chooseLookup(
  repositoryId: string,
  checked: { repositoryId: string; result: PullRequestLookup } | null,
  latest: PullRequestLookup | undefined
): PullRequestLookup | undefined {
  if (checked?.repositoryId !== repositoryId || checked.result.checkedAt < (latest?.checkedAt ?? 0))
    return latest
  if (
    checked.result.state === 'error' ||
    latest?.state === 'error' ||
    !latest ||
    checked.result.state === 'found'
  )
    return checked.result
  return latest
}

function connectionMessage(result: PullRequestLookup | undefined): string {
  switch (result?.state) {
    case 'error':
      return result.error?.kind === 'authentication'
        ? 'Saved token was rejected; it may have expired.'
        : (result.error?.message ?? 'The provider could not be checked.')
    case 'not-configured':
      return 'No credential is configured.'
    case 'none':
      return 'Connected · no pull request found on checked branches.'
    case 'found':
      return 'Connected · pull request found on a checked branch.'
    case 'not-applicable':
      return 'No lookup needed for this branch.'
    default:
      return 'Provider status has not been checked yet.'
  }
}

export function ProviderHealth({
  repository,
  statuses,
  worktrees,
  onManageProject,
  onManageGlobal,
  onRefresh,
}: ProviderHealthProps) {
  const [checked, setChecked] = useState<{
    repositoryId: string
    result: PullRequestLookup
  } | null>(null)
  const [checking, setChecking] = useState(false)
  const [recoveryFeedback, setRecoveryFeedback] = useState(false)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    },
    []
  )
  const latest = useMemo(
    () => latestLookup(repository.id, worktrees, statuses),
    [repository.id, worktrees, statuses]
  )
  const result = chooseLookup(repository.id, checked, latest)
  const check = async () => {
    if (checking) return
    setChecking(true)
    try {
      const response = await api.checkProviderConnection(repository.id)
      setChecked({ repositoryId: repository.id, result: response })
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
      const recovered = response.state === 'found' || response.state === 'none'
      setRecoveryFeedback(recovered)
      if (recovered) feedbackTimer.current = setTimeout(() => setRecoveryFeedback(false), 3500)
      onRefresh()
    } catch (error) {
      setRecoveryFeedback(false)
      setChecked({
        repositoryId: repository.id,
        result: {
          state: 'error',
          checkedAt: Date.now(),
          error: { kind: 'unknown', message: String(error) },
        },
      })
    } finally {
      setChecking(false)
    }
  }
  if (!repository.provider || !providerHealthVisible(result, recoveryFeedback)) return null
  return (
    <ProviderHealthStatus
      providerType={repository.provider.type}
      result={result}
      recoveryFeedback={recoveryFeedback}
      checking={checking}
      onRetry={() => void check()}
      onManageProject={onManageProject}
      onManageGlobal={onManageGlobal}
    />
  )
}

function ProviderHealthStatus({
  providerType,
  result,
  recoveryFeedback,
  checking,
  onRetry,
  onManageProject,
  onManageGlobal,
}: {
  providerType: 'github' | 'azure'
  result: PullRequestLookup | undefined
  recoveryFeedback: boolean
  checking: boolean
  onRetry: () => void
  onManageProject: () => void
  onManageGlobal: () => void
}) {
  const failed = result?.state === 'error'
  const source = result?.credentialSource
  const manage = source === 'project' ? onManageProject : onManageGlobal
  const message = connectionMessage(result)
  const stale =
    result?.lastSuccessAt && failed
      ? ` Last successful check: ${new Date(result.lastSuccessAt).toLocaleString()}.`
      : ''
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-5 py-2.5 text-xs ${failed ? 'bg-warning/10' : 'bg-card/45'}`}
      role="status"
    >
      {failed ? (
        <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
      ) : (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
      )}
      <span className="font-medium">
        {providerType === 'github' ? 'GitHub' : 'Azure'} connection
      </span>
      <span className="min-w-0 flex-1 text-muted">
        {recoveryFeedback && !failed ? 'Connection restored.' : message}
        {stale}
      </span>
      <ProviderHealthControls
        failed={failed}
        source={source}
        result={result}
        checking={checking}
        onRetry={onRetry}
        onManage={manage}
      />
    </div>
  )
}

function ProviderHealthControls({
  failed,
  source,
  result,
  checking,
  onRetry,
  onManage,
}: {
  failed: boolean
  source: PullRequestLookup['credentialSource']
  result: PullRequestLookup | undefined
  checking: boolean
  onRetry: () => void
  onManage: () => void
}) {
  const manage = onManage
  return (
    <>
      {failed && source && source !== 'none' && (
        <span className="text-muted">{source} credential</span>
      )}
      {failed && (
        <Button variant="quiet" size="compact" onClick={onRetry} loading={checking}>
          <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
          {checking ? 'Checking…' : 'Retry check'}
        </Button>
      )}
      {(failed || result?.state === 'not-configured') && (
        <Button variant="quiet" size="compact" onClick={manage}>
          Manage {source === 'project' ? 'project' : 'global'} credential
        </Button>
      )}
    </>
  )
}
