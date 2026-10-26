import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Dialog } from './ui/Dialog'
import { Button, IconButton } from './ui/Button'
import { Field, TextInput } from './ui/Field'
import { FolderOpen, Loader2, Terminal, X } from 'lucide-react'
import type {
  AppSettings,
  CreateWorktreeRequest,
  Worktree,
  Repository,
  WorktreeCreationPreview,
  WorktreeCreationProgress,
  WorktreeCreationResult,
  WorktreeLocation,
} from '@worktree/contracts'
import { api } from '../api'
import { useAppStore } from '../store'
import { isMacPlatform, shortcutLabel } from '../lib/dashboardShortcut'
import { ShellEditor } from './ShellEditor'

interface NewWorktreeModalProps {
  repository: Repository
  onClose: () => void
  onCreated: (result: WorktreeCreationResult) => void
}

const locations: { value: WorktreeLocation; label: string; hint: string }[] = [
  { value: 'sibling', label: 'Beside project', hint: 'Grouped in <project>.worktrees' },
  { value: 'inside', label: 'Inside project', hint: 'Hidden locally from parent Git status' },
  { value: 'managed', label: '~/.worktree-manager', hint: 'Grouped by project name' },
  { value: 'custom', label: 'Custom parent', hint: 'Choose an absolute folder' },
]

interface CreationFormProps {
  repository: Repository
  mode: 'new' | 'existing'
  setMode: (mode: 'new' | 'existing') => void
  branch: string
  setBranch: (branch: string) => void
  startRef: string
  setStartRef: (ref: string) => void
  branches: string[]
  location: WorktreeLocation
  setLocation: (location: WorktreeLocation) => void
  customParent: string
  setCustomParent: (path: string) => void
  overrideSetup: boolean
  setOverrideSetup: (override: boolean) => void
  overrideCommand: string
  setOverrideCommand: (command: string) => void
  busy: boolean
  preview: WorktreeCreationPreview | null
  chooseParent: () => Promise<void>
}

function CreationForm({
  repository,
  mode,
  setMode,
  branch,
  setBranch,
  startRef,
  setStartRef,
  branches,
  location,
  setLocation,
  customParent,
  setCustomParent,
  overrideSetup,
  setOverrideSetup,
  overrideCommand,
  setOverrideCommand,
  busy,
  preview,
  chooseParent,
}: CreationFormProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Branch choice">
        {(['new', 'existing'] as const).map((option) => (
          <button
            key={option}
            aria-pressed={mode === option}
            type="button"
            onClick={() => {
              setMode(option)
              setBranch('')
            }}
            disabled={busy}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${mode === option ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}`}
          >
            {option === 'new' ? 'New branch' : 'Existing branch'}
          </button>
        ))}
      </div>
      <Field htmlFor="create-branch" label="Branch name">
        <TextInput
          id="create-branch"
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
          list={mode === 'existing' ? 'existing-branches' : undefined}
          placeholder={mode === 'new' ? 'feature/my-change' : 'Choose a local branch'}
          autoFocus
          disabled={busy}
          spellCheck={false}
        />
        <datalist id="existing-branches">
          {branches.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </Field>
      {mode === 'new' && (
        <Field htmlFor="create-start-ref" label="Start from">
          <TextInput
            id="create-start-ref"
            list="start-refs"
            value={startRef}
            onChange={(event) => setStartRef(event.target.value)}
            disabled={busy}
            spellCheck={false}
          />
          <datalist id="start-refs">
            {branches.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>
      )}
      <fieldset disabled={busy} className="space-y-3">
        <legend className="sr-only">Setup after creation</legend>
        <label
          className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
          htmlFor="create-override-setup"
        >
          <input
            id="create-override-setup"
            type="checkbox"
            checked={overrideSetup}
            onChange={(event) => setOverrideSetup(event.target.checked)}
            className="h-4 w-4 shrink-0 accent-primary"
          />
          <span>Override setup command</span>
          <span className="ml-auto text-right text-xs text-muted">
            {overrideSetup
              ? overrideCommand.trim()
                ? 'Custom command'
                : 'Skip setup'
              : repository.postCreateCommand?.trim()
                ? 'Uses project default'
                : 'No setup command'}
          </span>
        </label>
        {overrideSetup && (
          <div className="space-y-2">
            <label htmlFor="create-setup-command" className="block text-xs font-medium">
              Setup command
            </label>
            <ShellEditor
              id="create-setup-command"
              label="Setup command for this worktree"
              className="h-32"
              value={overrideCommand}
              onChange={setOverrideCommand}
              placeholder="Leave empty to skip setup"
            />
            <p className="text-xs text-muted">
              {repository.postCreateCommand?.trim()
                ? 'Starts with the project command. Leave it empty to skip setup for this worktree.'
                : 'No project command is configured. Enter one here or leave it empty to skip setup.'}{' '}
              Project settings stay unchanged. Enter adds a line in the editor.
            </p>
          </div>
        )}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Location</legend>
        {locations.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${location === option.value ? 'border-primary bg-primary/5' : 'border-border'}`}
          >
            <input
              type="radio"
              name="worktree-location"
              value={option.value}
              checked={location === option.value}
              onChange={() => setLocation(option.value)}
              disabled={busy}
              className="mt-0.5 accent-primary"
            />
            <span>
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="block text-xs text-muted">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {location === 'custom' && (
        <div>
          <label htmlFor="create-parent" className="mb-1.5 block text-sm font-medium">
            Parent directory
          </label>
          <div className="flex gap-2">
            <TextInput
              id="create-parent"
              value={customParent}
              onChange={(event) => setCustomParent(event.target.value)}
              placeholder="/Users/you/dev/worktrees"
              disabled={busy}
            />
            <IconButton onClick={() => void chooseParent()} aria-label="Choose parent folder">
              <FolderOpen className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      )}
      <div className="rounded-xl border border-border bg-background p-3 text-xs">
        <div className="font-medium">Destination</div>
        <div className="mt-1 break-all font-mono text-muted">
          {preview?.path || 'Enter a branch to preview the path'}
        </div>
        {preview?.sourceCommit && (
          <div className="mt-2 text-muted">
            From <span className="font-mono">{preview.startRef}</span> at{' '}
            <span className="font-mono">{preview.sourceCommit.slice(0, 10)}</span>
          </div>
        )}
        {location === 'inside' && (
          <p className="mt-2 text-muted">
            The app adds /.worktrees/ to this repository’s local Git exclude file.
          </p>
        )}
      </div>
      {preview?.error && (
        <p role="alert" className="text-sm text-destructive">
          {preview.error}
        </p>
      )}
    </>
  )
}

function CreatedWorktree({
  result,
  worktree,
  busy,
  retrySetup,
  openCreated,
}: {
  result: WorktreeCreationResult
  worktree: Worktree
  busy: boolean
  retrySetup: () => Promise<void>
  openCreated: (target: 'editor' | 'terminal') => Promise<void>
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">
        {worktree.postCreateSetupState === 'running'
          ? 'Worktree created; setup is running'
          : result?.setup?.success === false
            ? 'Worktree created; setup needs attention'
            : 'Worktree ready'}
      </p>
      <p className="break-all font-mono text-xs text-muted">{worktree.path}</p>
      {result?.warning && (
        <p role="alert" className="text-sm text-warning">
          {result.warning}
        </p>
      )}
      {result?.setup && (
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-xs font-medium">
            {result.setup.success
              ? 'Setup completed'
              : result.setup.timedOut
                ? 'Setup timed out'
                : 'Setup failed'}
          </p>
          <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted">
            {result.setup.output || '(no output)'}
          </pre>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void openCreated('editor')}
          className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
        >
          Open worktree
        </button>
        <button
          type="button"
          onClick={() => void openCreated('terminal')}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
        >
          <Terminal className="h-4 w-4" />
          Open terminal
        </button>
        {result?.setup?.success === false && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void retrySetup()}
            className="rounded-lg border border-warning px-3 py-2 text-sm text-warning disabled:opacity-50"
          >
            Retry setup
          </button>
        )}
      </div>
    </div>
  )
}

async function openCreatedWorktree(
  target: 'editor' | 'terminal',
  worktree: Worktree,
  repository: Repository,
  settings: AppSettings | null
) {
  const subdirectory = repository.workingSubdirectory
  if (target === 'editor') {
    return api.openInEditor({
      path: worktree.path,
      editor: repository.preferredEditor ?? settings?.defaultEditor ?? 'cursor',
      ...(subdirectory ? { subdirectory } : {}),
    })
  }
  return api.openInTerminal({
    path: worktree.path,
    ...(settings?.defaultTerminal ? { terminal: settings.defaultTerminal } : {}),
    ...(subdirectory ? { subdirectory } : {}),
  })
}

function useCreationPreview(request: CreateWorktreeRequest, hasWorktree: boolean) {
  const [resolved, setResolved] = useState<{
    request: CreateWorktreeRequest
    preview: WorktreeCreationPreview
  } | null>(null)
  useEffect(() => {
    if (hasWorktree) return
    let live = true
    if (!request.branch) {
      return
    }
    const timer = window.setTimeout(() => {
      void api
        .previewWorktreeCreation(request)
        .then((value) => {
          if (live) setResolved({ request, preview: value })
        })
        .catch((cause) => {
          if (live)
            setResolved({
              request,
              preview: {
                path: '',
                branch: request.branch,
                startRef: request.startRef ?? request.branch,
                error: String(cause),
              },
            })
        })
    }, 180)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [request, hasWorktree])

  const preview = resolved?.request === request ? resolved.preview : null
  return { preview, checking: Boolean(request.branch) && !preview }
}

function useCreationLifecycle(
  repository: Repository,
  onCreated: NewWorktreeModalProps['onCreated']
) {
  const [progress, setProgress] = useState<WorktreeCreationProgress | null>(null)
  const [result, setResult] = useState<WorktreeCreationResult | null>(null)
  const registeredRef = useRef(false)
  const activeBranchRef = useRef('')
  useEffect(
    () =>
      api.onWorktreeCreationProgress((event) => {
        if (event.repositoryId !== repository.id) return
        if (event.worktree && event.worktree.branch !== activeBranchRef.current) return
        setProgress(event)
        if (event.stage === 'registered' && event.worktree && !registeredRef.current) {
          registeredRef.current = true
          const created: WorktreeCreationResult = { success: true, worktree: event.worktree }
          setResult(created)
          onCreated(created)
        }
        if (event.stage === 'done' && event.worktree) {
          const completedWorktree = event.worktree
          setResult((previous) => ({
            success: true,
            ...previous,
            worktree: completedWorktree,
            ...(completedWorktree.postCreateSetup
              ? { setup: completedWorktree.postCreateSetup }
              : {}),
          }))
        }
      }),
    [repository.id, onCreated]
  )

  return { progress, setProgress, result, setResult, registeredRef, activeBranchRef }
}

interface NewWorktreeShellProps {
  repositoryName: string
  onClose: () => void
  busy: boolean
  created: boolean
  progress: WorktreeCreationProgress | null
  error: string
  canCreate: boolean
  create: () => Promise<void>
  children: ReactNode
}

function NewWorktreeShell({
  repositoryName,
  onClose,
  busy,
  created,
  progress,
  error,
  canCreate,
  create,
  children,
}: NewWorktreeShellProps) {
  const composingRef = useRef(false)
  const ignoreCompositionEnterRef = useRef(false)
  const mac = isMacPlatform()
  return (
    <Dialog
      titleId="new-worktree-title"
      onClose={onClose}
      canClose={!busy || created}
      initialFocus="#create-branch"
    >
      <form
        className="flex max-h-[90vh] flex-col overflow-hidden"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          if (composingRef.current || ignoreCompositionEnterRef.current) return
          if (!created && canCreate && !busy) void create()
        }}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={() => {
          composingRef.current = false
        }}
        onKeyDownCapture={(event: KeyboardEvent<HTMLFormElement>) => {
          if (event.key !== 'Enter') return
          if (
            composingRef.current ||
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          ) {
            ignoreCompositionEnterRef.current = true
            window.setTimeout(() => {
              ignoreCompositionEnterRef.current = false
            }, 0)
          } else {
            ignoreCompositionEnterRef.current = false
          }
        }}
        onKeyDown={(event: KeyboardEvent<HTMLFormElement>) => {
          if (
            event.key !== 'Enter' ||
            (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) ||
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229 ||
            !(event.target instanceof HTMLInputElement) ||
            event.target.type !== 'text'
          )
            return
          event.preventDefault()
          event.currentTarget.requestSubmit()
        }}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 id="new-worktree-title" className="text-lg font-semibold">
              New worktree
            </h2>
            <p className="mt-0.5 text-xs text-muted">{repositoryName}</p>
          </div>
          <IconButton
            onClick={onClose}
            disabled={busy && !created}
            variant="quiet"
            aria-label="Close new worktree"
          >
            <X className="h-4 w-4" />
          </IconButton>
        </header>
        <div className="space-y-5 overflow-auto px-6 py-5">
          {children}
          {progress && (
            <p role="status" className="flex items-center gap-2 text-xs text-muted">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {progress.message}
              {busy && progress.stage === 'setup'
                ? ' You can close this window; setup continues in the worktree row.'
                : ''}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-border px-6 py-4">
          {!created && (
            <span className="mr-auto self-center text-xs text-muted">
              Enter or {shortcutLabel('Enter', mac)} in branch fields
            </span>
          )}
          <Button onClick={onClose} disabled={busy && !created}>
            {created ? 'Done' : busy ? 'Working…' : 'Cancel'}
          </Button>
          {!created && (
            <Button type="submit" variant="primary" disabled={busy || !canCreate}>
              Create worktree
            </Button>
          )}
        </footer>
      </form>
    </Dialog>
  )
}

export function NewWorktreeModal({ repository, onClose, onCreated }: NewWorktreeModalProps) {
  const settings = useAppStore((state) => state.settings)
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [branch, setBranch] = useState('')
  const [startRef, setStartRef] = useState(repository.baseBranch || 'HEAD')
  const [location, setLocation] = useState<WorktreeLocation>(
    repository.worktreeLocation ?? settings?.defaultWorktreeLocation ?? 'sibling'
  )
  const [customParent, setCustomParent] = useState(
    repository.worktreeCustomParent ?? settings?.defaultWorktreeCustomParent ?? ''
  )
  const [overrideSetup, setOverrideSetup] = useState(false)
  const [overrideCommand, setOverrideCommand] = useState(repository.postCreateCommand ?? '')
  const [branches, setBranches] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const creatingRef = useRef(false)
  const createdRef = useRef(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    api
      .getRepoBranches(repository.path)
      .then(({ branches: found, defaultBranch }) => {
        if (!live) return
        setBranches(found)
        if (defaultBranch && !repository.baseBranch) setStartRef(defaultBranch)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [repository.path, repository.baseBranch])

  const { progress, setProgress, result, setResult, registeredRef, activeBranchRef } =
    useCreationLifecycle(repository, onCreated)

  const request = useMemo<CreateWorktreeRequest>(
    () => ({
      repositoryId: repository.id,
      mode,
      branch: branch.trim(),
      ...(mode === 'new' ? { startRef: startRef.trim() } : {}),
      location,
      ...(location === 'custom' ? { customParent: customParent.trim() } : {}),
    }),
    [repository.id, mode, branch, startRef, location, customParent]
  )

  const { preview, checking } = useCreationPreview(request, Boolean(result?.worktree))

  const chooseParent = async () => {
    const paths = await api.openDirectoryDialog()
    if (paths[0]) setCustomParent(paths[0])
  }

  const create = async () => {
    if (
      creatingRef.current ||
      createdRef.current ||
      busy ||
      result?.worktree ||
      checking ||
      !preview ||
      preview.error ||
      !preview.sourceCommit
    )
      return
    creatingRef.current = true
    registeredRef.current = false
    activeBranchRef.current = request.branch
    setBusy(true)
    setError('')
    setProgress({
      repositoryId: repository.id,
      stage: 'validating',
      message: 'Checking branch and destination…',
    })
    try {
      const created = await api.createWorktree({
        ...request,
        ...(overrideSetup ? { postCreateCommandOverride: overrideCommand } : {}),
        expectedSourceCommit: preview.sourceCommit,
      })
      if (created.worktree) createdRef.current = true
      setResult(created)
      if (created.worktree && !registeredRef.current) onCreated(created)
      if (!created.success) setError(created.error ?? 'Could not create the worktree.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      creatingRef.current = false
      setBusy(false)
    }
  }

  const retrySetup = async () => {
    if (!result?.worktree || busy) return
    setBusy(true)
    setError('')
    try {
      const setup = await api.retryWorktreeSetup({
        repositoryId: repository.id,
        worktreeId: result.worktree.id,
      })
      const completed: WorktreeCreationResult = {
        ...result,
        setup,
        worktree: {
          ...result.worktree,
          postCreateSetup: setup,
          postCreateSetupState: undefined,
        },
      }
      setResult(completed)
      onCreated(completed)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const openCreated = async (target: 'editor' | 'terminal') => {
    if (!worktree) return
    setError('')
    try {
      const opened = await openCreatedWorktree(target, worktree, repository, settings)
      if (!opened.success) setError(opened.error ?? `Could not open the ${target}.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const worktree = result?.worktree
  return (
    <NewWorktreeShell
      repositoryName={repository.name}
      onClose={onClose}
      busy={busy}
      created={Boolean(worktree)}
      progress={progress}
      error={error}
      canCreate={Boolean(preview?.sourceCommit) && !Boolean(preview?.error) && !checking}
      create={create}
    >
      {worktree ? (
        <CreatedWorktree
          result={result}
          worktree={worktree}
          busy={busy}
          retrySetup={retrySetup}
          openCreated={openCreated}
        />
      ) : (
        <CreationForm
          repository={repository}
          mode={mode}
          setMode={setMode}
          branch={branch}
          setBranch={setBranch}
          startRef={startRef}
          setStartRef={setStartRef}
          branches={branches}
          location={location}
          setLocation={setLocation}
          customParent={customParent}
          setCustomParent={setCustomParent}
          overrideSetup={overrideSetup}
          setOverrideSetup={setOverrideSetup}
          overrideCommand={overrideCommand}
          setOverrideCommand={setOverrideCommand}
          busy={busy}
          preview={preview}
          chooseParent={chooseParent}
        />
      )}
    </NewWorktreeShell>
  )
}
