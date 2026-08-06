import { useEffect, useReducer, useRef, useState, type ChangeEvent, type MouseEvent } from 'react'
import { AlertTriangle, Image as ImageIcon, KeyRound, Loader2, Sparkles, X } from 'lucide-react'
import type { ProviderConfig, Repository } from '@worktree/contracts'
import { useAppStore } from '../store'
import { api } from '../api'
import { editorLabel, editorOptionsForIds, sortEditorOptions, shortenPath } from '../lib/paths'
import { cn } from '../lib/utils'
import { ShellEditor } from './ShellEditor'

interface ProjectConfigModalProps {
  repository: Repository
  onClose: () => void
  onSave: (repo: Repository) => void
}

type ProviderState = {
  type: ProviderConfig['type'] | ''
  organization: string
  project: string
  repoName: string
  token: string
}

type ProviderAction =
  | { type: 'set'; partial: Partial<ProviderState> }
  | { type: 'load'; provider?: ProviderConfig }

function initialProviderState(provider?: ProviderConfig): ProviderState {
  return {
    type: provider?.type ?? '',
    organization: provider?.organization ?? '',
    project: provider?.project ?? '',
    repoName: provider?.repository ?? '',
    token: provider?.personalAccessToken ?? '',
  }
}

function providerReducer(state: ProviderState, action: ProviderAction): ProviderState {
  switch (action.type) {
    case 'set':
      return { ...state, ...action.partial }
    case 'load':
      return initialProviderState(action.provider)
    default:
      return state
  }
}

export function ProjectConfigModal({ repository, onClose, onSave }: ProjectConfigModalProps) {
  const settings = useAppStore((s) => s.settings)
  const [baseBranch, setBaseBranch] = useState(repository.baseBranch || 'main')
  const [branches, setBranches] = useState<string[]>([])
  const [defaultBranch, setDefaultBranch] = useState<string | undefined>(undefined)
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [preferredEditor, setPreferredEditor] = useState(repository.preferredEditor ?? '')
  const [availableEditorIds, setAvailableEditorIds] = useState<string[] | null>(null)
  const [favorite, setFavorite] = useState(Boolean(repository.favorite))
  const [provider, dispatchProvider] = useReducer(
    providerReducer,
    initialProviderState(repository.provider)
  )
  const providerSourceRef = useRef(repository.provider?.source ?? 'manual')
  const [detecting, setDetecting] = useState(false)
  const [tokenHint, setTokenHint] = useState<string | null>(null)
  const [autoNote, setAutoNote] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState(repository.imageUrl ?? '')
  const [preDeleteCommand, setPreDeleteCommand] = useState(repository.preDeleteCommand ?? '')
  const [preDeleteTimeout, setPreDeleteTimeout] = useState(
    repository.preDeleteTimeoutSeconds ? String(repository.preDeleteTimeoutSeconds) : ''
  )
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    api
      .getAvailableEditors()
      .then((ids) => {
        if (!cancelled) setAvailableEditorIds(ids)
      })
      .catch(() => {
        if (!cancelled) setAvailableEditorIds(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const editorOptions = sortEditorOptions(
    editorOptionsForIds(availableEditorIds, [
      preferredEditor,
      repository.preferredEditor,
      settings?.defaultEditor,
    ])
  )

  // Auto-fill from remote on open if missing
  useEffect(() => {
    let cancelled = false
    async function auto() {
      if (cancelled) return
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
      if (cancelled) return
      if (!parsed) {
        setAutoNote('Could not parse provider from remote URL. Fill manually if needed.')
        return
      }
      dispatchProvider({
        type: 'set',
        partial: {
          type: parsed.type,
          organization: parsed.organization ?? '',
          project: parsed.project ?? '',
          repoName: parsed.repository,
        },
      })
      providerSourceRef.current = 'remote'
      setAutoNote(
        `Auto-detected ${parsed.type === 'github' ? 'GitHub' : 'Azure DevOps'} from ${shortenPath(repository.remoteUrl)}`
      )
    }
    auto()
    return () => {
      cancelled = true
    }
  }, [repository.remoteUrl, repository.provider])

  // Load the repo's branches so the base branch is a dropdown, defaulting to the
  // branch `origin/HEAD` points at rather than a free-text guess.
  useEffect(() => {
    let cancelled = false
    setLoadingBranches(true)
    api
      .getRepoBranches(repository.path)
      .then(({ branches: list, defaultBranch: detected }) => {
        if (cancelled) return
        setBranches(list)
        setDefaultBranch(detected)
        // If this repo was never explicitly configured, adopt the detected default.
        if (detected && !repository.baseBranch) setBaseBranch(detected)
      })
      .catch(() => {
        // leave the free-text fallback in place
      })
      .finally(() => {
        if (!cancelled) setLoadingBranches(false)
      })
    return () => {
      cancelled = true
    }
  }, [repository.path, repository.baseBranch])

  const detectToken = async () => {
    if (!provider.type) return
    setDetecting(true)
    setTokenHint(null)
    try {
      const found = await api.detectProviderToken(provider.type)
      if (found?.token) {
        dispatchProvider({ type: 'set', partial: { token: found.token } })
        setTokenHint(`Found via ${found.source}`)
      } else {
        setTokenHint(
          provider.type === 'github'
            ? 'No token found. Install/login with `gh auth login`, or paste a PAT.'
            : 'No token found. Set AZURE_DEVOPS_EXT_PAT, run `az login`, or paste a PAT.'
        )
      }
    } finally {
      setDetecting(false)
    }
  }

  const handleImageFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setImageUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  // Consider the form "clean" if it still matches the saved repository (the
  // detected default branch is auto-adopted on open and doesn't count as a change).
  const initialBase = repository.baseBranch || defaultBranch || 'main'
  const currentSource = providerSourceRef.current ?? 'manual'
  const savedSource = repository.provider?.source ?? 'manual'
  const isDirty =
    baseBranch !== initialBase ||
    (preferredEditor || '') !== (repository.preferredEditor || '') ||
    favorite !== Boolean(repository.favorite) ||
    (provider.type || '') !== (repository.provider?.type || '') ||
    (provider.organization || '') !== (repository.provider?.organization || '') ||
    (provider.project || '') !== (repository.provider?.project || '') ||
    (provider.repoName || '') !== (repository.provider?.repository || '') ||
    (provider.token || '') !== (repository.provider?.personalAccessToken || '') ||
    currentSource !== savedSource ||
    (imageUrl || '') !== (repository.imageUrl || '') ||
    (preDeleteCommand || '') !== (repository.preDeleteCommand || '') ||
    (preDeleteTimeout || '') !==
      (repository.preDeleteTimeoutSeconds ? String(repository.preDeleteTimeoutSeconds) : '')

  const handleBackdropMouseDown = (e: MouseEvent) => {
    if (e.target === e.currentTarget && !isDirty) onClose()
  }

  const handleSave = () => {
    const providerConfig: ProviderConfig | undefined = provider.type
      ? {
        type: provider.type,
        organization: provider.organization || undefined,
        project: provider.project || undefined,
        repository: provider.repoName || repository.name,
        personalAccessToken: provider.token || undefined,
        source: currentSource,
      }
      : undefined

    const timeoutSeconds = Number(preDeleteTimeout)
    onSave({
      ...repository,
      baseBranch,
      favorite,
      preferredEditor: preferredEditor || undefined,
      imageUrl: imageUrl || undefined,
      provider: providerConfig,
      preDeleteCommand: preDeleteCommand.trim() || undefined,
      preDeleteTimeoutSeconds:
        Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : undefined,
    })
  }

  const markManual = () => {
    providerSourceRef.current = 'manual'
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        onClick={handleBackdropMouseDown}
        aria-label="Close dialog"
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
        <div className="pointer-events-auto max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-border bg-card p-6 shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Project settings</h2>
              <p className="text-xs text-muted">{repository.name}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-muted hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-5">
            <CleanupSection
              preDeleteCommand={preDeleteCommand}
              setPreDeleteCommand={setPreDeleteCommand}
              preDeleteTimeout={preDeleteTimeout}
              setPreDeleteTimeout={setPreDeleteTimeout}
            />

            <GeneralSection
              baseBranch={baseBranch}
              setBaseBranch={setBaseBranch}
              branches={branches}
              defaultBranch={defaultBranch}
              loadingBranches={loadingBranches}
              preferredEditor={preferredEditor}
              editorOptions={editorOptions}
              setPreferredEditor={setPreferredEditor}
              favorite={favorite}
              setFavorite={setFavorite}
              imageUrl={imageUrl}
              setImageUrl={setImageUrl}
              fileInputRef={fileInputRef}
              handleImageFile={handleImageFile}
            />

            <ProviderSection
              repository={repository}
              provider={provider}
              dispatchProvider={dispatchProvider}
              markManual={markManual}
              autoNote={autoNote}
              tokenHint={tokenHint}
              detecting={detecting}
              detectToken={detectToken}
              loadingBranches={loadingBranches}
              defaultBranch={defaultBranch}
            />
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-card"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface GeneralSectionProps {
  baseBranch: string
  setBaseBranch: (b: string) => void
  branches: string[]
  defaultBranch: string | undefined
  loadingBranches: boolean
  preferredEditor: string
  editorOptions: ReturnType<typeof editorOptionsForIds>
  setPreferredEditor: (v: string) => void
  favorite: boolean
  setFavorite: (v: boolean) => void
  imageUrl: string
  setImageUrl: (v: string) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  handleImageFile: (e: ChangeEvent<HTMLInputElement>) => void
}

function GeneralSection({
  baseBranch,
  setBaseBranch,
  branches,
  defaultBranch,
  loadingBranches,
  preferredEditor,
  editorOptions,
  setPreferredEditor,
  favorite,
  setFavorite,
  imageUrl,
  setImageUrl,
  fileInputRef,
  handleImageFile,
}: GeneralSectionProps) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">General</h3>
      <div>
        <label htmlFor="base-branch" className="mb-1 flex items-center gap-2 text-sm font-medium">
          Base branch
          {loadingBranches && <Loader2 className="h-3 w-3 animate-spin text-muted" />}
        </label>
        <select
          id="base-branch"
          value={baseBranch}
          onChange={(e) => setBaseBranch(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        >
          {/* Keep the current value selectable even if it's not in the list. */}
          {baseBranch && !branches.includes(baseBranch) && (
            <option value={baseBranch}>{baseBranch} (not found)</option>
          )}
          {branches.map((b) => (
            <option key={b} value={b}>
              {b}
              {b === defaultBranch ? ' — default' : ''}
            </option>
          ))}
        </select>
        {defaultBranch && baseBranch !== defaultBranch ? (
          <p className="mt-1 flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              The repository’s default branch is{' '}
              <span className="font-medium">{defaultBranch}</span>. Merge, ahead/behind, and
              “safe to delete” checks will use{' '}
              <span className="font-medium">{baseBranch}</span> instead.
            </span>
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted">
            Detected from <code className="text-[11px]">origin/HEAD</code>. Used to check merge
            status.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="preferred-editor" className="mb-1 block text-sm font-medium">
          Editor for this project
        </label>
        <select
          id="preferred-editor"
          value={preferredEditor}
          onChange={(e) => setPreferredEditor(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">App default</option>
          {editorOptions.map((opt) => (
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

      <label htmlFor="project-favorite" className="flex items-center gap-2 text-sm">
        <input
          id="project-favorite"
          type="checkbox"
          checked={favorite}
          onChange={(e) => setFavorite(e.target.checked)}
          className="h-4 w-4"
        />
        Favorite (pin to top of project list)
      </label>

      <div>
        <label htmlFor="project-image-url" className="mb-1 block text-sm font-medium">
          Project image
        </label>
        <div className="flex items-start gap-3">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt="Project logo"
              className="h-10 w-10 rounded-md border border-border object-contain bg-background"
            />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted">
              <ImageIcon className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <input
              id="project-image-url"
              type="text"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/logo.png or data URL"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              aria-label="Choose project image file"
              onChange={handleImageFile}
              className="hidden"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Choose file
              </button>
              {imageUrl && (
                <button
                  type="button"
                  onClick={() => setImageUrl('')}
                  className="text-xs text-muted hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted">Supports image URLs and local files.</p>
      </div>
    </section>
  )
}

interface CleanupSectionProps {
  preDeleteCommand: string
  setPreDeleteCommand: (value: string) => void
  preDeleteTimeout: string
  setPreDeleteTimeout: (value: string) => void
}

function CleanupSection({
  preDeleteCommand,
  setPreDeleteCommand,
  preDeleteTimeout,
  setPreDeleteTimeout,
}: CleanupSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Cleanup on delete</h3>
          <p className="mt-0.5 text-xs text-muted">
            Runs in a worktree just before it is moved to Trash — release whatever that worktree
            allocated outside git, like its own Docker stack, volumes and ports.
          </p>
        </div>
        <label
          htmlFor="pre-delete-timeout"
          className="flex shrink-0 items-center gap-2 text-xs text-muted"
        >
          Timeout
          <input
            id="pre-delete-timeout"
            type="number"
            min={1}
            value={preDeleteTimeout}
            onChange={(e) => setPreDeleteTimeout(e.target.value)}
            placeholder="600"
            className="w-20 rounded-md border border-border bg-background px-2 py-1 text-right text-xs text-foreground outline-none focus:border-primary"
          />
          s
        </label>
      </div>

      <ShellEditor
        id="pre-delete-command"
        value={preDeleteCommand}
        onChange={setPreDeleteCommand}
        placeholder="Leave empty to skip"
      />

      <p className="text-[11px] leading-relaxed text-muted">
        Runs through your login shell, with the worktree as the working directory.{' '}
        <code className="font-mono text-warning">$WORKTREE_PATH</code>,{' '}
        <code className="font-mono text-warning">$WORKTREE_BRANCH</code>,{' '}
        <code className="font-mono text-warning">$REPO_PATH</code> and{' '}
        <code className="font-mono text-warning">$REPO_NAME</code> are available. If it fails
        you&rsquo;ll be asked whether to delete anyway.
      </p>
    </section>
  )
}

interface ProviderSectionProps {
  repository: Repository
  provider: ProviderState
  dispatchProvider: React.Dispatch<ProviderAction>
  markManual: () => void
  autoNote: string | null
  tokenHint: string | null
  detecting: boolean
  detectToken: () => void
  loadingBranches: boolean
  defaultBranch: string | undefined
}

function ProviderSection({
  repository,
  provider,
  dispatchProvider,
  markManual,
  autoNote,
  tokenHint,
  detecting,
  detectToken,
}: ProviderSectionProps) {
  const setProviderField = (partial: Partial<ProviderState>) => {
    markManual()
    dispatchProvider({ type: 'set', partial })
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
          Pull requests
        </h3>
        {repository.remoteUrl && (
          <span
            className="truncate font-mono text-[10px] text-muted"
            title={repository.remoteUrl}
          >
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
        <label htmlFor="provider-type" className="mb-1 block text-sm font-medium">
          Provider
        </label>
        <select
          id="provider-type"
          value={provider.type}
          onChange={(e) => setProviderField({ type: e.target.value as ProviderConfig['type'] | '' })}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">None</option>
          <option value="github">GitHub</option>
          <option value="azure">Azure DevOps</option>
        </select>
      </div>

      {provider.type === 'github' && (
        <div className="grid gap-3">
          <div>
            <label htmlFor="github-owner" className="mb-1 block text-sm font-medium">
              Owner / organization
            </label>
            <input
              id="github-owner"
              type="text"
              value={provider.organization}
              onChange={(e) => setProviderField({ organization: e.target.value })}
              placeholder="owner"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label htmlFor="github-repo" className="mb-1 block text-sm font-medium">
              Repository
            </label>
            <input
              id="github-repo"
              type="text"
              value={
                provider.repoName.includes('/')
                  ? (provider.repoName.split('/')[1] ?? provider.repoName)
                  : provider.repoName
              }
              onChange={(e) => {
                const name = e.target.value
                setProviderField({
                  repoName: provider.organization ? `${provider.organization}/${name}` : name,
                })
              }}
              placeholder="repo"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>
      )}

      {provider.type === 'azure' && (
        <div className="grid gap-3">
          <p className="text-xs text-muted">
            Org, project, and repo are filled from <code className="text-[11px]">origin</code>{' '}
            when possible — you usually only need a PAT.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="azure-organization" className="mb-1 block text-sm font-medium">
                Organization
              </label>
              <input
                id="azure-organization"
                type="text"
                value={provider.organization}
                onChange={(e) => setProviderField({ organization: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label htmlFor="azure-project" className="mb-1 block text-sm font-medium">
                Project
              </label>
              <input
                id="azure-project"
                type="text"
                value={provider.project}
                onChange={(e) => setProviderField({ project: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
          <div>
            <label htmlFor="azure-repo" className="mb-1 block text-sm font-medium">
              Repository
            </label>
            <input
              id="azure-repo"
              type="text"
              value={provider.repoName}
              onChange={(e) => setProviderField({ repoName: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>
      )}

      {provider.type && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="provider-token" className="block text-sm font-medium">
              Personal access token
            </label>
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
            id="provider-token"
            type="password"
            value={provider.token}
            onChange={(e) => setProviderField({ token: e.target.value })}
            placeholder={
              provider.type === 'github' ? 'ghp_… or leave empty to use Settings' : 'Azure PAT'
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
  )
}
