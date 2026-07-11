import { describe, expect, it } from 'vitest'
import './index.css'
import styles from './index.css?raw'

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

  it('matches the Linux text editor weight to committed canvas text', () => {
    expect(styles).toMatch(
      /html\[data-platform='linux'\] \.excalidraw textarea\.excalidraw-wysiwyg\s*\{[^}]*-webkit-font-smoothing:\s*antialiased;[^}]*-webkit-text-stroke:\s*0\.025em currentColor;/,
    )
  })
})
