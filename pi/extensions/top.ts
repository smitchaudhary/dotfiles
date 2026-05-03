/**
 * top — View the full latest assistant turn from its first line
 *
 * Commands: /top
 *
 * Navigation: ↑/k ↓/j PgUp/b PgDn/f/space g/G esc/q
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { matchesKey, Key, Markdown } from "@mariozechner/pi-tui";

// ---------------------------------------------------------------------------
// Tool call one-liners
// ---------------------------------------------------------------------------

type ToolSummarizer = (args: Record<string, unknown>) => string;

const toolSummarizers: Record<string, ToolSummarizer> = {
	edit:  (a) => `[edit: ${a.path ?? "?"}]`,
	write: (a) => `[write: ${a.path ?? "?"}]`,
	read:  (a) => `[read: ${a.path ?? "?"}]`,
	bash:  (a) => `[bash: ${String(a.command ?? "?").slice(0, 80)}]`,
	grep:  (a) => `[grep: ${a.pattern ?? a.regex ?? "?"}]`,
	rg:    (a) => `[rg: ${a.pattern ?? a.regex ?? "?"}]`,
	ls:    (a) => `[ls: ${a.path ?? "."}]`,
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

/** Find the index of the latest user message in the branch. */
function findLastUserIndex(branch: any[]): number {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry?.type === "message" && entry.message?.role === "user") return i;
	}
	return -1;
}

// ---------------------------------------------------------------------------
// Viewer component
// ---------------------------------------------------------------------------

function makeViewer(
	text: string,
	tui: { terminal: { rows: number }; requestRender(): void },
	theme: any,
	done: (v: undefined) => void,
) {
	let scroll = 0;
	let cachedWidth = -1;
	let cachedLines: string[] = [];
	let md: Markdown;

	const pageSize = () => Math.max(5, tui.terminal.rows - 6);

	const renderLines = (width: number) => {
		if (cachedWidth !== width) {
			md = new Markdown(text, 0, 0, getMarkdownTheme());
			cachedLines = md.render(width);
			cachedWidth = width;
		}
		return cachedLines;
	};

	const totalLines = () => renderLines(cachedWidth === -1 ? 80 : cachedWidth).length;

	const clamp = () => {
		const max = Math.max(0, totalLines() - pageSize());
		scroll = Math.max(0, Math.min(scroll, max));
	};

	return {
		render(width: number) {
			const lines = renderLines(width);
			clamp();
			const page = pageSize();
			const visible = lines.slice(scroll, scroll + page);
			const endLine = Math.min(scroll + page, lines.length);

			const out: string[] = [];

			out.push(theme.fg("accent", theme.bold("  Full Assistant Turn")));
			out.push(theme.fg("borderMuted", "  " + "─".repeat(Math.max(0, width - 4))));

			for (const line of visible) {
				out.push("  " + line);
			}

			// Pad to a consistent content height
			for (let i = page - visible.length; i > 0; i--) out.push("");

			const pos = lines.length > page
				? theme.fg("dim", `  ${scroll + 1}–${endLine} / ${lines.length}`)
				: "";
			out.push(pos + theme.fg("dim", "  ↑/k ↓/j PgUp/b PgDn/f g/G esc/q close"));

			return out;
		},

		handleInput(data: string) {
			if (matchesKey(data, Key.escape) || data === "q") {
				done(undefined);
				return;
			}

			const prev = scroll;
			const page = pageSize();

			if (matchesKey(data, Key.down) || data === "j") scroll++;
			else if (matchesKey(data, Key.up) || data === "k") scroll--;
			else if (matchesKey(data, Key.pageDown) || data === " " || data === "f") scroll += page;
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
		description: "View the full latest assistant turn from its first line",
		handler: async (_args, ctx) => {
			const branch = ctx.sessionManager.getBranch();

			const userIdx = findLastUserIndex(branch);
			if (userIdx === -1) {
				ctx.ui.notify("No user message found", "warning");
				return;
			}

			// Collect all assistant blocks after the latest user message
			const blocks: string[] = [];
			for (let i = userIdx + 1; i < branch.length; i++) {
				const entry = branch[i];
				if (entry?.type !== "message") continue;
				if (entry.message?.role !== "assistant") continue;

				const block = formatAssistantBlock(entry.message, "  ");
				if (block) blocks.push(block);
			}

			if (blocks.length === 0) {
				ctx.ui.notify("No assistant text found in the latest turn", "warning");
				return;
			}

			const text = blocks.join("\n\n───\n\n");

			await ctx.ui.custom<void>(
				(tui, theme, _kb, done) => makeViewer(text, tui, theme, done),
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
