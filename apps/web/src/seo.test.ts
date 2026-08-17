import { describe, expect, it } from "vitest";
import { seoForPath } from "./seo.js";

describe("SEO route policy", () => {
  it.each(["/", "/index.html"])("allows the public landing page to be indexed: %s", (pathname) => {
    expect(seoForPath(pathname).robots).toContain("index, follow");
  });

  it.each(["/admin", "/admin/rooms", "/room/ABCD", "/spectate/ABCD", "/missing"])(
    "keeps private, short-lived, and unknown routes out of search results: %s",
    (pathname) => {
      expect(seoForPath(pathname).robots).toBe("noindex, nofollow");
    }
  );
});
