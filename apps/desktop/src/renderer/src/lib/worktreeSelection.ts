import type { Worktree } from '@worktree/contracts'

/** A selection can only contain removable rows currently visible in one project. */
export function reconcileSelection(
  selected: ReadonlySet<string>,
  visible: Worktree[]
): Set<string> {
  const eligible = new Set(
    visible
      .filter((w) => !w.isMain && !w.prunable && w.postCreateSetupState !== 'running')
      .map((w) => w.id)
  )
  return new Set([...selected].filter((id) => eligible.has(id)))
}

export function selectAllVisible(visible: Worktree[]): Set<string> {
  return reconcileSelection(new Set(visible.map((w) => w.id)), visible)
}
