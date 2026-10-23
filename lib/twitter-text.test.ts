import { describe, expect, it } from "vitest";
import { countTwitterCharacters } from "./twitter-text";
import { validateContentLength, validateThreadLengths } from "./validation";

const sourceUrl = `https://example.com/${"original-source-path-".repeat(16)}`;
const atLimit = `${"a".repeat(256)} ${sourceUrl}`;
const overLimit = `${"a".repeat(257)} ${sourceUrl}`;

describe("X weighted character counts", () => {
  it("counts recognized URLs as 23 characters while preserving surrounding text and punctuation", () => {
    expect(sourceUrl.length).toBeGreaterThan(280);
    expect(countTwitterCharacters(sourceUrl)).toBe(23);
    expect(countTwitterCharacters(`(${sourceUrl})`)).toBe(25);
    expect(countTwitterCharacters(`${sourceUrl} https://example.org/another-source`)).toBe(47);
    expect(countTwitterCharacters(atLimit)).toBe(280);
    expect(countTwitterCharacters(overLimit)).toBe(281);
  });

  it("applies Unicode weights to CJK, composed accents, and complete emoji sequences", () => {
    expect(countTwitterCharacters("界".repeat(140))).toBe(280);
    expect(countTwitterCharacters("界".repeat(140) + "a")).toBe(281);
    expect(countTwitterCharacters("e\u0301")).toBe(1);
    for (const emoji of ["😀", "👩🏽‍💻", "👨‍👩‍👧‍👦", "🇮🇳"]) {
      expect(countTwitterCharacters(emoji)).toBe(2);
    }
  });

  it("uses weighted X limits in the shared post validator", () => {
    expect(validateContentLength(atLimit, "twitter")).toBeNull();
    expect(validateContentLength(overLimit, "twitter")).toMatchObject({
      field: "content", platform: "twitter", message: expect.stringContaining("Current: 281"),
    });
    expect(validateContentLength("😀".repeat(140), "twitter")).toBeNull();
    expect(validateContentLength("界".repeat(141), "twitter")?.message).toContain("Current: 282");
  });

  it("validates each thread part independently with the same URL and Unicode rules", () => {
    expect(validateThreadLengths(atLimit, [atLimit, "👩🏽‍💻".repeat(140), "界".repeat(140)], "twitter")).toEqual([]);
    expect(validateThreadLengths(overLimit, [atLimit, overLimit, "界".repeat(141)], "twitter"))
      .toEqual([
        expect.objectContaining({ field: "content", message: expect.stringContaining("Current: 281") }),
        expect.objectContaining({ field: "thread[1]", message: expect.stringContaining("Current: 281") }),
        expect.objectContaining({ field: "thread[2]", message: expect.stringContaining("Current: 282") }),
      ]);
  });

  it("keeps ordinary character limits for other platforms", () => {
    const linkedinText = `${"a".repeat(2976)} ${sourceUrl}`;
    expect(validateContentLength(linkedinText, "linkedin")).toMatchObject({
      platform: "linkedin", message: expect.stringContaining(`Current: ${linkedinText.length}`),
    });
  });
});
