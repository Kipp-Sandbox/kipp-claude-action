import type { Turn } from "./format-turns";
import { safeToolSummary } from "./format-turns";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKAssistantMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";

export type SummaryResult = {
  text: string | null;
  cost_usd: number;
  duration_ms: number;
  /**
   * True when the summary call errored (thrown exception or a non-success
   * result). Callers should fall back to a static summary and surface a
   * breadcrumb rather than rendering the failed call's output.
   */
  failed?: boolean;
};

/**
 * Extract a safe summary context from execution turns.
 * Includes assistant text and tool names (via safeToolSummary),
 * but never sends tool results or sensitive parameters.
 * Truncates to ~8000 chars.
 */
export function extractSummaryContext(data: Turn[]): string {
  const parts: string[] = [];

  for (const turn of data) {
    if (turn.type === "assistant") {
      const content = turn.message?.content || [];
      for (const item of content) {
        if (item.type === "text" && item.text?.trim()) {
          parts.push(item.text.trim());
        } else if (item.type === "tool_use") {
          parts.push(`[Tool: ${safeToolSummary(item)}]`);
        }
      }
    } else if (turn.type === "result") {
      if (turn.result) {
        parts.push(`[Result: ${turn.result}]`);
      }
    }
  }

  const joined = parts.join("\n");
  if (joined.length > 8000) {
    return joined.substring(0, 8000);
  }
  return joined;
}

/**
 * Generate a concise AI summary of the execution turns using the Claude SDK.
 * Works with all providers (Anthropic API, Azure Foundry, Bedrock, Vertex)
 * because the SDK reads the same provider env vars as the main execution.
 * Returns null text on any failure; cost_usd is always the summary call cost.
 */
export async function generateSummary(data: Turn[]): Promise<SummaryResult> {
  const model = process.env.SUMMARY_MODEL || "claude-haiku-4-5";
  const context = extractSummaryContext(data);
  if (!context.trim())
    return { text: null, cost_usd: 0, duration_ms: 0, failed: false };

  let text: string | null = null;
  let cost_usd = 0;
  let errored = false;
  const startMs = Date.now();

  try {
    for await (const message of query({
      prompt: context,
      options: {
        model,
        maxTurns: 1,
        allowedTools: [],
        // A summary is a one-shot text task; disable thinking so the call
        // stays cheap and does not 400 on providers/models that reject the
        // adaptive-thinking parameter (e.g. some litellm/Bedrock routes).
        thinking: { type: "disabled" },
        systemPrompt:
          "Summarize this Claude Code execution in a few concise paragraphs. Focus on key actions and outcomes. No markdown formatting. Keep it proportional to the work done.",
        settingSources: [],
      },
    })) {
      if (message.type === "assistant") {
        const assistantMsg = message as SDKAssistantMessage;
        const extracted = (
          assistantMsg.message.content as Array<{ type: string; text?: string }>
        )
          .filter((block) => block.type === "text")
          .map((block) => block.text ?? "")
          .join("")
          .trim();
        text = extracted || null;
      } else if (message.type === "result") {
        const resultMsg = message as SDKResultMessage;
        cost_usd = resultMsg.total_cost_usd;
        if (resultMsg.subtype !== "success") {
          // Non-success results (e.g. an API 400) arrive here, not in the
          // catch block. Log the provider detail to the run log for
          // troubleshooting; the report itself stays clean.
          errored = true;
          const detail = resultMsg.errors?.join("; ") || resultMsg.subtype;
          console.log(
            `Summary generation failed [${resultMsg.subtype}] model=${model}: ${detail}`,
          );
        }
      }
    }
  } catch (e) {
    errored = true;
    console.log(
      `Summary generation failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  // On failure, never surface the failed call's output (it may be the raw
  // API error text). Drop it so the caller falls back to the static summary.
  if (errored) text = null;
  return { text, cost_usd, duration_ms: Date.now() - startMs, failed: errored };
}
