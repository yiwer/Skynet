---
name: skynet-setup
description: Show local terminal commands when the user asks to set up Skynet, inspect collector status, or remove this plugin entry.
---

Resolve this installed plugin's root from this skill file. Show the user the absolute path to `scripts/skynet.cjs` with quotes for spaces.

For setup, explain that Node 24 must already be installed. The user sets their personal `SKYNET_KEY` in a local terminal and runs `node "<absolute-plugin-root>/scripts/skynet.cjs" setup`, then clears the variable. The key stays out of conversation, skill arguments, and command-line arguments. The deterministic program binds the device, copies the runtime into stable user storage, and installs user hooks. This plugin adds no second hook set.

For status, run the same script with `status`. Report installed, configured, pending host trust, first event, background, server freshness, and committed uploads separately. Finish setup guidance with Claude's ordinary workspace trust and a fresh ordinary conversation.

For removing this entry, show `node "<absolute-plugin-root>/scripts/skynet.cjs" entry-remove --entry claude-plugin`, then `claude plugin uninstall skynet-claude@<marketplace> --scope user`. Read the marketplace name from the host's installed-plugin listing. Other entries keep their shared collector. If the plugin cache is already absent, use the stable launcher path shown by status. Marketplace removal alone has no reliable cleanup callback.

Completion means the requested local command or status explanation is delivered. Ongoing capture is performed by the native user hooks and background; this skill never reads or reports employee transcripts.
