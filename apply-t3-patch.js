'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

function loadAsarModule() {
  const candidates = ['asar', '@electron/asar'];
  const npxDir = path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx');
  if (fs.existsSync(npxDir)) {
    for (const entry of fs.readdirSync(npxDir)) {
      const p = path.join(npxDir, entry, 'node_modules', 'asar');
      if (fs.existsSync(p)) candidates.push(p);
    }
  }
  for (const modPath of candidates) {
    try {
      return require(modPath);
    } catch (_err) {
      // try next candidate
    }
  }
  throw new Error('Could not locate asar module. Run `npx asar --version` once to populate cache.');
}

const asar = loadAsarModule();
const {
  BRIDGE_MARKER,
  BIN_CLI_BRIDGE_SOURCE,
  EMIT_SUBAGENT_TASKS_SOURCE,
  EMIT_TOOL_ITEM_SOURCE,
  PRIME_RPC_EVENT_CASES_SOURCE,
  ACP_PRIME_TOOL_HOOK_SOURCE,
  ACP_PRIME_SESSION_INFO_HOOK_SOURCE,
  PYTHON_RLM_HTML_SOURCE,
} = require('./t3-prime-bridge');

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const originalAsar = path.join(localAppData, 'Programs', 't3code', 'resources', 'server.asar');
const backupAsar = path.join(localAppData, 'Programs', 't3code', 'resources', 'server.asar.bak');
const inspectDir = path.join(localAppData, 'Temp', 'opencode', 't3-inspect');
const t3SettingsPath = path.join(os.homedir(), '.t3', 'userdata', 'settings.json');
const rlmSourceInit = path.join(os.homedir(), '.local', 'share', 'prime-agent', 'prime-agent-runtime', 'src', 'rlm', '__init__.py');
const rlmVenvInit = path.join(os.homedir(), '.prime', 'agent', 'kernel-venv', 'Lib', 'site-packages', 'rlm', '__init__.py');
const kernelPython = path.join(os.homedir(), '.prime', 'agent', 'kernel-venv', 'Scripts', 'python.exe');

function replaceFunctionBlock(content, prefix, newBlock) {
  const startIdx = content.indexOf(prefix);
  if (startIdx === -1) return { content, replaced: false };
  const callStart = content.indexOf('(', startIdx);
  if (callStart === -1) return { content, replaced: false };
  let depth = 0;
  let endIdx = -1;
  let inStr = null;
  let escaped = false;
  for (let i = callStart; i < content.length; i++) {
    const ch = content[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (inStr) {
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx === -1) return { content, replaced: false };
  if (content[endIdx + 1] === ';') endIdx++;
  return {
    content: content.slice(0, startIdx) + newBlock + content.slice(endIdx + 1),
    replaced: true,
  };
}

function patchBinCliContent(content) {
  let changes = 0;

  // 1. Inject or upgrade self-contained bridge helper block before resolveSpawnCommand (early in bundle)
  const anchor = 'const resolveSpawnCommand = fnUntraced(';
  if (!content.includes(BRIDGE_MARKER)) {
    if (content.includes(anchor)) {
      content = content.replace(anchor, `${BIN_CLI_BRIDGE_SOURCE}\n${anchor}`);
      changes++;
    }
  } else if (content.includes(anchor) && (!content.includes('__T3_HTML_RENDER_JSON__:') || !content.includes('rawGoal.goal && typeof rawGoal.goal'))) {
    const startIdx = content.indexOf(BRIDGE_MARKER);
    const endIdx = content.indexOf(anchor, startIdx);
    if (startIdx !== -1 && endIdx !== -1) {
      content = content.slice(0, startIdx) + `${BIN_CLI_BRIDGE_SOURCE}\n` + content.slice(endIdx);
      changes++;
    }
  }

  // 2. Patch resolveSpawnCommand, validateLocalExecutable, inspect, and resolve for Windows prime-agent.cmd / pa.cmd shims
  const oldSpawnExplicit = '\tconst explicitPath = command.includes("/") || command.includes("\\\\");';
  const newSpawnExplicit = '\tcommand = resolvePrimeCmdShim(command);\n\tconst explicitPath = command.includes("/") || command.includes("\\\\");';
  if (content.includes(oldSpawnExplicit) && !content.includes('command = resolvePrimeCmdShim(command);')) {
    content = content.replace(oldSpawnExplicit, newSpawnExplicit);
    changes++;
  }
  const oldValidateExec = 'const validateLocalExecutable = (command) => platform === "win32" && /\\.(?:cmd|bat)$/iu.test(command) ? fail$1(';
  const newValidateExec = 'const validateLocalExecutable = (command) => platform === "win32" && /\\.(?:cmd|bat)$/iu.test(command) && !isPrimeAgentBinary(command) ? fail$1(';
  if (content.includes(oldValidateExec)) {
    content = content.replace(oldValidateExec, newValidateExec);
    changes++;
  }
  const oldInspectCmd = 'const command = settings.commandPath.trim();';
  const newInspectCmd = 'const command = resolvePrimeCmdShim(settings.commandPath.trim());';
  if (content.includes(oldInspectCmd) && !content.includes('resolvePrimeCmdShim(settings.commandPath.trim())')) {
    content = content.replace(oldInspectCmd, newInspectCmd);
    changes++;
  }
  const oldResolveExec = 'const executable = settings.commandPath.trim();\n\t\t\tif (!executable) return yield* new AcpRegistryError({\n\t\t\t\treason: "agent_not_configured",\n\t\t\t\tdetail: "Local ACP provider requires an executable."\n\t\t\t});\n\t\t\tconst env = environment ?? hostEnvironment;\n\t\t\tconst command = resolveExecutable(executable, platform, env);';
  const newResolveExec = 'const executable = resolvePrimeCmdShim(settings.commandPath.trim());\n\t\t\tif (!executable) return yield* new AcpRegistryError({\n\t\t\t\treason: "agent_not_configured",\n\t\t\t\tdetail: "Local ACP provider requires an executable."\n\t\t\t});\n\t\t\tconst env = environment ?? hostEnvironment;\n\t\t\tconst rawCommand = resolveExecutable(executable, platform, env);\n\t\t\tconst command = rawCommand === void 0 ? void 0 : resolvePrimeCmdShim(rawCommand);';
  if (content.includes(oldResolveExec)) {
    content = content.replace(oldResolveExec, newResolveExec);
    changes++;
  }

  // 3. Patch PI_T3_MCP_EXTENSION_SOURCE directTools & xd://127.0.0.1 fallback URI
  const oldDirectTools = 'const directTools = new Set(["orchestrator_capabilities", "delegate_task", "task_status"]);';
  const newDirectTools = 'const directTools = new Set(["orchestrator_capabilities", "delegate_task", "task_status", "html_render", "html_preview"]);';
  if (content.includes(oldDirectTools)) {
    content = content.replace(oldDirectTools, newDirectTools);
    changes++;
  }
  const oldExtDetails = 'details: { server: "t3-code", tool: name },';
  const newExtDetails = 'details: { server: "t3-code", tool: name, uri: "xd://127.0.0.1/" + name },';
  if (content.includes(oldExtDetails)) {
    content = content.replace(oldExtDetails, newExtDetails);
    changes++;
  }

  // 4. Patch buildPiRpcLaunch + callers to filter unsupported flags for prime-agent
  const oldLaunchReturn = 'return {\n\t\targs,';
  const newLaunchReturn = 'const finalArgs = filterPrimeAgentLaunchArgs(args, isPrimeAgentBinary(input.binaryPath));\n\treturn {\n\t\targs: finalArgs,';
  if (content.includes(oldLaunchReturn) && !content.includes('const finalArgs = filterPrimeAgentLaunchArgs(')) {
    content = content.replace(oldLaunchReturn, newLaunchReturn);
    changes++;
  }
  const prevContentBeforeLaunch = content;
  content = content.replace(
    /buildPiRpcLaunch\(\{\n(\t+)launchArgs: resolvedLaunchArgs\.args,\n\1environment: options\.environment,/g,
    'buildPiRpcLaunch({\n$1binaryPath: options.settings.binaryPath,\n$1launchArgs: resolvedLaunchArgs.args,\n$1environment: options.environment,'
  );
  content = content.replace(
    /buildPiRpcLaunch\(\{\n(\t+)launchArgs,\n\1environment,\n\1mcpSession: void 0,/g,
    'buildPiRpcLaunch({\n$1binaryPath: piSettings.binaryPath,\n$1launchArgs,\n$1environment,\n$1mcpSession: void 0,'
  );
  content = content.replace(
    /buildPiRpcLaunch\(\{\n(\t+)launchArgs: resolvedLaunchArgs\.args,\n\1environment,\n\1mcpSession: void 0,/g,
    'buildPiRpcLaunch({\n$1binaryPath: piSettings.binaryPath,\n$1launchArgs: resolvedLaunchArgs.args,\n$1environment,\n$1mcpSession: void 0,'
  );
  if (content !== prevContentBeforeLaunch) changes++;

  // 4. Patch PiProviderCapabilitiesV2 & PI_PRESENTATION
  const piCapsAnchor = 'const PiProviderCapabilitiesV2 = {';
  const oldPlanningCaps = 'planning: {\n\t\temitsPlanUpdated: false,\n\t\temitsTodoList: false,\n\t\temitsProposedPlan: false,\n\t\tsupportsStructuredQuestions: true,\n\t\tplanDeltasHaveItemIds: false\n\t},';
  const newPlanningCaps = 'supportsSkillInvocation: true,\n\tsupportsPlanMode: true,\n\tsupportsSessionFork: true,\n\tsupportsUsageReporting: true,\n\tsupportsImageAttachments: true,\n\tplanning: {\n\t\temitsPlanUpdated: true,\n\t\temitsTodoList: true,\n\t\temitsProposedPlan: true,\n\t\tsupportsStructuredQuestions: true,\n\t\tplanDeltasHaveItemIds: true\n\t},';
  const piCapsIdx = content.indexOf(piCapsAnchor);
  if (piCapsIdx !== -1 && !content.includes('supportsSkillInvocation: true,')) {
    const tail = content.slice(piCapsIdx);
    if (tail.includes(oldPlanningCaps)) {
      content = content.slice(0, piCapsIdx) + tail.replace(oldPlanningCaps, newPlanningCaps);
      changes++;
    }
  }
  const oldPiPres = 'const PI_PRESENTATION = {\n\tdisplayName: "Pi",\n\tshowInteractionModeToggle: false,';
  const newPiPres = 'const PI_PRESENTATION = {\n\tdisplayName: "Pi",\n\tshowInteractionModeToggle: true,';
  if (content.includes(oldPiPres)) {
    content = content.replace(oldPiPres, newPiPres);
    changes++;
  }

  // 5. Patch htmlRenderFromToolItem
  const oldHtmlCheck = 'if (resolveT3McpToolId(item.toolName) !== "html_render") return void 0;';
  const newHtmlCheck = 'const _tId = resolveT3McpToolId(item.toolName); if (_tId !== "html_render" && item.toolName !== "html_render" && !item.toolName.endsWith("__html_render")) return void 0;';
  if (content.includes(oldHtmlCheck)) {
    content = content.replace(oldHtmlCheck, newHtmlCheck);
    changes++;
  }

  // 6. Replace emitToolItem and emitSubagentTasks
  if (!content.includes('turn.toolNames = turn.toolNames ?? new Map()') || !content.includes('child.kind === "goal"')) {
    const resTool = replaceFunctionBlock(content, 'const emitToolItem = fnUntraced(', EMIT_TOOL_ITEM_SOURCE);
    if (resTool.replaced) {
      content = resTool.content;
      changes++;
    }
  }
  if (!content.includes('currentToolName === "task" || currentToolName === "subagent"')) {
    const resSub = replaceFunctionBlock(content, 'const emitSubagentTasks = fnUntraced(', EMIT_SUBAGENT_TASKS_SOURCE);
    if (resSub.replaced) {
      content = resSub.content;
      changes++;
    }
  }

  // 7. Patch handleSessionEvent, makePiTextGeneration, and startTurn wake replay for Prime Agent RPC events (agent_end, goal_update, rlm_child_update)
  const oldTextGenSettled = 'while (true) if ((yield* take$2(connection.events))["type"] === "agent_settled") return;';
  const newTextGenSettled = 'while (true) { const _evType = (yield* take$2(connection.events))["type"]; if (_evType === "agent_settled" || _evType === "agent_end") return; }';
  if (content.includes(oldTextGenSettled)) {
    content = content.replace(oldTextGenSettled, newTextGenSettled);
    changes++;
  }
  const oldPendingWakeSettled = 'if (event["type"] === "agent_settled") yield* updateProviderSession("ready", null);';
  const newPendingWakeSettled = 'if (event["type"] === "agent_settled" || event["type"] === "agent_end") yield* updateProviderSession("ready", null);';
  if (content.includes(oldPendingWakeSettled)) {
    content = content.replace(oldPendingWakeSettled, newPendingWakeSettled);
    changes++;
  }
  const oldWakeReplaySettled = 'if (!continuation && event["type"] === "agent_settled") {';
  const newWakeReplaySettled = 'if (!continuation && (event["type"] === "agent_settled" || event["type"] === "agent_end")) {';
  if (content.includes(oldWakeReplaySettled)) {
    content = content.replace(oldWakeReplaySettled, newWakeReplaySettled);
    changes++;
  }
  if (!content.includes('case "rlm_child_update":')) {
    const settleCaseRe = /case "agent_settled":[\s\S]*?yield\* scheduleSettleProbe\(turn, true\);\s*\}\s*return;/;
    if (settleCaseRe.test(content)) {
      content = content.replace(settleCaseRe, PRIME_RPC_EVENT_CASES_SOURCE);
      changes++;
    }
  }

  // 8. Patch t3.settle_probe to check sessionActions.queuedCount alongside pendingMessageCount
  const oldProbeIdle = '(piRecordNumber(data, "pendingMessageCount") ?? 0) === 0';
  const newProbeIdle = '(piRecordNumber(data, "pendingMessageCount") ?? piRecordNumber(piRecordField(data, "sessionActions"), "queuedCount") ?? 0) === 0';
  if (content.includes(oldProbeIdle)) {
    content = content.replace(oldProbeIdle, newProbeIdle);
    changes++;
  }

  // 9. Patch listSessionEntries, registerThread, and rollbackThread to fall back to get_fork_messages for Prime Agent RPC
  const listEntriesAnchor = 'const listSessionEntries = (since, timeoutMs) =>';
  if (content.includes(listEntriesAnchor) && !content.includes('get_fork_messages')) {
    const listEntriesRe = /const listSessionEntries = \(since, timeoutMs\) => request\(\{[\s\S]*?\}\), orElseSucceed\(\(\) => null\)\);/;
    if (listEntriesRe.test(content)) {
      content = content.replace(
        listEntriesRe,
        `const listSessionEntries = (since, timeoutMs) => gen$1(function* () {\n\t\t\t\tconst primary = yield* request({\n\t\t\t\t\ttype: "get_entries",\n\t\t\t\t\t...since === null ? {} : { since }\n\t\t\t\t}, timeoutMs).pipe(map$11((data) => {\n\t\t\t\t\tconst leafId = piRecordField(data, "leafId");\n\t\t\t\t\tconst entries = piSessionEntries(piRecordField(data, "entries"));\n\t\t\t\t\treturn entries !== null && (typeof leafId === "string" || leafId === null) ? { entries, leafId } : null;\n\t\t\t\t}), orElseSucceed(() => null));\n\t\t\t\tif (primary !== null) return primary;\n\t\t\t\treturn yield* request({ type: "get_fork_messages" }, timeoutMs).pipe(map$11((data) => {\n\t\t\t\t\tconst msgs = piRecordField(data, "messages");\n\t\t\t\tif (!Array.isArray(msgs)) return null;\n\t\t\t\t\tconst rawEntries = msgs.map((m, idx) => ({\n\t\t\t\t\t\tid: String(m?.entryId ?? \`fork-\${idx}\`),\n\t\t\t\t\t\tparentId: idx > 0 ? String(msgs[idx - 1]?.entryId ?? \`fork-\${idx - 1}\`) : null,\n\t\t\t\t\t\ttype: "message",\n\t\t\t\t\t\tmessage: { role: "user" }\n\t\t\t\t\t}));\n\t\t\t\t\tconst entries = piSessionEntries(rawEntries);\n\t\t\t\t\tconst leafId = rawEntries.length > 0 ? rawEntries[rawEntries.length - 1].id : null;\n\t\t\t\t\treturn entries !== null ? { entries, leafId } : null;\n\t\t\t\t}), orElseSucceed(() => null));\n\t\t\t});`
      );
      changes++;
    }
  }
  const oldBaselineEntries = 'const baselineEntries = yield* request({ type: "get_entries" }).pipe(orElseSucceed(() => void 0));\n\t\t\t\tlastKnownLeaf = piRecordString(baselineEntries, "leafId") ?? null;\n\t\t\t\tleafCursorStale = baselineEntries === void 0;';
  const newBaselineEntries = 'const baselineEntries = yield* listSessionEntries(null, PI_REQUEST_TIMEOUT_MS);\n\t\t\t\tlastKnownLeaf = piRecordString(baselineEntries, "leafId") ?? null;\n\t\t\t\tleafCursorStale = baselineEntries === null;';
  if (content.includes(oldBaselineEntries)) {
    content = content.replace(oldBaselineEntries, newBaselineEntries);
    changes++;
  }
  const oldRollbackEntries = 'const entriesData = yield* request({ type: "get_entries" }).pipe(orElseSucceed(() => void 0));';
  const newRollbackEntries = 'const entriesData = yield* listSessionEntries(null, PI_REQUEST_TIMEOUT_MS);';
  if (content.includes(oldRollbackEntries)) {
    content = content.replace(oldRollbackEntries, newRollbackEntries);
    changes = changes + 1;
  }
  const oldSwitchSession = 'if (piRecordField(yield* lifecycleRequest(resumeId != null ? {\n\t\t\t\t\t\ttype: "switch_session",\n\t\t\t\t\t\tsessionPath: resumeId\n\t\t\t\t\t} : { type: "new_session" }), "cancelled") === true)';
  const newSwitchSession = `if (piRecordField(yield* lifecycleRequest(resumeId != null && !isPrimeAgentBinary(options.settings.binaryPath) ? {
\t\t\t\t\t\ttype: "switch_session",
\t\t\t\t\t\tsessionPath: resumeId
\t\t\t\t\t} : {
\t\t\t\t\t\ttype: "new_session",
\t\t\t\t\t\t...(resumeId != null ? { parentSession: resumeId } : {})
\t\t\t\t\t}), "cancelled") === true)`;
  if (content.includes(oldSwitchSession) && !content.includes('parentSession: resumeId')) {
    content = content.replace(oldSwitchSession, newSwitchSession);
    changes++;
  }
  const oldRollbackStale = 'leafCursorStale = entriesData === void 0;';
  const newRollbackStale = 'leafCursorStale = entriesData == null;';
  if (content.includes(oldRollbackStale)) {
    content = content.replace(oldRollbackStale, newRollbackStale);
    changes++;
  }

  // 10. Patch checkPiProviderStatus version check & auth label for Prime Agent
  const oldVerCheck = 'if (compareSemverVersions(version, "0.80.5") < 0) return buildServerProvider({';
  const newVerCheck = 'const minVer = isPrimeAgentBinary(piSettings.binaryPath) ? "0.10.0" : "0.80.5";\n\tif (compareSemverVersions(version, minVer) < 0) return buildServerProvider({';
  if (content.includes(oldVerCheck)) {
    content = content.replace(oldVerCheck, newVerCheck);
    changes++;
  }
  const oldAuthObj = 'auth: {\n\t\t\t\tstatus: discovery.authenticated ? "authenticated" : "unauthenticated",\n\t\t\t\ttype: "pi"\n\t\t\t},';
  const newAuthObj = 'auth: {\n\t\t\t\tstatus: discovery.authenticated ? "authenticated" : "unauthenticated",\n\t\t\t\ttype: isPrimeAgentBinary(piSettings.binaryPath) ? "prime-agent" : "pi",\n\t\t\t\t...(isPrimeAgentBinary(piSettings.binaryPath) ? { label: "prime-agent" } : {})\n\t\t\t},';
  if (content.includes(oldAuthObj)) {
    content = content.replace(oldAuthObj, newAuthObj);
    changes++;
  }

  // 11. Patch makeAcpAdapterV2 for Prime Agent ACP _meta
  const acpToolAnchor = 'const mcpIdentity = extractMcpToolCallIdentity(toolCall, { embeddedTerminalCommands: embeddedTerminalCommands(context.nativeThreadId, toolCall.toolCallId) });';
  if (content.includes(acpToolAnchor) && !content.includes('isPrimeIpythonAcp')) {
    content = content.replace(acpToolAnchor, `${ACP_PRIME_TOOL_HOOK_SOURCE}\n\t\t\t\t${acpToolAnchor}`);
    changes++;
  }
  const acpSessionInfoAnchor = 'if (context?.nativeThreadId === notification.sessionId) context.nativeMetadata = metadata;';
  if (content.includes(acpSessionInfoAnchor) && !content.includes('primeSessionMeta')) {
    content = content.replace(acpSessionInfoAnchor, `${acpSessionInfoAnchor}\n\t\t\t\t\t${ACP_PRIME_SESSION_INFO_HOOK_SOURCE}`);
    changes++;
  }

  // 12. Patch applyProviderCompatibility to eliminate false "Unsupported version (Use >=1.0.0)" popover for Prime Agent
  const oldApplyComp = 'function applyProviderCompatibility(snapshot, policies, fallback) {\n\tconst { compatibilityAdvisory: _previous, ...base } = snapshot;\n\tif (!snapshot.enabled || !snapshot.installed) return base;';
  const newApplyComp = 'function applyProviderCompatibility(snapshot, policies, fallback) {\n\tconst { compatibilityAdvisory: _previous, ...base } = snapshot;\n\tif (!snapshot.enabled || !snapshot.installed) return base;\n\tconst isPrime = snapshot.auth?.type === "prime-agent" || snapshot.auth?.label === "prime-agent" || snapshot.instanceId === "primeAgent" || /prime/i.test(snapshot.displayName ?? "");\n\tif (isPrime) {\n\t\tconst cleanVer = snapshot.version?.replace(/^v/, "");\n\t\tconst isSupported = Boolean(cleanVer && compareSemverVersions(cleanVer, "0.10.0") >= 0);\n\t\treturn isSupported ? base : {\n\t\t\t...base,\n\t\t\tcompatibilityAdvisory: {\n\t\t\t\tstatus: "unsupported",\n\t\t\t\tmessage: "This provider version is outside the supported range for this T3 Code release. Use >=0.10.0.",\n\t\t\t\trecommendedVersion: null,\n\t\t\t\trecommendedRange: ">=0.10.0"\n\t\t\t}\n\t\t};\n\t}';
  if (content.includes(oldApplyComp) && !content.includes('const isPrime = snapshot.auth?.type === "prime-agent"')) {
    content = content.replace(oldApplyComp, newApplyComp);
    changes++;
  }

  // 13. Patch enrichPiSnapshot to suppress Pi npm update checks and false "update --self" commands for Prime Agent
  const oldEnrichPi = 'const enrichPiSnapshot = (input) => {\n\tconst { snapshot, publishSnapshot } = input;\n\treturn enrichProviderSnapshotWithVersionAdvisory(';
  const newEnrichPi = 'const enrichPiSnapshot = (input) => {\n\tconst { snapshot, publishSnapshot } = input;\n\tconst isPrime = snapshot.auth?.type === "prime-agent" || snapshot.auth?.label === "prime-agent" || snapshot.instanceId === "primeAgent" || /prime/i.test(snapshot.displayName ?? "");\n\tif (isPrime) {\n\t\treturn publishSnapshot({\n\t\t\t...snapshot,\n\t\t\tversionAdvisory: {\n\t\t\t\tstatus: "current",\n\t\t\t\tcurrentVersion: snapshot.version,\n\t\t\t\tlatestVersion: snapshot.version,\n\t\t\t\tupdateCommand: null,\n\t\t\t\tcanUpdate: false,\n\t\t\t\tcanInstallVersion: false,\n\t\t\t\tcheckedAt: snapshot.checkedAt ?? null,\n\t\t\t\tmessage: null\n\t\t\t}\n\t\t});\n\t}\n\treturn enrichProviderSnapshotWithVersionAdvisory(';
  if (content.includes(oldEnrichPi) && !content.includes('status: "current",\n\t\t\t\tcurrentVersion: snapshot.version,')) {
    content = content.replace(oldEnrichPi, newEnrichPi);
    changes++;
  }

  // 14. Patch windowOf in OpenCode2Adapter to dynamically resolve maxTokens (500k) from local opencode.json
  const oldWindowOf = 'const directoryOf = (cwd) => cwd ?? host.paths.cwd;\n\t\tconst windowOf = (cwd, model) => contextWindows.get(directoryOf(cwd))?.get(model);';
  const newWindowOf = `const directoryOf = (cwd) => cwd ?? host.paths.cwd;
\t\tconst windowOf = (cwd, model) => {
\t\t\tconst dir = directoryOf(cwd);
\t\t\tlet capacity = contextWindows.get(dir)?.get(model);
\t\t\tif (capacity === void 0 && model) capacity = contextWindows.get(dir)?.get(model.replace(/^[^\\/]+\\//, ""));
\t\t\tif (capacity === void 0) {
\t\t\t\ttry {
\t\t\t\t\tconst cfgPath = Path$1.join(dir, "opencode.json");
\t\t\t\t\tif (NFS.existsSync(cfgPath)) {
\t\t\t\t\t\tconst cfg = JSON.parse(NFS.readFileSync(cfgPath, "utf8"));
\t\t\t\t\t\tfor (const p of Object.values(cfg.provider ?? {})) {
\t\t\t\t\t\t\tconst m = p.models?.[model] ?? p.models?.[model?.replace(/^[^\\/]+\\//, "")];
\t\t\t\t\t\t\tif (m?.limit?.context || m?.limit?.input) {
\t\t\t\t\t\t\t\tcapacity = m.limit.context ?? m.limit.input;
\t\t\t\t\t\t\t\tbreak;
\t\t\t\t\t\t\t}
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t} catch (_err) {}
\t\t\t}
\t\t\treturn capacity ?? 500000;
\t\t};`;
  if (content.includes(oldWindowOf) && !content.includes('return capacity ?? 500000;')) {
    content = content.replace(oldWindowOf, newWindowOf);
    changes++;
  }

  // 15. Patch session.step.ended in OpenCode2Adapter for live token streaming
  const oldStepEnded = 'case "session.step.ended":\n\t\t\t\tcase "session.step.failed": {\n\t\t\t\t\tconst tokens = event.data.tokens;\n\t\t\t\t\tif (tokens === void 0) return;\n\t\t\t\t\tturn.steps += 1;\n\t\t\t\t\tturn.lastStep = tokens;\n\t\t\t\t\tturn.usage.input += tokens.input + tokens.cache.read + tokens.cache.write;\n\t\t\t\t\tturn.usage.cached += tokens.cache.read;\n\t\t\t\t\tturn.usage.cacheWrite += tokens.cache.write;\n\t\t\t\t\tturn.usage.output += tokens.output + tokens.reasoning;\n\t\t\t\t\tturn.usage.reasoning += tokens.reasoning;\n\t\t\t\t\treturn;\n\t\t\t\t}';
  const newStepEnded = `case "session.step.ended":
\t\t\t\tcase "session.step.failed": {
\t\t\t\t\tconst tokens = event.data.tokens;
\t\t\t\t\tif (tokens === void 0) return;
\t\t\t\t\tturn.steps += 1;
\t\t\t\t\tturn.lastStep = tokens;
\t\t\t\t\tturn.usage.input += tokens.input + tokens.cache.read + tokens.cache.write;
\t\t\t\t\tturn.usage.cached += tokens.cache.read;
\t\t\t\t\tturn.usage.cacheWrite += tokens.cache.write;
\t\t\t\t\tturn.usage.output += tokens.output + tokens.reasoning;
\t\t\t\t\tturn.usage.reasoning += tokens.reasoning;
\t\t\t\t\tconst win = windowOf(turn.input.runtimePolicy.cwd, turn.input.modelSelection.model);
\t\t\t\t\treturn yield* emitProviderTurn(state, turn, {
\t\t\t\t\t\t...turn.providerTurn,
\t\t\t\t\t\ttokenUsage: {
\t\t\t\t\t\t\tusedTokens: tokens.input + tokens.cache.read + tokens.cache.write + tokens.output,
\t\t\t\t\t\t\tmaxTokens: win ?? 500000,
\t\t\t\t\t\t\tinputTokens: tokens.input + tokens.cache.read + tokens.cache.write,
\t\t\t\t\t\t\tcachedInputTokens: tokens.cache.read,
\t\t\t\t\t\t\toutputTokens: tokens.output,
\t\t\t\t\t\t\treasoningOutputTokens: tokens.reasoning,
\t\t\t\t\t\t\tupdatedAt: formatIso(yield* now)
\t\t\t\t\t\t}
\t\t\t\t\t});
\t\t\t\t}`;
  if (content.includes(oldStepEnded) && !content.includes('usedTokens: tokens.input + tokens.cache.read')) {
    content = content.replace(oldStepEnded, newStepEnded);
    changes++;
  }

  // 16. Patch forgetRequest in OpenCode2Adapter to verify anyActive before resetting to running
  const oldForgetRequest = 'if (!pending.delete(entry.request.id)) return false;\n\t\t\tif (pending.size === 0 && session.status === "waiting") yield* setSessionStatus("running", null);';
  const newForgetRequest = `if (!pending.delete(entry.request.id)) return false;
\t\t\tconst anyActive = [...threads.values()].some((candidate) => candidate.subagent === void 0 && candidate.active !== void 0);
\t\t\tif (pending.size === 0 && session.status === "waiting") yield* setSessionStatus(anyActive ? "running" : "ready", null);`;
  if (content.includes(oldForgetRequest) && !content.includes('setSessionStatus(anyActive ? "running" : "ready", null)')) {
    content = content.replace(oldForgetRequest, newForgetRequest);
    changes++;
  }

  // 17. Patch session.compaction.ended in OpenCode2Adapter to clear lock status
  const oldCompEnd = 'case "session.compaction.ended": return yield* emitCompaction(state, turn, "completed", event.data.text);';
  const newCompEnd = `case "session.compaction.ended": {
\t\t\t\t\tyield* emitCompaction(state, turn, "completed", event.data.text);
\t\t\t\t\tconst anyActive = [...threads.values()].some((candidate) => candidate.subagent === void 0 && candidate.active !== void 0);
\t\t\t\t\tif (!anyActive) {
\t\t\t\t\t\tstate.providerThread = { ...state.providerThread, status: "idle", updatedAt: yield* now };
\t\t\t\t\t\tyield* emit({ type: "provider_thread.updated", driver, providerThread: state.providerThread });
\t\t\t\t\t\tyield* setSessionStatus(pending.size > 0 ? "waiting" : "ready", null);
\t\t\t\t\t}
\t\t\t\t\treturn;
\t\t\t\t}`;
  if (content.includes(oldCompEnd) && !content.includes('state.providerThread = { ...state.providerThread, status: "idle"')) {
    content = content.replace(oldCompEnd, newCompEnd);
    changes++;
  }

  // 18. Patch compaction_end in PiAdapterV2 to broadcast updated token count and force settle
  const oldPiCompNull = 'const errorMessage = piRecordString(event, "errorMessage") ?? "Pi context compaction failed.";\n\t\t\t\t\t\t\tyield* emitCompaction(turn, compaction, "failed", { summary: errorMessage.slice(0, 1e3) });\n\t\t\t\t\t\t\tif (turn.settleWhenIdle || !turn.sawAgentActivity) yield* scheduleSettleProbe(turn, turn.settleWhenIdle);\n\t\t\t\t\t\t\treturn;';
  const newPiCompNull = `const rawCompErr = piRecordString(event, "errorMessage");
\t\t\t\t\t\t\tif (rawCompErr === void 0) {
\t\t\t\t\t\t\t\tyield* emitCompaction(turn, compaction, "completed", { summary: "Context is already compact (session is below compaction threshold)." });
\t\t\t\t\t\t\t\tyield* scheduleSettleProbe(turn, true);
\t\t\t\t\t\t\t\treturn;
\t\t\t\t\t\t\t}
\t\t\t\t\t\t\tyield* emitCompaction(turn, compaction, "failed", { summary: rawCompErr.slice(0, 1e3) });
\t\t\t\t\t\t\tyield* scheduleSettleProbe(turn, true);
\t\t\t\t\t\t\treturn;`;
  if (content.includes(oldPiCompNull) && !content.includes('rawCompErr === void 0')) {
    content = content.replace(oldPiCompNull, newPiCompNull);
    changes++;
  }

  const oldPiCompResp = 'if (event["success"] !== false) return;\n\t\t\t\t\t\t\tif (compactTurn === null) return;';
  const newPiCompResp = `if (event["success"] !== false) return;
\t\t\t\t\t\t\tif (compactTurn === null) return;
\t\t\t\t\t\t\tif (/too short to compact/i.test(piRecordString(event, "error") ?? "")) {
\t\t\t\t\t\t\t\tyield* scheduleSettleProbe(compactTurn, true);
\t\t\t\t\t\t\t\treturn;
\t\t\t\t\t\t\t}`;
  if (content.includes(oldPiCompResp) && !content.includes('too short to compact')) {
    content = content.replace(oldPiCompResp, newPiCompResp);
    changes++;
  }

  const oldPiCompEnd = 'yield* emitCompaction(turn, compaction, "completed", {\n\t\t\t\t\t\t\t...summary === void 0 ? {} : { summary },\n\t\t\t\t\t\t\t...beforeTokenCount === void 0 ? {} : { beforeTokenCount },\n\t\t\t\t\t\t\t...afterTokenCount === void 0 ? {} : { afterTokenCount }\n\t\t\t\t\t\t});\n\t\t\t\t\t\tif (turn.settleWhenIdle || !turn.sawAgentActivity) yield* scheduleSettleProbe(turn, turn.settleWhenIdle);';
  const newPiCompEnd = `yield* emitCompaction(turn, compaction, "completed", {
\t\t\t\t\t\t\t...summary === void 0 ? {} : { summary },
\t\t\t\t\t\t\t...beforeTokenCount === void 0 ? {} : { beforeTokenCount },
\t\t\t\t\t\t\t...afterTokenCount === void 0 ? {} : { afterTokenCount }
\t\t\t\t\t\t});
\t\t\t\t\t\tif (afterTokenCount !== void 0 && afterTokenCount > 0) {
\t\t\t\t\t\t\tturn.lastLiveUsedTokens = afterTokenCount;
\t\t\t\t\t\t\tyield* emit({
\t\t\t\t\t\t\t\ttype: "provider_turn.updated",
\t\t\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\t\t\tthreadId: turn.turnInput.threadId,
\t\t\t\t\t\t\t\tproviderTurn: {
\t\t\t\t\t\t\t\t\t...turn.providerTurn,
\t\t\t\t\t\t\t\t\ttokenUsage: {
\t\t\t\t\t\t\t\t\t\tusedTokens: afterTokenCount,
\t\t\t\t\t\t\t\t\t\tmaxTokens: contextWindow ?? 500000,
\t\t\t\t\t\t\t\t\t\tupdatedAt: formatIso(yield* now)
\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t});
\t\t\t\t\t\t}
\t\t\t\t\t\tyield* scheduleSettleProbe(turn, true);`;
  if (content.includes(oldPiCompEnd) && !content.includes('turn.lastLiveUsedTokens = afterTokenCount;')) {
    content = content.replace(oldPiCompEnd, newPiCompEnd);
    changes++;
  }

  return { content, changes };
}

function patchClientAssets(clientAssetsDir) {
  let patchedFiles = 0;
  if (!fs.existsSync(clientAssetsDir)) return patchedFiles;
  const files = fs.readdirSync(clientAssetsDir);
  for (const file of files) {
    const fullPath = path.join(clientAssetsDir, file);
    if (file.startsWith('session-logic-') && file.endsWith('.js')) {
      let c = fs.readFileSync(fullPath, 'utf8');
      const clientRegex = /if\s*\(\s*([a-zA-Z0-9_$]+)\s*\(\s*e\.toolName\s*\)\s*!==\s*`html_render`\s*\)\s*return\s*;/;
      if (clientRegex.test(c) && !c.includes('e.toolName!==`html_render`')) {
        c = c.replace(clientRegex, (_m, fnName) => `let _t=${fnName}(e.toolName);if(_t!==\`html_render\`&&e.toolName!==\`html_render\`&&!e.toolName.endsWith(\`__html_render\`))return;`);
        fs.writeFileSync(fullPath, c, 'utf8');
        cp.execSync(`node --check "${fullPath}"`, { stdio: 'inherit' });
        patchedFiles++;
      }
    }
    if (file.startsWith('ChatGptUsageButton-') && file.endsWith('.js')) {
      let c = fs.readFileSync(fullPath, 'utf8');
      const iconTarget = 'r=k.get(e.driverKind)?.icon';
      const iconReplacement = 'r=/prime/i.test(e.displayName??``)?{viewBox:`0 0 24 24`,fill:{light:`#059669`,dark:`#34d399`},paths:[{d:`M12 2L3 7v10l9 5 9-5V7l-9-5zm0 2.3L18.9 8 12 11.7 5.1 8 12 4.3zM5 9.8l6 3.3v6.6l-6-3.3V9.8zm8 9.9v-6.6l6-3.3v6.6l-6 3.3z`}]}:k.get(e.driverKind)?.icon';
      if (c.includes(iconTarget) && !c.includes('M12 2L3 7v10l9 5')) {
        c = c.replace(iconTarget, iconReplacement);
        fs.writeFileSync(fullPath, c, 'utf8');
        cp.execSync(`node --check "${fullPath}"`, { stdio: 'inherit' });
        patchedFiles++;
      }
    }
  }
  return patchedFiles;
}

function patchPythonRlmFile(pyPath) {
  if (!fs.existsSync(pyPath)) return false;
  let py = fs.readFileSync(pyPath, 'utf8');
  if (py.includes('# __T3_PRIME_HTML_BRIDGE__') && py.includes('_t3_wrapped_host_request')) return false;
  if (py.includes('# __T3_PRIME_HTML_BRIDGE__')) {
    py = py.slice(0, py.indexOf('# __T3_PRIME_HTML_BRIDGE__')).trimEnd();
  }
  py = py.trimEnd() + '\n' + PYTHON_RLM_HTML_SOURCE;
  if (py.includes('__all__ = [') && !py.includes('"html_render",')) {
    py = py.replace('__all__ = [', '__all__ = [\n    "html_render",\n    "html_preview",');
  }
  fs.writeFileSync(pyPath, py, 'utf8');
  if (fs.existsSync(kernelPython)) {
    cp.execFileSync(kernelPython, ['-m', 'py_compile', pyPath], { stdio: 'inherit' });
  }
  return true;
}

function patchUserSettings(settingsFile) {
  if (!fs.existsSync(settingsFile)) return false;
  const raw = fs.readFileSync(settingsFile, 'utf8');
  const parsed = JSON.parse(raw);
  parsed.providerInstances = parsed.providerInstances ?? {};
  if (parsed.providerInstances.pi) {
    parsed.providerInstances.pi.enabled = true;
  }
  const existingPrime = parsed.providerInstances.primeAgent;
  const defaultPrimeExe = path.join(os.homedir(), '.local', 'share', 'prime-agent', 'prime-agent.exe');
  const targetPrime = {
    driver: 'pi',
    displayName: 'Prime Agent',
    accentColor: '#10b981',
    enabled: true,
    config: {
      binaryPath: existingPrime?.config?.binaryPath || defaultPrimeExe,
      ...(existingPrime?.config?.launchArgs !== undefined ? { launchArgs: existingPrime.config.launchArgs } : {}),
      customModels: existingPrime?.config?.customModels ?? [
        'openai/gpt-5.4',
        'anthropic/claude-sonnet-4.6',
        'google/gemini-2.5-pro',
      ],
    },
  };
  parsed.providerInstances.primeAgent = targetPrime;
  const nextRaw = JSON.stringify(parsed, null, 2);
  if (nextRaw.trim() === raw.trim()) return false;
  fs.writeFileSync(settingsFile, nextRaw + '\n', 'utf8');
  return true;
}

function checkT3CodeRunning() {
  let isRunning = false;
  let pids = [];
  try {
    const tasklist = cp.execSync('tasklist /FO CSV /NH', { encoding: 'utf8' });
    for (const line of tasklist.split('\n')) {
      if (/t3 code/i.test(line)) {
        const parts = line.split(',');
        if (parts.length >= 2) {
          const pid = parseInt(parts[1].replace(/"/g, ''), 10);
          if (pid) pids.push(pid);
        }
        isRunning = true;
      }
    }
  } catch (_e) {}

  let portListening = false;
  try {
    const netstat = cp.execSync('netstat -ano', { encoding: 'utf8' });
    if (/[:\.]3773\s+.*LISTENING/i.test(netstat)) {
      portListening = true;
      isRunning = true;
    }
  } catch (_e) {}

  return { isRunning, portListening, pids };
}

async function runPatch() {
  if (!fs.existsSync(originalAsar)) {
    throw new Error('server.asar not found at: ' + originalAsar);
  }
  if (!fs.existsSync(backupAsar)) {
    fs.copyFileSync(originalAsar, backupAsar);
    console.log('Created initial backup at:', backupAsar);
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 't3-patch-auto-'));
  try {
    asar.extractAll(originalAsar, tempDir);
    const distDir = path.join(tempDir, 'apps', 'server', 'dist');
    const binCliFiles = fs.readdirSync(distDir).filter((f) => f.startsWith('binCli-') && f.endsWith('.mjs'));
    let totalChanges = 0;
    for (const binCli of binCliFiles) {
      const p = path.join(distDir, binCli);
      const raw = fs.readFileSync(p, 'utf8');
      if (!raw.includes(BRIDGE_MARKER)) {
        fs.copyFileSync(originalAsar, backupAsar);
        console.log('Refreshed unpatched backup at:', backupAsar);
      }
      const { content, changes } = patchBinCliContent(raw);
      totalChanges += changes;
      if (changes > 0) {
        fs.writeFileSync(p, content, 'utf8');
      }
      cp.execSync(`node --check "${p}"`, { stdio: 'inherit' });
      console.log(`Verified ${binCli} (applied ${changes} patch group(s))`);
      if (fs.existsSync(inspectDir)) {
        const inspectBin = path.join(inspectDir, 'apps', 'server', 'dist', binCli);
        if (fs.existsSync(path.dirname(inspectBin))) fs.writeFileSync(inspectBin, content, 'utf8');
      }
    }
    const clientAssetsDir = path.join(distDir, 'client', 'assets');
    const clientPatched = patchClientAssets(clientAssetsDir);
    if (fs.existsSync(inspectDir)) {
      patchClientAssets(path.join(inspectDir, 'apps', 'server', 'dist', 'client', 'assets'));
    }
    console.log(`Patched ${clientPatched} client asset file(s)`);

    const runningStatus = checkT3CodeRunning();
    const shouldRestartApp = process.argv.includes('--restart-app') || process.argv.includes('-RestartApp');

    if (totalChanges === 0 && clientPatched === 0) {
      console.log('Live server.asar is already fully patched (idempotent no-op).');
    } else {
      const newAsar = path.join(os.tmpdir(), `new-server-${Date.now()}.asar`);
      const unpackPattern = '{**/@ff-labs/**/*.{dll,node},**/@napi-rs/**/*.node,**/@yuuang/**/*.node,**/node-pty/build/**/*.{node,dll,exe},**/node-pty/prebuilds/win32-x64/**/*.{node,dll,exe},**/node-pty/third_party/**/*.{node,dll,exe}}';
      if (typeof asar.createPackageWithOptions === 'function') {
        await asar.createPackageWithOptions(tempDir, newAsar, { unpack: unpackPattern });
      } else {
        await asar.createPackage(tempDir, newAsar, { unpack: unpackPattern });
      }
      const newUnpacked = newAsar + '.unpacked';
      const originalUnpacked = originalAsar + '.unpacked';
      const stagedAsar = path.join(__dirname, 'server.patched.asar');
      const stagedUnpacked = path.join(__dirname, 'server.patched.asar.unpacked');

      try {
        if (runningStatus.isRunning && !shouldRestartApp) {
          fs.copyFileSync(newAsar, stagedAsar);
          if (fs.existsSync(newUnpacked)) {
            fs.cpSync(newUnpacked, stagedUnpacked, { recursive: true, force: true });
          }
          console.warn(`CAUTION: T3 Code is currently running (PID on port 3773). Overwriting server.asar while running corrupts archive offsets and breaks UI rendering. Wrote patched package to ${stagedAsar}. Close T3 Code or pass --restart-app (or sync-patches.ps1 -RestartApp) to apply automatically.`);
        } else {
          if (runningStatus.isRunning && shouldRestartApp) {
            console.log('T3 Code is running. Gracefully stopping processes for safe replacement...');
            try {
              cp.execSync('taskkill /F /IM "T3 Code (Nightly).exe" /IM "T3 Code.exe"', { stdio: 'ignore' });
            } catch (_e) {}
            for (let i = 0; i < 20; i++) {
              const check = checkT3CodeRunning();
              if (!check.isRunning && !check.portListening) break;
              await new Promise((r) => setTimeout(r, 250));
            }
          }
          fs.copyFileSync(newAsar, originalAsar);
          if (fs.existsSync(newUnpacked)) {
            fs.cpSync(newUnpacked, originalUnpacked, { recursive: true, force: true });
          }
          console.log('Updated live server.asar and server.asar.unpacked successfully.');
          if (fs.existsSync(stagedAsar)) fs.unlinkSync(stagedAsar);
          if (fs.existsSync(stagedUnpacked)) fs.rmSync(stagedUnpacked, { recursive: true, force: true });

          if (runningStatus.isRunning && shouldRestartApp) {
            const t3Dir = path.dirname(path.dirname(originalAsar));
            const candidateExes = [
              path.join(t3Dir, 'T3 Code (Nightly).exe'),
              path.join(t3Dir, 'T3 Code.exe'),
              path.join(t3Dir, 't3code.exe'),
            ];
            const t3Exe = candidateExes.find((exe) => fs.existsSync(exe));
            if (t3Exe) {
              console.log(`Relaunching T3 Code: ${t3Exe}`);
              const child = cp.spawn(t3Exe, [], { detached: true, stdio: 'ignore' });
              child.unref();
            }
          }
        }
      } finally {
        if (fs.existsSync(newAsar)) fs.unlinkSync(newAsar);
        if (fs.existsSync(newUnpacked)) fs.rmSync(newUnpacked, { recursive: true, force: true });
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const pySrcChanged = patchPythonRlmFile(rlmSourceInit);
  const pyVenvChanged = patchPythonRlmFile(rlmVenvInit);
  console.log(`Python rlm.__init__ patched (src=${pySrcChanged}, venv=${pyVenvChanged})`);

  const settingsChanged = patchUserSettings(t3SettingsPath);
  console.log(`T3 user settings.json updated=${settingsChanged}`);

  const primeCachePath = path.join(os.homedir(), '.t3', 'caches', 'primeAgent.json');
  if (fs.existsSync(primeCachePath)) {
    try {
      const cacheObj = JSON.parse(fs.readFileSync(primeCachePath, 'utf8'));
      delete cacheObj.compatibilityAdvisory;
      if (cacheObj.versionAdvisory) {
        cacheObj.versionAdvisory.status = 'current';
        cacheObj.versionAdvisory.message = null;
        cacheObj.versionAdvisory.updateCommand = null;
        cacheObj.versionAdvisory.canUpdate = false;
      }
      fs.writeFileSync(primeCachePath, JSON.stringify(cacheObj, null, 2) + '\n', 'utf8');
      console.log('Cleaned cached Prime Agent advisory in ~/.t3/caches/primeAgent.json');
    } catch (_err) {
      // ignore
    }
  }
}

if (require.main === module) {
  runPatch().catch((err) => {
    console.error('Failed to apply patch:', err);
    process.exit(1);
  });
}

module.exports = {
  checkT3CodeRunning,
  loadAsarModule,
  patchBinCliContent,
  patchClientAssets,
  patchPythonRlmFile,
  patchUserSettings,
  runPatch,
};
