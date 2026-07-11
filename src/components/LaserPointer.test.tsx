import { fireEvent, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LaserPointer } from './LaserPointer'

describe('LaserPointer rendering', () => {
  const animationFrames = new Map<number, FrameRequestCallback>()
  let nextFrameId = 1
  const context = {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    fill: vi.fn(),
    lineCap: 'round',
    lineJoin: 'round',
    lineTo: vi.fn(),
    lineWidth: 1,
    moveTo: vi.fn(),
    setTransform: vi.fn(),
    shadowBlur: 0,
    shadowColor: '',
    stroke: vi.fn(),
    strokeStyle: '',
  }

  beforeEach(() => {
    animationFrames.clear()
    nextFrameId = 1
    vi.clearAllMocks()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId++
      animationFrames.set(id, callback)
      return id
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
      animationFrames.delete(id)
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders pointer movement on canvas without a permanent animation loop', () => {
    render(
      <StrictMode>
        <LaserPointer />
      </StrictMode>,
    )

    expect(requestAnimationFrame).toHaveBeenCalledTimes(2)
    animationFrames.get(2)?.(0)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2)

    fireEvent.mouseMove(window, { clientX: 120, clientY: 80 })
    expect(requestAnimationFrame).toHaveBeenCalledTimes(3)

    animationFrames.get(3)?.(16)
    expect(context.arc).toHaveBeenCalledWith(120, 80, 6, 0, Math.PI * 2)
    expect(context.fill).toHaveBeenCalledTimes(1)
  })
})
