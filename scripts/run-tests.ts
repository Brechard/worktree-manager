import { readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ignoredDirectories = new Set([
  '.git',
  '.turbo',
  'coverage',
  'dist',
  'dist-electron',
  'node_modules',
  'out',
  'release',
])
const testFilePattern = /\.(?:test|spec)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/

async function collectTestFiles(directory: string, relativeDirectory = ''): Promise<string[]> {
  const files: string[] = []
  const entries = await readdir(directory, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue

    const relativePath = relativeDirectory ? join(relativeDirectory, entry.name) : entry.name
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue
      files.push(...(await collectTestFiles(join(directory, entry.name), relativePath)))
    } else if (entry.isFile() && testFilePattern.test(entry.name)) {
      files.push(relativePath)
    }
  }

  return files
}

const testFiles = (await collectTestFiles(repositoryRoot)).sort()

if (testFiles.length === 0) {
  console.error(
    'No test files found. Add a *.test.* or *.spec.* file before running the test gate.'
  )
  process.exit(1)
}

console.log(`Running ${testFiles.length} test file(s) with Bun's native test runner.`)
const result = Bun.spawnSync([process.execPath, 'test', ...testFiles.map((file) => `./${file}`)], {
  cwd: repositoryRoot,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
})

process.exit(result.exitCode ?? 1)
