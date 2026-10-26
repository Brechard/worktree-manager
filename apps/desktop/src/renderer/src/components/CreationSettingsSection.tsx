import type { WorktreeLocation } from '@worktree/contracts'
import { ShellEditor } from './ShellEditor'
import { Field, Select, TextInput } from './ui/Field'

export function WorktreeLocationSection({
  location,
  setLocation,
  customParent,
  setCustomParent,
}: {
  location: WorktreeLocation | ''
  setLocation: (value: WorktreeLocation | '') => void
  customParent: string
  setCustomParent: (value: string) => void
}) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Worktree location</h3>
        <p className="mt-1 text-xs text-muted">
          Choose where new worktrees for this project start.
        </p>
      </div>
      <Field htmlFor="project-create-location" label="Default location">
        <Select
          id="project-create-location"
          value={location}
          onChange={(event) => setLocation(event.target.value as WorktreeLocation | '')}
        >
          <option value="">Use app default</option>
          <option value="sibling">Beside project — &lt;project&gt;.worktrees</option>
          <option value="inside">Inside project — .worktrees</option>
          <option value="managed">~/.worktree-manager</option>
          <option value="custom">Custom parent directory</option>
        </Select>
      </Field>
      {location === 'custom' && (
        <Field htmlFor="project-create-parent" label="Parent directory">
          <TextInput
            id="project-create-parent"
            value={customParent}
            onChange={(event) => setCustomParent(event.target.value)}
            placeholder="/absolute/path/to/worktrees"
            className="font-mono"
          />
        </Field>
      )}
    </section>
  )
}

export function PostCreateSetupSection({
  command,
  setCommand,
  timeout,
  setTimeout,
}: {
  command: string
  setCommand: (value: string) => void
  timeout: string
  setTimeout: (value: string) => void
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Setup after creation</h3>
        <p className="mt-1 text-xs text-muted">
          Optional command in the new worktree root. A failure leaves the worktree available to
          retry.
        </p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="post-create-command" className="text-sm font-medium">
          Setup command
        </label>
        <label className="flex items-center gap-2 text-xs text-muted" htmlFor="post-create-timeout">
          Timeout
          <TextInput
            density="compact"
            id="post-create-timeout"
            type="number"
            min={1}
            value={timeout}
            onChange={(event) => setTimeout(event.target.value)}
            placeholder="600"
            className="w-20 text-right"
          />
          s
        </label>
      </div>
      <ShellEditor
        id="post-create-command"
        label="Setup command"
        className="h-32"
        value={command}
        onChange={setCommand}
        placeholder="Leave empty to skip"
      />
      <p className="text-xs leading-relaxed text-muted">
        WORKTREE_PATH, WORKTREE_BRANCH, REPO_PATH and REPO_NAME are available.
      </p>
    </section>
  )
}
