const asar = require('C:/Users/Ak417ytrfg/AppData/Local/npm-cache/_npx/8b3f11f22d4db0c9/node_modules/asar');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const originalAsar = 'C:/Users/Ak417ytrfg/AppData/Local/Programs/t3code/resources/server.asar';
const backupAsar = 'C:/Users/Ak417ytrfg/AppData/Local/Programs/t3code/resources/server.asar.bak';

(async () => {
  try {
    if (!fs.existsSync(originalAsar)) {
      console.error('server.asar not found at:', originalAsar);
      process.exit(1);
    }
    console.log('1. Extracting server.asar to tempDir...');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 't3-patch-auto-'));
    asar.extractAll(originalAsar, tempDir);

    // 1. Patch binCli in apps/server/dist
    const distDir = path.join(tempDir, 'apps', 'server', 'dist');
    const binCliFiles = fs.readdirSync(distDir).filter(f => f.startsWith('binCli-') && f.endsWith('.mjs'));
    for (const binCli of binCliFiles) {
      const p = path.join(distDir, binCli);
      let content = fs.readFileSync(p, 'utf8');

      // 1.1 Intercept xd:// writes
      const targetPattern = 'if (toolName === "edit" || toolName === "write") {';
      if (content.includes(targetPattern) && !content.includes('const piIsXd =')) {
        const replacement = `if (toolName === "edit" || toolName === "write") {
\t\t\t\t\tconst piCheckPath = piRecordString(args, "path") ?? piRecordString(args, "file_path") ?? "";
\t\t\t\t\tconst piIsXd = typeof piCheckPath === "string" && piCheckPath.startsWith("xd://");
\t\t\t\t\tif (piIsXd && toolName === "write") {
\t\t\t\t\t\tconst piMatch = /^xd:\\/\\/(?:mcp__(?<server>[^\\/]+)__(?<tool>.+)|(?<rawTool>[^\\/]+))$/i.exec(piCheckPath);
\t\t\t\t\t\tconst piResolvedName = piMatch?.groups?.rawTool ?? (piMatch?.groups?.server && piMatch?.groups?.tool ? \`\${piMatch.groups.server}.\${piMatch.groups.tool}\` : piCheckPath.replace("xd://", ""));
\t\t\t\t\t\tconst piEffectiveName = (piMatch?.groups?.tool ?? piResolvedName).replace(/^[a-z0-9_-]+[.:]/i, "");
\t\t\t\t\t\tlet piParsedInput = {};
\t\t\t\t\t\ttry { const piRaw = piRecordString(args, "content"); if (piRaw) piParsedInput = JSON.parse(piRaw); } catch {}
\t\t\t\t\t\tyield* emit({
\t\t\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\t\tturnItem: {
\t\t\t\t\t\t\t\t...shared,
\t\t\t\t\t\t\t\ttitle: piCheckPath.replace("xd://", ""),
\t\t\t\t\t\t\t\ttype: "dynamic_tool",
\t\t\t\t\t\t\t\t...mcpToolPresentation$1({ toolName: piEffectiveName }),
\t\t\t\t\t\t\t\ttoolName: piCheckPath.replace("xd://", ""),
\t\t\t\t\t\t\t\tinput: piParsedInput,
								...(typeof piToolOutput === "function" ? (() => { const _o = piToolOutput(resultRecord, piEffectiveName); return _o === undefined ? {} : { output: _o }; })() : (outputText.length > 0 ? { output: outputText } : {}))
\t\t\t\t\t\t\t}
\t\t\t\t\t\t});
\t\t\t\t\t\treturn;
\t\t\t\t\t}`;
        content = content.replace(targetPattern, replacement);
        console.log('2. Patched PiAdapterV2 xd:// interceptor in', binCli);
      }

      // 1.2 Backend htmlRender
      const oldCheck = 'if (resolveT3McpToolId(item.toolName) !== "html_render") return void 0;';
      if (content.includes(oldCheck)) {
        content = content.replace(oldCheck, 'const _tId = resolveT3McpToolId(item.toolName); if (_tId !== "html_render" && item.toolName !== "html_render" && !item.toolName.endsWith("__html_render")) return void 0;');
        console.log('3. Patched htmlRenderFromToolItem in', binCli);
      }

      // 1.3 Subagent/task call trigger
      const oldSubCall = 'if (toolName === "subagent") yield* emitSubagentTasks(turn, toolCallId, resultRecord, completed);';
      const newSubCall = 'if (toolName === "subagent" || toolName === "task" || toolName === "wait") yield* emitSubagentTasks(turn, toolCallId, resultRecord, completed, args, toolName);';
      if (content.includes(oldSubCall)) {
        content = content.replace(oldSubCall, newSubCall);
        console.log('4. Patched subagent/task dispatch call in', binCli);
      }

      // 1.4 Enhanced emitSubagentTasks function
      const subDefPrefix = 'const emitSubagentTasks = fnUntraced(';
      const startIdx = content.indexOf(subDefPrefix);
      if (startIdx !== -1 && !content.includes('currentToolName === "task"')) {
        const callStart = content.indexOf('(', startIdx);
        let depth = 0;
        let endIdx = -1;
        for (let i = callStart; i < content.length; i++) {
          if (content[i] === '(' || content[i] === '{') depth++;
          else if (content[i] === ')' || content[i] === '}') {
            depth--;
            if (depth === 0) {
              endIdx = i;
              break;
            }
          }
        }
        if (content[endIdx + 1] === ';') endIdx++;

        const newSubDef = `const emitSubagentTasks = fnUntraced(function* (turn, toolCallId, resultRecord, completed, args, currentToolName) {
\t\t\t\tconst details = piRecordField(resultRecord, "details");
\t\t\t\tlet items = [];
\t\t\t\tturn.subagentPrompts = turn.subagentPrompts ?? new Map();

\t\t\t\tconst rawResults = piRecordField(details, "results");
\t\t\t\tif (Array.isArray(rawResults) && rawResults.length > 0 && (piRecordField(rawResults[0], "agent") || piRecordField(rawResults[0], "task"))) {
\t\t\t\t\tfor (const [index, result] of rawResults.entries()) {
\t\t\t\t\t\tconst agent = piRecordString(result, "agent") ?? "subagent";
\t\t\t\t\t\tconst task = piRecordString(result, "task") ?? "";
\t\t\t\t\t\tconst subName = piRecordString(result, "id") ?? piRecordString(result, "name") ?? (toolCallId + ":" + index);
\t\t\t\t\t\tconst nativeTaskId = "subagent:" + subName;
\t\t\t\t\t\tif (task) turn.subagentPrompts.set(nativeTaskId, task);
\t\t\t\t\t\tconst finished = completed || piRecordField(result, "finished") === true;
\t\t\t\t\t\tconst stopReason = piRecordString(result, "stopReason");
\t\t\t\t\t\tconst interrupted = finished && stopReason === "aborted";
\t\t\t\t\t\tconst failed = finished && !interrupted && ((piRecordNumber(result, "exitCode") ?? 0) !== 0 || stopReason === "error");
\t\t\t\t\t\tconst status = interrupted ? "interrupted" : failed ? "failed" : finished ? "completed" : "running";
\t\t\t\t\t\tconst outputText = piSubagentOutput(result);
\t\t\t\t\t\titems.push({
\t\t\t\t\t\t\tnativeTaskId,
\t\t\t\t\t\t\tagent,
\t\t\t\t\t\t\ttask: task || turn.subagentPrompts.get(nativeTaskId) || agent,
\t\t\t\t\t\t\tmodel: piRecordString(result, "model") ?? null,
\t\t\t\t\t\t\tstatus,
\t\t\t\t\t\t\tfinished,
\t\t\t\t\t\t\toutputText
\t\t\t\t\t\t});
\t\t\t\t\t}
\t\t\t\t} else if (currentToolName === "task") {
\t\t\t\t\tconst rawProgress = piRecordField(details, "progress");
\t\t\t\t\tconst progressList = Array.isArray(rawProgress) ? rawProgress : [];
\t\t\t\t\tconst rawTasks = piRecordField(args, "tasks");
\t\t\t\t\tconst tasksArgs = Array.isArray(rawTasks) ? rawTasks : [];
\t\t\t\t\tconst maxLen = Math.max(progressList.length, tasksArgs.length);
\t\t\t\t\tfor (let index = 0; index < maxLen; index++) {
\t\t\t\t\t\tconst p = progressList[index] ?? {};
\t\t\t\t\t\tconst a = tasksArgs[index] ?? {};
\t\t\t\t\t\tconst subName = piRecordString(p, "id") ?? piRecordString(a, "name") ?? piRecordString(p, "agent") ?? piRecordString(a, "agent") ?? (toolCallId + ":" + index);
\t\t\t\t\t\tconst nativeTaskId = "subagent:" + subName;
\t\t\t\t\t\tconst agent = piRecordString(p, "agent") ?? piRecordString(a, "agent") ?? subName;
\t\t\t\t\t\tconst task = piRecordString(p, "assignment") ?? piRecordString(p, "task") ?? piRecordString(a, "task") ?? "";
\t\t\t\t\t\tif (task) turn.subagentPrompts.set(nativeTaskId, task);
\t\t\t\t\t\tconst statusRaw = piRecordString(p, "status") ?? (completed ? "completed" : "running");
\t\t\t\t\t\tconst status = statusRaw === "completed" ? "completed" : statusRaw === "failed" ? "failed" : statusRaw === "interrupted" ? "interrupted" : "running";
\t\t\t\t\t\tconst finished = status === "completed" || status === "failed" || status === "interrupted";
\t\t\t\t\t\tconst model = piRecordString(p, "resolvedModel") ?? piRecordString(p, "modelRole") ?? null;
\t\t\t\t\t\titems.push({
\t\t\t\t\t\t\tnativeTaskId,
\t\t\t\t\t\t\tagent: piRecordString(p, "id") ?? piRecordString(a, "name") ?? agent,
\t\t\t\t\t\t\ttask: task || turn.subagentPrompts.get(nativeTaskId) || agent,
\t\t\t\t\t\t\tmodel,
\t\t\t\t\t\t\tstatus,
\t\t\t\t\t\t\tfinished,
\t\t\t\t\t\t\toutputText: ""
\t\t\t\t\t\t});
\t\t\t\t\t}
\t\t\t\t} else if (currentToolName === "wait") {
\t\t\t\t\tconst rawJobs = piRecordField(details, "jobs");
\t\t\t\t\tif (Array.isArray(rawJobs)) {
\t\t\t\t\t\tfor (const [index, job] of rawJobs.entries()) {
\t\t\t\t\t\t\tconst subName = piRecordString(job, "id") ?? piRecordString(job, "label") ?? ("job-" + index);
\t\t\t\t\t\t\tconst nativeTaskId = "subagent:" + subName;
\t\t\t\t\t\t\tconst statusRaw = piRecordString(job, "status");
\t\t\t\t\t\t\tconst finished = statusRaw === "completed" || statusRaw === "failed" || statusRaw === "cancelled" || statusRaw === "aborted";
\t\t\t\t\t\t\tconst status = statusRaw === "completed" ? "completed" : statusRaw === "failed" ? "failed" : (statusRaw === "cancelled" || statusRaw === "aborted") ? "interrupted" : "running";
\t\t\t\t\t\t\tconst model = piRecordString(job, "resolvedModel") ?? piRecordString(job, "resolvedModelIdentity") ?? null;
\t\t\t\t\t\t\tconst outputText = piRecordString(job, "resultText") ?? "";
\t\t\t\t\t\t\titems.push({
\t\t\t\t\t\t\t\tnativeTaskId,
\t\t\t\t\t\t\t\tagent: subName,
\t\t\t\t\t\t\t\ttask: turn.subagentPrompts.get(nativeTaskId) || subName,
\t\t\t\t\t\t\t\tmodel,
\t\t\t\t\t\t\t\tstatus,
\t\t\t\t\t\t\t\tfinished,
\t\t\t\t\t\t\t\toutputText
\t\t\t\t\t\t\t});
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t}

\t\t\t\tif (items.length === 0) return;
\t\t\t\tconst emittedAt = yield* now;
\t\t\t\tconst parentNodeId = idAllocator.derive.nodeFromProviderItem({
\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\tnativeItemId: toolCallId
\t\t\t\t});

\t\t\t\tfor (const item of items) {
\t\t\t\t\tconst subagentId = idAllocator.derive.nodeFromProviderItem({
\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\tnativeItemId: item.nativeTaskId
\t\t\t\t\t});
\t\t\t\t\tconst startedAt = turn.toolStartedAt.get(item.nativeTaskId) ?? emittedAt;
\t\t\t\t\tturn.toolStartedAt.set(item.nativeTaskId, startedAt);
\t\t\t\t\tconst progress = !item.finished && item.outputText.length > 0 ? { progress: item.outputText.slice(0, 200) } : {};
\t\t\t\t\tconst resultText = item.finished && item.outputText.length > 0 ? item.outputText.slice(0, 1e4) : null;

\t\t\t\t\tyield* emit({
\t\t\t\t\t\ttype: "subagent.updated",
\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\tsubagent: {
\t\t\t\t\t\t\tid: subagentId,
\t\t\t\t\t\t\tthreadId: turn.turnInput.threadId,
\t\t\t\t\t\t\trunId: turn.turnInput.runId,
\t\t\t\t\t\t\tparentNodeId,
\t\t\t\t\t\t\torigin: "provider_native",
\t\t\t\t\t\t\tcreatedBy: "agent",
\t\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\t\tproviderInstanceId: options.instanceId,
\t\t\t\t\t\t\tproviderThreadId: turn.turnInput.providerThread.id,
\t\t\t\t\t\t\tchildThreadId: null,
\t\t\t\t\t\t\tnativeTaskRef: providerRef(item.nativeTaskId),
\t\t\t\t\t\t\tprompt: item.task,
\t\t\t\t\t\t\ttitle: item.agent,
\t\t\t\t\t\t\tmodel: item.model,
\t\t\t\t\t\t\tstatus: item.status,
\t\t\t\t\t\t\t...progress,
\t\t\t\t\t\t\tresult: resultText,
\t\t\t\t\t\t\tstartedAt,
\t\t\t\t\t\t\tcompletedAt: item.finished ? emittedAt : null,
\t\t\t\t\t\t\tupdatedAt: emittedAt
\t\t\t\t\t\t}
\t\t\t\t\t});
\t\t\t\t\tyield* emit({
\t\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\tturnItem: {
\t\t\t\t\t\t\t...baseItemFields(turn, item.nativeTaskId, startedAt, emittedAt),
\t\t\t\t\t\t\tstatus: item.status,
\t\t\t\t\t\t\ttitle: item.agent,
\t\t\t\t\t\t\tcompletedAt: item.finished ? emittedAt : null,
\t\t\t\t\t\t\ttype: "subagent",
\t\t\t\t\t\t\tsubagentId,
\t\t\t\t\t\t\torigin: "provider_native",
\t\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\t\tproviderInstanceId: options.instanceId,
\t\t\t\t\t\t\tchildThreadId: null,
\t\t\t\t\t\t\tprompt: item.task,
\t\t\t\t\t\t\t...progress,
\t\t\t\t\t\t\tresult: resultText
\t\t\t\t\t\t}
\t\t\t\t\t});
\t\t\t\t}
\t\t\t});`;

        content = content.slice(0, startIdx) + newSubDef + content.slice(endIdx + 1);
        console.log('5. Patched emitSubagentTasks definition in', binCli);
      }

      fs.writeFileSync(p, content, 'utf8');

      // Syntax verification
      cp.execSync('node --check "' + p + '"', { stdio: 'inherit' });
    }

    // 2. Patch client bundle
    const clientAssetsDir = path.join(tempDir, 'apps', 'server', 'dist', 'client', 'assets');
    if (fs.existsSync(clientAssetsDir)) {
      const clientFiles = fs.readdirSync(clientAssetsDir).filter(f => f.startsWith('session-logic-') && f.endsWith('.js'));
      for (const clientFile of clientFiles) {
        const cpFile = path.join(clientAssetsDir, clientFile);
        let clientContent = fs.readFileSync(cpFile, 'utf8');
        const clientRegex = /if\s*\(\s*([a-zA-Z0-9_$]+)\s*\(\s*e\.toolName\s*\)\s*!==\s*`html_render`\s*\)\s*return\s*;/;
        if (clientRegex.test(clientContent)) {
          clientContent = clientContent.replace(clientRegex, (match, fnName) => {
            return `let _t=${fnName}(e.toolName);if(_t!==\`html_render\`&&e.toolName!==\`html_render\`&&!e.toolName.endsWith(\`__html_render\`))return;`;
          });
          fs.writeFileSync(cpFile, clientContent, 'utf8');
          console.log('6. Patched htmlRender in client bundle', clientFile);
        }
      }
    }

    console.log('7. Packing new server.asar...');
    const newAsar = path.join(os.tmpdir(), 'new-server.asar');
    await asar.createPackage(tempDir, newAsar);

    console.log('8. Creating backup of current server.asar...');
    fs.copyFileSync(originalAsar, backupAsar);

    console.log('9. Overwriting server.asar...');
    fs.copyFileSync(newAsar, originalAsar);
    fs.unlinkSync(newAsar);
    fs.rmSync(tempDir, { recursive: true, force: true });

    console.log('ALL PATCHES APPLIED SUCCESSFULLY!');
  } catch (err) {
    console.error('Failed to apply patch:', err);
    process.exit(1);
  }
})();
