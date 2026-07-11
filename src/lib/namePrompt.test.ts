import { afterEach, describe, expect, it } from 'vitest'
import { promptForName } from './namePrompt'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('promptForName', () => {
  it('makes the application inert and restores focus after closing', async () => {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    const launcher = document.createElement('button')
    appRoot.append(launcher)
    document.body.append(appRoot)
    launcher.focus()

    const result = promptForName({
      title: 'Drawing name',
      defaultValue: 'Untitled.excalidraw',
    })

    expect(appRoot.inert).toBe(true)
    expect(document.activeElement).toBe(document.querySelector('.name-prompt-input'))

    document.querySelector<HTMLButtonElement>('.name-prompt-button')?.click()

    await expect(result).resolves.toBeNull()
    expect(appRoot.inert).toBe(false)
    expect(document.activeElement).toBe(launcher)
  })

  it('keeps tab focus inside the modal prompt', async () => {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)

    const result = promptForName({
      title: 'Folder name',
      defaultValue: 'New Folder',
    })
    const input = document.querySelector<HTMLInputElement>('.name-prompt-input')!
    const buttons = document.querySelectorAll<HTMLButtonElement>('.name-prompt-button')
    const confirmButton = buttons[buttons.length - 1]

    confirmButton.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(input)

    buttons[0].click()
    await result
  })

  it('allows only one modal prompt at a time', async () => {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)

    const firstPrompt = promptForName({
      title: 'Drawing name',
      defaultValue: 'Untitled.excalidraw',
    })
    const secondPrompt = promptForName({
      title: 'Folder name',
      defaultValue: 'New Folder',
    })

    await expect(secondPrompt).resolves.toBeNull()
    expect(document.querySelectorAll('.name-prompt-dialog')).toHaveLength(1)

    document.querySelector<HTMLButtonElement>('.name-prompt-button')?.click()
    await firstPrompt
    expect(appRoot.inert).toBe(false)
  })
})
