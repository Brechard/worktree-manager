import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const targets = [
  { os: 'macos', arch: 'arm64', extensions: ['dmg', 'zip'] },
  { os: 'macos', arch: 'x64', extensions: ['dmg', 'zip'] },
  { os: 'windows', arch: 'x64', extensions: ['exe', 'zip'] },
  { os: 'linux', arch: 'x64', extensions: ['AppImage', 'zip'] },
]

function fail(message) {
  throw new Error(message)
}

function versionFor(tag) {
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) {
    fail(`Expected a stable version tag such as v0.2.0; received ${tag}`)
  }

  const version = tag.slice(1)
  const rootVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const desktopVersion = JSON.parse(
    readFileSync(join(root, 'apps/desktop/package.json'), 'utf8')
  ).version
  // bun.lock is JSONC, and this check runs before dependencies are installed.
  const lockMatch = readFileSync(join(root, 'bun.lock'), 'utf8').match(
    /"apps\/desktop":\s*\{\s*"name":\s*"@worktree\/desktop",\s*"version":\s*"([^"]+)"/
  )
  const lockVersion = lockMatch?.[1]
  if (rootVersion !== version || desktopVersion !== version || lockVersion !== version) {
    fail(
      `Version mismatch: tag=${tag}, root=${rootVersion}, desktop=${desktopVersion}, lock=${lockVersion}`
    )
  }
  return version
}

function filenames(version, target) {
  return target.extensions.map(
    (extension) => `Worktree-Manager-${version}-${target.os}-${target.arch}.${extension}`
  )
}

function regularFiles(directory) {
  if (!existsSync(directory)) fail(`Missing directory: ${directory}`)
  const entries = readdirSync(directory, { withFileTypes: true })
  const unexpected = entries.filter((entry) => !entry.isFile())
  if (unexpected.length)
    fail(
      `Unexpected non-file entries in ${directory}: ${unexpected.map((entry) => entry.name).join(', ')}`
    )
  return entries.map((entry) => entry.name).sort()
}

function checkFile(path) {
  const size = statSync(path).size
  if (size < 1024 * 1024) fail(`Release asset is unexpectedly small (${size} bytes): ${path}`)
  const data = readFileSync(path, { flag: 'r' }).subarray(0, 4)
  const ext = path.split('.').at(-1)
  const signatures = {
    zip: Buffer.from([0x50, 0x4b]),
    exe: Buffer.from([0x4d, 0x5a]),
    AppImage: Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
  }
  if (signatures[ext] && !data.subarray(0, signatures[ext].length).equals(signatures[ext])) {
    fail(`Unexpected ${ext} file signature: ${path}`)
  }
  return size
}

function checkFiles(directory, expected) {
  const actual = regularFiles(directory)
  if (actual.join('\n') !== [...expected].sort().join('\n')) {
    fail(
      `Asset mismatch in ${directory}: expected ${expected.join(', ')}, found ${actual.join(', ')}`
    )
  }
  for (const name of expected) checkFile(join(directory, name))
}

function stage(tag, os, arch, source, destination) {
  const version = versionFor(tag)
  const target = targets.find((item) => item.os === os && item.arch === arch)
  if (!target) fail(`Unsupported release target: ${os}/${arch}`)
  const expected = filenames(version, target)
  for (const name of expected) {
    if (!existsSync(join(source, name))) fail(`Missing ${name} in ${source}`)
    checkFile(join(source, name))
  }
  mkdirSync(destination, { recursive: true })
  for (const name of expected) copyFileSync(join(source, name), join(destination, name))
  checkFiles(destination, expected)
  console.log(`Staged ${os}/${arch}: ${expected.join(', ')}`)
}

function assemble(tag, source, destination) {
  const version = versionFor(tag)
  const expectedDirectories = targets.map((target) => `release-${target.os}-${target.arch}`).sort()
  const actualDirectories = readdirSync(source, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  if (actualDirectories.join('\n') !== expectedDirectories.join('\n')) {
    fail(
      `Build set mismatch: expected ${expectedDirectories.join(', ')}, found ${actualDirectories.join(', ')}`
    )
  }

  mkdirSync(destination, { recursive: true })
  const names = []
  for (const target of targets) {
    const directory = join(source, `release-${target.os}-${target.arch}`)
    const expected = filenames(version, target)
    checkFiles(directory, expected)
    for (const name of expected) {
      copyFileSync(join(directory, name), join(destination, name))
      names.push(name)
    }
  }
  checkFiles(destination, names)
  const checksums = names
    .sort()
    .map(
      (name) =>
        `${createHash('sha256')
          .update(readFileSync(join(destination, name)))
          .digest('hex')}  ${name}`
    )
    .join('\n')
  writeFileSync(join(destination, 'SHA256SUMS'), `${checksums}\n`)
  console.log(`Assembled ${names.length} release assets and SHA256SUMS in ${basename(destination)}`)
}

const [command, ...args] = process.argv.slice(2)
try {
  if (command === 'check-tag' && args.length === 1) console.log(`Verified ${versionFor(args[0])}`)
  else if (command === 'stage' && args.length === 5) stage(...args)
  else if (command === 'assemble' && args.length === 3) assemble(...args)
  else
    fail(
      'Usage: release-assets.mjs check-tag TAG | stage TAG OS ARCH SOURCE DEST | assemble TAG SOURCE DEST'
    )
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
