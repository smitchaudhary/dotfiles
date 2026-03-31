import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Command aliases extension - provides alternate names for built-in commands.
 * Since built-in commands are handled at a different layer, we register
 * actual extension commands that perform the equivalent actions.
 */
export default function (pi: ExtensionAPI) {
  // /clear -> same as /new
  pi.registerCommand("clear", {
    description: "Start a new session (alias for /new)",
    handler: async (_args, ctx) => {
      const result = await ctx.newSession();
      if (result.cancelled) {
        ctx.ui.notify("Cancelled", "info");
      }
    },
  });

  // /exit -> same as /quit
  pi.registerCommand("exit", {
    description: "Exit pi (alias for /quit)",
    handler: async (_args, ctx) => {
      ctx.shutdown();
    },
  });

  // /q -> same as /quit
  pi.registerCommand("q", {
    description: "Exit pi (alias for /quit)",
    handler: async (_args, ctx) => {
      ctx.shutdown();
    },
  });
}
