import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const AI_AGENT_DIRS = ['.t3', '.claude', '.codex', '.devin', '.aider', '.windsurf', '.cursor']

/** Select scan roots without silently reading repositories outside the user's chosen folders. */
export function scanRoots(
  selectedRoots: string[],
  includeAgentWorktrees: boolean,
  home = homedir(),
  exists: (path: string) => boolean = existsSync
): string[] {
  const roots = [...selectedRoots]
  if (includeAgentWorktrees) {
    for (const directory of AI_AGENT_DIRS) {
      const path = join(home, directory)
      if (exists(path)) roots.push(path)
    }
  }
  const unique = [...new Set(roots.map((root) => root.replace(/\/+$/, '')).filter(Boolean))]
  unique.sort((a, b) => a.length - b.length)
  return unique.filter(
    (root, index) => !unique.slice(0, index).some((parent) => root.startsWith(parent + '/'))
  )
}
