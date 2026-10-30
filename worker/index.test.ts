import { describe, expect, it, vi } from "vitest";
import worker, { homeAddressOf } from "./index.ts";

function assetsReturning(body: string) {
  return {
    fetch: vi.fn(() => {
      return Promise.resolve(new Response(body));
    }),
  };
}

describe("worker", () => {
  it("serves the game on its own domain", async () => {
    const assets = assetsReturning("game");

    const response = await worker.fetch(new Request("https://playdawnfolk.com/?seed=7"), { ASSETS: assets });

    expect(await response.text()).toBe("game");
    expect(assets.fetch).toHaveBeenCalledOnce();
  });

  it("sends the old address to the domain with the path and query kept", async () => {
    const assets = assetsReturning("game");

    const response = await worker.fetch(new Request("https://dawnfolk.svidskiy.workers.dev/?seed=7&shape=round"), {
      ASSETS: assets,
    });

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("https://playdawnfolk.com/?seed=7&shape=round");
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("serves a part of a film when asked for a range", async () => {
    const assets = assetsReturning("0123456789");

    const response = await worker.fetch(
      new Request("https://playdawnfolk.com/media/wide.mp4", { headers: { Range: "bytes=2-5" } }),
      { ASSETS: assets }
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(await response.text()).toBe("2345");
  });

  it("offers ranges on a whole film", async () => {
    const response = await worker.fetch(new Request("https://playdawnfolk.com/media/wide.mp4"), {
      ASSETS: assetsReturning("0123456789"),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(await response.text()).toBe("0123456789");
  });

  it("serves the whole film for a range it does not read", async () => {
    const response = await worker.fetch(
      new Request("https://playdawnfolk.com/media/wide.mp4", { headers: { Range: "bytes=-3" } }),
      { ASSETS: assetsReturning("0123456789") }
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("0123456789");
  });

  it("drops the www prefix", () => {
    expect(homeAddressOf(new Request("https://www.playdawnfolk.com/manifest.webmanifest"))).toBe(
      "https://playdawnfolk.com/manifest.webmanifest"
    );
    expect(homeAddressOf(new Request("https://www.ashfolk.com/?seed=7"))).toBe("https://ashfolk.com/?seed=7");
  });

  it("serves the game on the new domain too", () => {
    expect(homeAddressOf(new Request("https://ashfolk.com/?seed=7"))).toBeNull();
  });
});
