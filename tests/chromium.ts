const SOFTWARE_WEBGPU_ARGUMENTS = ["--enable-unsafe-webgpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

interface ChromiumLaunchOptions {
  readonly args: string[];
  readonly executablePath?: string;
}

export function createChromiumLaunchOptions(): ChromiumLaunchOptions {
  const { CHROMIUM_EXECUTABLE_PATH: executablePath } = process.env;

  if (executablePath === undefined) {
    return { args: SOFTWARE_WEBGPU_ARGUMENTS };
  }

  return { args: SOFTWARE_WEBGPU_ARGUMENTS, executablePath };
}
