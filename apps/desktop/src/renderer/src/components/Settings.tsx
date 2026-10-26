import { useEffect, useState } from 'react'
import { KeyRound, Loader2, Plus, X } from 'lucide-react'
import { useAppStore } from '../store'
import type { PullRequestLookup, WorktreeLocation } from '@worktree/contracts'
import { api } from '../api'
import { cn } from '../lib/utils'
import { isMacPlatform, shortcutLabel } from '../lib/dashboardShortcut'
import {
  editorOptionsForIds,
  sortEditorOptions,
  type EditorOption,
  TERMINAL_OPTIONS,
  shortenPath,
} from '../lib/paths'
import { applyTheme, type Theme } from '../lib/theme'
import { buildSettingsDraft, settingsDraftChanged } from '../lib/settingsDraft'
import { ScanSourcesSetting } from './ScanSourcesSetting'
import { Button, IconButton } from './ui/Button'
import { Select, TextInput } from './ui/Field'
import { UnsavedChangesDialog } from './ui/UnsavedChangesDialog'
import { Dialog } from './ui/Dialog'
import { SettingsTabs } from './ui/SettingsTabs'

type SettingsSection = 'general' | 'connections' | 'worktrees' | 'scanning'

const sectionTabs: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'connections', label: 'Connections' },
  { id: 'worktrees', label: 'Worktrees' },
  { id: 'scanning', label: 'Scanning' },
]

function useSettings() {
  const { settings, setSettings, closeSettings } = useAppStore()
  const [editor, setEditor] = useState(settings?.defaultEditor ?? 'cursor')
  const [terminal, setTerminal] = useState(settings?.defaultTerminal ?? '')
  const [theme, setTheme] = useState<Theme>(settings?.theme ?? 'system')
  const [dirs, setDirs] = useState<string[]>(settings?.watchedDirectories ?? [])
  const [excluded, setExcluded] = useState<string[]>(settings?.excludedPaths ?? [])
  const [includeAgentWorktrees, setIncludeAgentWorktrees] = useState(
    settings?.includeAgentWorktrees ?? false
  )
  const [defaultWorktreeLocation, setDefaultWorktreeLocation] = useState<WorktreeLocation>(
    settings?.defaultWorktreeLocation ?? 'sibling'
  )
  const [defaultWorktreeCustomParent, setDefaultWorktreeCustomParent] = useState(
    settings?.defaultWorktreeCustomParent ?? ''
  )
  const [githubToken, setGithubToken] = useState(settings?.githubToken ?? '')
  const [azureToken, setAzureToken] = useState(settings?.azureToken ?? '')
  const [saving, setSaving] = useState(false)
  const [showUnsaved, setShowUnsaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [detecting, setDetecting] = useState<'github' | 'azure' | null>(null)
  const [tokenMsg, setTokenMsg] = useState<string | null>(null)
  const [connection, setConnection] = useState<PullRequestLookup | null>(null)
  const [checkingConnection, setCheckingConnection] = useState(false)
  const [connectionRepoId, setConnectionRepoId] = useState(
    () => useAppStore.getState().selectedRepositoryId ?? ''
  )
  const repositories = useAppStore((state) => state.repositories)
  const [version, setVersion] = useState<string>('')
  const [availableEditorIds, setAvailableEditorIds] = useState<string[] | null>(null)

  useEffect(() => {
    api
      .getAppVersion()
      .then(setVersion)
      .catch(() => {})
  }, [])

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

  const editorOptions = sortEditorOptions(editorOptionsForIds(availableEditorIds, [editor]))

  const previewTheme = (t: Theme) => {
    setTheme(t)
    applyTheme(t)
  }

  const addDir = async () => {
    const paths = await api.openDirectoryDialog()
    if (paths.length) setDirs((prev) => Array.from(new Set([...prev, ...paths])))
  }

  const removeDir = (i: number) => {
    setDirs((prev) => prev.filter((_, idx) => idx !== i))
  }

  const addExcluded = async () => {
    const paths = await api.openDirectoryDialog()
    if (paths.length) setExcluded((prev) => Array.from(new Set([...prev, ...paths])))
  }

  const removeExcluded = (i: number) => {
    setExcluded((prev) => prev.filter((_, idx) => idx !== i))
  }

  const detect = async (provider: 'github' | 'azure') => {
    setDetecting(provider)
    setTokenMsg(null)
    try {
      const found = await api.detectProviderToken(provider)
      if (!found?.token) {
        setTokenMsg(
          provider === 'github'
            ? 'No GitHub token found (try `gh auth login`).'
            : 'No Azure token found (try `az login` or AZURE_DEVOPS_EXT_PAT).'
        )
        return
      }
      if (provider === 'github') setGithubToken(found.token)
      else setAzureToken(found.token)
      setTokenMsg(`Loaded ${provider} token from ${found.source}`)
    } finally {
      setDetecting(null)
    }
  }

  const nextSettings = () =>
    buildSettingsDraft(settings, {
      dirs,
      excluded,
      editor,
      terminal,
      theme,
      githubToken,
      azureToken,
      includeAgentWorktrees,
      defaultWorktreeLocation,
      defaultWorktreeCustomParent,
    })

  const hasChanges = () => settingsDraftChanged(settings, nextSettings())

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const next = nextSettings()
      await api.setSettings(next)
      setSettings(next)
      closeSettings()
    } catch (error) {
      const message = `Could not save settings: ${String(error)}`
      setTokenMsg(message)
      setSaveError(message)
    } finally {
      setSaving(false)
    }
  }

  const checkConnection = async () => {
    if (!connectionRepoId) return
    setCheckingConnection(true)
    setConnection(null)
    try {
      setConnection(await api.checkProviderConnection(connectionRepoId))
    } catch (error) {
      setTokenMsg(`Could not check provider connection: ${String(error)}`)
    } finally {
      setCheckingConnection(false)
    }
  }

  const goBack = () => {
    if (!hasChanges()) {
      closeSettings()
      return
    }
    setShowUnsaved(true)
  }

  const discardChanges = () => {
    applyTheme(settings?.theme ?? 'system')
    setShowUnsaved(false)
    closeSettings()
  }

  return {
    editor,
    setEditor,
    terminal,
    setTerminal,
    theme,
    previewTheme,
    dirs,
    addDir,
    removeDir,
    excluded,
    addExcluded,
    removeExcluded,
    includeAgentWorktrees,
    setIncludeAgentWorktrees,
    defaultWorktreeLocation,
    setDefaultWorktreeLocation,
    defaultWorktreeCustomParent,
    setDefaultWorktreeCustomParent,
    githubToken,
    setGithubToken,
    azureToken,
    setAzureToken,
    detecting,
    detect,
    tokenMsg,
    connection,
    checkingConnection,
    connectionRepoId,
    setConnectionRepoId,
    repositories,
    checkConnection,
    editorOptions,
    saving,
    save,
    version,
    goBack,
    showUnsaved,
    setShowUnsaved,
    discardChanges,
    saveError,
  }
}

function AppearanceSection({
  theme,
  previewTheme,
}: {
  theme: Theme
  previewTheme: (t: Theme) => void
}) {
  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Appearance</h2>
      <div className="flex items-center gap-2">
        {(['system', 'light', 'dark'] as const).map((t) => (
          <button
            type="button"
            key={t}
            aria-pressed={theme === t}
            onClick={() => previewTheme(t)}
            className={cn(
              'rounded-md border border-border px-3 py-1.5 text-sm capitalize',
              theme === t ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'
            )}
          >
            {t}
          </button>
        ))}
      </div>
    </section>
  )
}

function DefaultEditorSection({
  editor,
  setEditor,
  editorOptions,
}: {
  editor: string
  setEditor: (value: string) => void
  editorOptions: EditorOption[]
}) {
  return (
    <section>
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
        Default editor
      </h2>
      <p className="mb-3 text-xs text-muted">
        Fallback when a project has no editor of its own. Prefer setting the editor on the project
        header (“Open with”).
      </p>
      <Select
        id="default-editor"
        value={editor}
        onChange={(e) => setEditor(e.target.value)}
        aria-label="Default editor"
      >
        {editorOptions.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </Select>
    </section>
  )
}

function DefaultTerminalSection({
  terminal,
  setTerminal,
}: {
  terminal: string
  setTerminal: (value: string) => void
}) {
  return (
    <section>
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
        Default terminal
      </h2>
      <p className="mb-3 text-xs text-muted">macOS app name, or system default.</p>
      <Select
        id="default-terminal"
        value={terminal}
        onChange={(e) => setTerminal(e.target.value)}
        aria-label="Default terminal"
      >
        {TERMINAL_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.command}>
            {opt.label}
          </option>
        ))}
      </Select>
    </section>
  )
}

function WorktreeCreationDefaults({
  location,
  setLocation,
  customParent,
  setCustomParent,
}: {
  location: WorktreeLocation
  setLocation: (value: WorktreeLocation) => void
  customParent: string
  setCustomParent: (value: string) => void
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">New worktrees</h2>
        <p className="mt-1 text-xs text-muted">
          Default location for projects without their own preference. You can change it during
          creation.
        </p>
      </div>
      <Select
        aria-label="Default worktree location"
        value={location}
        onChange={(event) => setLocation(event.target.value as WorktreeLocation)}
      >
        <option value="sibling">Beside project — &lt;project&gt;.worktrees</option>
        <option value="inside">Inside project — .worktrees</option>
        <option value="managed">~/.worktree-manager</option>
        <option value="custom">Custom parent directory</option>
      </Select>
      {location === 'custom' && (
        <TextInput
          aria-label="Default custom parent directory"
          value={customParent}
          onChange={(event) => setCustomParent(event.target.value)}
          placeholder="/absolute/path/to/worktrees"
          className="font-mono"
        />
      )}
    </section>
  )
}

function ProviderTokensSection({
  githubToken,
  setGithubToken,
  azureToken,
  setAzureToken,
  detecting,
  detect,
  tokenMsg,
}: {
  githubToken: string
  setGithubToken: (value: string) => void
  azureToken: string
  setAzureToken: (value: string) => void
  detecting: 'github' | 'azure' | null
  detect: (provider: 'github' | 'azure') => void
  tokenMsg: string | null
}) {
  return (
    <section>
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
        Provider tokens
      </h2>
      <p className="mb-3 text-xs text-muted">
        Used for PR lookup when a project has no token. GitHub/Azure org+repo are auto-detected from
        git remotes.
      </p>
      {tokenMsg && <p className="mb-2 text-xs text-muted">{tokenMsg}</p>}
      <div className="space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="github-token" className="text-sm font-medium">
              GitHub token
            </label>
            <button
              type="button"
              onClick={() => detect('github')}
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              {detecting === 'github' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <KeyRound className="h-3 w-3" />
              )}
              Detect
            </button>
          </div>
          <TextInput
            id="github-token"
            type="password"
            value={githubToken}
            onChange={(e) => setGithubToken(e.target.value)}
            placeholder="ghp_… or empty"
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="azure-token" className="text-sm font-medium">
              Azure DevOps PAT
            </label>
            <button
              type="button"
              onClick={() => detect('azure')}
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              {detecting === 'azure' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <KeyRound className="h-3 w-3" />
              )}
              Detect
            </button>
          </div>
          <TextInput
            id="azure-token"
            type="password"
            value={azureToken}
            onChange={(e) => setAzureToken(e.target.value)}
            placeholder="PAT or empty"
          />
        </div>
      </div>
    </section>
  )
}

function WatchedDirectoriesSection({
  dirs,
  addDir,
  removeDir,
}: {
  dirs: string[]
  addDir: () => void
  removeDir: (i: number) => void
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
          Watched directories
        </h2>
        <Button size="compact" variant="primary" onClick={addDir}>
          <Plus className="h-3.5 w-3.5" />
          Add folder
        </Button>
      </div>
      {dirs.length === 0 ? (
        <p className="text-sm text-muted">No folders watched yet.</p>
      ) : (
        <ul className="space-y-2">
          {dirs.map((dir, i) => (
            <li
              key={dir}
              className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <span className="truncate font-mono text-xs" title={dir}>
                {shortenPath(dir)}
              </span>
              <IconButton
                size="compact"
                variant="quiet"
                onClick={() => removeDir(i)}
                aria-label="Remove directory"
                className="ml-2"
              >
                <X className="h-4 w-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ExcludedPathsSection({
  excluded,
  addExcluded,
  removeExcluded,
}: {
  excluded: string[]
  addExcluded: () => void
  removeExcluded: (i: number) => void
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Excluded folders
          </h2>
          <p className="mt-1 text-xs text-muted">
            These paths are skipped when discovering worktrees.
          </p>
        </div>
        <Button size="compact" variant="primary" onClick={addExcluded}>
          <Plus className="h-3.5 w-3.5" />
          Add folder
        </Button>
      </div>
      {excluded.length === 0 ? (
        <p className="text-sm text-muted">No excluded folders.</p>
      ) : (
        <ul className="space-y-2">
          {excluded.map((dir, i) => (
            <li
              key={dir}
              className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <span className="truncate font-mono text-xs" title={dir}>
                {shortenPath(dir)}
              </span>
              <IconButton
                size="compact"
                variant="quiet"
                onClick={() => removeExcluded(i)}
                aria-label="Remove excluded folder"
                className="ml-2"
              >
                <X className="h-4 w-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

type SettingsModel = ReturnType<typeof useSettings>

function connectionStatus(connection: PullRequestLookup): string {
  switch (connection.state) {
    case 'error':
      return connection.error?.message ?? 'Provider check failed.'
    case 'none':
      return 'Connected. No pull request was found for the checked branch.'
    case 'found':
      return 'Connected. Pull request found.'
    case 'not-configured':
      return 'No provider is configured for this project.'
    default:
      return 'This branch does not need a pull request lookup.'
  }
}

function GeneralSettingsContent({ s }: { s: SettingsModel }) {
  const mac = isMacPlatform()
  return (
    <>
      <AppearanceSection theme={s.theme} previewTheme={s.previewTheme} />
      <DefaultEditorSection
        editor={s.editor}
        setEditor={s.setEditor}
        editorOptions={s.editorOptions}
      />
      <DefaultTerminalSection terminal={s.terminal} setTerminal={s.setTerminal} />
      <section className="border-t border-border pt-5" aria-labelledby="settings-shortcuts-title">
        <h2
          id="settings-shortcuts-title"
          className="text-xs font-semibold uppercase tracking-wider text-muted"
        >
          Keyboard shortcuts
        </h2>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
          <dt>New worktree</dt>
          <dd className="font-mono text-muted">{shortcutLabel('N', mac)}</dd>
          <dt>Search worktrees</dt>
          <dd className="font-mono text-muted">{shortcutLabel('F', mac)}</dd>
          <dt>Settings</dt>
          <dd className="font-mono text-muted">{shortcutLabel(',', mac)}</dd>
          <dt>Create from a single-line field</dt>
          <dd className="font-mono text-muted">
            Enter, Shift+Enter, or {shortcutLabel('Enter', mac)}
          </dd>
          <dt>Close a dialog</dt>
          <dd className="font-mono text-muted">Esc</dd>
        </dl>
      </section>
      <section className="border-t border-border pt-5" aria-labelledby="settings-about-title">
        <h2
          id="settings-about-title"
          className="text-xs font-semibold uppercase tracking-wider text-muted"
        >
          About
        </h2>
        <p className="mt-2 text-xs text-muted">
          Worktree Manager{s.version ? ` · v${s.version}` : ''} · Made by{' '}
          <button
            type="button"
            onClick={() => void api.openExternal('https://clubtidy.fr')}
            className="text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            ClubTidy
          </button>
        </p>
      </section>
    </>
  )
}

function ConnectionSettingsContent({ s }: { s: SettingsModel }) {
  return (
    <>
      <ProviderTokensSection
        githubToken={s.githubToken}
        setGithubToken={s.setGithubToken}
        azureToken={s.azureToken}
        setAzureToken={s.setAzureToken}
        detecting={s.detecting}
        detect={s.detect}
        tokenMsg={s.tokenMsg}
      />
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Check provider connection</h2>
        <p className="mt-1 text-xs text-muted">
          Checks the effective credential for one project. Save token changes before checking.
        </p>
        <div className="mt-3 flex gap-2">
          <Select
            value={s.connectionRepoId}
            onChange={(event) => s.setConnectionRepoId(event.target.value)}
            aria-label="Project to check"
          >
            <option value="">Select a project</option>
            {s.repositories.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.name}
              </option>
            ))}
          </Select>
          <Button
            variant="primary"
            disabled={!s.connectionRepoId}
            loading={s.checkingConnection}
            onClick={() => void s.checkConnection()}
          >
            {s.checkingConnection ? 'Checking…' : 'Test connection'}
          </Button>
        </div>
        {s.repositories.length === 0 && (
          <p className="mt-2 text-xs text-muted">
            Add a project before testing a provider credential.
          </p>
        )}
        {s.connection && (
          <p role="status" className="mt-3 text-sm text-muted">
            {connectionStatus(s.connection)}{' '}
            {s.connection.credentialSource && s.connection.credentialSource !== 'none'
              ? `Credential: ${s.connection.credentialSource}.`
              : ''}
          </p>
        )}
      </section>
    </>
  )
}

function WorktreeSettingsContent({ s }: { s: SettingsModel }) {
  return (
    <WorktreeCreationDefaults
      location={s.defaultWorktreeLocation}
      setLocation={s.setDefaultWorktreeLocation}
      customParent={s.defaultWorktreeCustomParent}
      setCustomParent={s.setDefaultWorktreeCustomParent}
    />
  )
}

function ScanningSettingsContent({ s }: { s: SettingsModel }) {
  return (
    <>
      <WatchedDirectoriesSection dirs={s.dirs} addDir={s.addDir} removeDir={s.removeDir} />
      <ScanSourcesSetting
        includeAgentWorktrees={s.includeAgentWorktrees}
        onChange={s.setIncludeAgentWorktrees}
      />
      <ExcludedPathsSection
        excluded={s.excluded}
        addExcluded={s.addExcluded}
        removeExcluded={s.removeExcluded}
      />
    </>
  )
}

function SettingsContent({ section, s }: { section: SettingsSection; s: SettingsModel }) {
  if (section === 'general') return <GeneralSettingsContent s={s} />
  if (section === 'connections') return <ConnectionSettingsContent s={s} />
  if (section === 'worktrees') return <WorktreeSettingsContent s={s} />
  if (section === 'scanning') return <ScanningSettingsContent s={s} />
  return null
}

function SettingsForm({ initialSection }: { initialSection: SettingsSection }) {
  const s = useSettings()
  const [section, setSection] = useState<SettingsSection>(initialSection)

  return (
    <Dialog
      titleId="app-settings-title"
      onClose={s.goBack}
      canClose={!s.saving && !s.showUnsaved}
      size="wide"
      initialFocus={`#app-settings-tab-${initialSection}`}
    >
      <div className="flex max-h-[90vh] min-h-0 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <h2 id="app-settings-title" className="text-lg font-semibold">
            Settings
          </h2>
          <IconButton
            onClick={s.goBack}
            variant="quiet"
            aria-label="Close settings"
            disabled={s.saving}
          >
            <X className="h-5 w-5" />
          </IconButton>
        </div>

        <SettingsTabs
          tabs={sectionTabs}
          section={section}
          onChange={setSection}
          prefix="app-settings"
          label="Settings sections"
        />

        <div
          id="app-settings-panel"
          role="tabpanel"
          aria-labelledby={`app-settings-tab-${section}`}
          tabIndex={0}
          className="min-h-0 flex-1 space-y-6 overflow-y-auto overflow-x-hidden px-6 py-6"
        >
          <SettingsContent section={section} s={s} />
        </div>

        {s.saveError && !s.showUnsaved && (
          <p role="alert" className="px-6 pb-2 text-sm text-destructive">
            {s.saveError}
          </p>
        )}
        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-4">
          <Button onClick={s.goBack} disabled={s.saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void s.save()} loading={s.saving}>
            Save changes
          </Button>
        </div>
      </div>
      {s.showUnsaved && (
        <UnsavedChangesDialog
          onKeep={() => s.setShowUnsaved(false)}
          onDiscard={s.discardChanges}
          onSave={() => void s.save()}
          saving={s.saving}
          error={s.saveError}
        />
      )}
    </Dialog>
  )
}

export function Settings({ initialSection = 'general' }: { initialSection?: SettingsSection }) {
  return <SettingsForm initialSection={initialSection} />
}
