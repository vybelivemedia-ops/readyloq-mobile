declare module "jpeg-js" {
  export interface RawImageData {
    width: number;
    height: number;
    data: Uint8Array;
  }
  export interface DecodeOptions {
    useTArray?: boolean;
    formatAsRGBA?: boolean;
    tolerantDecoding?: boolean;
    colorTransform?: boolean;
    maxResolutionInMP?: number;
    maxMemoryUsageInMB?: number;
  }
  export function decode(
    data: Uint8Array | ArrayBuffer,
    opts?: DecodeOptions,
  ): RawImageData;
  export function encode(
    imgData: { data: Uint8Array; width: number; height: number },
    quality?: number,
  ): RawImageData;
}
