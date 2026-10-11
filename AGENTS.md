# Project Context: T3 Code Provider Parity & Prime Agent Integration

## 1. Environment & Paths
- **Workspace Repository**: `F:\test`
- **T3 Code Bundle (`server.asar`)**: `C:\Users\Ak417ytrfg\AppData\Local\Programs\t3code\resources\server.asar`
- **Extracted Inspection Copy**: `C:\Users\Ak417ytrfg\AppData\Local\Temp\opencode\t3-inspect\apps\server\dist\binCli-CyxUejOW.mjs`
- **Prime Agent Binary (`0.10.1-beta.8`)**: `C:\Users\Ak417ytrfg\.local\share\prime-agent\prime-agent.exe`
- **Prime Agent CLI Shims**: `C:\Users\Ak417ytrfg\.local\bin\prime-agent.cmd`, `C:\Users\Ak417ytrfg\.local\bin\pa.cmd`
- **Prime Agent Python Runtime Source**: `C:\Users\Ak417ytrfg\.local\share\prime-agent\prime-agent-runtime\src\rlm`
- **Prime Agent Bundled Skills**: `C:\Users\Ak417ytrfg\.local\share\prime-agent\skills` (`edit`, `goal`, `refine`, `schedule`, `subagents`)
- **Prime Agent Kernel Venv**: `C:\Users\Ak417ytrfg\.prime\agent\kernel-venv` (CPython 3.11.16)
- **Prime Agent User State**: `C:\Users\Ak417ytrfg\.prime\agent` (`auth.json`, `models.json`, `settings.json`, `sessions`)

## 2. Target Architecture (Two Variants + Update Resilience)

### Variant 1: Native `Pi` (`omp`) Driver Full Feature Parity (`PiAdapterV2`)
- **Capabilities (`PiProviderCapabilitiesV2`)**: Enable `supportsSkillInvocation: true` alongside `supportsPlanMode: true`, `supportsSessionFork: true`, `supportsUsageReporting: true`, and `supportsImageAttachments: true`.
- **Tool Normalization (`emitToolItem` in `makePiAdapterV2`)**:
  - `todo_write` -> `todo_list` turn item + `thread.todos.updated` event.
  - `exit_plan_mode` / `plan` -> `proposed_plan` turn item + `thread.proposed_plan.upserted` event.
  - `find` / `grep` -> `file_search` turn item.
  - `web_search` -> `web_search` turn item.
  - `read` -> `dynamic_tool` (`toolName: "Read"`) for native file-read card rendering.
  - `html_render` / `html_preview` -> `mcp_tool_call` with `xd://127.0.0.1` fallback URI in `PI_T3_MCP_EXTENSION_SOURCE` and `htmlRenderFromToolItem`.
  - `subagent` / `task` / `wait` -> `subagent.updated` + `turn_item.updated` (`type: "subagent"`) supporting both Pi's `details.results` and Oh-My-Pi's `details.results` (`id`, `agent`, `assignment`, `status`, `output`, `error`).

### Variant 2: Prime Agent (`prime-agent` / `pa`) Full Integration (ACP + RPC + Kernel Bridge)
- **ACP Mode (`prime-agent --mode acp` via `makeAcpAdapterV2` / `makeAcpRegistryAdapterV2`)**:
  - Resolve `.cmd` shims (`prime-agent.cmd` / `pa.cmd`) to `prime-agent.exe` on Windows when needed.
  - Parse `_meta["ai.primeintellect.prime-agent"]` in `session_info_update` and `tool_call_update`:
    - `ipython.attachments` (`application/vnd.prime-agent.diff+json`) -> `file_change` turn items with unified diffs.
    - `ipython.attachments` (`application/vnd.prime-agent.html-render+json` or `text/html`) -> `html_render` preview/inline view.
    - `goal` (`goal_update`) -> `todo_list` / `proposed_plan` synchronization (`thread.todos.updated`).
    - `subagents` (`rlm_child_update`) -> `subagent.updated` + `turn_item.updated` (`type: "subagent"`).
    - `compaction` (`compaction_end`) -> `context_compaction` turn item.
- **RPC Mode (`prime-agent --mode rpc` via `makePiAdapterV2`)**:
  - Detect `prime-agent` / `pa` binary in `buildPiRpcLaunch`, `checkPiProviderStatus`, and `makePiAdapterV2`:
    - Omit unsupported Pi CLI flags (`--extension`, `--no-extensions`, `--no-tools`).
    - Accept `prime-agent` semver (`>= 0.10.0`).
    - Handle `agent_end` as run settle trigger alongside `agent_settled` and map `sessionActions.queuedCount` in `t3.settle_probe`.
    - Map `goal_update` and `ipython` attachments (`details.attachments`) into T3 Code diffs, plans/todos, `html_render`, and subagents.
- **Python Kernel Bridge (`rlm` / skill helpers)**:
  - Expose `rlm.html_render(html, title=...)` / `rlm.html_preview(html, title=...)` and MCP bridge helpers inside the IPython kernel so Prime Agent's single-tool (`ipython`) workflow can render interactive HTML and diffs directly in T3 Code.

### Update Resilience
- Idempotent patching via `F:\test\apply-t3-patch.js` using structural regex/anchor matching that works across T3 Code nightly builds (`binCli-*.mjs` hash changes) and `prime-agent update` runs, paired with `F:\test\sync-patches.ps1`.
