/// <reference types="vite/client" />

import type { RachanaNativeApi } from './lib/native'

declare global {
	interface Window {
		rachana: RachanaNativeApi
		EXCALIDRAW_ASSET_PATH: string
	}
}
