import { describe, expect, it } from "vitest";
import { studioRedirectTarget } from "@/lib/studio/landing-redirect";

describe("studioRedirectTarget", () => {
  it("returns null for a plain visit", () => {
    expect(studioRedirectTarget({})).toBeNull();
    expect(studioRedirectTarget({ foo: "bar" })).toBeNull();
  });

  it("returns null for an empty share param", () => {
    expect(studioRedirectTarget({ s: "" })).toBeNull();
  });

  it("redirects a share link to /studio with the same query", () => {
    expect(studioRedirectTarget({ s: "abc" })).toBe("/studio?s=abc");
    expect(studioRedirectTarget({ s: "zABC123", other: "1" })).toBe(
      "/studio?s=zABC123&other=1",
    );
  });

  it("keeps repeated params in order", () => {
    expect(studioRedirectTarget({ s: "abc", x: ["1", "2"] })).toBe(
      "/studio?s=abc&x=1&x=2",
    );
  });
});
