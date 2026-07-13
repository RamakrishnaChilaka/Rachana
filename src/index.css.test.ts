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
