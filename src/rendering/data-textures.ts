import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  NearestFilter,
  type PixelFormat,
  UnsignedByteType,
} from "three/webgpu";

export function floatDataTexture(data: Float32Array, width: number, height: number, format: PixelFormat): DataTexture {
  const texture = new DataTexture(data, width, height, format, FloatType);

  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return texture;
}

export function cellByteTexture(data: Uint8Array, size: number, format: PixelFormat): DataTexture {
  const texture = new DataTexture(data, size, size, format, UnsignedByteType);

  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return texture;
}

export function byteTexture(data: Uint8Array, size: number, format: PixelFormat): DataTexture {
  const texture = new DataTexture(data, size, size, format, UnsignedByteType);

  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return texture;
}
