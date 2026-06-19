/**
 * top — Browse assistant turns
 *
 * Commands: /top
 *
 * Navigation:
 *   n/p — next/previous turn
 *   ↑/k ↓/j — scroll line by line
 *   PgUp/b PgDn/f/space — page up/down
 *   g/G — top/bottom
 *   esc/q — close
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { matchesKey, Key, Markdown } from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// Tool call one-liners
// ---------------------------------------------------------------------------

type ToolSummarizer = (args: Record<string, unknown>) => string;

const toolSummarizers: Record<string, ToolSummarizer> = {
  edit: (a) => `[edit: ${a.path ?? "?"}]`,
  write: (a) => `[write: ${a.path ?? "?"}]`,
  read: (a) => `[read: ${a.path ?? "?"}]`,
  bash: (a) => `[bash: ${String(a.command ?? "?").slice(0, 80)}]`,
  grep: (a) => `[grep: ${a.pattern ?? a.regex ?? "?"}]`,
  rg: (a) => `[rg: ${a.pattern ?? a.regex ?? "?"}]`,
  ls: (a) => `[ls: ${a.path ?? "."}]`,
};

function summarizeToolCall(tc: any): string {
  const summarizer = toolSummarizers[tc.name ?? ""];
  if (summarizer) return summarizer(tc.arguments ?? {});
  return `[${tc.name ?? "?"}]`;
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

/** Collect text + tool summaries from a single assistant message. */
function formatAssistantBlock(message: any, indent: string): string {
  if (!Array.isArray(message.content)) return "";

  const texts: string[] = [];
  const tools: string[] = [];

  for (const block of message.content) {
    if (block?.type === "text" && typeof block.text === "string") {
      const t = block.text.trim();
      if (t) texts.push(t);
    } else if (block?.type === "toolCall") {
      tools.push(indent + summarizeToolCall(block));
    }
  }

  const parts: string[] = [];
  if (texts.length > 0) parts.push(texts.join("\n\n"));
  if (tools.length > 0) parts.push(tools.join("\n"));
  return parts.join("\n");
}

interface Turn {
  index: number;
  userText: string;
  assistantText: string;
}

function extractUserText(message: any): string {
  if (typeof message.content === "string") {
    return message.content.trim();
  }
  if (Array.isArray(message.content)) {
    return message.content
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
  }
  return "";
}

/** Find all user/assistant turn pairs in the branch. */
function findAllTurns(branch: any[]): Turn[] {
  const turns: Turn[] = [];
  let currentUserText = "";
  let currentAssistantBlocks: string[] = [];
  let turnIndex = -1;

  for (const entry of branch) {
    if (entry?.type !== "message") continue;
    const msg = entry.message;
    if (!msg) continue;

    if (msg.role === "user") {
      if (currentUserText !== "" || currentAssistantBlocks.length > 0) {
        turns.push({
          index: turnIndex,
          userText: currentUserText,
          assistantText: currentAssistantBlocks.join("\n\n───\n\n"),
        });
      }
      turnIndex++;
      currentUserText = extractUserText(msg);
      currentAssistantBlocks = [];
    } else if (msg.role === "assistant") {
      const block = formatAssistantBlock(msg, "  ");
      if (block) currentAssistantBlocks.push(block);
    }
  }

  if (currentUserText !== "" || currentAssistantBlocks.length > 0) {
    turns.push({
      index: turnIndex,
      userText: currentUserText,
      assistantText: currentAssistantBlocks.join("\n\n───\n\n"),
    });
  }

  return turns;
}

// ---------------------------------------------------------------------------
// Viewer component
// ---------------------------------------------------------------------------

function makeViewer(
  turns: Turn[],
  initialIndex: number,
  tui: { terminal: { rows: number }; requestRender(): void },
  theme: any,
  done: (v: undefined) => void,
) {
  let currentTurn = initialIndex;
  let scroll = 0;
  let cachedWidth = -1;
  let cachedLines: string[] = [];
  let md: Markdown;

  const currentText = () => turns[currentTurn]?.assistantText ?? "";

  const pageSize = () => Math.max(5, tui.terminal.rows - 6);

  const renderLines = (width: number) => {
    if (cachedWidth !== width) {
      md = new Markdown(currentText(), 0, 0, getMarkdownTheme());
      cachedLines = md.render(width);
      cachedWidth = width;
    }
    return cachedLines;
  };

  const totalLines = () =>
    renderLines(cachedWidth === -1 ? 80 : cachedWidth).length;

  const clamp = () => {
    const max = Math.max(0, totalLines() - pageSize());
    scroll = Math.max(0, Math.min(scroll, max));
  };

  const goToTurn = (idx: number) => {
    if (idx < 0 || idx >= turns.length || idx === currentTurn) return;
    currentTurn = idx;
    scroll = 0;
    cachedWidth = -1;
    cachedLines = [];
    md?.invalidate();
    tui.requestRender();
  };

  return {
    render(width: number) {
      const lines = renderLines(width);
      clamp();
      const page = pageSize();
      const visible = lines.slice(scroll, scroll + page);
      const endLine = Math.min(scroll + page, lines.length);

      const out: string[] = [];

      // Header: turn position + user prompt preview
      const turnInfo = `Turn ${currentTurn + 1} of ${turns.length}`;
      const userPreview = turns[currentTurn]?.userText ?? "";
      const userLine =
        userPreview.length > 0
          ? "  " +
            theme.fg(
              "muted",
              userPreview.slice(0, width - 6) +
                (userPreview.length > width - 6 ? "…" : ""),
            )
          : "";
      out.push(theme.fg("accent", theme.bold(`  ${turnInfo}`)));
      if (userLine) out.push(userLine);
      out.push(
        theme.fg("borderMuted", "  " + "─".repeat(Math.max(0, width - 4))),
      );

      for (const line of visible) {
        out.push("  " + line);
      }

      // Pad to a consistent content height
      for (let i = page - visible.length; i > 0; i--) out.push("");

      const pos =
        lines.length > page
          ? theme.fg("dim", `  ${scroll + 1}–${endLine} / ${lines.length}`)
          : "";

      // Context-aware nav hints
      const hints: string[] = [];
      if (currentTurn > 0) hints.push("p prev");
      if (currentTurn < turns.length - 1) hints.push("n next");
      hints.push("↑/k ↓/j PgUp/b PgDn/f g/G esc/q");

      out.push(pos + theme.fg("dim", "  " + hints.join("  ")));

      return out;
    },

    handleInput(data: string) {
      if (matchesKey(data, Key.escape) || data === "q") {
        done(undefined);
        return;
      }

      // Turn navigation
      if (data === "n" && currentTurn < turns.length - 1) {
        goToTurn(currentTurn + 1);
        return;
      }
      if (data === "p" && currentTurn > 0) {
        goToTurn(currentTurn - 1);
        return;
      }

      const prev = scroll;
      const page = pageSize();

      if (matchesKey(data, Key.down) || data === "j") scroll++;
      else if (matchesKey(data, Key.up) || data === "k") scroll--;
      else if (matchesKey(data, Key.pageDown) || data === " " || data === "f")
        scroll += page;
      else if (matchesKey(data, Key.pageUp) || data === "b") scroll -= page;
      else if (matchesKey(data, Key.home) || data === "g") scroll = 0;
      else if (matchesKey(data, Key.end) || data === "G") scroll = totalLines();
      else return;

      clamp();
      if (scroll !== prev) tui.requestRender();
    },

    invalidate() {
      cachedWidth = -1;
      cachedLines = [];
      md?.invalidate();
    },
  };
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.registerCommand("top", {
    description: "Browse all assistant turns with n/p navigation",
    handler: async (_args, ctx) => {
      const branch = ctx.sessionManager.getBranch();
      const turns = findAllTurns(branch);

      if (turns.length === 0) {
        ctx.ui.notify("No messages found", "warning");
        return;
      }

      await ctx.ui.custom<void>(
        (tui, theme, _kb, done) =>
          makeViewer(turns, turns.length - 1, tui, theme, done),
        {
          overlay: true,
          overlayOptions: {
            anchor: "top-left",
            width: "100%",
            maxHeight: "100%",
          },
        },
      );
    },
  });
}
