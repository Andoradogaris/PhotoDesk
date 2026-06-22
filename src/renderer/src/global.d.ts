import type { PhotoDeskApi } from './types'

declare global {
  interface Window {
    photoDesk: PhotoDeskApi
  }
}

export {}
