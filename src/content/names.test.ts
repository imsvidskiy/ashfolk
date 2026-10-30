import { describe, expect, it } from "vitest";
import { createRandom } from "../shared/random.ts";
import { personName, tribeIdentity } from "./names.ts";

describe("names", () => {
  it("numbers the tribes once the totems run out", () => {
    expect(tribeIdentity(0).name).toBe("Bear Clan");
    expect(tribeIdentity(10).name).toBe("Bear Clan 2");
  });

  it("names women and men from their own lists", () => {
    expect(personName(createRandom(4), true)).not.toBe(personName(createRandom(4), false));
  });
});
