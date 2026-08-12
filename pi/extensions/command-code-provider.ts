import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type ImageContent,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type StopReason,
  type TextContent,
  type ThinkingContent,
  type ThinkingLevelMap,
  type ToolCall,
  type Usage,
  calculateCost,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_BASE_URL = "https://api.commandcode.ai";
const INFERENCE_ROUTE = "/alpha/generate";
const CLI_VERSION = "1.27.0";

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

export type CommandCodeModelDef = {
  id: string;
  name: string;
  description?: string;
  reasoning: boolean;
  reasoningEfforts?: string[];
  input: ("text" | "image")[];
  contextWindow: number;
  maxTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

// Prices are USD per million tokens, matching Command Code's advertised model
// catalog. cacheWrite is 0 for providers that don't bill cache writes
// separately. Keep this table editable — it is the single source of truth for
// which models the extension exposes.
export const COMMAND_CODE_MODELS: CommandCodeModelDef[] = [
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  {
    id: "claude-fable-5",
    name: "Claude Fable 5",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  },
  {
    id: "claude-opus-5",
    name: "Claude Opus 5",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  },
  {
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  },
  {
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 16_000,
    cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 64_000,
    cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 3.125 },
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 64_000,
    cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 64_000,
    cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
  },
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
    input: ["text", "image"],
    contextWindow: 400_000,
    maxTokens: 64_000,
    cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
    input: ["text", "image"],
    contextWindow: 400_000,
    maxTokens: 64_000,
    cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
  },
  {
    id: "gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
    input: ["text", "image"],
    contextWindow: 400_000,
    maxTokens: 64_000,
    cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high"],
    input: ["text", "image"],
    contextWindow: 400_000,
    maxTokens: 64_000,
    cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
  },
  {
    id: "MiniMaxAI/MiniMax-M3-Free",
    name: "MiniMax M3 (Free)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "deepseek/deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    reasoning: true,
    reasoningEfforts: ["high", "max"],
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0 },
  },
  {
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    reasoning: true,
    reasoningEfforts: ["high", "max"],
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0 },
  },
  {
    id: "moonshotai/Kimi-K3",
    name: "Kimi K3",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
  },
  {
    id: "moonshotai/Kimi-K2.7-Code",
    name: "Kimi K2.7 Code",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 256_000,
    maxTokens: 32_000,
    cost: { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 },
  },
  {
    id: "moonshotai/Kimi-K2.7-Code-Highspeed",
    name: "Kimi K2.7 Code HighSpeed",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 262_000,
    maxTokens: 32_000,
    cost: { input: 1.9, output: 8, cacheRead: 0.38, cacheWrite: 0 },
  },
  {
    id: "moonshotai/Kimi-K2.6",
    name: "Kimi K2.6",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 256_000,
    maxTokens: 32_000,
    cost: { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0 },
  },
  {
    id: "moonshotai/Kimi-K2.5",
    name: "Kimi K2.5",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 256_000,
    maxTokens: 32_000,
    cost: { input: 0.6, output: 3, cacheRead: 0.1, cacheWrite: 0 },
  },
  {
    id: "zai-org/GLM-5.3",
    name: "GLM-5.3",
    reasoning: true,
    reasoningEfforts: ["low", "high", "max"],
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
  },
  {
    id: "zai-org/GLM-5.2",
    name: "GLM-5.2",
    reasoning: true,
    reasoningEfforts: ["high", "max"],
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
  },
  {
    id: "zai-org/GLM-5.2-Fast",
    name: "GLM-5.2 Fast",
    reasoning: false,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 3, output: 10.25, cacheRead: 0.5, cacheWrite: 0 },
  },
  {
    id: "zai-org/GLM-5.1",
    name: "GLM-5.1",
    reasoning: false,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
  },
  {
    id: "zai-org/GLM-5",
    name: "GLM-5",
    reasoning: false,
    input: ["text"],
    contextWindow: 200_000,
    maxTokens: 32_000,
    cost: { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
  },
  {
    id: "MiniMaxAI/MiniMax-M3",
    name: "MiniMax M3",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
  },
  {
    id: "MiniMaxAI/MiniMax-M2.7",
    name: "MiniMax M2.7",
    reasoning: false,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
  },
  {
    id: "MiniMaxAI/MiniMax-M2.5",
    name: "MiniMax M2.5",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 32_000,
    cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0 },
  },
  {
    id: "xiaomi/mimo-v2.5-pro",
    name: "MiMo V2.5 Pro",
    reasoning: false,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 0.435, output: 0.87, cacheRead: 0.0036, cacheWrite: 0 },
  },
  {
    id: "xiaomi/mimo-v2.5",
    name: "MiMo V2.5",
    reasoning: false,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
  },
  {
    id: "Qwen/Qwen3.8-Max",
    name: "Qwen 3.8 Max",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "xhigh"],
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 },
  },
  {
    id: "Qwen/Qwen3.7-Max",
    name: "Qwen 3.7 Max",
    reasoning: false,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 2.5, output: 7.5, cacheRead: 0.5, cacheWrite: 3.13 },
  },
  {
    id: "Qwen/Qwen3.7-Plus",
    name: "Qwen 3.7 Plus",
    reasoning: false,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 0.4, output: 1.6, cacheRead: 0.08, cacheWrite: 0.5 },
  },
  {
    id: "Qwen/Qwen3.7-Flash",
    name: "Qwen 3.7 Flash",
    reasoning: false,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 0.03, output: 0.13, cacheRead: 0.006, cacheWrite: 0.038 },
  },
  {
    id: "Qwen/Qwen3.6-Max-Preview",
    name: "Qwen 3.6 Max Preview",
    reasoning: false,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 1.3, output: 7.8, cacheRead: 0.26, cacheWrite: 1.63 },
  },
  {
    id: "Qwen/Qwen3.6-Plus",
    name: "Qwen 3.6 Plus",
    reasoning: false,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 0.5, output: 3, cacheRead: 0.1, cacheWrite: 0 },
  },
  {
    id: "stepfun/Step-3.7-Flash",
    name: "Step 3.7 Flash",
    reasoning: false,
    input: ["text"],
    contextWindow: 256_000,
    maxTokens: 32_000,
    cost: { input: 0.2, output: 1.15, cacheRead: 0.04, cacheWrite: 0 },
  },
  {
    id: "stepfun/Step-3.5-Flash",
    name: "Step 3.5 Flash",
    reasoning: false,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 0.1, output: 0.3, cacheRead: 0.02, cacheWrite: 0 },
  },
  {
    id: "tencent/hy3-paid",
    name: "Tencent Hy3 (Paid)",
    reasoning: false,
    input: ["text"],
    contextWindow: 262_000,
    maxTokens: 32_000,
    cost: { input: 0.14, output: 0.58, cacheRead: 0.035, cacheWrite: 0 },
  },
  {
    id: "tencent/Hy3",
    name: "Tencent Hy3",
    reasoning: false,
    input: ["text"],
    contextWindow: 262_000,
    maxTokens: 32_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "google/gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high"],
    input: ["text", "image"],
    contextWindow: 1_050_000,
    maxTokens: 32_000,
    cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.04167 },
  },
  {
    id: "google/gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high"],
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 },
  },
  {
    id: "google/gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high"],
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 0 },
  },
  {
    id: "google/gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash Lite",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high"],
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
  },
  {
    id: "google/gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high"],
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 0.25, output: 1.5, cacheRead: 0.03, cacheWrite: 0 },
  },
  {
    id: "sakana/fugu-ultra",
    name: "Fugu Ultra",
    reasoning: true,
    reasoningEfforts: ["high", "xhigh"],
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
  },
  {
    id: "xai/grok-4.5",
    name: "Grok 4.5",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high"],
    input: ["text"],
    contextWindow: 500_000,
    maxTokens: 32_000,
    cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
  },
  {
    id: "xai/grok-4.6",
    name: "Grok 4.6",
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
    input: ["text"],
    contextWindow: 500_000,
    maxTokens: 32_000,
    cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
  },
  {
    id: "meta/muse-spark-1.1",
    name: "Muse Spark 1.1",
    reasoning: false,
    input: ["text"],
    contextWindow: 1_050_000,
    maxTokens: 32_000,
    cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
  },
  {
    id: "meta/muse-spark-1.2",
    name: "Muse Spark 1.2",
    reasoning: false,
    input: ["text"],
    contextWindow: 1_050_000,
    maxTokens: 32_000,
    cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
  },
  {
    id: "meta/muse-spark-1.2-contributor",
    name: "Muse Spark 1.2 Contributor",
    reasoning: false,
    input: ["text"],
    contextWindow: 1_050_000,
    maxTokens: 32_000,
    cost: { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 },
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b",
    name: "Nemotron 3 Ultra",
    reasoning: false,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 },
  },
  {
    id: "poolside/laguna-s-2.1-free",
    name: "Laguna S 2.1 (Free)",
    reasoning: false,
    input: ["text"],
    contextWindow: 256_000,
    maxTokens: 32_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "inclusionai/ling-3.0-flash-free",
    name: "Ling 3.0 Flash (Free)",
    reasoning: false,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
];

const MODEL_BY_ID = new Map(
  COMMAND_CODE_MODELS.map((model) => [model.id, model]),
);

// ---------------------------------------------------------------------------
// Wire formats used by https://api.commandcode.ai/alpha/generate
// ---------------------------------------------------------------------------

type CommandCodeWireContent =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mimeType: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: { type: "text" | "error-text"; value: string };
    };

type CommandCodeWireMessage = {
  role: "user" | "assistant" | "tool";
  content: CommandCodeWireContent[];
};

type CommandCodeStreamEvent =
  | { type: "start" }
  | { type: "abort" }
  | { type: "text-delta"; text?: string }
  | { type: "reasoning-start" }
  | { type: "reasoning-delta"; text?: string }
  | { type: "reasoning-end" }
  | { type: "tool-call"; toolCallId?: string; toolName?: string; input?: unknown }
  | {
      type: "finish";
      finishReason?: string;
      rawFinishReason?: string;
      totalUsage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        reasoningTokens?: number;
        inputTokenDetails?: {
          cacheReadTokens?: number;
          cacheWriteTokens?: number;
        };
      };
    }
  | {
      type: "error";
      error?: {
        message?: string;
        statusCode?: number;
        isRetryable?: boolean;
      };
    };

// ---------------------------------------------------------------------------
// Streaming implementation
// ---------------------------------------------------------------------------

function contentText(content: (TextContent | ImageContent)[]): string {
  return content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function convertMessages(messages: Message[]): CommandCodeWireMessage[] {
  const wire: CommandCodeWireMessage[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const blocks: CommandCodeWireContent[] =
        typeof message.content === "string"
          ? message.content.trim()
            ? [{ type: "text", text: message.content }]
            : []
          : message.content.map((block) =>
              block.type === "text"
                ? { type: "text", text: block.text }
                : {
                    type: "image",
                    image: `data:${block.mimeType};base64,${block.data}`,
                    mimeType: block.mimeType,
                  },
            );

      if (blocks.length > 0) {
        wire.push({ role: "user", content: blocks });
      }
      continue;
    }

    if (message.role === "assistant") {
      const blocks: CommandCodeWireContent[] = [];
      for (const block of message.content) {
        if (block.type === "text") {
          blocks.push({ type: "text", text: block.text });
        } else if (block.type === "thinking") {
          blocks.push({ type: "reasoning", text: block.thinking });
        } else if (block.type === "toolCall") {
          blocks.push({
            type: "tool-call",
            toolCallId: block.id,
            toolName: block.name,
            input: block.arguments,
          });
        }
      }
      if (blocks.length > 0) {
        wire.push({ role: "assistant", content: blocks });
      }
      continue;
    }

    // toolResult
    const resultBlocks: CommandCodeWireContent[] = [
      {
        type: "tool-result",
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        output: {
          type: message.isError ? "error-text" : "text",
          value: contentText(message.content),
        },
      },
    ];
    wire.push({ role: "tool", content: resultBlocks });
  }

  return wire;
}

function mapStopReason(raw: string | undefined): StopReason {
  const reason = (raw ?? "").toLowerCase();
  if (reason === "tool-calls" || reason === "tool_use") return "toolUse";
  if (reason === "length" || reason === "max_tokens") return "length";
  return "stop";
}

function streamCommandCode(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "pending",
      timestamp: Date.now(),
    };

    let openText: (TextContent & { index?: number }) | null = null;
    let openThinking: (ThinkingContent & { index?: number }) | null = null;

    const finalizeText = () => {
      if (!openText) return;
      delete openText.index;
      stream.push({
        type: "text_end",
        contentIndex: output.content.indexOf(openText as TextContent),
        content: openText.text,
        partial: output,
      });
      openText = null;
    };

    const finalizeThinking = () => {
      if (!openThinking) return;
      delete openThinking.index;
      stream.push({
        type: "thinking_end",
        contentIndex: output.content.indexOf(openThinking as ThinkingContent),
        content: openThinking.thinking,
        partial: output,
      });
      openThinking = null;
    };

    try {
      const apiKey = options?.apiKey;
      if (!apiKey) {
        throw new Error(
          "No Command Code API key. Set COMMAND_CODE_API_KEY or run /login command-code.",
        );
      }

      const baseUrl = model.baseUrl || DEFAULT_BASE_URL;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "x-command-code-version": CLI_VERSION,
        "x-cli-environment": "production",
        ...(options?.headers as Record<string, string> | undefined),
      };

      const params: Record<string, unknown> = {
        model: model.id,
        messages: convertMessages(context.messages),
        tools: (context.tools ?? []).map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        })),
        system: context.systemPrompt ?? "",
        max_tokens: options?.maxTokens ?? Math.min(model.maxTokens || 64_000, 64_000),
        stream: true,
      };

      if (options?.reasoning && model.reasoning) {
        const effort = options.reasoning === "minimal" ? "low" : options.reasoning;
        params.reasoning_effort = effort;
      }

      const body = {
        config: {
          workingDir: process.cwd(),
          date: new Date().toISOString().slice(0, 10),
          environment: process.platform,
          structure: [],
          isGitRepo: false,
          currentBranch: "",
          mainBranch: "",
          gitStatus: "",
          recentCommits: [],
        },
        memory: null,
        taste: null,
        skills: null,
        permissionMode: "standard",
        mode: "agent",
        params,
      };

      const response = await fetch(`${baseUrl}${INFERENCE_ROUTE}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => "");
        throw new Error(`Command Code HTTP ${response.status}: ${text}`);
      }

      stream.push({ type: "start", partial: output });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        let event: CommandCodeStreamEvent;
        try {
          event = JSON.parse(trimmed) as CommandCodeStreamEvent;
        } catch {
          return;
        }

        switch (event.type) {
          case "text-delta": {
            if (!openText) {
              openText = { type: "text", text: "", index: output.content.length };
              output.content.push(openText);
              stream.push({
                type: "text_start",
                contentIndex: output.content.length - 1,
                partial: output,
              });
            }
            openText.text += event.text ?? "";
            stream.push({
              type: "text_delta",
              contentIndex: output.content.indexOf(openText as TextContent),
              delta: event.text ?? "",
              partial: output,
            });
            break;
          }

          case "reasoning-start": {
            finalizeText();
            openThinking = {
              type: "thinking",
              thinking: "",
              index: output.content.length,
            };
            output.content.push(openThinking);
            stream.push({
              type: "thinking_start",
              contentIndex: output.content.length - 1,
              partial: output,
            });
            break;
          }

          case "reasoning-delta": {
            if (!openThinking) {
              openThinking = {
                type: "thinking",
                thinking: "",
                index: output.content.length,
              };
              output.content.push(openThinking);
              stream.push({
                type: "thinking_start",
                contentIndex: output.content.length - 1,
                partial: output,
              });
            }
            openThinking.thinking += event.text ?? "";
            stream.push({
              type: "thinking_delta",
              contentIndex: output.content.indexOf(openThinking as ThinkingContent),
              delta: event.text ?? "",
              partial: output,
            });
            break;
          }

          case "reasoning-end": {
            finalizeThinking();
            break;
          }

          case "tool-call": {
            finalizeText();
            finalizeThinking();

            const toolCall: ToolCall = {
              type: "toolCall",
              id: event.toolCallId ?? "",
              name: event.toolName ?? "",
              arguments: (event.input as Record<string, any>) ?? {},
            };

            output.content.push(toolCall);
            const contentIndex = output.content.length - 1;
            stream.push({ type: "toolcall_start", contentIndex, partial: output });

            const delta = JSON.stringify(toolCall.arguments ?? {});
            if (delta !== "{}") {
              stream.push({ type: "toolcall_delta", contentIndex, delta, partial: output });
            }

            stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: output });
            break;
          }

          case "finish": {
            finalizeText();
            finalizeThinking();

            const usage = event.totalUsage;
            if (usage) {
              output.usage = {
                input: usage.inputTokens ?? 0,
                output: usage.outputTokens ?? 0,
                cacheRead: usage.inputTokenDetails?.cacheReadTokens ?? 0,
                cacheWrite: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
                reasoning: usage.reasoningTokens,
                totalTokens: usage.totalTokens ?? 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              };
              output.usage.cost = calculateCost(model, output.usage);
            }

            output.rawStopReason = event.rawFinishReason ?? event.finishReason;
            output.stopReason = mapStopReason(event.finishReason ?? event.rawFinishReason);
            break;
          }

          case "error": {
            throw new Error(event.error?.message ?? "Command Code stream error");
          }

          default:
            break;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          handleLine(line);
          newline = buffer.indexOf("\n");
        }
      }

      const tail = buffer.trim();
      if (tail) handleLine(tail);

      if (options?.signal?.aborted) {
        throw new Error("Request was aborted");
      }

      if (output.stopReason === "pending") {
        throw new Error("Command Code stream ended without a finish event");
      }

      stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
      stream.end();
    } catch (error) {
      for (const block of output.content) delete (block as { index?: number }).index;
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}

function buildThinkingLevelMap(efforts: string[] | undefined): ThinkingLevelMap | undefined {
  if (!efforts || efforts.length === 0) return undefined;

  const supported = new Set(efforts);

  // Pi thinking levels map to Command Code reasoning_effort values. A level is
  // exposed only when the corresponding effort is in the model's catalog.
  const levelToEffort = {
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  } as const;

  const map: ThinkingLevelMap = {};
  for (const [level, effort] of Object.entries(levelToEffort)) {
    map[level as keyof ThinkingLevelMap] = supported.has(effort) ? effort : null;
  }

  return map;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.registerProvider("command-code", {
    name: "Command Code",
    baseUrl: DEFAULT_BASE_URL,
    apiKey: "$COMMAND_CODE_API_KEY",
    authHeader: true,
    api: "command-code-inference",
    headers: {
      "x-command-code-version": CLI_VERSION,
      "x-cli-environment": "production",
    },
    models: [...MODEL_BY_ID.values()].map((def) => ({
      id: def.id,
      name: def.name,
      reasoning: def.reasoning,
      thinkingLevelMap: buildThinkingLevelMap(def.reasoningEfforts),
      input: def.input,
      cost: def.cost,
      contextWindow: def.contextWindow,
      maxTokens: def.maxTokens,
    })),
    streamSimple: streamCommandCode,
  });
}

export { streamCommandCode };
