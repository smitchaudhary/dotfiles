/**
 * VCS Status Extension
 *
 * Replaces the default footer with VCS info integrated alongside all default info.
 *
 * Supports:
 * - Git: branch, staged/unstaged/untracked counts
 * - JJ: bookmark, modified/added/deleted counts
 *
 * Footer format:
 *   Line 1: ~/.path/to/dir (branch) [+2 ~3 ?1] • session_name
 *   Line 2: ↑tokens ↓tokens Rcache Wcache $cost (sub) ctx%/window (auto)    (provider) model • thinking
 *   Line 3: Extension statuses
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ReadonlyFooterDataProvider } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface GitStatus {
  type: "git";
  branch: string;
  staged: number;
  unstaged: number;
  untracked: number;
}

interface JJStatus {
  type: "jj";
  bookmark: string;
  modified: number;
  added: number;
  deleted: number;
}

type VCSStatus = GitStatus | JJStatus | null;

interface CachedStatus {
  status: VCSStatus;
  timestamp: number;
  cwd: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

const CACHE_TTL_MS = 1000;
const COMMAND_TIMEOUT_MS = 500;

let cachedStatus: CachedStatus | null = null;
let pendingFetch: Promise<VCSStatus> | null = null;
let autoCompactEnabled = true;

// ═══════════════════════════════════════════════════════════════════════════
// Git Operations
// ═══════════════════════════════════════════════════════════════════════════

function runCommand(command: string, args: string[], cwd: string, timeoutMs = COMMAND_TIMEOUT_MS): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let resolved = false;

    const finish = (result: string | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      resolve(result);
    };

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      finish(code === 0 ? stdout.trim() : null);
    });

    proc.on("error", () => {
      finish(null);
    });

    const timeoutId = setTimeout(() => {
      proc.kill();
      finish(null);
    }, timeoutMs);
  });
}

function parseGitStatusOutput(output: string): { staged: number; unstaged: number; untracked: number } {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;

  for (const line of output.split("\n")) {
    if (!line) continue;
    const x = line[0];
    const y = line[1];

    if (x === "?" && y === "?") {
      untracked++;
      continue;
    }

    if (x && x !== " " && x !== "?") staged++;
    if (y && y !== " ") unstaged++;
  }

  return { staged, unstaged, untracked };
}

async function getGitStatus(cwd: string): Promise<GitStatus | null> {
  if (!existsSync(join(cwd, ".git"))) return null;

  let branch = await runCommand("git", ["branch", "--show-current"], cwd);
  if (!branch) {
    const sha = await runCommand("git", ["rev-parse", "--short", "HEAD"], cwd);
    branch = sha || "detached";
  }

  const statusOutput = await runCommand("git", ["status", "--porcelain", "--untracked-files=normal"], cwd, 1000);
  const { staged, unstaged, untracked } = statusOutput
    ? parseGitStatusOutput(statusOutput)
    : { staged: 0, unstaged: 0, untracked: 0 };

  return { type: "git", branch, staged, unstaged, untracked };
}

// ═══════════════════════════════════════════════════════════════════════════
// JJ Operations
// ═══════════════════════════════════════════════════════════════════════════

function parseJJStatusOutput(output: string): { modified: number; added: number; deleted: number } {
  let modified = 0;
  let added = 0;
  let deleted = 0;

  for (const line of output.split("\n")) {
    if (!line) continue;
    if (line.startsWith("M ")) modified++;
    else if (line.startsWith("A ")) added++;
    else if (line.startsWith("D ")) deleted++;
  }

  return { modified, added, deleted };
}

async function getJJStatus(cwd: string): Promise<JJStatus | null> {
  if (!existsSync(join(cwd, ".jj"))) return null;

  let bookmark = await runCommand(
    "jj",
    ["log", "-r", "closest_bookmark(@)", "--no-graph", "--color", "never", "-T", "bookmarks", "--limit", "1"],
    cwd,
    1000
  );

  if (!bookmark || bookmark === "(empty)") bookmark = "(no bookmark)";
  bookmark = bookmark.trim();

  const statusOutput = await runCommand("jj", ["status", "--no-pager"], cwd, 1000);
  const { modified, added, deleted } = statusOutput
    ? parseJJStatusOutput(statusOutput)
    : { modified: 0, added: 0, deleted: 0 };

  return { type: "jj", bookmark, modified, added, deleted };
}

// ═══════════════════════════════════════════════════════════════════════════
// VCS Detection & Status
// ═══════════════════════════════════════════════════════════════════════════

async function fetchVCSStatus(cwd: string): Promise<VCSStatus> {
  const jjStatus = await getJJStatus(cwd);
  if (jjStatus) return jjStatus;

  const gitStatus = await getGitStatus(cwd);
  if (gitStatus) return gitStatus;

  return null;
}

function getCachedStatus(cwd: string): VCSStatus {
  const now = Date.now();

  if (cachedStatus && cachedStatus.cwd === cwd && now - cachedStatus.timestamp < CACHE_TTL_MS) {
    return cachedStatus.status;
  }

  if (!pendingFetch) {
    pendingFetch = fetchVCSStatus(cwd).then((result) => {
      cachedStatus = { status: result, timestamp: Date.now(), cwd };
      pendingFetch = null;
      return result;
    });
  }

  return cachedStatus?.cwd === cwd ? cachedStatus.status : null;
}

function invalidateCache(): void {
  cachedStatus = null;
  pendingFetch = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Formatting Utilities
// ═══════════════════════════════════════════════════════════════════════════

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// Rendering
// ═══════════════════════════════════════════════════════════════════════════

function renderVCSBadge(status: VCSStatus, theme: any): string {
  if (!status) return "";

  const parts: string[] = [];

  if (status.type === "git") {
    if (status.staged > 0) parts.push(theme.fg("success", `+${status.staged}`));
    if (status.unstaged > 0) parts.push(theme.fg("error", `~${status.unstaged}`));
    if (status.untracked > 0) parts.push(theme.fg("dim", `?${status.untracked}`));
  } else if (status.type === "jj") {
    if (status.modified > 0) parts.push(theme.fg("error", `~${status.modified}`));
    if (status.added > 0) parts.push(theme.fg("success", `+${status.added}`));
    if (status.deleted > 0) parts.push(theme.fg("accent", `-${status.deleted}`));
  }

  return parts.length > 0 ? ` [${parts.join(" ")}]` : "";
}

// ═══════════════════════════════════════════════════════════════════════════
// Extension
// ═══════════════════════════════════════════════════════════════════════════

export default function (pi: ExtensionAPI) {
  let tuiRef: any = null;
  let ctxRef: any = null;

  function createFooterRenderer(ctx: any, theme: any, footerData: ReadonlyFooterDataProvider) {
    const unsub = footerData.onBranchChange(() => tuiRef?.requestRender());

    return {
      dispose: unsub,
      invalidate() {},

      render(width: number): string[] {
        const lines: string[] = [];

        // ═══════════════════════════════════════════════════════════════════
        // Line 1: pwd (branch) [status] • session_name
        // ═══════════════════════════════════════════════════════════════════

        let pwd = ctx.cwd;
        const home = homedir();
        if (home && pwd.startsWith(home)) {
          pwd = `~${pwd.slice(home.length)}`;
        }

        // Get VCS status
        const vcsStatus = getCachedStatus(ctx.cwd);

        // Add branch from VCS (prefer our fetched status, fallback to provider)
        const branch = vcsStatus?.type === "git"
          ? vcsStatus.branch
          : vcsStatus?.type === "jj"
            ? vcsStatus.bookmark
            : footerData.getGitBranch();

        if (branch) {
          pwd = `${pwd} (${branch})`;
        }

        // Add VCS status badge
        const badge = renderVCSBadge(vcsStatus, theme);
        pwd = `${pwd}${badge}`;

        // Add session name if set
        const sessionName = ctx.sessionManager.getSessionName();
        if (sessionName) {
          pwd = `${pwd} • ${sessionName}`;
        }

        lines.push(truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")));

        // ═══════════════════════════════════════════════════════════════════
        // Line 2: tokens, cost, context, model
        // ═══════════════════════════════════════════════════════════════════

        // Calculate cumulative usage from ALL session entries
        let totalInput = 0;
        let totalOutput = 0;
        let totalCacheRead = 0;
        let totalCacheWrite = 0;
        let totalCost = 0;

        for (const entry of ctx.sessionManager.getEntries()) {
          if (entry.type === "message" && entry.message.role === "assistant") {
            const m = entry.message as AssistantMessage;
            totalInput += m.usage.input;
            totalOutput += m.usage.output;
            totalCacheRead += m.usage.cacheRead;
            totalCacheWrite += m.usage.cacheWrite;
            totalCost += m.usage.cost.total;
          }
        }

        // Build stats line
        const statsParts: string[] = [];

        if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
        if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
        if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
        if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);

        // Show cost with "(sub)" indicator if using OAuth subscription
        const model = ctx.model;
        const usingSubscription = model ? ctx.modelRegistry?.isUsingOAuth?.(model) : false;
        if (totalCost || usingSubscription) {
          const costStr = `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
          statsParts.push(costStr);
        }

        // Context usage with color coding
        const contextUsage = ctx.getContextUsage?.();
        const contextWindow = contextUsage?.contextWindow ?? model?.contextWindow ?? 0;
        const contextPercentValue = contextUsage?.percent ?? 0;

        const autoIndicator = autoCompactEnabled ? " (auto)" : "";
        const contextPercentDisplay = contextUsage?.percent !== null && contextUsage?.percent !== undefined
          ? `${contextPercentValue.toFixed(1)}%/${formatTokens(contextWindow)}${autoIndicator}`
          : `?/${formatTokens(contextWindow)}${autoIndicator}`;

        let contextPercentStr: string;
        if (contextPercentValue > 90) {
          contextPercentStr = theme.fg("error", contextPercentDisplay);
        } else if (contextPercentValue > 70) {
          contextPercentStr = theme.fg("warning", contextPercentDisplay);
        } else {
          contextPercentStr = contextPercentDisplay;
        }
        statsParts.push(contextPercentStr);

        let statsLeft = statsParts.join(" ");
        let statsLeftWidth = visibleWidth(statsLeft);

        if (statsLeftWidth > width) {
          statsLeft = truncateToWidth(statsLeft, width, "...");
          statsLeftWidth = visibleWidth(statsLeft);
        }

        // Build right side: model + thinking
        const modelName = model?.id || "no-model";
        let rightSideWithoutProvider = modelName;

        if (model?.reasoning) {
          const thinkingLevel = pi.getThinkingLevel();
          rightSideWithoutProvider = thinkingLevel === "off"
            ? `${modelName} • thinking off`
            : `${modelName} • ${thinkingLevel}`;
        }

        // Prepend provider if multiple providers available
        let rightSide = rightSideWithoutProvider;
        if (footerData.getAvailableProviderCount() > 1 && model) {
          const withProvider = `(${model.provider}) ${rightSideWithoutProvider}`;
          if (statsLeftWidth + 2 + visibleWidth(withProvider) <= width) {
            rightSide = withProvider;
          }
        }

        const rightSideWidth = visibleWidth(rightSide);
        const minPadding = 2;
        const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;

        let statsLine: string;
        if (totalNeeded <= width) {
          const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
          statsLine = statsLeft + padding + rightSide;
        } else {
          const availableForRight = width - statsLeftWidth - minPadding;
          if (availableForRight > 0) {
            const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
            const truncatedRightWidth = visibleWidth(truncatedRight);
            const padding = " ".repeat(Math.max(0, width - statsLeftWidth - truncatedRightWidth));
            statsLine = statsLeft + padding + truncatedRight;
          } else {
            statsLine = statsLeft;
          }
        }

        // Apply dim styling
        const dimStatsLeft = theme.fg("dim", statsLeft);
        const remainder = statsLine.slice(statsLeft.length);
        const dimRemainder = theme.fg("dim", remainder);

        lines.push(dimStatsLeft + dimRemainder);

        // ═══════════════════════════════════════════════════════════════════
        // Line 3: Extension statuses
        // ═══════════════════════════════════════════════════════════════════

        const extensionStatuses = footerData.getExtensionStatuses();
        if (extensionStatuses.size > 0) {
          const sortedStatuses = Array.from(extensionStatuses.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, text]) => sanitizeStatusText(text));
          const statusLine = sortedStatuses.join(" ");
          lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
        }

        return lines;
      },
    };
  }

  function updateFooter(ctx: { cwd: string; ui: any; hasUI: boolean; model: any; sessionManager: any; modelRegistry: any; getContextUsage?: () => any }): void {
    if (!ctx.hasUI) return;
    ctxRef = ctx;

    ctx.ui.setFooter((tui: any, theme: any, footerData: ReadonlyFooterDataProvider) => {
      tuiRef = tui;
      return createFooterRenderer(ctx, theme, footerData);
    });
  }

  async function refreshAfterFetch(ctx: any): Promise<void> {
    const status = await fetchVCSStatus(ctx.cwd);
    if (status) {
      cachedStatus = { status, timestamp: Date.now(), cwd: ctx.cwd };
      if (tuiRef) tuiRef.requestRender();
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    invalidateCache();
    updateFooter(ctx);
    refreshAfterFetch(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    invalidateCache();
    updateFooter(ctx);
    refreshAfterFetch(ctx);
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName === "bash" || event.toolName === "write" || event.toolName === "edit") {
      invalidateCache();
      if (tuiRef) tuiRef.requestRender();
      refreshAfterFetch(ctx);
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setFooter(undefined);
    }
    tuiRef = null;
    ctxRef = null;
  });
}
