interface NamePromptOptions {
  title: string
  defaultValue: string
  confirmLabel?: string
}

let promptIsOpen = false

export function isNamePromptOpen(): boolean {
  return promptIsOpen
}

export function promptForName({
  title,
  defaultValue,
  confirmLabel = 'Create',
}: NamePromptOptions): Promise<string | null> {
  if (promptIsOpen) {
    return Promise.resolve(null)
  }

  promptIsOpen = true

  return new Promise((resolve) => {
    const previouslyFocusedElement = document.activeElement
    const appRoot = document.getElementById('root')
    const appRootWasInert = appRoot?.inert ?? false
    const overlay = document.createElement('div')
    overlay.className = 'name-prompt-overlay'

    const dialog = document.createElement('form')
    dialog.className = 'name-prompt-dialog'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')

    const label = document.createElement('label')
    label.className = 'name-prompt-label'
    label.textContent = title
    label.id = 'name-prompt-title'

    const input = document.createElement('input')
    input.className = 'name-prompt-input'
    input.type = 'text'
    input.value = defaultValue
    input.id = 'name-prompt-input'
    label.htmlFor = input.id
    dialog.setAttribute('aria-labelledby', label.id)

    const actions = document.createElement('div')
    actions.className = 'name-prompt-actions'

    const cancelButton = document.createElement('button')
    cancelButton.className = 'name-prompt-button'
    cancelButton.type = 'button'
    cancelButton.textContent = 'Cancel'

    const confirmButton = document.createElement('button')
    confirmButton.className = 'name-prompt-button primary'
    confirmButton.type = 'submit'
    confirmButton.textContent = confirmLabel

    let settled = false

    const cleanup = (value: string | null) => {
      if (settled) {
        return
      }
      settled = true
      promptIsOpen = false
      document.removeEventListener('keydown', handleKeyDown)
      overlay.remove()
      if (appRoot) {
        appRoot.inert = appRootWasInert
      }
      if (previouslyFocusedElement instanceof HTMLElement) {
        previouslyFocusedElement.focus()
      }
      resolve(value)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cleanup(null)
      } else if (event.key === 'Tab') {
        const focusableElements = [input, cancelButton, confirmButton]
        const firstElement = focusableElements[0]
        const lastElement = focusableElements[focusableElements.length - 1]

        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault()
          event.stopPropagation()
          lastElement.focus()
        } else if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault()
          event.stopPropagation()
          firstElement.focus()
        }
      }
    }

    dialog.addEventListener('submit', (event) => {
      event.preventDefault()
      const value = input.value.trim()
      cleanup(value || null)
    })

    cancelButton.addEventListener('click', () => cleanup(null))
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        cleanup(null)
      }
    })
    document.addEventListener('keydown', handleKeyDown)
    if (appRoot) {
      appRoot.inert = true
    }

    actions.append(cancelButton, confirmButton)
    dialog.append(label, input, actions)
    overlay.append(dialog)
    document.body.append(overlay)

    input.focus()
    input.select()
  })
}
