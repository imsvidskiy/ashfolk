import { describe, expect, it } from "vitest";
import { CombatLedger } from "./combat-ledger.ts";

describe("the combat ledger", () => {
  it("lets a stagger and a guard wear off long before it forgets the last assailant", () => {
    const ledger = new CombatLedger();

    ledger.stagger(1, 7);
    ledger.guard(2, 8);
    ledger.stagger(2, 9);

    expect(ledger.isStaggered(1)).toBe(true);
    expect(ledger.isGuarding(1)).toBe(false);
    expect(ledger.isGuarding(2)).toBe(true);
    expect(ledger.assailantOf(2)).toBe(9);
    expect(ledger.assailantOf(3)).toBeNull();

    ledger.update(1);

    expect(ledger.isStaggered(1)).toBe(false);
    expect(ledger.isGuarding(2)).toBe(false);
    expect(ledger.assailantOf(1)).toBe(7);

    ledger.update(60);

    expect(ledger.assailantOf(1)).toBeNull();
    expect(ledger.snapshot().size).toBe(0);
  });

  it("remembers a fighter's assailant afresh with each new blow", () => {
    const ledger = new CombatLedger();

    ledger.stagger(1, 7);
    ledger.update(10);
    ledger.stagger(1, 8);
    ledger.update(5);

    expect(ledger.assailantOf(1)).toBe(8);
  });
});
