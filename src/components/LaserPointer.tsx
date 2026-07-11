import { useEffect, useRef } from 'react'

interface Point {
  x: number
  y: number
  time: number
}

const TRAIL_DURATION = 600
const DOT_SIZE = 12
const TRAIL_POINTS_MAX = 50

export function LaserPointer() {
  const trailRef = useRef<Point[]>([])
  const pointerRef = useRef({ x: 0, y: 0, visible: false })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)

  useEffect(() => {
    const requestRender = () => {
      if (!animFrameRef.current) {
        animFrameRef.current = requestAnimationFrame(render)
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      const now = performance.now()
      pointerRef.current = { x: e.clientX, y: e.clientY, visible: true }

      trailRef.current.push({ x: e.clientX, y: e.clientY, time: now })
      if (trailRef.current.length > TRAIL_POINTS_MAX) {
        trailRef.current.shift()
      }
      requestRender()
    }

    const setPointerVisibility = (visible: boolean) => {
      pointerRef.current.visible = visible
      requestRender()
    }

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1
      const width = window.innerWidth
      const height = window.innerHeight

      canvas.width = Math.ceil(width * dpr)
      canvas.height = Math.ceil(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      requestRender()
    }

    const render = () => {
      animFrameRef.current = 0
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)

      const now = performance.now()

      trailRef.current = trailRef.current.filter(
        (p) => now - p.time < TRAIL_DURATION
      )

      const points = trailRef.current

      if (points.length > 1) {
        for (let i = 1; i < points.length; i++) {
          const prev = points[i - 1]
          const curr = points[i]
          const age = now - curr.time
          const opacity = Math.max(0, 1 - age / TRAIL_DURATION) * 0.6
          const width = Math.max(1, (1 - age / TRAIL_DURATION) * 4)

          ctx.beginPath()
          ctx.moveTo(prev.x, prev.y)
          ctx.lineTo(curr.x, curr.y)
          ctx.strokeStyle = `rgba(255, 40, 40, ${opacity})`
          ctx.lineWidth = width
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.stroke()
        }
      }

      const pointer = pointerRef.current
      if (pointer.visible) {
        const radius = DOT_SIZE / 2
        const gradient = ctx.createRadialGradient(
          pointer.x,
          pointer.y,
          0,
          pointer.x,
          pointer.y,
          radius
        )
        gradient.addColorStop(0, 'rgba(255, 50, 50, 1)')
        gradient.addColorStop(0.4, 'rgba(255, 30, 30, 0.8)')
        gradient.addColorStop(0.7, 'rgba(255, 0, 0, 0)')
        gradient.addColorStop(1, 'rgba(255, 0, 0, 0)')

        ctx.beginPath()
        ctx.arc(pointer.x, pointer.y, radius, 0, Math.PI * 2)
        ctx.fillStyle = gradient
        ctx.shadowColor = 'rgba(255, 40, 40, 0.5)'
        ctx.shadowBlur = 8
        ctx.fill()
        ctx.shadowBlur = 0
      }

      if (trailRef.current.length > 0) {
        animFrameRef.current = requestAnimationFrame(render)
      }
    }

    const handleMouseLeave = () => setPointerVisibility(false)
    const handleMouseEnter = () => setPointerVisibility(true)

    resizeCanvas()
    window.addEventListener('mousemove', handleMouseMove, { passive: true })
    window.addEventListener('resize', resizeCanvas)
    document.addEventListener('mouseleave', handleMouseLeave)
    document.addEventListener('mouseenter', handleMouseEnter)

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = 0
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('resize', resizeCanvas)
      document.removeEventListener('mouseleave', handleMouseLeave)
      document.removeEventListener('mouseenter', handleMouseEnter)
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none" style={{ cursor: 'none' }}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  )
}
