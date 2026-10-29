import { lerp, saturate } from "./math.ts";

const HEX_COLOR = /^#[0-9a-f]{6}$/iu;
const CHANNEL_MAXIMUM = 255;
const RED_FACTOR = 65_536;
const GREEN_FACTOR = 256;

type ColorChannels = readonly [red: number, green: number, blue: number];

export function parseHexColor(text: string): number {
  if (!HEX_COLOR.test(text)) {
    throw new RangeError(`"${text}" is not a #rrggbb color`);
  }

  return Number.parseInt(text.slice(1), 16);
}

export function colorChannels(color: number): ColorChannels {
  const red = Math.floor(color / RED_FACTOR) % GREEN_FACTOR;
  const green = Math.floor(color / GREEN_FACTOR) % GREEN_FACTOR;
  const blue = color % GREEN_FACTOR;

  return [red / CHANNEL_MAXIMUM, green / CHANNEL_MAXIMUM, blue / CHANNEL_MAXIMUM];
}

export function toByte(value: number): number {
  return Math.round(saturate(value) * CHANNEL_MAXIMUM);
}

export function packColor(red: number, green: number, blue: number): number {
  return toByte(red) * RED_FACTOR + toByte(green) * GREEN_FACTOR + toByte(blue);
}

export function mixColors(from: number, to: number, amount: number): number {
  const [fromRed, fromGreen, fromBlue] = colorChannels(from);
  const [toRed, toGreen, toBlue] = colorChannels(to);

  return packColor(lerp(fromRed, toRed, amount), lerp(fromGreen, toGreen, amount), lerp(fromBlue, toBlue, amount));
}

export function scaleColor(color: number, factor: number): number {
  const [red, green, blue] = colorChannels(color);

  return packColor(red * factor, green * factor, blue * factor);
}

export function colorFromPalette(palette: readonly number[], position: number): number {
  const scaled = saturate(position) * (palette.length - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(palette.length - 1, lower + 1);

  return mixColors(palette[lower], palette[upper], scaled - lower);
}
