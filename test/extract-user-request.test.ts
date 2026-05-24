import { describe, test, expect } from "bun:test";
import {
  extractUserRequest,
  splitPromptBlocks,
} from "../src/utils/extract-user-request";

describe("extractUserRequest", () => {
  test("extracts text after @claude trigger", () => {
    expect(extractUserRequest("@claude /review-pr", "@claude")).toBe(
      "/review-pr",
    );
  });

  test("extracts slash command with arguments", () => {
    expect(
      extractUserRequest(
        "@claude /review-pr please check the auth module",
        "@claude",
      ),
    ).toBe("/review-pr please check the auth module");
  });

  test("handles trigger phrase with extra whitespace", () => {
    expect(extractUserRequest("@claude    /review-pr", "@claude")).toBe(
      "/review-pr",
    );
  });

  test("handles trigger phrase at start of multiline comment", () => {
    const comment = `@claude /review-pr
Please review this PR carefully.
Focus on security issues.`;
    expect(extractUserRequest(comment, "@claude")).toBe(
      `/review-pr
Please review this PR carefully.
Focus on security issues.`,
    );
  });

  test("handles trigger phrase in middle of text", () => {
    expect(
      extractUserRequest("Hey team, @claude can you review this?", "@claude"),
    ).toBe("can you review this?");
  });

  test("returns null for empty comment body", () => {
    expect(extractUserRequest("", "@claude")).toBeNull();
  });

  test("returns null for undefined comment body", () => {
    expect(extractUserRequest(undefined, "@claude")).toBeNull();
  });

  test("returns null when trigger phrase not found", () => {
    expect(extractUserRequest("Please review this PR", "@claude")).toBeNull();
  });

  test("returns null when only trigger phrase with no request", () => {
    expect(extractUserRequest("@claude", "@claude")).toBeNull();
  });

  test("handles custom trigger phrase", () => {
    expect(extractUserRequest("/claude help me", "/claude")).toBe("help me");
  });

  test("handles trigger phrase with special regex characters", () => {
    expect(
      extractUserRequest("@claude[bot] do something", "@claude[bot]"),
    ).toBe("do something");
  });

  test("is case insensitive", () => {
    expect(extractUserRequest("@CLAUDE /review-pr", "@claude")).toBe(
      "/review-pr",
    );
    expect(extractUserRequest("@Claude /review-pr", "@claude")).toBe(
      "/review-pr",
    );
  });
});

describe("splitPromptBlocks", () => {
  test("returns input unchanged when no tags are present", () => {
    expect(splitPromptBlocks("just a single prompt")).toEqual([
      { text: "just a single prompt" },
    ]);
  });

  test("returns single-element array for a single <prompt> block", () => {
    expect(splitPromptBlocks("<prompt>/ship auto</prompt>")).toEqual([
      { text: "/ship auto" },
    ]);
  });

  test("splits multiple <prompt> blocks in order", () => {
    const input = `<prompt>/maintain deps auto</prompt>
<prompt>/ship auto</prompt>`;
    expect(splitPromptBlocks(input)).toEqual([
      { text: "/maintain deps auto" },
      { text: "/ship auto" },
    ]);
  });

  test("trims whitespace inside <prompt> blocks", () => {
    const input = `<prompt>
      /maintain deps auto
    </prompt>
    <prompt>
      /ship auto
    </prompt>`;
    expect(splitPromptBlocks(input)).toEqual([
      { text: "/maintain deps auto" },
      { text: "/ship auto" },
    ]);
  });

  test("supports multi-line bodies", () => {
    const input = `<prompt>line one
line two
line three</prompt>
<prompt>second prompt</prompt>`;
    expect(splitPromptBlocks(input)).toEqual([
      { text: "line one\nline two\nline three" },
      { text: "second prompt" },
    ]);
  });

  test("throws on unbalanced tags (missing close)", () => {
    expect(() => splitPromptBlocks("<prompt>oops")).toThrow(
      /Malformed prompt input/,
    );
  });

  test("throws on unbalanced tags (missing open)", () => {
    expect(() => splitPromptBlocks("oops</prompt>")).toThrow(
      /Malformed prompt input/,
    );
  });

  test("throws on empty <prompt></prompt> body", () => {
    expect(() => splitPromptBlocks("<prompt></prompt>")).toThrow(
      /empty <prompt><\/prompt> block/,
    );
  });

  test("throws on whitespace-only body", () => {
    expect(() => splitPromptBlocks("<prompt>   \n   </prompt>")).toThrow(
      /empty <prompt><\/prompt> block/,
    );
  });

  test("throws on stray non-whitespace text outside tag pairs", () => {
    const input = `before
<prompt>/ship</prompt>
trailing text`;
    expect(() => splitPromptBlocks(input)).toThrow(/stray text/);
  });

  test("allows whitespace between tag pairs", () => {
    const input = `

<prompt>/one</prompt>

<prompt>/two</prompt>

`;
    expect(splitPromptBlocks(input)).toEqual([
      { text: "/one" },
      { text: "/two" },
    ]);
  });

  test("captures label attribute on a single block", () => {
    expect(splitPromptBlocks('<prompt label="Audit">/x</prompt>')).toEqual([
      { text: "/x", label: "Audit" },
    ]);
  });

  test("captures labels across mixed labelled and unlabelled blocks", () => {
    const input = `<prompt label="Audit">/maintain deps auto</prompt>
<prompt>/ship auto</prompt>
<prompt label="PR">/git pr ready-state auto</prompt>`;
    expect(splitPromptBlocks(input)).toEqual([
      { text: "/maintain deps auto", label: "Audit" },
      { text: "/ship auto" },
      { text: "/git pr ready-state auto", label: "PR" },
    ]);
  });

  test("strips matched blocks (incl. labelled) before stray-text check", () => {
    const input = `<prompt label="Audit">/x</prompt>
<prompt>/y</prompt>`;
    expect(() => splitPromptBlocks(input)).not.toThrow();
  });

  test("throws on empty label attribute", () => {
    expect(() => splitPromptBlocks('<prompt label="">/x</prompt>')).toThrow(
      /empty label attribute/,
    );
  });

  test("throws on whitespace-only label attribute", () => {
    expect(() => splitPromptBlocks('<prompt label="   ">/x</prompt>')).toThrow(
      /empty label attribute/,
    );
  });

  test("throws with attribute-specific message on missing closing quote", () => {
    expect(() =>
      splitPromptBlocks('<prompt label="unclosed>body</prompt>'),
    ).toThrow(/label attribute must be quoted/);
  });

  test("throws with attribute-specific message on unquoted label", () => {
    expect(() => splitPromptBlocks("<prompt label=foo>/x</prompt>")).toThrow(
      /label attribute must be quoted/,
    );
  });

  test("throws on unknown attribute via the pairing check", () => {
    expect(() => splitPromptBlocks('<prompt foo="bar">/x</prompt>')).toThrow(
      /not properly paired/,
    );
  });
});
