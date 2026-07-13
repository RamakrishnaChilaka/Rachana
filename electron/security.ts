export function isTrustedRendererDocument(
  expectedUrl: string,
  candidateUrl: string
): boolean {
  try {
    const expected = new URL(expectedUrl)
    const candidate = new URL(candidateUrl)
    return (
      candidate.protocol === expected.protocol &&
      candidate.host === expected.host &&
      decodeURIComponent(candidate.pathname) === decodeURIComponent(expected.pathname)
    )
  } catch {
    return false
  }
}