import { DataTexture, FloatType, LinearFilter, type PixelFormat, UnsignedByteType } from "three/webgpu";

export function floatDataTexture(data: Float32Array, width: number, height: number, format: PixelFormat): DataTexture {
  const texture = new DataTexture(data, width, height, format, FloatType);

  texture.needsUpdate = true;

  return texture;
}

export function byteTexture(data: Uint8Array, size: number, format: PixelFormat): DataTexture {
  const texture = new DataTexture(data, size, size, format, UnsignedByteType);

  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;

  return texture;
}
