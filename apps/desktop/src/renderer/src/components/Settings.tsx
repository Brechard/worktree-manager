import { useState } from 'react'
import { ArrowLeft, KeyRound, Loader2, Plus, X } from 'lucide-react'
import { useAppStore } from '../store'
import { api } from '../api'
import { cn } from '../lib/utils'
import { EDITOR_OPTIONS, TERMINAL_OPTIONS, shortenPath } from '../lib/paths'
import { TitleBar } from './TitleBar'

export function Settings() {
  const { settings, setSettings, setView } = useAppStore()
  const [editor, setEditor] = useState(settings?.defaultEditor ?? 'cursor')
  const [terminal, setTerminal] = useState(settings?.defaultTerminal ?? '')
  const [theme, setTheme] = useState(settings?.theme ?? 'system')
  const [dirs, setDirs] = useState<string[]>(settings?.watchedDirectories ?? [])
  const [githubToken, setGithubToken] = useState(settings?.githubToken ?? '')
  const [azureToken, setAzureToken] = useState(settings?.azureToken ?? '')
  const [saving, setSaving] = useState(false)
  const [detecting, setDetecting] = useState<'github' | 'azure' | null>(null)
  const [tokenMsg, setTokenMsg] = useState<string | null>(null)

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

  const save = async () => {
    setSaving(true)
    try {
      const next = {
        watchedDirectories: dirs,
        defaultEditor: editor,
        theme,
        ...(terminal ? { defaultTerminal: terminal } : {}),
        ...(githubToken ? { githubToken } : {}),
        ...(azureToken ? { azureToken } : {}),
      }
      await api.setSettings(next)
      setSettings(next)
      setView('dashboard')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <TitleBar
        title="Settings"
        trailing={
          <button
            onClick={() => setView('dashboard')}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
        }
      />

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-xl space-y-8">
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
              Appearance
            </h2>
            <div className="flex items-center gap-2">
              {(['system', 'light', 'dark'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
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

          <section>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
              Default editor
            </h2>
            <p className="mb-3 text-xs text-muted">
              Fallback when a project has no editor of its own. Prefer setting the editor on the
              project header (“Open with”).
            </p>
            <select
              value={editor}
              onChange={(e) => setEditor(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            >
              {EDITOR_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </section>

          <section>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
              Default terminal
            </h2>
            <p className="mb-3 text-xs text-muted">macOS app name, or system default.</p>
            <select
              value={terminal}
              onChange={(e) => setTerminal(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            >
              {TERMINAL_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.command}>
                  {opt.label}
                </option>
              ))}
            </select>
          </section>

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
                  <label className="text-sm font-medium">GitHub token</label>
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
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="ghp_… or empty"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-sm font-medium">Azure DevOps PAT</label>
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
                  type="password"
                  value={azureToken}
                  onChange={(e) => setAzureToken(e.target.value)}
                  placeholder="PAT or empty"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                Watched directories
              </h2>
              <button
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
                      onClick={() => removeDir(i)}
                      className="ml-2 text-muted hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <div className="border-t border-border px-6 py-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
