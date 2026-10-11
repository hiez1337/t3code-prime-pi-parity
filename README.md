# T3 Code Provider Parity: Native `Pi` (`omp`) and `Prime Agent`

This repository provides a full-parity integration and update-resilient patching suite for **T3 Code** (`pingdotgg/t3code`). It enables two distinct provider variants:
1. **Variant 1 (`PiAdapterV2`)**: Native `Pi` (`@earendil-works/pi-coding-agent` and `oh-my-pi` `omp`) full feature parity.
2. **Variant 2 (`Prime Agent`)**: Native `PrimeIntellect-ai/prime-agent` (`0.10.1-beta.8`) integration across RPC, ACP, and the Python `rlm` IPython kernel.

---

## 1. Architecture Overview

The patcher injects a self-contained parity bridge into the T3 Code server bundle (`binCli-*.mjs`) and client bundle (`session-logic-*.js`, `ChatGptUsageButton-*.js`). All injected helpers avoid Rollup-mangled symbol suffixes so the patcher survives T3 Code nightly updates and `prime-agent update` runs.

| Component | File Path | Responsibility |
| :--- | :--- | :--- |
| **Parity Bridge** | `./t3-prime-bridge.js` | Provides helper functions and adapter hooks for `PiAdapterV2`, `AcpAdapterV2`, and the Python `rlm` namespace. |
| **Idempotent Patcher** | `./apply-t3-patch.js` | Extracts `server.asar`, applies server and client patches, validates syntax with `node --check`, and updates `rlm/__init__.py`. |
| **Sync Script** | `./sync-patches.ps1` | Checks patch markers, refreshes `server.asar.bak` on upstream updates, applies patches, and runs integration tests. |
| **Test Suite** | `./test-integration.mjs` | Verifies tool normalization, `ipython` unpacking, V2 event schemas, Python `rlm.html_render`, and live RPC handshakes. |

---

## 2. Variant 1: Native `Pi` (`omp`) Driver Parity

Variant 1 upgrades `PiProviderCapabilitiesV2` and `PI_PRESENTATION` in `binCli-*.mjs` to match first-class T3 Code providers (`Codex`, `Claude`, `OpenCode`). Specifically, the patch enables `supportsSkillInvocation`, `supportsPlanMode`, `supportsSessionFork`, `supportsUsageReporting`, `supportsImageAttachments`, `planning.emitsPlanUpdated`, `planning.emitsTodoList`, `planning.emitsProposedPlan`, and `showInteractionModeToggle`.

In `makePiAdapterV2`, the upgraded `emitToolItem` function normalizes `Pi` and `omp` tool calls into native `OrchestrationV2TurnItem` and `ProviderAdapterV2Event` payloads:

| Tool Name | Emitted V2 Turn Item | Emitted V2 Event / Details |
| :--- | :--- | :--- |
| `todo_write`, `todo` | `todo_list` (`planId`, `steps`) | Emits `plan.updated` (`kind: "todo_list"`) with statuses normalized to `"pending" \| "running" \| "completed"`. |
| `exit_plan_mode`, `plan` | `proposed_plan` (`planId`, `markdown`) | Emits `plan.updated` (`kind: "proposed_plan"`) and streams markdown to the T3 plan card. |
| `grep`, `find`, `glob` | `file_search` (`pattern`, `results`) | Extracts file paths, line numbers, and code previews from ripgrep or glob output. |
| `web_search`, `webfetch` | `web_search` (`patterns`, `results`) | Extracts search queries, result URLs, titles, and snippets into the native web search card. |
| `read` | `dynamic_tool` (`toolName: "Read"`) | Formats file path and line range (`Loffset-end`) for the native T3 file-read card. |
| `html_render`, `html_preview` | `dynamic_tool` (`output.htmlRender`) | Registers direct tools in `PI_T3_MCP_EXTENSION_SOURCE` with `xd://127.0.0.1` fallback URIs and `-html` attachments. |
| `subagent`, `task`, `wait` | `subagent` (`origin: "provider_native"`) | Emits `subagent.updated` and `turn_item.updated` for both Pi `details.results` and `omp` `details.progress`. |

---

## 3. Variant 2: `Prime Agent` (`prime-agent` / `pa`) Native Bridge

Variant 2 registers `providerInstances.primeAgent` in `~/.t3/userdata/settings.json`. In `Settings -> Providers`, T3 Code displays `Prime Agent` with status `Authenticated · prime-agent`, version `v0.10.1-beta.8`, and a custom emerald vector icon.

Prime Agent executes code and file edits inside a single stateful IPython tool (`ipython`, titled `Python cell`). The `unpackPrimeIpythonCell` bridge inspects each cell and emits deterministic child turn items (`${toolCallId}:*`) alongside the parent cell:
- **Unified File Diffs (`file_change`)**: Extracts `details.diffs`, `application/vnd.prime-agent.diff+json` attachments, and Python `edit(...)` calls into unified diffs with `changes: [{ operation: "edit", path }]`.
- **Interactive HTML (`html_render`)**: Extracts `application/vnd.prime-agent.html-render+json` attachments and `rlm.html_render(...)` calls into `dynamic_tool` items with `output.htmlRender`.
- **File Reads and Shell Commands**: Extracts `read(...)` and `bash(...)` calls inside Python cells into native `Read` and `command_execution` cards.
- **Goals and Subagents**: Maps `goal_update` (RPC) and `_meta["ai.primeintellect.prime-agent"].goal` (ACP) to `todo_list` plans, and maps `rlm_child_update` / `_meta.subagents` to `subagent` cards.
- **Lifecycle and Windows Compatibility**: The bridge resolves `prime-agent.cmd` and `pa.cmd` shims to `prime-agent.exe`. It strips unsupported CLI flags, settles turns on `agent_end`, and falls back to `get_fork_messages`.

---

## 4. Usage and Verification

1. Run `sync-patches.ps1` to apply all T3 Code and Prime Agent RLM patches and execute the test suite:

```powershell
powershell -ExecutionPolicy Bypass -File .\sync-patches.ps1
```

2. Run `test-integration.mjs` directly to verify helper functions, bundle idempotency, Python RLM helpers, and live RPC responses:

```powershell
node test-integration.mjs
```

3. If you need to restore the unpatched `server.asar` backup, run `sync-patches.ps1` with `-RestoreBackup`:

```powershell
powershell -ExecutionPolicy Bypass -File .\sync-patches.ps1 -RestoreBackup
```
