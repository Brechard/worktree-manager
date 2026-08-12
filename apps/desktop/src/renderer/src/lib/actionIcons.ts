import {
  Beaker,
  Database,
  Globe,
  Hammer,
  Play,
  Rocket,
  Terminal,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { ProjectActionIcon } from '@worktree/contracts'

/**
 * A custom action's button is icon-first, so the icon is the only thing telling
 * "start the dev server" apart from "run the simulator" at a glance. Kept to a
 * handful of unmistakable shapes rather than the whole lucide set.
 */
export const ACTION_ICONS: Record<ProjectActionIcon, LucideIcon> = {
  play: Play,
  terminal: Terminal,
  rocket: Rocket,
  hammer: Hammer,
  beaker: Beaker,
  database: Database,
  globe: Globe,
  zap: Zap,
}

export const ACTION_ICON_OPTIONS: { id: ProjectActionIcon; label: string }[] = [
  { id: 'play', label: 'Play' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'rocket', label: 'Rocket' },
  { id: 'hammer', label: 'Build' },
  { id: 'beaker', label: 'Test' },
  { id: 'database', label: 'Database' },
  { id: 'globe', label: 'Web' },
  { id: 'zap', label: 'Zap' },
]
