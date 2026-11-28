const METAL_ARGUMENTS = ["--use-angle=metal", "--enable-gpu"];
const SOFTWARE_WEBGPU_ARGUMENTS = ["--enable-unsafe-webgpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

interface ChromiumLaunchOptions {
  readonly args: string[];
  readonly executablePath?: string;
}

export function createChromiumLaunchOptions(defaultPath?: string): ChromiumLaunchOptions {
  const { CHROMIUM_EXECUTABLE_PATH: executablePath = defaultPath } = process.env;

  if (executablePath === undefined) {
    return { args: SOFTWARE_WEBGPU_ARGUMENTS };
  }

  return { args: process.platform === "darwin" ? METAL_ARGUMENTS : SOFTWARE_WEBGPU_ARGUMENTS, executablePath };
}
