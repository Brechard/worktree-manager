import { useEffect, useState } from 'react'
import { ArrowLeft, KeyRound, Loader2, Plus, X } from 'lucide-react'
import { useAppStore } from '../store'
import { api } from '../api'
import { cn } from '../lib/utils'
import { EDITOR_OPTIONS, TERMINAL_OPTIONS, shortenPath } from '../lib/paths'
import { applyTheme, type Theme } from '../lib/theme'
import { TitleBar } from './TitleBar'

function useSettings() {
  const { settings, setSettings, setView } = useAppStore()
  const [editor, setEditor] = useState(settings?.defaultEditor ?? 'cursor')
  const [terminal, setTerminal] = useState(settings?.defaultTerminal ?? '')
  const [theme, setTheme] = useState<Theme>(settings?.theme ?? 'system')
  const [dirs, setDirs] = useState<string[]>(settings?.watchedDirectories ?? [])
  const [githubToken, setGithubToken] = useState(settings?.githubToken ?? '')
  const [azureToken, setAzureToken] = useState(settings?.azureToken ?? '')
  const [saving, setSaving] = useState(false)
  const [detecting, setDetecting] = useState<'github' | 'azure' | null>(null)
  const [tokenMsg, setTokenMsg] = useState<string | null>(null)
  const [version, setVersion] = useState<string>('')

  useEffect(() => {
    api
      .getAppVersion()
      .then(setVersion)
      .catch(() => { })
  }, [])

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

  const nextSettings = () => ({
    watchedDirectories: dirs,
    defaultEditor: editor,
    theme,
    ...(terminal ? { defaultTerminal: terminal } : {}),
    ...(githubToken ? { githubToken } : {}),
    ...(azureToken ? { azureToken } : {}),
    worktreeSort: settings?.worktreeSort ?? 'activity',
    worktreeSortDirection: settings?.worktreeSortDirection ?? 'desc',
  })

  const hasChanges = () => {
    const current = nextSettings()
    const prev = {
      watchedDirectories: settings?.watchedDirectories ?? [],
      defaultEditor: settings?.defaultEditor ?? 'cursor',
      theme: settings?.theme ?? 'system',
      defaultTerminal: settings?.defaultTerminal ?? '',
      githubToken: settings?.githubToken ?? '',
      azureToken: settings?.azureToken ?? '',
      worktreeSort: settings?.worktreeSort ?? 'activity',
      worktreeSortDirection: settings?.worktreeSortDirection ?? 'desc',
    }
    return (
      JSON.stringify({ ...current, watchedDirectories: [...current.watchedDirectories].sort() }) !==
      JSON.stringify({ ...prev, watchedDirectories: [...prev.watchedDirectories].sort() })
    )
  }

  const save = async () => {
    setSaving(true)
    try {
      const next = nextSettings()
      await api.setSettings(next)
      setSettings(next)
      setView('dashboard')
    } finally {
      setSaving(false)
    }
  }

  const goBack = () => {
    if (!hasChanges()) {
      setView('dashboard')
      return
    }
    const saveChanges = window.confirm('You have unsaved changes. Save before going back?')
    if (saveChanges) {
      void save()
    } else {
      applyTheme(settings?.theme ?? 'system')
      setView('dashboard')
    }
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
    githubToken,
    setGithubToken,
    azureToken,
    setAzureToken,
    detecting,
    detect,
    tokenMsg,
    saving,
    save,
    version,
    goBack,
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
}: {
  editor: string
  setEditor: (value: string) => void
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
      <select
        id="default-editor"
        value={editor}
        onChange={(e) => setEditor(e.target.value)}
        aria-label="Default editor"
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
      >
        {EDITOR_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
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
      <select
        id="default-terminal"
        value={terminal}
        onChange={(e) => setTerminal(e.target.value)}
        aria-label="Default terminal"
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
      >
        {TERMINAL_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.command}>
            {opt.label}
          </option>
        ))}
      </select>
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
        Used for PR lookup when a project has no token. GitHub/Azure org+repo are auto-detected
        from git remotes.
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
          <input
            id="github-token"
            type="password"
            value={githubToken}
            onChange={(e) => setGithubToken(e.target.value)}
            placeholder="ghp_… or empty"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
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
          <input
            id="azure-token"
            type="password"
            value={azureToken}
            onChange={(e) => setAzureToken(e.target.value)}
            placeholder="PAT or empty"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
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
        <button
          type="button"
          onClick={addDir}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" />
          Add folder
        </button>
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
              <button
                type="button"
                onClick={() => removeDir(i)}
                aria-label="Remove directory"
                className="ml-2 text-muted hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SettingsFooter({
  saving,
  save,
  version,
}: {
  saving: boolean
  save: () => void
  version: string
}) {
  return (
    <div className="flex items-center justify-between border-t border-border px-6 py-3">
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
      {version && <span className="text-xs text-muted">v{version}</span>}
    </div>
  )
}

function SettingsForm() {
  const s = useSettings()

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <TitleBar
        title="Settings"
        trailing={
          <button
            type="button"
            onClick={s.goBack}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
        }
      />

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-xl space-y-8">
          <AppearanceSection theme={s.theme} previewTheme={s.previewTheme} />
          <DefaultEditorSection editor={s.editor} setEditor={s.setEditor} />
          <DefaultTerminalSection terminal={s.terminal} setTerminal={s.setTerminal} />
          <ProviderTokensSection
            githubToken={s.githubToken}
            setGithubToken={s.setGithubToken}
            azureToken={s.azureToken}
            setAzureToken={s.setAzureToken}
            detecting={s.detecting}
            detect={s.detect}
            tokenMsg={s.tokenMsg}
          />
          <WatchedDirectoriesSection dirs={s.dirs} addDir={s.addDir} removeDir={s.removeDir} />
        </div>
      </div>

      <SettingsFooter saving={s.saving} save={s.save} version={s.version} />
    </div>
  )
}

export function Settings() {
  return <SettingsForm />
}
