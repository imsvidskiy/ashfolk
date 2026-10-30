import { describe, expect, it } from "vitest";
import { cn } from "./cn.ts";

describe("class names", () => {
  it("lets a later class replace a conflicting one and reads the design colors as colors", () => {
    expect(cn("text-ink-soft px-2 text-sm", "text-dawn px-4")).toBe("text-sm text-dawn px-4");
  });
});
