import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'

export function useResolvedTheme(): 'light' | 'dark' {
  const preference = useStore((state) => state.preferences.theme)
  const [systemIsDark, setSystemIsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (event: MediaQueryListEvent) => setSystemIsDark(event.matches)

    setSystemIsDark(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  const theme = preference === 'system'
    ? (systemIsDark ? 'dark' : 'light')
    : preference

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  return theme
}
