export function shortenPath(path: string): string {
  if (!path) return path

  const unix = path.match(/^\/(?:Users|home)\/[^/]+(.*)$/)
  if (unix) return `~${unix[1] || ''}`

  const win = path.match(/^[A-Za-z]:\\Users\\[^\\]+(.*)$/i)
  if (win) return `~${(win[1] || '').replace(/\\/g, '/')}`

  return path
}

export const EDITOR_OPTIONS = [
  { id: 'cursor', label: 'Cursor', command: 'cursor', macApp: 'Cursor' },
  { id: 'windsurf', label: 'Windsurf', command: 'windsurf', macApp: 'Windsurf' },
  { id: 'code', label: 'VS Code', command: 'code', macApp: 'Visual Studio Code' },
  {
    id: 'code-insiders',
    label: 'VS Code Insiders',
    command: 'code-insiders',
    macApp: 'Visual Studio Code - Insiders',
  },
  { id: 'zed', label: 'Zed', command: 'zed', macApp: 'Zed' },
  { id: 'webstorm', label: 'WebStorm', command: 'webstorm', macApp: 'WebStorm' },
  { id: 'pycharm', label: 'PyCharm', command: 'pycharm', macApp: 'PyCharm' },
  { id: 'idea', label: 'IntelliJ IDEA', command: 'idea', macApp: 'IntelliJ IDEA' },
  { id: 'rider', label: 'Rider', command: 'rider', macApp: 'Rider' },
  { id: 'goland', label: 'GoLand', command: 'goland', macApp: 'GoLand' },
  { id: 'phpstorm', label: 'PhpStorm', command: 'phpstorm', macApp: 'PhpStorm' },
  { id: 'rubymine', label: 'RubyMine', command: 'rubymine', macApp: 'RubyMine' },
  { id: 'android-studio', label: 'Android Studio', command: 'studio', macApp: 'Android Studio' },
  { id: 'xcode', label: 'Xcode', command: 'xed', macApp: 'Xcode' },
  { id: 'sublime', label: 'Sublime Text', command: 'subl', macApp: 'Sublime Text' },
  { id: 'devin', label: 'Devin', command: 'devin', macApp: 'Devin' },
  { id: 'file-manager', label: 'File Manager', command: 'file-manager', macApp: null },
] as const

export type EditorOptionId = (typeof EDITOR_OPTIONS)[number]['id']

export function editorLabel(id: string | undefined | null): string {
  if (!id) return 'Default'
  return EDITOR_OPTIONS.find((e) => e.id === id)?.label ?? id
}

export const TERMINAL_OPTIONS = [
  { id: 'default', label: 'System default', command: '' },
  { id: 'Terminal', label: 'Terminal.app', command: 'Terminal' },
  { id: 'iTerm', label: 'iTerm', command: 'iTerm' },
  { id: 'Warp', label: 'Warp', command: 'Warp' },
  { id: 'Ghostty', label: 'Ghostty', command: 'Ghostty' },
  { id: 'Alacritty', label: 'Alacritty', command: 'Alacritty' },
] as const
