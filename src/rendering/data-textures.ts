import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  type MagnificationTextureFilter,
  NearestFilter,
  type PixelFormat,
  UnsignedByteType,
} from "three/webgpu";

function clampedTexture(texture: DataTexture, filter: MagnificationTextureFilter): DataTexture {
  texture.minFilter = filter;
  texture.magFilter = filter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return texture;
}

export function floatDataTexture(data: Float32Array, width: number, height: number, format: PixelFormat): DataTexture {
  return clampedTexture(new DataTexture(data, width, height, format, FloatType), NearestFilter);
}

export function byteTexture(data: Uint8Array, size: number, format: PixelFormat): DataTexture {
  return clampedTexture(new DataTexture(data, size, size, format, UnsignedByteType), LinearFilter);
}
