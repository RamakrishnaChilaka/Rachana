import { createHash, randomUUID } from 'node:crypto'
import {
  constants,
  promises as fs,
  type BigIntStats,
} from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import type {
  NativeFileContent,
  NativeSaveResult,
  SaveFileAsRequest,
  SaveFileRequest,
} from '../src/lib/native'
import type { DocumentFile, FileTreeNode } from '../src/types'
import {
  documentKindFromPath,
  ensureDocumentExtension,
  isSupportedDocumentPath,
  type DocumentKind,
} from '../src/lib/documentKind'

const DEFAULT_DRAWING = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  source: 'Rachana',
  elements: [],
  appState: {
    gridSize: null,
    viewBackgroundColor: '#ffffff',
  },
  files: {},
}, null, 2)

const pathQueues = new Map<string, Promise<void>>()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertAbsolutePath(candidate: string): void {
  if (!path.isAbsolute(candidate) || candidate.includes('\0')) {
    throw new Error('An absolute filesystem path is required')
  }
}

function validateDocumentPath(candidate: string): DocumentKind {
  const kind = documentKindFromPath(candidate)
  if (!kind) {
    throw new Error('Expected a supported .excalidraw, .md, or .markdown file')
  }
  return kind
}

function validateExcalidrawContent(content: string): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw new Error(`Invalid JSON: ${errorMessage(error)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Content is not a JSON object')
  }
  const drawing = parsed as Record<string, unknown>
  if (drawing.type !== 'excalidraw') {
    throw new Error("Invalid or missing type field; expected 'excalidraw'")
  }
  if (typeof drawing.version !== 'number') {
    throw new Error('Version field must be a number')
  }
  if (!Array.isArray(drawing.elements)) {
    throw new Error('Elements field must be an array')
  }
}

function validateDocumentContent(kind: DocumentKind, content: string): void {
  if (kind === 'excalidraw') {
    validateExcalidrawContent(content)
  }
}

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function fileIdentity(stats: BigIntStats): string {
  return `${process.platform}:${stats.dev}:${stats.ino}`
}

function normalizePathKey(candidate: string): string {
  const normalized = path.resolve(candidate).replaceAll('\\', '/').replace(/\/+$/, '')
  return process.platform === 'win32' || process.platform === 'darwin'
    ? normalized.toLocaleLowerCase('en-US')
    : normalized
}

function isWithinDirectory(candidate: string, directory: string): boolean {
  const candidateKey = normalizePathKey(candidate)
  const directoryKey = normalizePathKey(directory)
  return candidateKey === directoryKey || candidateKey.startsWith(`${directoryKey}/`)
}

async function existingCanonicalPath(candidate: string): Promise<string> {
  assertAbsolutePath(candidate)
  return fs.realpath(candidate)
}

async function destinationPath(candidate: string): Promise<string> {
  assertAbsolutePath(candidate)
  validateDocumentPath(candidate)
  try {
    return await fs.realpath(candidate)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = await fs.realpath(path.dirname(candidate))
    return path.join(parent, path.basename(candidate))
  }
}

async function readHandleText(handle: FileHandle): Promise<string> {
  const stats = await handle.stat({ bigint: true })
  if (stats.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Document is too large to read safely')
  }
  const buffer = Buffer.alloc(Number(stats.size))
  let offset = 0
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      buffer.length - offset,
      offset
    )
    if (bytesRead === 0) break
    offset += bytesRead
  }
  return buffer.subarray(0, offset).toString('utf8')
}

async function writeHandleText(handle: FileHandle, content: string): Promise<void> {
  const buffer = Buffer.from(content, 'utf8')
  await handle.truncate(0)
  let offset = 0
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(
      buffer,
      offset,
      buffer.length - offset,
      offset
    )
    if (bytesWritten === 0) {
      throw new Error('Unable to make progress while writing the document')
    }
    offset += bytesWritten
  }
  await handle.sync()
}

async function copyPreparedContent(
  destination: FileHandle,
  prepared: FileHandle
): Promise<void> {
  const preparedStats = await prepared.stat({ bigint: true })
  if (preparedStats.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Prepared document is too large to save safely')
  }
  await destination.truncate(0)
  const buffer = Buffer.alloc(64 * 1024)
  let offset = 0
  const total = Number(preparedStats.size)
  while (offset < total) {
    const { bytesRead } = await prepared.read(
      buffer,
      0,
      Math.min(buffer.length, total - offset),
      offset
    )
    if (bytesRead === 0) {
      throw new Error('Prepared document ended before the save completed')
    }
    let written = 0
    while (written < bytesRead) {
      const result = await destination.write(
        buffer,
        written,
        bytesRead - written,
        offset + written
      )
      if (result.bytesWritten === 0) {
        throw new Error('Unable to make progress while saving the document')
      }
      written += result.bytesWritten
    }
    offset += bytesRead
  }
  await destination.sync()
}

async function syncedTemporaryFile(destination: string, content: string) {
  const temporaryPath = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${randomUUID()}.tmp`
  )
  const handle = await fs.open(temporaryPath, 'wx+', 0o600)
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    return { handle, temporaryPath }
  } catch (error) {
    await handle.close().catch(() => undefined)
    await fs.unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

async function syncParentDirectory(destination: string): Promise<void> {
  if (process.platform === 'win32') return
  const directory = await fs.open(path.dirname(destination), 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

async function serializePath<T>(candidate: string, operation: () => Promise<T>): Promise<T> {
  const key = normalizePathKey(candidate)
  const previous = pathQueues.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  pathQueues.set(key, current)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (pathQueues.get(key) === current) {
      pathQueues.delete(key)
    }
  }
}

interface ExpectedSnapshot {
  contentHash: string
  fileIdentity: string
}

async function overwriteExisting(
  destination: string,
  content: string,
  expected?: ExpectedSnapshot
): Promise<NativeSaveResult> {
  const handle = await fs.open(destination, 'r+')
  let originalContent = ''
  let originalMode = 0
  let mutated = false
  try {
    const openedStats = await handle.stat({ bigint: true })
    const openedIdentity = fileIdentity(openedStats)
    originalMode = Number(openedStats.mode)
    originalContent = await readHandleText(handle)
    if (expected?.fileIdentity !== undefined && openedIdentity !== expected.fileIdentity) {
      throw new Error('The document was replaced on disk since it was opened. Reload or save a copy before retrying.')
    }
    if (expected?.contentHash !== undefined && contentHash(originalContent) !== expected.contentHash) {
      throw new Error('The document changed on disk since it was opened. Reload or save a copy before retrying.')
    }
    const staged = await syncedTemporaryFile(destination, content)
    try {
      const pathStats = await fs.stat(destination, { bigint: true })
      if (fileIdentity(pathStats) !== openedIdentity) {
        throw new Error('The save destination was replaced before it could be written')
      }
      if (await readHandleText(handle) !== originalContent) {
        throw new Error('The save destination changed before it could be written')
      }
      mutated = true
      await copyPreparedContent(handle, staged.handle)
      await handle.chmod(originalMode)
      const savedContent = await readHandleText(handle)
      const savedPathStats = await fs.stat(destination, { bigint: true })
      if (savedContent !== content || fileIdentity(savedPathStats) !== openedIdentity) {
        throw new Error('The save destination changed while it was being written')
      }
      return {
        contentHash: contentHash(content),
        fileIdentity: openedIdentity,
      }
    } catch (error) {
      if (mutated) {
        try {
          await writeHandleText(handle, originalContent)
          await handle.chmod(originalMode)
        } catch (restoreError) {
          throw new Error(
            `Failed to save document (${errorMessage(error)}) and restore its previous content (${errorMessage(restoreError)})`
          )
        }
      }
      throw error
    } finally {
      await staged.handle.close().catch(() => undefined)
      await fs.unlink(staged.temporaryPath).catch(() => undefined)
    }
  } finally {
    await handle.close()
  }
}

async function writeNew(destination: string, content: string): Promise<NativeSaveResult> {
  const staged = await syncedTemporaryFile(destination, content)
  await staged.handle.close()
  try {
    await fs.link(staged.temporaryPath, destination)
    await syncParentDirectory(destination)
    const stats = await fs.stat(destination, { bigint: true })
    return {
      contentHash: contentHash(content),
      fileIdentity: fileIdentity(stats),
    }
  } finally {
    await fs.unlink(staged.temporaryPath).catch(() => undefined)
  }
}

async function sameFile(first: string, second: string): Promise<boolean> {
  if (normalizePathKey(first) === normalizePathKey(second)) return true
  try {
    const [firstStats, secondStats] = await Promise.all([
      fs.stat(first, { bigint: true }),
      fs.stat(second, { bigint: true }),
    ])
    return fileIdentity(firstStats) === fileIdentity(secondStats)
  } catch {
    return false
  }
}

function safeName(name: string): string {
  const sanitized = name.trim().replaceAll('/', '_').replaceAll('\\', '_').replaceAll('..', '_')
  if (!sanitized || sanitized === '.') {
    throw new Error('Invalid file or folder name')
  }
  return sanitized
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function buildTree(directory: string): Promise<FileTreeNode[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const nodes: FileTreeNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: entryPath,
        is_directory: true,
        modified: false,
        children: await buildTree(entryPath),
      })
    } else if (
      entry.isFile() &&
      isSupportedDocumentPath(entry.name)
    ) {
      const kind = validateDocumentPath(entry.name)
      nodes.push({
        name: entry.name,
        path: entryPath,
        kind,
        is_directory: false,
        modified: false,
      })
    }
  }
  return nodes.sort((first, second) => {
    if (first.is_directory !== second.is_directory) {
      return first.is_directory ? -1 : 1
    }
    return first.name.localeCompare(second.name)
  })
}

export async function listDocumentFiles(directory: string): Promise<DocumentFile[]> {
  const root = await existingCanonicalPath(directory)
  const tree = await buildTree(root)
  const files: DocumentFile[] = []
  const collect = (nodes: FileTreeNode[]) => {
    for (const node of nodes) {
      if (node.is_directory) {
        collect(node.children ?? [])
      } else {
        files.push({
          name: node.name,
          path: node.path,
          kind: node.kind!,
          modified: false,
        })
      }
    }
  }
  collect(tree)
  return files.sort((first, second) => first.name.localeCompare(second.name))
}

export async function getFileTree(directory: string): Promise<FileTreeNode[]> {
  return buildTree(await existingCanonicalPath(directory))
}

export async function readDocumentFile(filePath: string): Promise<NativeFileContent> {
  const canonicalPath = await existingCanonicalPath(filePath)
  const kind = validateDocumentPath(canonicalPath)
  const handle = await fs.open(canonicalPath, 'r')
  try {
    const openedStats = await handle.stat({ bigint: true })
    const openedIdentity = fileIdentity(openedStats)
    const content = await readHandleText(handle)
    const verificationContent = await readHandleText(handle)
    const [finalStats, finalPath] = await Promise.all([
      fs.stat(canonicalPath, { bigint: true }),
      fs.realpath(filePath),
    ])
    if (
      content !== verificationContent ||
      fileIdentity(finalStats) !== openedIdentity ||
      normalizePathKey(finalPath) !== normalizePathKey(canonicalPath)
    ) {
      throw new Error('The document changed or was replaced while it was being read; retry the operation')
    }
    validateDocumentContent(kind, content)
    return {
      content,
      contentHash: contentHash(content),
      fileIdentity: openedIdentity,
    }
  } finally {
    await handle.close()
  }
}

export async function saveDocumentFile(request: SaveFileRequest): Promise<NativeSaveResult> {
  const canonicalPath = await existingCanonicalPath(request.filePath)
  const kind = validateDocumentPath(canonicalPath)
  validateDocumentContent(kind, request.content)
  if (!request.expectedHash || !request.expectedIdentity) {
    throw new Error('Expected content hash and file identity are required')
  }
  return serializePath(canonicalPath, async () => {
    return overwriteExisting(canonicalPath, request.content, {
      contentHash: request.expectedHash!,
      fileIdentity: request.expectedIdentity!,
    })
  })
}

export async function saveDocumentFileAs(request: SaveFileAsRequest): Promise<NativeSaveResult> {
  const destination = await destinationPath(request.filePath)
  const destinationKind = validateDocumentPath(destination)
  const sourceKind = validateDocumentPath(request.sourcePath)
  if (destinationKind !== sourceKind) {
    throw new Error('Save As must preserve the document type')
  }
  validateDocumentContent(destinationKind, request.content)
  if (
    request.forbiddenDirectory &&
    isWithinDirectory(destination, await existingCanonicalPath(request.forbiddenDirectory))
  ) {
    throw new Error('The save destination must be outside the folder being deleted')
  }
  if (request.isRecovery && await sameFile(destination, request.sourcePath)) {
    throw new Error('A recovery copy must be saved to a different destination')
  }
  for (const openPath of request.openPaths) {
    if (await sameFile(destination, openPath)) {
      throw new Error('That save destination is already open')
    }
  }
  return serializePath(destination, async () => {
    return await pathExists(destination)
      ? overwriteExisting(destination, request.content)
      : writeNew(destination, request.content)
  })
}

export async function createNewFile(
  directory: string,
  fileName: string,
  kind: DocumentKind
): Promise<string> {
  const root = await existingCanonicalPath(directory)
  const requestedName = safeName(fileName)
  const normalizedName = ensureDocumentExtension(requestedName, kind)
  if (documentKindFromPath(normalizedName) !== kind) {
    throw new Error('The filename extension does not match the document type')
  }
  const extension = kind === 'markdown'
    ? path.extname(normalizedName)
    : '.excalidraw'
  const stem = normalizedName.slice(0, -extension.length)
  const content = kind === 'markdown' ? '' : DEFAULT_DRAWING
  for (let suffix = 0; suffix <= 100; suffix += 1) {
    const candidateName = suffix === 0
      ? normalizedName
      : `${stem}-${suffix}${extension}`
    const candidate = path.join(root, candidateName)
    try {
      const handle = await fs.open(candidate, 'wx')
      try {
        await handle.writeFile(content, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error('Could not find a unique file name')
}

export async function createNewFolder(directory: string, folderName: string): Promise<string> {
  const root = await existingCanonicalPath(directory)
  const name = safeName(folderName)
  for (let suffix = 0; suffix <= 100; suffix += 1) {
    const candidate = path.join(root, suffix === 0 ? name : `${name}-${suffix}`)
    try {
      await fs.mkdir(candidate)
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error('Could not find a unique folder name')
}

export async function renameFile(oldPath: string, newName: string): Promise<string> {
  const canonicalPath = await existingCanonicalPath(oldPath)
  const kind = validateDocumentPath(canonicalPath)
  const requestedName = safeName(newName)
  const finalName = ensureDocumentExtension(requestedName, kind)
  if (documentKindFromPath(finalName) !== kind) {
    throw new Error('Rename must preserve the document type')
  }
  const destination = path.join(path.dirname(canonicalPath), finalName)
  if (normalizePathKey(destination) !== normalizePathKey(canonicalPath) && await pathExists(destination)) {
    throw new Error('A file with that name already exists')
  }
  await fs.rename(canonicalPath, destination)
  return destination
}

export async function renameFolder(oldPath: string, newName: string): Promise<string> {
  const canonicalPath = await existingCanonicalPath(oldPath)
  if (!(await fs.stat(canonicalPath)).isDirectory()) {
    throw new Error('Path is not a folder')
  }
  const destination = path.join(path.dirname(canonicalPath), safeName(newName))
  if (normalizePathKey(destination) !== normalizePathKey(canonicalPath) && await pathExists(destination)) {
    throw new Error('A folder or file with that name already exists')
  }
  await fs.rename(canonicalPath, destination)
  return destination
}

export async function deleteFile(filePath: string): Promise<void> {
  const canonicalPath = await existingCanonicalPath(filePath)
  validateDocumentPath(canonicalPath)
  await fs.unlink(canonicalPath)
}

export async function deleteFolder(folderPath: string): Promise<void> {
  const canonicalPath = await existingCanonicalPath(folderPath)
  if (!(await fs.stat(canonicalPath)).isDirectory()) {
    throw new Error('Path is not a folder')
  }
  await fs.rm(canonicalPath, { recursive: true })
}

export async function getDeletionScopeMatches(
  targetPath: string,
  isDirectory: boolean,
  candidatePaths: string[]
): Promise<boolean[]> {
  const targetExists = await pathExists(targetPath)
  const resolvedTarget = targetExists ? await existingCanonicalPath(targetPath) : targetPath
  return Promise.all(candidatePaths.map(async (candidate) => {
    const lexicalMatch = isDirectory
      ? isWithinDirectory(candidate, targetPath)
      : normalizePathKey(candidate) === normalizePathKey(targetPath)
    if (lexicalMatch || !targetExists || !await pathExists(candidate)) {
      return lexicalMatch
    }
    const resolvedCandidate = await existingCanonicalPath(candidate)
    return isDirectory
      ? isWithinDirectory(resolvedCandidate, resolvedTarget)
      : normalizePathKey(resolvedCandidate) === normalizePathKey(resolvedTarget)
  }))
}