import type { AppSettings } from '@worktree/contracts'

export type Theme = AppSettings['theme']

/**
 * Reflects the chosen theme onto the document so the CSS variables in
 * index.css switch. 'system' follows the OS `prefers-color-scheme`.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}
