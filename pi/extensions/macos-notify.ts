import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

let notificationsEnabled = true;
const SOUND_FILE = "/System/Library/Sounds/Glass.aiff";

// Ghostty is the only terminal I use — no need to check for others
const GHOSTTY = new Set(["ghostty", "ghostty.app"]);

function makeUserWatcher(pi: ExtensionAPI) {
  return async (): Promise<boolean> => {
    try {
      // Check 1: Is a terminal emulator the frontmost app?
      const { stdout } = await pi.exec("osascript", [
        "-e",
        'tell application "System Events" to get name of first application process whose frontmost is true',
      ]);
      const frontmostApp = stdout.trim().toLowerCase();

      if (!GHOSTTY.has(frontmostApp)) {
        // User is not in Ghostty — definitely not watching
        return false;
      }

      // Check 2: If inside tmux, is pi's own pane the active one?
      if (process.env.TMUX) {
        const paneId = process.env.TMUX_PANE;
        const { stdout: status } = await pi
          .exec("tmux", [
            "display-message",
            "-p",
            "-t",
            paneId,
            "#{window_active}#{pane_active}",
          ])
          .catch(() => ({ stdout: "" }));

        // Returns "11" only if pi's window is active AND pi's pane is active within it
        return status.trim() === "11";
      }

      // Terminal is frontmost, no tmux — assume they're watching
      return true;
    } catch {
      // If anything fails (osascript unavailable, etc.), fall back to always notify
      return false;
    }
  };
}

export default function (pi: ExtensionAPI) {
  // Helper to play sound
  async function notify() {
    if (!notificationsEnabled) return;
    pi.exec("afplay", [SOUND_FILE]).catch(() => {});
  }

  // Restore settings on session start
  pi.on("session_start", async (_event, ctx) => {
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === "notify-settings") {
        notificationsEnabled = entry.data?.enabled ?? true;
      }
    }
  });

  const isUserWatchingPi = makeUserWatcher(pi);

  // When pi finishes working — only notify if user is NOT watching
  pi.on("agent_end", async () => {
    if (!notificationsEnabled) return;

    const watching = await isUserWatchingPi();
    if (!watching) {
      await notify();
    }
  });

  // When a dangerous tool call needs confirmation — always notify, regardless
  pi.on("tool_call", async (event, ctx) => {
    if (isToolCallEventType("bash", event)) {
      const cmd = event.input.command || "";

      const needsApproval =
        cmd.includes("rm -rf") ||
        cmd.includes("sudo ") ||
        cmd.includes("chmod -R") ||
        cmd.includes("git reset --hard") ||
        cmd.includes("git clean -fd") ||
        cmd.includes("drop database") ||
        cmd.includes("jj abandon");

      if (needsApproval) {
        await notify();
      }
    }
  });

  // Toggle command
  pi.registerCommand("notify", {
    description: "Toggle notification sound on/off",
    handler: async (args, ctx) => {
      const subcommand = args?.trim().toLowerCase() || "toggle";

      if (subcommand === "on") {
        notificationsEnabled = true;
        ctx.ui.notify("Sound notifications on", "success");
        pi.appendEntry("notify-settings", { enabled: notificationsEnabled });
      } else if (subcommand === "off") {
        notificationsEnabled = false;
        ctx.ui.notify("Sound notifications off", "info");
        pi.appendEntry("notify-settings", { enabled: notificationsEnabled });
      } else if (subcommand === "status") {
        const status = notificationsEnabled ? "on" : "off";
        ctx.ui.notify(`Sound notifications: ${status}`, "info");
      } else {
        notificationsEnabled = !notificationsEnabled;
        const status = notificationsEnabled ? "on" : "off";
        ctx.ui.notify(`Sound notifications ${status}`, "info");
        pi.appendEntry("notify-settings", { enabled: notificationsEnabled });
      }
    },
  });

  // Test command
  pi.registerCommand("notify-test", {
    description: "Play the notification sound",
    handler: async (_args, ctx) => {
      await notify();
      ctx.ui.notify("Sound played", "success");
    },
  });
}
