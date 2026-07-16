export const DOCUMENT_KINDS = ['excalidraw', 'markdown'] as const

export type DocumentKind = typeof DOCUMENT_KINDS[number]

const MARKDOWN_EXTENSIONS = ['.md', '.markdown'] as const

export function documentKindFromPath(filePath: string): DocumentKind | null {
  const normalized = filePath.toLocaleLowerCase('en-US')
  if (normalized.endsWith('.excalidraw')) return 'excalidraw'
  if (MARKDOWN_EXTENSIONS.some((extension) => normalized.endsWith(extension))) {
    return 'markdown'
  }
  return null
}

export function isSupportedDocumentPath(filePath: string): boolean {
  return documentKindFromPath(filePath) !== null
}

export function documentDisplayName(name: string): string {
  return name.replace(/\.(excalidraw|markdown|md)$/i, '')
}

export function ensureDocumentExtension(
  name: string,
  kind: DocumentKind
): string {
  if (documentKindFromPath(name)) return name
  return kind === 'markdown' ? `${name}.md` : `${name}.excalidraw`
}