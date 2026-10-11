'use strict';

const asar = require('C:/Users/Ak417ytrfg/AppData/Local/npm-cache/_npx/8b3f11f22d4db0c9/node_modules/asar');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
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

const originalAsar = 'C:/Users/Ak417ytrfg/AppData/Local/Programs/t3code/resources/server.asar';
const backupAsar = 'C:/Users/Ak417ytrfg/AppData/Local/Programs/t3code/resources/server.asar.bak';
const inspectDir = 'C:/Users/Ak417ytrfg/AppData/Local/Temp/opencode/t3-inspect';
const t3SettingsPath = path.join(os.homedir(), '.t3', 'userdata', 'settings.json');
const rlmSourceInit = path.join(os.homedir(), '.local', 'share', 'prime-agent', 'prime-agent-runtime', 'src', 'rlm', '__init__.py');
const rlmVenvInit = path.join(os.homedir(), '.prime', 'agent', 'kernel-venv', 'Lib', 'site-packages', 'rlm', '__init__.py');

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

  // 1. Inject self-contained bridge helper block once before buildPiRpcLaunch
  if (!content.includes(BRIDGE_MARKER)) {
    const anchor = 'function buildPiRpcLaunch(input) {';
    if (content.includes(anchor)) {
      content = content.replace(anchor, `${BIN_CLI_BRIDGE_SOURCE}\n${anchor}`);
      changes++;
    }
  }

  // 2. Patch validateLocalExecutable to allow prime-agent.cmd / pa.cmd shims on Windows
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

  // 3. Patch buildPiRpcLaunch + callers to filter unsupported flags for prime-agent
  const oldLaunchReturn = 'return {\n\t\targs,';
  const newLaunchReturn = 'const finalArgs = filterPrimeAgentLaunchArgs(args, isPrimeAgentBinary(input.binaryPath));\n\treturn {\n\t\targs: finalArgs,';
  if (content.includes(oldLaunchReturn) && !content.includes('filterPrimeAgentLaunchArgs(args,')) {
    content = content.replace(oldLaunchReturn, newLaunchReturn);
    changes++;
  }
  content = content.replace(
    /buildPiRpcLaunch\(\{\s*launchArgs: resolvedLaunchArgs\.args,\s*environment: options\.environment,/g,
    'buildPiRpcLaunch({\n\t\t\t\tbinaryPath: options.settings.binaryPath,\n\t\t\t\tlaunchArgs: resolvedLaunchArgs.args,\n\t\t\t\tenvironment: options.environment,'
  );
  content = content.replace(
    /buildPiRpcLaunch\(\{\s*launchArgs,\s*environment,\s*mcpSession: void 0,/g,
    'buildPiRpcLaunch({\n\t\tbinaryPath: piSettings.binaryPath,\n\t\tlaunchArgs,\n\t\tenvironment,\n\t\tmcpSession: void 0,'
  );
  content = content.replace(
    /buildPiRpcLaunch\(\{\s*launchArgs: resolvedLaunchArgs\.args,\s*environment,\s*mcpSession: void 0,/g,
    'buildPiRpcLaunch({\n\t\t\t\tbinaryPath: piSettings.binaryPath,\n\t\t\t\tlaunchArgs: resolvedLaunchArgs.args,\n\t\t\t\tenvironment,\n\t\t\t\tmcpSession: void 0,'
  );

  // 4. Patch PiProviderCapabilitiesV2 & PI_PRESENTATION
  const oldPlanningCaps = 'planning: {\n\t\temitsPlanUpdated: false,\n\t\temitsTodoList: false,\n\t\temitsProposedPlan: false,\n\t\tsupportsStructuredQuestions: true,\n\t\tplanDeltasHaveItemIds: false\n\t},';
  const newPlanningCaps = 'supportsSkillInvocation: true,\n\tsupportsPlanMode: true,\n\tsupportsSessionFork: true,\n\tsupportsUsageReporting: true,\n\tsupportsImageAttachments: true,\n\tplanning: {\n\t\temitsPlanUpdated: true,\n\t\temitsTodoList: true,\n\t\temitsProposedPlan: true,\n\t\tsupportsStructuredQuestions: true,\n\t\tplanDeltasHaveItemIds: true\n\t},';
  if (content.includes(oldPlanningCaps)) {
    content = content.replace(oldPlanningCaps, newPlanningCaps);
    changes++;
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
  if (!content.includes('unpackPrimeIpythonCell(toolCallId,')) {
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

  // 7. Patch handleSessionEvent for Prime Agent RPC events (agent_end, goal_update, rlm_child_update) and pendingWake
  const oldPendingWakeSettled = 'if (event["type"] === "agent_settled") yield* updateProviderSession("ready", null);';
  const newPendingWakeSettled = 'if (event["type"] === "agent_settled" || event["type"] === "agent_end") yield* updateProviderSession("ready", null);';
  if (content.includes(oldPendingWakeSettled)) {
    content = content.replace(oldPendingWakeSettled, newPendingWakeSettled);
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

  // 9. Patch listSessionEntries to fall back to get_fork_messages for Prime Agent RPC
  const listEntriesAnchor = 'const listSessionEntries = (since, timeoutMs) =>';
  if (content.includes(listEntriesAnchor) && !content.includes('get_fork_messages')) {
    const listEntriesRe = /const listSessionEntries = \(since, timeoutMs\) => request\(\{[\s\S]*?\}\), orElseSucceed\(\(\) => null\)\);/;
    if (listEntriesRe.test(content)) {
      content = content.replace(
        listEntriesRe,
        `const listSessionEntries = (since, timeoutMs) => gen$1(function* () {\n\t\t\t\tconst primary = yield* request({\n\t\t\t\t\ttype: "get_entries",\n\t\t\t\t\t...since === null ? {} : { since }\n\t\t\t\t}, timeoutMs).pipe(map$11((data) => {\n\t\t\t\t\tconst leafId = piRecordField(data, "leafId");\n\t\t\t\t\tconst entries = piSessionEntries(piRecordField(data, "entries"));\n\t\t\t\t\treturn entries !== null && (typeof leafId === "string" || leafId === null) ? { entries, leafId } : null;\n\t\t\t\t}), orElseSucceed(() => null));\n\t\t\t\tif (primary !== null) return primary;\n\t\t\t\treturn yield* request({ type: "get_fork_messages" }, timeoutMs).pipe(map$11((data) => {\n\t\t\t\t\tconst msgs = piRecordField(data, "messages");\n\t\t\t\t\tif (!Array.isArray(msgs)) return null;\n\t\t\t\t\tconst rawEntries = msgs.map((m, idx) => ({\n\t\t\t\t\t\tid: String(m?.entryId ?? \`fork-\${idx}\`),\n\t\t\t\t\t\tparentId: idx > 0 ? String(msgs[idx - 1]?.entryId ?? \`fork-\${idx - 1}\`) : null,\n\t\t\t\t\t\ttype: "message",\n\t\t\t\t\t\trole: "user"\n\t\t\t\t\t}));\n\t\t\t\t\tconst entries = piSessionEntries(rawEntries);\n\t\t\t\t\tconst leafId = rawEntries.length > 0 ? rawEntries[rawEntries.length - 1].id : null;\n\t\t\t\t\treturn entries !== null ? { entries, leafId } : null;\n\t\t\t\t}), orElseSucceed(() => null));\n\t\t\t});`
      );
      changes++;
    }
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
        patchedFiles++;
      }
    }
  }
  return patchedFiles;
}

function patchPythonRlmFile(pyPath) {
  if (!fs.existsSync(pyPath)) return false;
  let py = fs.readFileSync(pyPath, 'utf8');
  if (py.includes('# __T3_PRIME_HTML_BRIDGE__')) return false;
  py = py.trimEnd() + '\n' + PYTHON_RLM_HTML_SOURCE;
  if (py.includes('__all__ = [')) {
    py = py.replace('__all__ = [', '__all__ = [\n    "html_render",\n    "html_preview",');
  }
  fs.writeFileSync(pyPath, py, 'utf8');
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
  const targetPrime = {
    driver: 'pi',
    displayName: 'Prime Agent',
    accentColor: '#10b981',
    enabled: true,
    config: {
      binaryPath: 'C:\\Users\\Ak417ytrfg\\.local\\share\\prime-agent\\prime-agent.exe',
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
    for (const binCli of binCliFiles) {
      const p = path.join(distDir, binCli);
      const raw = fs.readFileSync(p, 'utf8');
      const { content, changes } = patchBinCliContent(raw);
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

    const newAsar = path.join(os.tmpdir(), `new-server-${Date.now()}.asar`);
    await asar.createPackage(tempDir, newAsar);
    try {
      fs.copyFileSync(newAsar, originalAsar);
      console.log('Updated live server.asar successfully.');
    } catch (copyErr) {
      const stagedAsar = path.join(__dirname, 'server.patched.asar');
      fs.copyFileSync(newAsar, stagedAsar);
      console.warn(`Live server.asar is locked by running T3 Code (${copyErr.code}); wrote staged package to ${stagedAsar}`);
    } finally {
      if (fs.existsSync(newAsar)) fs.unlinkSync(newAsar);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const pySrcChanged = patchPythonRlmFile(rlmSourceInit);
  const pyVenvChanged = patchPythonRlmFile(rlmVenvInit);
  console.log(`Python rlm.__init__ patched (src=${pySrcChanged}, venv=${pyVenvChanged})`);

  const settingsChanged = patchUserSettings(t3SettingsPath);
  console.log(`T3 user settings.json updated=${settingsChanged}`);
}

if (require.main === module) {
  runPatch().catch((err) => {
    console.error('Failed to apply patch:', err);
    process.exit(1);
  });
}

module.exports = {
  patchBinCliContent,
  patchClientAssets,
  patchPythonRlmFile,
  patchUserSettings,
  runPatch,
};
