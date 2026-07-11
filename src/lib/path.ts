export function pathBasename(path: string): string {
  const normalizedPath = path.replace(/[\\/]+$/, '')
  return normalizedPath.split(/[\\/]/).pop() || path
}

export function normalizePathForComparison(path: string): string {
  const windowsPath = /^[a-z]:[\\/]/i.test(path) || /^\\\\/.test(path)
  const normalized = path
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')

  return windowsPath ? normalized.toLocaleLowerCase('en-US') : normalized
}

export function pathsEqual(first: string, second: string): boolean {
  return normalizePathForComparison(first) === normalizePathForComparison(second)
}

export function drawingDisplayName(name: string): string {
  return name.replace(/\.excalidraw$/i, '')
}
