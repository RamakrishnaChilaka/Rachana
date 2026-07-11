export function didSceneElementsChange(
  previous: readonly unknown[],
  current: readonly unknown[]
): boolean {
  if (previous === current) {
    return false
  }
  if (previous.length !== current.length) {
    return true
  }

  // Excalidraw elements are immutable, so unchanged scenes retain element references.
  return previous.some((element, index) => element !== current[index])
}
