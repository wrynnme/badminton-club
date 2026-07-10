import { describe, it, expect, afterEach } from "vitest";
import { setUnsavedGuard, hasUnsavedChanges } from "@/lib/hooks/use-unsaved-guard";

// The registry is module-level (shared across the whole page), so every test
// must clear its own key(s) afterward to avoid leaking dirty state into the
// next test.
afterEach(() => {
  setUnsavedGuard("a", false);
  setUnsavedGuard("b", false);
});

describe("hasUnsavedChanges", () => {
  it("is false when nothing has been registered", () => {
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("is true once a key is marked dirty", () => {
    setUnsavedGuard("a", true);
    expect(hasUnsavedChanges()).toBe(true);
  });

  it("is false again once the key is cleared", () => {
    setUnsavedGuard("a", true);
    setUnsavedGuard("a", false);
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("stays true if one of several keys is still dirty", () => {
    setUnsavedGuard("a", true);
    setUnsavedGuard("b", true);
    setUnsavedGuard("a", false);
    expect(hasUnsavedChanges()).toBe(true);
    setUnsavedGuard("b", false);
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("is idempotent — marking the same key dirty twice does not require two clears", () => {
    setUnsavedGuard("a", true);
    setUnsavedGuard("a", true);
    setUnsavedGuard("a", false);
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("clearing a key that was never set is a no-op", () => {
    setUnsavedGuard("a", false);
    expect(hasUnsavedChanges()).toBe(false);
  });
});
