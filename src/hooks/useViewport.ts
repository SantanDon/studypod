import * as React from "react"

const MOBILE_BREAKPOINT = 768
const DESKTOP_BREAKPOINT = 1100

export interface ViewportState {
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
  width: number
}

export function useViewport(): ViewportState {
  const [viewport, setViewport] = React.useState<ViewportState>({
    isMobile: false,
    isTablet: false,
    isDesktop: false,
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
  })

  React.useEffect(() => {
    const calculateViewport = (): ViewportState => {
      const width = window.innerWidth
      return {
        isMobile: width < MOBILE_BREAKPOINT,
        isTablet: width >= MOBILE_BREAKPOINT && width < DESKTOP_BREAKPOINT,
        isDesktop: width >= DESKTOP_BREAKPOINT,
        width,
      }
    }

    const handleResize = () => {
      setViewport(calculateViewport())
    }

    // Set initial state
    setViewport(calculateViewport())

    // Use matchMedia for better performance
    const mobileMql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const desktopMql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`)

    mobileMql.addEventListener("change", handleResize)
    desktopMql.addEventListener("change", handleResize)

    return () => {
      mobileMql.removeEventListener("change", handleResize)
      desktopMql.removeEventListener("change", handleResize)
    }
  }, [])

  return viewport
}

// Backward compatibility hooks
export function useIsMobile(): boolean {
  const { isMobile } = useViewport()
  return isMobile
}

export function useIsDesktop(): boolean {
  const { isDesktop } = useViewport()
  return isDesktop
}
