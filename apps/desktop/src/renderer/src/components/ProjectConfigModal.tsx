import { useEffect, useState } from 'react'
import { KeyRound, Loader2, Sparkles, X } from 'lucide-react'
import type { ProviderConfig, Repository } from '@worktree/contracts'
import { api } from '../api'
import { EDITOR_OPTIONS, editorLabel, shortenPath } from '../lib/paths'
import { cn } from '../lib/utils'

interface ProjectConfigModalProps {
  repository: Repository
  onClose: () => void
  onSave: (repo: Repository) => void
}

export function ProjectConfigModal({ repository, onClose, onSave }: ProjectConfigModalProps) {
  const [baseBranch, setBaseBranch] = useState(repository.baseBranch || 'main')
  const [preferredEditor, setPreferredEditor] = useState(repository.preferredEditor ?? '')
  const [favorite, setFavorite] = useState(Boolean(repository.favorite))
  const [providerType, setProviderType] = useState<ProviderConfig['type'] | ''>(
    repository.provider?.type ?? ''
  )
  const [organization, setOrganization] = useState(repository.provider?.organization ?? '')
  const [project, setProject] = useState(repository.provider?.project ?? '')
  const [repoName, setRepoName] = useState(repository.provider?.repository ?? '')
  const [token, setToken] = useState(repository.provider?.personalAccessToken ?? '')
  const [providerSource, setProviderSource] = useState(repository.provider?.source)
  const [detecting, setDetecting] = useState(false)
  const [tokenHint, setTokenHint] = useState<string | null>(null)
  const [autoNote, setAutoNote] = useState<string | null>(null)

  // Auto-fill from remote on open if missing
  useEffect(() => {
    let cancelled = false
    async function auto() {
      if (!repository.remoteUrl) {
        setAutoNote('No git remote found for this project.')
        return
      }
      if (repository.provider?.type && repository.provider.source === 'remote') {
        setAutoNote(
          `Detected from origin: ${repository.provider.type === 'github' ? 'GitHub' : 'Azure DevOps'}`
        )
        return
      }
      const parsed = await api.parseRemoteProvider(repository.remoteUrl)
      if (cancelled || !parsed) {
        if (!cancelled) setAutoNote('Could not parse provider from remote URL. Fill manually if needed.')
        return
      }
      setProviderType(parsed.type)
      setOrganization(parsed.organization ?? '')
      setProject(parsed.project ?? '')
      setRepoName(parsed.repository)
      setProviderSource('remote')
      setAutoNote(
        `Auto-detected ${parsed.type === 'github' ? 'GitHub' : 'Azure DevOps'} from ${shortenPath(repository.remoteUrl)}`
      )
    }
    auto()
    return () => {
      cancelled = true
    }
  }, [repository.remoteUrl, repository.provider])

  const detectToken = async () => {
    if (!providerType) return
    setDetecting(true)
    setTokenHint(null)
    try {
      const found = await api.detectProviderToken(providerType)
      if (found?.token) {
        setToken(found.token)
        setTokenHint(`Found via ${found.source}`)
      } else {
        setTokenHint(
          providerType === 'github'
            ? 'No token found. Install/login with `gh auth login`, or paste a PAT.'
            : 'No token found. Set AZURE_DEVOPS_EXT_PAT, run `az login`, or paste a PAT.'
        )
      }
    } finally {
      setDetecting(false)
    }
  }

  const handleSave = () => {
    const provider: ProviderConfig | undefined = providerType
      ? {
          type: providerType,
          organization: organization || undefined,
          project: project || undefined,
          repository: repoName || repository.name,
          personalAccessToken: token || undefined,
          source: providerSource ?? 'manual',
        }
      : undefined

    onSave({
      ...repository,
      baseBranch,
      favorite,
      preferredEditor: preferredEditor || undefined,
      provider,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Project settings</h2>
            <p className="text-xs text-muted">{repository.name}</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5">
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">General</h3>
            <div>
              <label className="mb-1 block text-sm font-medium">Base branch</label>
              <input
                type="text"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <p className="mt-1 text-xs text-muted">Used to check merge status.</p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Editor for this project</label>
              <select
                value={preferredEditor}
                onChange={(e) => setPreferredEditor(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              >
                <option value="">App default</option>
                {EDITOR_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">
                Also available as “Open with” on the main screen
                {preferredEditor ? ` · ${editorLabel(preferredEditor)}` : ''}.
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={favorite}
                onChange={(e) => setFavorite(e.target.checked)}
                className="h-4 w-4"
              />
              Favorite (pin to top of project list)
            </label>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                Pull requests
              </h3>
              {repository.remoteUrl && (
                <span className="truncate font-mono text-[10px] text-muted" title={repository.remoteUrl}>
                  {shortenPath(repository.remoteUrl)}
                </span>
              )}
            </div>

            {autoNote && (
              <div className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>{autoNote}</span>
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium">Provider</label>
              <select
                value={providerType}
                onChange={(e) => {
                  setProviderType(e.target.value as ProviderConfig['type'] | '')
                  setProviderSource('manual')
                }}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              >
                <option value="">None</option>
                <option value="github">GitHub</option>
                <option value="azure">Azure DevOps</option>
              </select>
            </div>

            {providerType === 'github' && (
              <div className="grid gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">Owner / organization</label>
                  <input
                    type="text"
                    value={organization}
                    onChange={(e) => {
                      setOrganization(e.target.value)
                      setProviderSource('manual')
                    }}
                    placeholder="owner"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Repository</label>
                  <input
                    type="text"
                    value={repoName.includes('/') ? repoName.split('/')[1] ?? repoName : repoName}
                    onChange={(e) => {
                      const name = e.target.value
                      setRepoName(organization ? `${organization}/${name}` : name)
                      setProviderSource('manual')
                    }}
                    placeholder="repo"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
              </div>
            )}

            {providerType === 'azure' && (
              <div className="grid gap-3">
                <p className="text-xs text-muted">
                  Org, project, and repo are filled from <code className="text-[11px]">origin</code> when
                  possible — you usually only need a PAT.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium">Organization</label>
                    <input
                      type="text"
                      value={organization}
                      onChange={(e) => {
                        setOrganization(e.target.value)
                        setProviderSource('manual')
                      }}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Project</label>
                    <input
                      type="text"
                      value={project}
                      onChange={(e) => {
                        setProject(e.target.value)
                        setProviderSource('manual')
                      }}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Repository</label>
                  <input
                    type="text"
                    value={repoName}
                    onChange={(e) => {
                      setRepoName(e.target.value)
                      setProviderSource('manual')
                    }}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
              </div>
            )}

            {providerType && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-sm font-medium">Personal access token</label>
                  <button
                    type="button"
                    onClick={detectToken}
                    disabled={detecting}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent',
                      detecting && 'opacity-60'
                    )}
                  >
                    {detecting ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <KeyRound className="h-3 w-3" />
                    )}
                    Detect token
                  </button>
                </div>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={
                    providerType === 'github' ? 'ghp_… or leave empty to use Settings' : 'Azure PAT'
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
                {tokenHint && <p className="mt-1 text-xs text-muted">{tokenHint}</p>}
                <p className="mt-1 text-xs text-muted">
                  Optional per-repo. Global tokens live in Settings and apply to all projects.
                </p>
              </div>
            )}
          </section>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-card"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
