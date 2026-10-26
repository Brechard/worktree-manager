import { useEffect, useReducer, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  AlertTriangle,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Plus,
  Sparkles,
  X,
} from 'lucide-react'
import type {
  ProjectAction,
  ProviderConfig,
  Repository,
  WorktreeLocation,
} from '@worktree/contracts'
import { useAppStore } from '../store'
import { api } from '../api'
import { ACTION_ICONS, ACTION_ICON_OPTIONS } from '../lib/actionIcons'
import { editorLabel, editorOptionsForIds, sortEditorOptions, shortenPath } from '../lib/paths'
import { cn } from '../lib/utils'
import { ShellEditor } from './ShellEditor'
import { WorktreeLocationSection, PostCreateSetupSection } from './CreationSettingsSection'
import { Dialog } from './ui/Dialog'
import { Button, IconButton } from './ui/Button'
import { Field, TextInput, Select } from './ui/Field'
import { UnsavedChangesDialog } from './ui/UnsavedChangesDialog'
import { SettingsTabs } from './ui/SettingsTabs'

export type ProjectConfigSection = 'general' | 'connection' | 'worktrees' | 'automation'

interface ProjectConfigModalProps {
  repository: Repository
  initialSection?: ProjectConfigSection
  onClose: () => void
  onSave: (repo: Repository) => Promise<void>
}

const sectionTabs: { id: ProjectConfigSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'connection', label: 'Connection' },
  { id: 'worktrees', label: 'Worktrees' },
  { id: 'automation', label: 'Automation' },
]

type ProviderState = {
  type: ProviderConfig['type'] | ''
  organization: string
  project: string
  repoName: string
  token: string
}

type ProviderAction =
  { type: 'set'; partial: Partial<ProviderState> } | { type: 'load'; provider?: ProviderConfig }

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

interface ProjectDraft {
  baseBranch: string
  preferredEditor: string
  favorite: boolean
  provider: ProviderState
  currentSource: NonNullable<ProviderConfig['source']>
  imageUrl: string
  workingSubdirectory: string
  actions: ProjectAction[]
  preDeleteCommand: string
  preDeleteTimeout: string
  worktreeLocation: WorktreeLocation | ''
  worktreeCustomParent: string
  postCreateCommand: string
  postCreateTimeout: string
}

// The detected default branch is auto-adopted on open and is not an edit.
function projectDraftChanged(
  repository: Repository,
  defaultBranch: string | undefined,
  draft: ProjectDraft
): boolean {
  const {
    baseBranch,
    preferredEditor,
    favorite,
    provider,
    currentSource,
    imageUrl,
    workingSubdirectory,
    actions,
    preDeleteCommand,
    preDeleteTimeout,
    worktreeLocation,
    worktreeCustomParent,
    postCreateCommand,
    postCreateTimeout,
  } = draft
  const initialBase = repository.baseBranch || defaultBranch || 'main'
  const savedSource = repository.provider?.source ?? 'manual'
  return (
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
    (workingSubdirectory || '') !== (repository.workingSubdirectory || '') ||
    JSON.stringify(actions) !== JSON.stringify(repository.actions ?? []) ||
    (preDeleteCommand || '') !== (repository.preDeleteCommand || '') ||
    (preDeleteTimeout || '') !==
      (repository.preDeleteTimeoutSeconds ? String(repository.preDeleteTimeoutSeconds) : '') ||
    worktreeLocation !== (repository.worktreeLocation ?? '') ||
    worktreeCustomParent !== (repository.worktreeCustomParent ?? '') ||
    postCreateCommand !== (repository.postCreateCommand ?? '') ||
    postCreateTimeout !==
      (repository.postCreateTimeoutSeconds ? String(repository.postCreateTimeoutSeconds) : '')
  )
}

function useAvailableEditors() {
  const [availableEditorIds, setAvailableEditorIds] = useState<string[] | null>(null)
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

  return availableEditorIds
}

function useProjectBranches(repository: Repository) {
  const [baseBranch, setBaseBranch] = useState(repository.baseBranch || 'main')
  const [branches, setBranches] = useState<string[]>([])
  const [defaultBranch, setDefaultBranch] = useState<string | undefined>(undefined)
  const [loadingBranches, setLoadingBranches] = useState(false)
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

  return { baseBranch, setBaseBranch, branches, defaultBranch, loadingBranches }
}

function useAutoProvider(
  repository: Repository,
  dispatchProvider: (action: ProviderAction) => void,
  providerSourceRef: { current: string }
) {
  const [autoNote, setAutoNote] = useState<string | null>(null)
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
  }, [repository.remoteUrl, repository.provider, dispatchProvider, providerSourceRef])

  return autoNote
}

function updatedRepository(repository: Repository, draft: ProjectDraft): Repository {
  const {
    baseBranch,
    preferredEditor,
    favorite,
    provider,
    currentSource,
    imageUrl,
    workingSubdirectory,
    actions,
    preDeleteCommand,
    preDeleteTimeout,
    worktreeLocation,
    worktreeCustomParent,
    postCreateCommand,
    postCreateTimeout,
  } = draft
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
  const createTimeoutSeconds = Number(postCreateTimeout)
  // `clubtidy`, `./clubtidy` and `clubtidy/` all mean the same folder.
  const subdirectory = workingSubdirectory
    .trim()
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '')
  // A half-typed action (no command) would render as a button that does
  // nothing, so it never reaches the row.
  const cleanedActions = actions
    .map((action) => ({
      ...action,
      label: action.label.trim() || 'Run',
      command: action.command.trim(),
    }))
    .filter((action) => action.command.length > 0)

  return {
    ...repository,
    baseBranch,
    favorite,
    preferredEditor: preferredEditor || undefined,
    imageUrl: imageUrl || undefined,
    workingSubdirectory: subdirectory || undefined,
    actions: cleanedActions,
    provider: providerConfig,
    preDeleteCommand: preDeleteCommand.trim() || undefined,
    preDeleteTimeoutSeconds:
      Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : undefined,
    worktreeLocation: worktreeLocation || undefined,
    worktreeCustomParent:
      worktreeLocation === 'custom' ? worktreeCustomParent.trim() || undefined : undefined,
    postCreateCommand: postCreateCommand.trim() || undefined,
    postCreateTimeoutSeconds:
      Number.isFinite(createTimeoutSeconds) && createTimeoutSeconds > 0
        ? createTimeoutSeconds
        : undefined,
  }
}

function useProviderToken(
  provider: ProviderState,
  dispatchProvider: (action: ProviderAction) => void
) {
  const [detecting, setDetecting] = useState(false)
  const [tokenHint, setTokenHint] = useState<string | null>(null)
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

  return { detecting, tokenHint, detectToken }
}

export function ProjectConfigModal({
  repository,
  initialSection = 'general',
  onClose,
  onSave,
}: ProjectConfigModalProps) {
  const [section, setSection] = useState<ProjectConfigSection>(initialSection)
  const [showUnsaved, setShowUnsaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const settings = useAppStore((s) => s.settings)
  const statuses = useAppStore((s) => s.statuses)
  const worktrees = useAppStore((s) => s.worktrees)
  const { baseBranch, setBaseBranch, branches, defaultBranch, loadingBranches } =
    useProjectBranches(repository)
  const [preferredEditor, setPreferredEditor] = useState(repository.preferredEditor ?? '')
  const availableEditorIds = useAvailableEditors()
  const [favorite, setFavorite] = useState(Boolean(repository.favorite))
  const [provider, dispatchProvider] = useReducer(
    providerReducer,
    initialProviderState(repository.provider)
  )
  const providerSourceRef = useRef(repository.provider?.source ?? 'manual')
  const projectIds = new Set(
    worktrees.filter((w) => w.repositoryId === repository.id).map((w) => w.id)
  )
  const projectLookups = Object.values(statuses)
    .filter((status) => projectIds.has(status.worktreeId))
    .map((status) => status.prLookup)
    .filter((lookup) => lookup && lookup.state !== 'not-applicable')
  const lastSuccessfulCheck = Math.max(
    0,
    ...projectLookups.map(
      (lookup) =>
        lookup?.lastSuccessAt ??
        (lookup?.state === 'found' || lookup?.state === 'none' ? lookup.checkedAt : 0)
    )
  )
  const lookupCredentialSource = projectLookups.find(
    (lookup) => lookup?.credentialSource && lookup.credentialSource !== 'none'
  )?.credentialSource
  const { detecting, tokenHint, detectToken } = useProviderToken(provider, dispatchProvider)
  const autoNote = useAutoProvider(repository, dispatchProvider, providerSourceRef)
  const [imageUrl, setImageUrl] = useState(repository.imageUrl ?? '')
  const [workingSubdirectory, setWorkingSubdirectory] = useState(
    repository.workingSubdirectory ?? ''
  )
  const [actions, setActions] = useState<ProjectAction[]>(repository.actions ?? [])
  const [preDeleteCommand, setPreDeleteCommand] = useState(repository.preDeleteCommand ?? '')
  const [preDeleteTimeout, setPreDeleteTimeout] = useState(
    repository.preDeleteTimeoutSeconds ? String(repository.preDeleteTimeoutSeconds) : ''
  )
  const [worktreeLocation, setWorktreeLocation] = useState<WorktreeLocation | ''>(
    repository.worktreeLocation ?? ''
  )
  const [worktreeCustomParent, setWorktreeCustomParent] = useState(
    repository.worktreeCustomParent ?? ''
  )
  const [postCreateCommand, setPostCreateCommand] = useState(repository.postCreateCommand ?? '')
  const [postCreateTimeout, setPostCreateTimeout] = useState(
    repository.postCreateTimeoutSeconds ? String(repository.postCreateTimeoutSeconds) : ''
  )
  const fileInputRef = useRef<HTMLInputElement>(null)

  const editorOptions = sortEditorOptions(
    editorOptionsForIds(availableEditorIds, [
      preferredEditor,
      repository.preferredEditor,
      settings?.defaultEditor,
    ])
  )

  const handleImageFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setImageUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  const currentSource = providerSourceRef.current ?? 'manual'
  const draft: ProjectDraft = {
    baseBranch,
    preferredEditor,
    favorite,
    provider,
    currentSource,
    imageUrl,
    workingSubdirectory,
    actions,
    preDeleteCommand,
    preDeleteTimeout,
    worktreeLocation,
    worktreeCustomParent,
    postCreateCommand,
    postCreateTimeout,
  }

  const isDirty = projectDraftChanged(repository, defaultBranch, draft)

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(updatedRepository(repository, draft))
    } catch (error) {
      setSaveError(`Could not save project settings: ${String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const requestClose = () => {
    if (saving) return
    if (isDirty) setShowUnsaved(true)
    else onClose()
  }

  const markManual = () => {
    providerSourceRef.current = 'manual'
  }

  return (
    <ProjectConfigShell
      repositoryName={repository.name}
      section={section}
      setSection={setSection}
      requestClose={requestClose}
      saving={saving}
      saveError={saveError}
      showUnsaved={showUnsaved}
      setShowUnsaved={setShowUnsaved}
      onClose={onClose}
      handleSave={handleSave}
    >
      <ProjectConfigPanel
        section={section}
        general={{
          baseBranch,
          setBaseBranch,
          workingSubdirectory,
          setWorkingSubdirectory,
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
        }}
        connection={{
          repository,
          provider,
          lastSuccessfulCheck,
          currentSource: lookupCredentialSource,
          dispatchProvider,
          markManual,
          autoNote,
          tokenHint,
          detecting,
          detectToken,
          loadingBranches,
          defaultBranch,
        }}
        worktrees={{
          location: worktreeLocation,
          setLocation: setWorktreeLocation,
          customParent: worktreeCustomParent,
          setCustomParent: setWorktreeCustomParent,
        }}
        postCreate={{
          command: postCreateCommand,
          setCommand: setPostCreateCommand,
          timeout: postCreateTimeout,
          setTimeout: setPostCreateTimeout,
        }}
        actions={{ actions, setActions, workingSubdirectory }}
        cleanup={{ preDeleteCommand, setPreDeleteCommand, preDeleteTimeout, setPreDeleteTimeout }}
      />
    </ProjectConfigShell>
  )
}

interface ProjectConfigShellProps {
  repositoryName: string
  section: ProjectConfigSection
  setSection: (section: ProjectConfigSection) => void
  requestClose: () => void
  saving: boolean
  saveError: string | null
  showUnsaved: boolean
  setShowUnsaved: (value: boolean) => void
  onClose: () => void
  handleSave: () => Promise<void>
  children: ReactNode
}

function ProjectConfigShell({
  repositoryName,
  section,
  setSection,
  requestClose,
  saving,
  saveError,
  showUnsaved,
  setShowUnsaved,
  onClose,
  handleSave,
  children,
}: ProjectConfigShellProps) {
  return (
    <Dialog
      titleId="project-settings-title"
      onClose={requestClose}
      canClose={!saving}
      size="wide"
      initialFocus={`#project-tab-${section}`}
    >
      <div className="flex max-h-[90vh] flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="project-settings-title" className="text-lg font-semibold">
              Project settings
            </h2>
            <p className="text-xs text-muted">{repositoryName}</p>
          </div>
          <IconButton onClick={requestClose} variant="quiet" aria-label="Close project settings">
            <X className="h-5 w-5" />
          </IconButton>
        </div>
        <SettingsTabs
          tabs={sectionTabs}
          section={section}
          onChange={setSection}
          prefix="project"
          label="Project settings sections"
        />
        <div
          id="project-panel"
          role="tabpanel"
          aria-labelledby={`project-tab-${section}`}
          tabIndex={0}
          className="min-h-0 flex-1 space-y-6 overflow-auto px-6 py-6"
        >
          {children}
        </div>
        {saveError && !showUnsaved && (
          <p role="alert" className="px-6 pb-2 text-sm text-destructive">
            {saveError}
          </p>
        )}
        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-4">
          <Button onClick={requestClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} loading={saving}>
            Save
          </Button>
        </div>
      </div>
      {showUnsaved && (
        <UnsavedChangesDialog
          onKeep={() => setShowUnsaved(false)}
          onDiscard={onClose}
          onSave={() => void handleSave()}
          saving={saving}
          error={saveError}
        />
      )}
    </Dialog>
  )
}

interface ProjectConfigPanelProps {
  section: ProjectConfigSection
  general: GeneralSectionProps
  connection: ProviderSectionProps
  worktrees: Parameters<typeof WorktreeLocationSection>[0]
  postCreate: Parameters<typeof PostCreateSetupSection>[0]
  actions: ActionsSectionProps
  cleanup: CleanupSectionProps
}

function ProjectConfigPanel({
  section,
  general,
  connection,
  worktrees,
  postCreate,
  actions,
  cleanup,
}: ProjectConfigPanelProps) {
  if (section === 'general') return <GeneralSection {...general} />
  if (section === 'connection') return <ProviderSection {...connection} />
  if (section === 'worktrees') return <WorktreeLocationSection {...worktrees} />
  return (
    <div className="space-y-6">
      <PostCreateSetupSection {...postCreate} />
      <div className="border-t border-border pt-6">
        <ActionsSection {...actions} />
      </div>
      <div className="border-t border-border pt-6">
        <CleanupSection {...cleanup} />
      </div>
    </div>
  )
}

interface GeneralSectionProps {
  baseBranch: string
  setBaseBranch: (b: string) => void
  workingSubdirectory: string
  setWorkingSubdirectory: (value: string) => void
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
  workingSubdirectory,
  setWorkingSubdirectory,
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
      <Field
        htmlFor="base-branch"
        label={
          <span className="flex items-center gap-2">
            Base branch {loadingBranches && <Loader2 className="h-3 w-3 animate-spin text-muted" />}
          </span>
        }
      >
        <Select id="base-branch" value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)}>
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
        </Select>
        {defaultBranch && baseBranch !== defaultBranch ? (
          <p className="mt-1 flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              The repository’s default branch is{' '}
              <span className="font-medium">{defaultBranch}</span>. Merge, ahead/behind, and “safe
              to delete” checks will use <span className="font-medium">{baseBranch}</span> instead.
            </span>
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted">
            Detected from <code className="text-[11px]">origin/HEAD</code>. Used to check merge
            status.
          </p>
        )}
      </Field>

      <div>
        <label htmlFor="working-subdirectory" className="mb-1 block text-sm font-medium">
          Working subdirectory
        </label>
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-mono text-xs text-muted">&lt;worktree&gt;/</span>
          <TextInput
            id="working-subdirectory"
            type="text"
            value={workingSubdirectory}
            onChange={(e) => setWorkingSubdirectory(e.target.value)}
            placeholder="apps/web"
            spellCheck={false}
            className="min-w-0 flex-1 font-mono"
          />
        </div>
        <p className="mt-1 text-xs text-muted">
          For projects whose app lives one folder down. “Open in terminal” and custom actions start
          here; worktrees without the folder fall back to their root.
        </p>
      </div>

      <div>
        <label htmlFor="preferred-editor" className="mb-1 block text-sm font-medium">
          Editor for this project
        </label>
        <Select
          id="preferred-editor"
          value={preferredEditor}
          onChange={(e) => setPreferredEditor(e.target.value)}
        >
          <option value="">App default</option>
          {editorOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </Select>
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
            <TextInput
              id="project-image-url"
              type="text"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/logo.png or data URL"
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

interface ActionsSectionProps {
  actions: ProjectAction[]
  setActions: (next: ProjectAction[]) => void
  /** Only to tell the user where these commands will actually run. */
  workingSubdirectory: string
}

/** Ids only have to be unique within one project's list. */
function newActionId(): string {
  return `action-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function ActionsSection({ actions, setActions, workingSubdirectory }: ActionsSectionProps) {
  const update = (id: string, patch: Partial<ProjectAction>) => {
    setActions(actions.map((action) => (action.id === id ? { ...action, ...patch } : action)))
  }

  const add = () => {
    setActions([
      ...actions,
      { id: newActionId(), label: '', command: '', icon: 'play', mode: 'terminal' },
    ])
  }

  const where = workingSubdirectory.trim() ? `${workingSubdirectory.trim()}/` : 'the worktree root'

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Custom actions</h3>
          <p className="mt-0.5 text-xs text-muted">
            A button on every worktree row of this project, run in {where} — a dev server, a
            simulator, whatever this repo needs.
          </p>
        </div>
        <button
          type="button"
          onClick={add}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" />
          Add action
        </button>
      </div>

      {actions.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted">
          No actions yet. Add one to get a button like{' '}
          <code className="font-mono text-[11px] text-primary">npm run dev:local</code> on each row.
        </p>
      ) : (
        <ul className="space-y-2">
          {actions.map((action) => (
            <li key={action.id} className="rounded-md border border-border bg-background p-2">
              <ActionRow
                action={action}
                onChange={(patch) => update(action.id, patch)}
                onRemove={() =>
                  setActions(actions.filter((candidate) => candidate.id !== action.id))
                }
              />
            </li>
          ))}
        </ul>
      )}

      {actions.length > 0 && (
        <p className="text-[11px] leading-relaxed text-muted">
          “New terminal” opens a window in your terminal from Settings, so a long-running command
          keeps printing and stops with ctrl-C. “Background” runs inside the app and reports the
          output when it finishes. Both get{' '}
          <code className="font-mono text-warning">$WORKTREE_PATH</code>,{' '}
          <code className="font-mono text-warning">$WORKTREE_BRANCH</code>,{' '}
          <code className="font-mono text-warning">$REPO_PATH</code> and{' '}
          <code className="font-mono text-warning">$REPO_NAME</code>.
        </p>
      )}
    </section>
  )
}

function ActionRow({
  action,
  onChange,
  onRemove,
}: {
  action: ProjectAction
  onChange: (patch: Partial<ProjectAction>) => void
  onRemove: () => void
}) {
  const Icon = ACTION_ICONS[action.icon]
  const field =
    'rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none focus:border-primary'

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <Select
          aria-label="Action icon"
          value={action.icon}
          onChange={(e) => onChange({ icon: e.target.value as ProjectAction['icon'] })}
          className={cn(field, 'w-[104px]')}
        >
          {ACTION_ICON_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
        <input
          type="text"
          aria-label="Button label"
          value={action.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Dev"
          className={cn(field, 'w-28 font-medium')}
        />
        <Select
          aria-label="Where the command runs"
          value={action.mode}
          onChange={(e) => onChange({ mode: e.target.value as ProjectAction['mode'] })}
          className={cn(field, 'w-[132px]')}
        >
          <option value="terminal">New terminal</option>
          <option value="background">Background</option>
        </Select>
        {action.mode === 'background' && (
          <label className="flex items-center gap-1 text-[11px] text-muted">
            <input
              type="number"
              min={1}
              aria-label="Timeout in seconds"
              value={action.timeoutSeconds ? String(action.timeoutSeconds) : ''}
              onChange={(e) => {
                const raw = e.target.value.trim()
                const seconds = raw === '' ? undefined : Number(raw)
                onChange({
                  timeoutSeconds:
                    seconds !== undefined &&
                    Number.isSafeInteger(seconds) &&
                    seconds >= 1 &&
                    seconds <= 86400
                      ? seconds
                      : undefined,
                })
              }}
              placeholder="600"
              className={cn(field, 'w-16 text-right')}
            />
            s
          </label>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove action ${action.label || 'without a label'}`}
          className="shrink-0 rounded p-1 text-muted hover:text-destructive"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <input
        type="text"
        aria-label="Command"
        value={action.command}
        onChange={(e) => onChange({ command: e.target.value })}
        placeholder="npm run dev:local"
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        className={cn(field, 'w-full font-mono')}
      />
    </div>
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
        label="Cleanup command"
        className="h-32"
        value={preDeleteCommand}
        onChange={setPreDeleteCommand}
        placeholder="Leave empty to skip"
      />

      <p className="text-xs leading-relaxed text-muted">
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
  lastSuccessfulCheck: number
  currentSource: string | undefined
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
  lastSuccessfulCheck,
  currentSource,
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
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Pull requests</h3>
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
        <label htmlFor="provider-type" className="mb-1 block text-sm font-medium">
          Provider
        </label>
        <Select
          id="provider-type"
          value={provider.type}
          onChange={(e) =>
            setProviderField({ type: e.target.value as ProviderConfig['type'] | '' })
          }
        >
          <option value="">None</option>
          <option value="github">GitHub</option>
          <option value="azure">Azure DevOps</option>
        </Select>
      </div>

      {provider.type === 'github' && (
        <div className="grid gap-3">
          <div>
            <label htmlFor="github-owner" className="mb-1 block text-sm font-medium">
              Owner / organization
            </label>
            <TextInput
              id="github-owner"
              type="text"
              value={provider.organization}
              onChange={(e) => setProviderField({ organization: e.target.value })}
              placeholder="owner"
            />
          </div>
          <div>
            <label htmlFor="github-repo" className="mb-1 block text-sm font-medium">
              Repository
            </label>
            <TextInput
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
            />
          </div>
        </div>
      )}

      {provider.type === 'azure' && (
        <div className="grid gap-3">
          <p className="text-xs text-muted">
            Org, project, and repo are filled from <code className="text-[11px]">origin</code> when
            possible — you usually only need a PAT.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="azure-organization" className="mb-1 block text-sm font-medium">
                Organization
              </label>
              <TextInput
                id="azure-organization"
                type="text"
                value={provider.organization}
                onChange={(e) => setProviderField({ organization: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="azure-project" className="mb-1 block text-sm font-medium">
                Project
              </label>
              <TextInput
                id="azure-project"
                type="text"
                value={provider.project}
                onChange={(e) => setProviderField({ project: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label htmlFor="azure-repo" className="mb-1 block text-sm font-medium">
              Repository
            </label>
            <TextInput
              id="azure-repo"
              type="text"
              value={provider.repoName}
              onChange={(e) => setProviderField({ repoName: e.target.value })}
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
          <TextInput
            id="provider-token"
            type="password"
            value={provider.token}
            onChange={(e) => setProviderField({ token: e.target.value })}
            placeholder={
              provider.type === 'github' ? 'ghp_… or leave empty to use Settings' : 'Azure PAT'
            }
          />
          {tokenHint && <p className="mt-1 text-xs text-muted">{tokenHint}</p>}
          <p className="mt-1 text-xs text-muted">
            Optional per-repo. Global tokens live in Settings and apply to all projects.
          </p>
          <p className="mt-2 text-xs text-muted">
            Current connection:{' '}
            {lastSuccessfulCheck
              ? `last successful check ${new Date(lastSuccessfulCheck).toLocaleString()}`
              : 'not yet checked successfully'}
            {currentSource ? ` · ${currentSource} credential` : ''}.
          </p>
        </div>
      )}
    </section>
  )
}
