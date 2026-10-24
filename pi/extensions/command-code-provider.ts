import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type ImageContent,
  type JsonObject,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type StopReason,
  type TextContent,
  type ThinkingContent,
  type ThinkingLevelMap,
  type ToolCall,
  type TranscriptContext,
  type Usage,
  calculateCost,
  collapseSystemMessages,
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  withoutInitialSystemMessage,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_BASE_URL = "https://api.commandcode.ai";
const INFERENCE_ROUTE = "/alpha/generate";
const CLI_VERSION = "1.88.0";

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
    id: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    reasoning: true,
    reasoningEfforts: ["low", "high", "max"],
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 32_000,
    cost: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
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
      type: "finish-step";
      providerMetadata?: {
        gateway?: { cost?: string; [key: string]: unknown };
      };
    }
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

function imageToWire(block: ImageContent): CommandCodeWireContent {
  return {
    type: "image",
    image: `data:${block.mimeType};base64,${block.data}`,
    mimeType: block.mimeType,
  };
}

function convertMessages(
  messages: Message[],
  allowImages: boolean,
): CommandCodeWireMessage[] {
  const wire: CommandCodeWireMessage[] = [];

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === "user") {
      const blocks: CommandCodeWireContent[] =
        typeof message.content === "string"
          ? message.content.trim()
            ? [{ type: "text", text: message.content }]
            : []
          : message.content.map((block) =>
              block.type === "text"
                ? { type: "text", text: block.text }
                : imageToWire(block),
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
    // The wire format's tool-result output is text-only, so images returned by
    // tools (e.g. `read` on an image file) are attached in a following user
    // message instead. Batch consecutive tool results so the tool messages stay
    // contiguous on the wire.
    const pendingImages: ImageContent[] = [];
    let next = index;

    for (; next < messages.length; next++) {
      const toolMessage = messages[next];
      if (toolMessage.role !== "toolResult") break;

      const images = toolMessage.content.filter(
        (block): block is ImageContent => block.type === "image",
      );
      const text = contentText(toolMessage.content);
      const output =
        text ||
        (images.length > 0 && !allowImages
          ? "[Image omitted: model does not support images]"
          : "");

      wire.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: toolMessage.toolCallId,
            toolName: toolMessage.toolName,
            output: {
              type: toolMessage.isError ? "error-text" : "text",
              value: output,
            },
          },
        ],
      });

      if (allowImages) {
        pendingImages.push(...images);
      }
    }

    index = next - 1;

    if (pendingImages.length > 0) {
      wire.push({
        role: "user",
        content: pendingImages.map((block) => imageToWire(block)),
      });
    }
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
  context: TranscriptContext,
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
    // Actual billed cost reported by Command Code's gateway in the
    // `finish-step` event. Used to reconcile the token-based cost below
    // (accounts for peak/off-peak pricing and gateway surcharges that the
    // static model catalog can't represent).
    let serverCost: number | null = null;

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

      // pi 0.86 passes a normalized transcript. The system prompt and tool
      // declarations live in system messages, so fold them into one leading
      // message first. This API takes the prompt in a separate `system` field,
      // so drop the leading system message before converting the rest.
      const transcript = collapseSystemMessages(context);
      const systemPrompt = getCurrentSystemPrompt(transcript.messages);
      const tools = getCurrentTools(transcript.messages);
      const messages = withoutInitialSystemMessage(transcript.messages);

      const params: Record<string, unknown> = {
        model: model.id,
        messages: convertMessages(messages, model.input.includes("image")),
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        })),
        system: systemPrompt,
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
              arguments: (event.input as JsonObject | undefined) ?? {},
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

          case "finish-step": {
            // Gateway cost arrives on `finish-step` (before `finish`).
            const rawCost = event.providerMetadata?.gateway?.cost;
            if (typeof rawCost === "string") {
              const parsed = Number(rawCost);
              if (Number.isFinite(parsed) && parsed >= 0) {
                serverCost = parsed;
              }
            }
            break;
          }

          case "finish": {
            finalizeText();
            finalizeThinking();

            const usage = event.totalUsage;
            if (usage) {
              // Command Code's `inputTokens` INCLUDES cache reads/writes;
              // pi expects `input` to be the uncached portion only
              // (promptTokens = input + cacheRead + cacheWrite). Use
              // `noCacheTokens` so the cached tokens aren't double-counted.
              const inputTokenDetails = usage.inputTokenDetails;
              output.usage = {
                input:
                  inputTokenDetails?.noCacheTokens ??
                  Math.max(
                    0,
                    (usage.inputTokens ?? 0) -
                      (inputTokenDetails?.cacheReadTokens ?? 0) -
                      (inputTokenDetails?.cacheWriteTokens ?? 0),
                  ),
                output: usage.outputTokens ?? 0,
                cacheRead: inputTokenDetails?.cacheReadTokens ?? 0,
                cacheWrite: inputTokenDetails?.cacheWriteTokens ?? 0,
                reasoning: usage.reasoningTokens,
                totalTokens: usage.totalTokens ?? 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              };
              output.usage.cost = calculateCost(model, output.usage);

              // Reconcile with the server-billed total when available:
              // scale the token-based bucket breakdown proportionally so
              // cost.total matches the gateway's actual billed amount.
              if (serverCost !== null) {
                const computed = output.usage.cost;
                const scale = computed.total > 0 ? serverCost / computed.total : 0;
                computed.input *= scale;
                computed.output *= scale;
                computed.cacheRead *= scale;
                computed.cacheWrite *= scale;
                computed.total = serverCost;
              }
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
