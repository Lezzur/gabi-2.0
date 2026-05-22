// Minimal BarcodeDetector declaration for browsers that support the
// Barcode Detection API (Chrome/Edge 83+). Not yet in TypeScript's lib.dom.
// https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API

interface BarcodeDetectorOptions {
  formats?: string[]
}

interface DetectedBarcode {
  rawValue: string
  format: string
  boundingBox: DOMRectReadOnly
  cornerPoints: ReadonlyArray<{ x: number; y: number }>
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions)
  detect(image: ImageBitmapSource | HTMLVideoElement): Promise<DetectedBarcode[]>
  static getSupportedFormats(): Promise<string[]>
}

interface Window {
  BarcodeDetector: typeof BarcodeDetector
  __qrPending?: string | null
}
