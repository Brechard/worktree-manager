import type { Worktree, WorktreeDiskUsage } from '@worktree/contracts'

export interface ProjectDiskSummary {
  totalBytes: number
  reclaimableBytes: number
  worktreeCount: number
  measuredCount: number
  errorCount: number
  measuring: boolean
}

export function summarizeProjectDisk(
  worktrees: Worktree[],
  usageById: Record<string, WorktreeDiskUsage>,
  measuringIds: Set<string>
): ProjectDiskSummary {
  let totalBytes = 0
  let reclaimableBytes = 0
  let measuredCount = 0
  let errorCount = 0
  let measuring = false
  for (const worktree of worktrees) {
    const usage = usageById[worktree.id]
    if (measuringIds.has(worktree.id)) measuring = true
    if (!usage) {
      continue
    } else if (usage.error) {
      errorCount += 1
    } else {
      measuredCount += 1
      totalBytes += usage.totalBytes
      reclaimableBytes += usage.reclaimableBytes
    }
  }
  return {
    totalBytes,
    reclaimableBytes,
    worktreeCount: worktrees.length,
    measuredCount,
    errorCount,
    measuring,
  }
}
