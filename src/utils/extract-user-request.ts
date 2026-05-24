export type PromptBlock = { text: string; label?: string };

/**
 * Splits a user request into individual prompts based on `<prompt>...</prompt>` tags.
 *
 * Zero tags: returns the input as a single-element array.
 * One or more well-formed tags: returns the trimmed bodies in order, with optional labels.
 * Supports `<prompt label="...">...</prompt>`; label values may not contain `"` or newlines.
 * Throws on unbalanced tags, empty bodies, malformed attributes, empty labels, or stray text.
 */
export function splitPromptBlocks(input: string): PromptBlock[] {
  if (!input.includes("<prompt") && !input.includes("</prompt>")) {
    return [{ text: input }];
  }
  if (/<prompt\s+[^>]*$/m.test(input)) {
    throw new Error(
      "Malformed prompt input: <prompt> attribute is missing a closing quote or '>'",
    );
  }
  if (/<prompt\s+label(?!="[^"\n]*"\s*>)[^>]*>/.test(input)) {
    throw new Error(
      'Malformed prompt input: <prompt> label attribute must be quoted, e.g. label="Audit"',
    );
  }
  const openCount = (input.match(/<prompt(?:\s[^>]*)?>/g) ?? []).length;
  const closeCount = (input.match(/<\/prompt>/g) ?? []).length;
  if (openCount === 0 && closeCount === 0) {
    return [{ text: input }];
  }
  if (openCount !== closeCount) {
    throw new Error(
      `Malformed prompt input: ${openCount} <prompt> tags but ${closeCount} </prompt> tags`,
    );
  }
  const matches = [
    ...input.matchAll(
      /<prompt(?:\s+label="([^"\n]*)")?\s*>([\s\S]*?)<\/prompt>/g,
    ),
  ];
  if (matches.length !== openCount) {
    throw new Error(
      "Malformed prompt input: <prompt> tags are not properly paired",
    );
  }
  const blocks: PromptBlock[] = matches.map((m) => {
    const rawLabel = m[1];
    const text = m[2]!.trim();
    if (rawLabel !== undefined) {
      const label = rawLabel.trim();
      if (label.length === 0) {
        throw new Error("Malformed prompt input: empty label attribute");
      }
      return { text, label };
    }
    return { text };
  });
  if (blocks.some((b) => b.text.length === 0)) {
    throw new Error("Malformed prompt input: empty <prompt></prompt> block");
  }
  const stripped = input
    .replace(/<prompt(?:\s[^>]*)?>[\s\S]*?<\/prompt>/g, "")
    .trim();
  if (stripped.length > 0) {
    throw new Error(
      `Malformed prompt input: stray text outside <prompt> blocks: ${stripped.slice(0, 80)}`,
    );
  }
  return blocks;
}

/**
 * Extracts the user's request from a trigger comment.
 *
 * Given a comment like "@claude /review-pr please check the auth module",
 * this extracts "/review-pr please check the auth module".
 *
 * @param commentBody - The full comment body containing the trigger phrase
 * @param triggerPhrase - The trigger phrase (e.g., "@claude")
 * @returns The user's request (text after the trigger phrase), or null if not found
 */
export function extractUserRequest(
  commentBody: string | undefined,
  triggerPhrase: string,
): string | null {
  if (!commentBody) {
    return null;
  }

  // Use string operations instead of regex for better performance and security
  // (avoids potential ReDoS with large comment bodies)
  const triggerIndex = commentBody
    .toLowerCase()
    .indexOf(triggerPhrase.toLowerCase());
  if (triggerIndex === -1) {
    return null;
  }

  const afterTrigger = commentBody
    .substring(triggerIndex + triggerPhrase.length)
    .trim();
  return afterTrigger || null;
}
