#!/usr/bin/env bun

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("runClaudeWithSdk", () => {
  const originalRunnerTemp = process.env.RUNNER_TEMP;
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
    process.env.RUNNER_TEMP = originalRunnerTemp;
  });

  test("writes the execution file when the SDK throws after yielding messages", async () => {
    const consoleErrorSpy = spyOn(console, "error").mockImplementation(
      () => {},
    );
    const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});

    tempDir = await mkdtemp(join(tmpdir(), "claude-sdk-"));
    process.env.RUNNER_TEMP = tempDir;

    const promptPath = join(tempDir, "prompt.txt");
    await writeFile(promptPath, "test prompt");

    const initMessage = {
      type: "system",
      subtype: "init",
      session_id: "session-123",
      model: "claude-sonnet-4-6",
    };

    mock.module("@anthropic-ai/claude-agent-sdk", () => ({
      query: async function* () {
        yield initMessage;
        throw new Error("Claude Code returned error_max_turns");
      },
    }));

    try {
      const { runClaudeWithSdk } = await import("../src/run-claude-sdk");

      await expect(
        runClaudeWithSdk(promptPath, {
          sdkOptions: {},
          showFullOutput: false,
          hasJsonSchema: false,
        }),
      ).rejects.toThrow("SDK execution error");

      const executionFile = join(tempDir, "claude-execution-output.json");
      await expect(readFile(executionFile, "utf-8")).resolves.toBe(
        JSON.stringify([initMessage], null, 2),
      );
    } finally {
      consoleErrorSpy.mockRestore();
      consoleLogSpy.mockRestore();
    }
  });
});

describe("createPromptConfig", () => {
  let tempDir: string | undefined;
  const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
    consoleLogSpy.mockClear();
  });

  test("returns string prompt when no user request file is present", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claude-prompt-config-"));
    const promptPath = join(tempDir, "claude-prompt.txt");
    await writeFile(promptPath, "system prompt body");

    const { createPromptConfig } = await import("../src/run-claude-sdk");
    const result = await createPromptConfig(promptPath, false, false);

    expect(typeof result).toBe("string");
    expect(result).toBe("system prompt body");
  });

  test("returns multi-block message when user request file is present and not resuming", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claude-prompt-config-"));
    const promptPath = join(tempDir, "claude-prompt.txt");
    const userRequestPath = join(tempDir, "claude-user-request.txt");
    await writeFile(promptPath, "system prompt body");
    await writeFile(userRequestPath, "/review focus on security");

    const { createPromptConfig } = await import("../src/run-claude-sdk");
    const result = await createPromptConfig(promptPath, false, false);

    expect(typeof result).not.toBe("string");

    // Drain the async iterable and inspect the single yielded multi-block message.
    const messages: unknown[] = [];
    for await (const message of result as AsyncIterable<unknown>) {
      messages.push(message);
    }
    expect(messages).toHaveLength(1);
    const first = messages[0] as {
      type: string;
      message: {
        role: string;
        content: Array<{ type: string; text: string }>;
      };
    };
    expect(first.type).toBe("user");
    expect(first.message.role).toBe("user");
    expect(first.message.content).toEqual([
      { type: "text", text: "system prompt body" },
      { type: "text", text: "/review focus on security" },
    ]);
  });

  test("returns user-request string only when resuming with a user request file present", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claude-prompt-config-"));
    const promptPath = join(tempDir, "claude-prompt.txt");
    const userRequestPath = join(tempDir, "claude-user-request.txt");
    await writeFile(promptPath, "system prompt body");
    await writeFile(userRequestPath, "/ship auto");

    const { createPromptConfig } = await import("../src/run-claude-sdk");
    const result = await createPromptConfig(promptPath, false, true);

    expect(typeof result).toBe("string");
    expect(result).toBe("/ship auto");
  });
});
