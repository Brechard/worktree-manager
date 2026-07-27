import type {
  Worktree,
  WorktreeSort,
  WorktreeSortDirection,
  WorktreeStatus,
} from '@worktree/contracts'
// One implementation, shared with the main process's delete confirmation.
export { isSafeToDelete } from '@worktree/contracts'
import { isSafeToDelete } from '@worktree/contracts'

export type WorktreeSafetyGroup = 'primary' | 'prunable' | 'safe' | 'attention'

export const SAFETY_GROUP_LABELS: Record<WorktreeSafetyGroup, string> = {
  primary: 'Primary worktree',
  prunable: 'Stale · prune first',
  safe: 'Safe to remove',
  attention: 'Needs attention',
}

export function getWorktreeSafetyGroup(
  worktree: Worktree,
  status?: WorktreeStatus
): WorktreeSafetyGroup {
  if (worktree.isMain) return 'primary'
  if (worktree.prunable) return 'prunable'
  return isSafeToDelete(worktree, status) ? 'safe' : 'attention'
}

function liveBranch(worktree: Worktree, status?: WorktreeStatus): string {
  return status?.branch ?? worktree.branch
}

function compareOptionalNumbers(a?: number, b?: number): number {
  if (a === undefined && b === undefined) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1
  return a - b
}

function compareNames(a: Worktree, b: Worktree, statuses: Record<string, WorktreeStatus>): number {
  const branchComparison = liveBranch(a, statuses[a.id]).localeCompare(
    liveBranch(b, statuses[b.id])
  )
  return branchComparison || a.path.localeCompare(b.path)
}

/** Sort without mutating the worktree array held by Zustand. */
export function sortWorktrees(
  worktrees: Worktree[],
  statuses: Record<string, WorktreeStatus>,
  sort: WorktreeSort,
  direction: WorktreeSortDirection
): Worktree[] {
  return worktrees
    .map((worktree, index) => ({ worktree, index }))
    .sort((a, b) => {
      const left = a.worktree
      const right = b.worktree

      // The primary checkout remains an anchor in every view. It is never a
      // cleanup candidate, and keeping it visible first prevents accidental
      // destructive actions from looking like the default action.
      if (left.isMain !== right.isMain) return left.isMain ? -1 : 1

      let comparison = 0
      if (sort === 'activity') {
        comparison = compareOptionalNumbers(left.lastModified, right.lastModified)
      } else if (sort === 'name') {
        comparison = compareNames(left, right, statuses)
      } else {
        const leftRank = getSafetyRank(getWorktreeSafetyGroup(left, statuses[left.id]))
        const rightRank = getSafetyRank(getWorktreeSafetyGroup(right, statuses[right.id]))
        comparison = leftRank - rightRank
      }

      if (comparison !== 0) {
        // Unknown activity is kept at the end in either direction. For known
        // values, direction reverses the chosen sort key.
        const eitherActivityUnknown =
          sort === 'activity' &&
          (left.lastModified === undefined || right.lastModified === undefined)
        return eitherActivityUnknown ? comparison : direction === 'asc' ? comparison : -comparison
      }

      // Deterministic ties make the list feel stable as scans complete.
      return compareNames(left, right, statuses) || a.index - b.index
    })
    .map(({ worktree }) => worktree)
}

function getSafetyRank(group: WorktreeSafetyGroup): number {
  switch (group) {
    case 'prunable':
      return 0
    case 'safe':
      return 1
    case 'attention':
      return 2
    case 'primary':
      return -1
  }
}

export interface WorktreeSection {
  key: WorktreeSafetyGroup | 'all'
  label?: string
  worktrees: Worktree[]
}

export function groupWorktrees(
  worktrees: Worktree[],
  statuses: Record<string, WorktreeStatus>,
  enabled: boolean
): WorktreeSection[] {
  if (!enabled) return [{ key: 'all', worktrees }]

  const sections: WorktreeSection[] = []
  for (const worktree of worktrees) {
    const key = getWorktreeSafetyGroup(worktree, statuses[worktree.id])
    const existing = sections.at(-1)
    if (existing?.key === key) {
      existing.worktrees.push(worktree)
    } else {
      sections.push({ key, label: SAFETY_GROUP_LABELS[key], worktrees: [worktree] })
    }
  }
  return sections
}
