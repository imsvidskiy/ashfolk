const HOME_HOST = "ashfolk.com";
const SERVED_HOSTS = new Set([HOME_HOST, "localhost"]);
const MEDIA_PREFIX = "/media/";
const RANGE_PATTERN = /^bytes=(?<start>\d+)-(?<end>\d*)$/u;

interface WorkerEnvironment {
  readonly ASSETS: { readonly fetch: (request: Request) => Promise<Response> };
}

export function homeAddressOf(request: Request): string | null {
  const url = new URL(request.url);

  if (SERVED_HOSTS.has(url.hostname)) {
    return null;
  }

  url.protocol = "https:";
  url.hostname = HOME_HOST;
  url.port = "";

  return url.toString();
}

function requestedRange(rangeHeader: string | null): { end: string; start: string } | null {
  const groups = rangeHeader === null ? undefined : RANGE_PATTERN.exec(rangeHeader)?.groups;

  if (groups === undefined) {
    return null;
  }

  const { end, start } = groups;

  if (start === undefined || end === undefined) {
    return null;
  }

  return { end, start };
}

async function serveRange(request: Request, assets: WorkerEnvironment["ASSETS"]): Promise<Response> {
  const response = await assets.fetch(request);
  const range = requestedRange(request.headers.get("Range"));
  const headers = new Headers(response.headers);

  headers.set("Accept-Ranges", "bytes");

  if (!response.ok || range === null) {
    return new Response(response.body, { headers, status: response.status });
  }

  const body = await response.arrayBuffer();
  const start = Number(range.start);
  const end = range.end === "" ? body.byteLength - 1 : Math.min(Number(range.end), body.byteLength - 1);

  if (start > end) {
    return new Response(body, { headers });
  }

  headers.set("Content-Range", `bytes ${start}-${end}/${body.byteLength}`);
  headers.set("Content-Length", String(end - start + 1));

  return new Response(body.slice(start, end + 1), { headers, status: 206 });
}

export default {
  fetch(request: Request, environment: WorkerEnvironment): Promise<Response> {
    const homeAddress = homeAddressOf(request);

    if (homeAddress !== null) {
      return Promise.resolve(Response.redirect(homeAddress, 301));
    }

    if (new URL(request.url).pathname.startsWith(MEDIA_PREFIX)) {
      return serveRange(request, environment.ASSETS);
    }

    return environment.ASSETS.fetch(request);
  },
};
