import { describe, expect, it } from 'vitest'
import './index.css'

describe('canvas text typography', () => {
  it('keeps shell font synthesis from changing the Excalidraw text editor weight', () => {
    const shellInput = document.createElement('textarea')
    const editor = document.createElement('textarea')
    const canvas = document.createElement('canvas')
    const excalidraw = document.createElement('div')

    excalidraw.className = 'excalidraw'
    editor.className = 'excalidraw-wysiwyg'
    excalidraw.append(editor, canvas)
    document.body.append(shellInput, excalidraw)

    expect(getComputedStyle(shellInput).fontSynthesis).toBe('none')
    expect(getComputedStyle(editor).fontSynthesis).toBe(
      'weight style small-caps position',
    )
    expect(getComputedStyle(canvas).fontSynthesis).toBe(
      'weight style small-caps position',
    )

    shellInput.remove()
    excalidraw.remove()
  })
})

describe('application menu styling', () => {
  it('keeps the menu bounded and distinguishes disabled and recent items', () => {
    const menu = document.createElement('div')
    const disabledItem = document.createElement('div')
    const recentItem = document.createElement('div')
    const detail = document.createElement('span')

    menu.className = 'chrome-menu'
    disabledItem.className = 'chrome-menu-item'
    disabledItem.dataset.disabled = ''
    recentItem.className = 'chrome-menu-item chrome-menu-recent-item'
    detail.className = 'chrome-menu-item-detail'
    recentItem.append(detail)
    menu.append(disabledItem, recentItem)
    document.body.append(menu)

    expect(getComputedStyle(menu).width).toBe('17rem')
    expect(getComputedStyle(menu).overflowY).toBe('auto')
    expect(getComputedStyle(disabledItem).opacity).toBe('0.42')
    expect(getComputedStyle(disabledItem).pointerEvents).toBe('none')
    expect(getComputedStyle(recentItem).minHeight).toBe('2.75rem')
    expect(getComputedStyle(detail).textOverflow).toBe('ellipsis')

    menu.remove()
  })
})
