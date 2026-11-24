// @ts-check

/**
 * @typedef {{ x: number, y: number }} Point
 *
 * @typedef {{ x: number, y: number, w: number, h: number }} RectBox
 *
 * @typedef {{ x: number, y: number, scale: number, rotation?: number }} LayerTransform
 *
 * @typedef {{
 *   type: 'border-cut' | 'lasso',
 *   polygon: Point[],
 *   cutPath: Point[],
 *   pIn?: Point,
 *   pOut?: Point
 * }} SelectionShape
 *
 * @typedef {{
 *   img: HTMLImageElement | HTMLCanvasElement,
 *   width: number,
 *   height: number,
 *   name: string,
 *   _diskBytes?: { data: ArrayBuffer, type: string } | null,
 *   _wasDownscaled?: boolean,
 *   _origWidth?: number,
 *   _origHeight?: number,
 *   _cachedBlob?: Blob | null
 * }} LoadedImage
 *
 * @typedef {'none' | 'feather' | 'multiband' | 'poisson' | 'lab_skin' | 'luma_chroma' | 'edge_aware'} FinalMergeMode
 *
 * @typedef {{
 *   mode: FinalMergeMode,
 *   radiusPx: number,
 *   colorMatchStrength: number,
 *   prioritizeSkin: boolean,
 *   poissonReach: number,
 *   protectCoreFace: boolean
 * }} FinalMergeOptions
 *
 * @typedef {'oklab_ot' | 'cdf_curves' | 'melanin_hemo' | 'zones_lgg' | 'spatial_oklab'} SkinPostMethod
 *
 * @typedef {'face_to_body' | 'body_to_face' | 'mutual'} SkinMatchDirection
 *
 * @typedef {{
 *   enabled: boolean,
 *   method: SkinPostMethod,
 *   direction: SkinMatchDirection,
 *   strength: number,
 *   lumaMatch: number,
 *   chromaMatch: number,
 *   maskSelectivity: number,
 *   protectFeatures: boolean,
 *   seamEqualizePx: number,
 *   borderMatchStrength?: number,
 *   borderMutualMeet?: boolean,
 *   tempOffset: number,
 *   tintOffset: number,
 *   lightOffset: number,
 *   satScale: number
 * }} SkinPostOptions
 *
 * @typedef {{
 *   theme: string,
 *   precisionDefaultMobile: boolean,
 *   precisionSensitivity: number,
 *   loupeZoom: number,
 *   loupeSize: number,
 *   autoSaveHistory: boolean,
 *   mobileMaxEdge?: number,
 *   settingsVersion?: number
 * }} AppSettings
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   status: 'in_progress' | 'completed',
 *   activeStep: 1 | 2 | 3 | 4 | 5 | 6,
 *   createdAt: number,
 *   updatedAt: number,
 *   width: number,
 *   height: number,
 *   thumbBlob?: Blob | null,
 *   thumbBytes?: { data: ArrayBuffer, type: string } | null,
 *   meta: any
 * }} StoredProjectMeta
 *
 * @typedef {{
 *   valid: boolean,
 *   faceRgbBefore: [number, number, number],
 *   bodyRgbBefore: [number, number, number],
 *   faceRgbAfter: [number, number, number],
 *   bodyRgbAfter: [number, number, number],
 *   deltaEBefore: number,
 *   deltaEAfter: number,
 *   faceSkinPixels: number,
 *   bodySkinPixels: number
 * }} SkinDiagnostics
 */
