# T3 Code Provider Parity: Native `Pi` (`omp`) & `Prime Agent` (`prime-agent` / `pa`)

Full-parity integration and update-resilient patching suite for **T3 Code** (`pingdotgg/t3code`) supporting:
1. **Variant 1 — Native `Pi` (`@earendil-works/pi-coding-agent` / `oh-my-pi` `omp`) Full Feature Parity** (`PiAdapterV2`)
2. **Variant 2 — Native `Prime Agent` (`PrimeIntellect-ai/prime-agent` `0.10.1-beta.8`) Integration** (RPC, ACP, and Python `rlm` IPython Kernel Bridge)

---

## 1. Architecture Overview

| Component | File / Target Path | Responsibility |
| :--- | :--- | :--- |
| **Parity Bridge Module** | `F:\test\t3-prime-bridge.js` | Self-contained, Rollup-suffix-independent helper functions and adapter hooks for `PiAdapterV2`, `AcpAdapterV2`, and Python `rlm`. |
| **Idempotent Patcher** | `F:\test\apply-t3-patch.js` | Extracts `server.asar`, applies backend (`binCli-*.mjs`) and client (`session-logic-*.js`, `ChatGptUsageButton-*.js`) patches, verifies syntax via `node --check`, repacks `server.asar`, patches `rlm/__init__.py`, and registers `primeAgent` in `~/.t3/userdata/settings.json`. |
| **Update Sync Script** | `F:\test\sync-patches.ps1` | One-command PowerShell synchronization script for re-applying patches after T3 Code nightly updates or `prime-agent update`. |
| **Integration Test Suite** | `F:\test\test-integration.mjs` | End-to-end verification of tool normalization, `ipython` cell unpacking, idempotency, Python `rlm.html_render`, and live `prime-agent --mode rpc` JSON-RPC handshake. |

---

## 2. Feature Matrix

### Variant 1: Native `Pi` (`omp`) Driver Parity (`PiAdapterV2`)
- **Provider Capabilities (`PiProviderCapabilitiesV2` & `PI_PRESENTATION`)**:
  - Enables `supportsSkillInvocation: true`, `supportsPlanMode: true`, `supportsSessionFork: true`, `supportsUsageReporting: true`, `supportsImageAttachments: true`.
  - Enables `planning.emitsPlanUpdated: true`, `planning.emitsTodoList: true`, `planning.emitsProposedPlan: true`, and `showInteractionModeToggle: true`.
- **Rich Turn Item Normalization (`emitToolItem`)**:
  - `todo_write` / `todo` (both flat `todos` and Oh-My-Pi `phases`) $\rightarrow$ `todo_list` turn item + `thread.todos.updated` event with strict `OrchestrationV2PlanStep` statuses (`"pending" | "running" | "completed"`).
  - `exit_plan_mode` / `plan` / `submit_plan` $\rightarrow$ `proposed_plan` turn item + `thread.proposed_plan.upserted` event.
  - `grep` / `find` / `glob` / `file_search` $\rightarrow$ `file_search` turn item with file/line/preview extraction.
  - `web_search` / `fetch` $\rightarrow$ `web_search` turn item with query patterns and URL snippets.
  - `read` $\rightarrow$ `dynamic_tool` (`toolName: "Read"`) for native T3 Code file-read card rendering.
  - `html_render` / `html_preview` $\rightarrow$ `mcp_tool_call` with `xd://127.0.0.1` fallback URI and deterministic `-html` attachment files in `~/.t3/userdata/attachments`.
  - `subagent` / `task` / `wait` $\rightarrow$ `subagent.updated` + `turn_item.updated` (`type: "subagent"`) supporting both Pi `details.results` and Oh-My-Pi `details.progress` / `details.jobs`.

### Variant 2: `Prime Agent` (`prime-agent` / `pa`) Native Bridge
- **First-Class Provider Registration (`~/.t3/userdata/settings.json`)**:
  - Registers `providerInstances.primeAgent` (`displayName: "Prime Agent"`, `accentColor: "#10b981"`, `binaryPath: "C:\\Users\\Ak417ytrfg\\.local\\share\\prime-agent\\prime-agent.exe"`).
  - Displays `Authenticated · prime-agent`, version `v0.10.1-beta.8`, and a custom emerald vector icon in `Settings -> Providers`.
- **Single-Tool (`ipython` / `Python cell`) Unpacking (`unpackPrimeIpythonCell`)**:
  - Unpacks `details.diffs`, `application/vnd.prime-agent.diff+json` attachments, and Python `edit(path, old, new)` calls into native `file_change` turn items with unified diffs and `changes: [{ operation: "edit", path }]`.
  - Unpacks `application/vnd.prime-agent.html-render+json` / `text/html` attachments and `rlm.html_render(...)` calls into native `html_render` preview cards.
  - Unpacks `read(...)` and `bash(...)` calls inside `ipython` cells into native `Read` and `command_execution` cards using deterministic child item IDs (`${toolCallId}:*`).
- **Subagents, Goals & Compaction (RPC + ACP)**:
  - Maps `rlm_child_update` (RPC) and `_meta["ai.primeintellect.prime-agent"].subagents` (ACP) into live T3 Code `subagent` cards (`Subagent #N`).
  - Maps `goal_update` (RPC) and `_meta["ai.primeintellect.prime-agent"].goal` (ACP) into `todo_list` / `thread.todos.updated` with token budget tracking.
  - Handles `agent_end` alongside `agent_settled`, checks `sessionActions.queuedCount` in `t3.settle_probe`, falls back from `get_entries` to `get_fork_messages`, strips unsupported Pi CLI flags (`--extension`, `--no-extensions`, `--no-tools`, `--tools`), and resolves Windows `prime-agent.cmd` / `pa.cmd` shims in `validateLocalExecutable`.
- **Python RLM Kernel Helpers (`rlm/__init__.py`)**:
  - Adds `rlm.html_render(html, title="HTML Preview", height=480)` and `rlm.html_preview(...)` to both `prime-agent-runtime/src/rlm/__init__.py` and `kernel-venv/Lib/site-packages/rlm/__init__.py`.

---

## 3. Usage & Update Synchronization

Apply or synchronize all patches idempotently after updating T3 Code or Prime Agent:

```powershell
powershell -ExecutionPolicy Bypass -File F:\test\sync-patches.ps1
```

Run the automated integration test suite directly:

```powershell
node F:\test\test-integration.mjs
```

Restore the original unpatched `server.asar` backup if needed:

```powershell
powershell -ExecutionPolicy Bypass -File F:\test\sync-patches.ps1 -RestoreBackup
```
