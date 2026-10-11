'use strict';

const BRIDGE_MARKER = '/* __T3_PRIME_PI_PARITY_BRIDGE__ */';

const BIN_CLI_BRIDGE_SOURCE = `${BRIDGE_MARKER}
const PRIME_AGENT_DEFAULT_EXE = "C:\\\\Users\\\\Ak417ytrfg\\\\.local\\\\share\\\\prime-agent\\\\prime-agent.exe";
const _bridgeFs = typeof NFS === "object" && NFS !== null ? NFS : typeof require === "function" ? require("node:fs") : null;
const _bridgePath = typeof minpath === "object" && minpath !== null ? minpath : typeof require === "function" ? require("node:path") : null;
const _bridgeOs = typeof OS === "object" && OS !== null ? OS : typeof require === "function" ? require("node:os") : null;
function isPrimeAgentBinary(cmd) {
\tif (typeof cmd !== "string" || cmd.length === 0) return false;
\treturn /(?:^|[\\\\/])(prime-agent|pa)(?:\\.(?:exe|cmd|bat))?$/i.test(cmd.trim());
}
function resolvePrimeCmdShim(cmd) {
\tif (typeof cmd !== "string" || cmd.length === 0) return cmd;
\tconst trimmed = cmd.trim();
\tif (process.platform === "win32" && /(?:^|[\\\\/])(prime-agent|pa)(?:\\.(?:cmd|bat))?$/i.test(trimmed)) {
\t\tif (_bridgeFs && typeof _bridgeFs.existsSync === "function" && _bridgeFs.existsSync(PRIME_AGENT_DEFAULT_EXE)) {
\t\t\treturn PRIME_AGENT_DEFAULT_EXE;
\t\t}
\t\treturn PRIME_AGENT_DEFAULT_EXE;
\t}
\treturn cmd;
}
function filterPrimeAgentLaunchArgs(args, isPrime) {
\tif (!isPrime || !Array.isArray(args)) return args;
\tconst filtered = [];
\tconst withVal = new Set(["--extension", "-e", "--tools", "-t", "--exclude-tools", "-xt"]);
\tconst noVal = new Set(["--no-extensions", "-ne", "--no-tools", "-nt", "--no-builtin-tools", "-nbt"]);
\tfor (let i = 0; i < args.length; i++) {
\t\tconst a = args[i];
\t\tif (typeof a !== "string") continue;
\t\tif (withVal.has(a)) { i++; continue; }
\t\tif (noVal.has(a) || a.startsWith("--extension=") || a.startsWith("-e=") || a.startsWith("--tools=") || a.startsWith("-t=") || a.startsWith("--exclude-tools=")) continue;
\t\tfiltered.push(a);
\t}
\treturn filtered;
}
function buildUnifiedDiffFromEdit(filePath, oldStr, newStr, startLine = 1) {
\tconst cleanPath = String(filePath || "file").replace(/\\\\/g, "/");
\tconst oldLines = typeof oldStr === "string" && oldStr.length > 0 ? oldStr.split(/\\r?\\n/) : [];
\tconst newLines = typeof newStr === "string" && newStr.length > 0 ? newStr.split(/\\r?\\n/) : [];
\tconst lineStart = typeof startLine === "number" && startLine > 0 ? Math.trunc(startLine) : 1;
\tconst body = [
\t\t...oldLines.map((l) => "-" + l),
\t\t...newLines.map((l) => "+" + l)
\t].join("\\n");
\tconst diffStr = \`--- a/\${cleanPath}\\n+++ b/\${cleanPath}\\n@@ -\${lineStart},\${oldLines.length} +\${lineStart},\${newLines.length} @@\\n\${body}\`;
\treturn { diffStr, additions: newLines.length, deletions: oldLines.length };
}
function normalizePiPlanStepStatus(raw) {
\tconst s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
\tif (s === "in_progress" || s === "inprogress" || s === "running" || s === "active") return "running";
\tif (s === "completed" || s === "done" || s === "achieved" || s === "cancelled" || s === "skipped") return "completed";
\treturn "pending";
}
function extractPiTodoSteps(args, resultRecord) {
\tconst details = resultRecord && typeof resultRecord === "object" ? resultRecord.details : void 0;
\tconst rawTodos = (args && (args.todos ?? args.steps ?? args.items)) ?? (details && (details.todos ?? details.steps ?? details.items));
\tconst steps = [];
\tif (Array.isArray(rawTodos)) {
\t\tfor (const [idx, item] of rawTodos.entries()) {
\t\t\tif (!item || typeof item !== "object") continue;
\t\t\tconst text = String(item.content ?? item.text ?? item.step ?? item.title ?? \`Step \${idx + 1}\`).trim() || \`Step \${idx + 1}\`;
\t\t\tconst id = String(item.id ?? \`todo-\${idx + 1}\`).trim() || \`todo-\${idx + 1}\`;
\t\t\tsteps.push({ id, text, status: normalizePiPlanStepStatus(item.status) });
\t\t}
\t}
\tconst rawPhases = (args && args.phases) ?? (details && details.phases);
\tif (steps.length === 0 && Array.isArray(rawPhases)) {
\t\tlet idx = 0;
\t\tfor (const phase of rawPhases) {
\t\t\tif (!phase || typeof phase !== "object" || !Array.isArray(phase.tasks)) continue;
\t\t\tconst pName = typeof phase.name === "string" && phase.name.trim().length > 0 ? phase.name.trim() + ": " : "";
\t\t\tfor (const t of phase.tasks) {
\t\t\t\tif (!t || typeof t !== "object") continue;
\t\t\t\tidx += 1;
\t\t\t\tconst text = (pName + String(t.content ?? t.text ?? \`Task \${idx}\`).trim()).trim();
\t\t\t\tsteps.push({ id: \`phase-todo-\${idx}\`, text: text || \`Task \${idx}\`, status: normalizePiPlanStepStatus(t.status) });
\t\t\t}
\t\t}
\t}
\tconst explanation = (args && typeof args.explanation === "string" ? args.explanation.trim() : "") || (details && typeof details.explanation === "string" ? details.explanation.trim() : "");
\treturn { steps, explanation: explanation || void 0 };
}
function extractPiProposedPlanMarkdown(args, resultRecord, outputText) {
\tconst details = resultRecord && typeof resultRecord === "object" ? resultRecord.details : void 0;
\tfor (const candidate of [args?.plan, args?.markdown, args?.content, args?.text, details?.plan, details?.markdown, outputText]) {
\t\tif (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
\t}
\treturn "";
}
function extractPiFileSearch(toolName, args, resultRecord, outputText) {
\tconst pattern = String(args?.pattern ?? args?.query ?? args?.glob ?? args?.path ?? toolName).trim();
\tconst results = [];
\tif (typeof outputText === "string" && outputText.trim().length > 0) {
\t\tfor (const rawLine of outputText.split(/\\r?\\n/).slice(0, 50)) {
\t\t\tconst lineStr = rawLine.trim();
\t\t\tif (!lineStr || lineStr.startsWith("[")) continue;
\t\t\tconst m = /^([^:\\r\\n]+?):(\\d+):(.*)$/.exec(lineStr);
\t\t\tif (m) {
\t\t\t\tconst lineNum = Number(m[2]);
\t\t\t\tresults.push({
\t\t\t\t\tfileName: m[1].trim(),
\t\t\t\t\t...(Number.isInteger(lineNum) && lineNum > 0 ? { line: lineNum } : {}),
\t\t\t\t\t...(m[3].trim() ? { preview: m[3].trim().slice(0, 400) } : {})
\t\t\t\t});
\t\t\t} else {
\t\t\t\tresults.push({ fileName: lineStr.slice(0, 400) });
\t\t\t}
\t\t}
\t}
\treturn { pattern: pattern || void 0, results };
}
function extractPiWebSearch(args, resultRecord, outputText) {
\tconst q = String(args?.query ?? args?.q ?? args?.url ?? "").trim();
\tconst patterns = q ? [q] : [];
\tconst details = resultRecord && typeof resultRecord === "object" ? resultRecord.details : void 0;
\tconst rawResults = details?.results ?? args?.results;
\tconst results = [];
\tif (Array.isArray(rawResults)) {
\t\tfor (const r of rawResults.slice(0, 20)) {
\t\t\tif (!r || typeof r !== "object") continue;
\t\t\tconst url = typeof r.url === "string" ? r.url.trim() : "";
\t\t\tif (!url) continue;
\t\t\tresults.push({
\t\t\t\turl,
\t\t\t\t...(typeof r.title === "string" && r.title.trim() ? { title: r.title.trim() } : {}),
\t\t\t\t...(typeof r.snippet === "string" && r.snippet.trim() ? { snippet: r.snippet.trim() } : {})
\t\t\t});
\t\t}
\t} else if (typeof args?.url === "string" && args.url.trim().length > 0) {
\t\tresults.push({
\t\t\turl: args.url.trim(),
\t\t\t...(typeof outputText === "string" && outputText.trim() ? { snippet: outputText.trim().slice(0, 400) } : {})
\t\t});
\t}
\treturn { patterns, results };
}
function formatPiReadCard(args) {
\tconst readPath = String(args?.path ?? args?.file_path ?? args?.filePath ?? "").trim();
\tconst offset = args?.offset ?? args?.start_line ?? args?.startLine;
\tconst limit = args?.limit ?? args?.end_line ?? args?.endLine;
\tlet range = "";
\tif (typeof offset === "number" && Number.isFinite(offset)) {
\t\trange = typeof limit === "number" && Number.isFinite(limit) ? \`L\${offset}-\${offset + limit}\` : \`L\${offset}+\`;
\t}
\tconst title = readPath ? (range ? \`Read \${readPath} (\${range})\` : \`Read \${readPath}\`) : "Read";
\treturn {
\t\treadPath: readPath || void 0,
\t\ttitle,
\t\tinput: { ...(args && typeof args === "object" ? args : {}), ...(readPath ? { path: readPath } : {}) }
\t};
}
function primeGoalToTodoSteps(goal) {
\tif (!goal || typeof goal !== "object") return { steps: [], explanation: void 0 };
\tconst objective = String(goal.objective ?? goal.title ?? "").trim();
\tconst statusRaw = String(goal.status ?? (goal.active ? "active" : "completed")).trim().toLowerCase();
\tconst steps = [];
\tif (Array.isArray(goal.steps)) {
\t\tfor (const [idx, s] of goal.steps.entries()) {
\t\t\tif (!s || typeof s !== "object") continue;
\t\t\tsteps.push({
\t\t\t\tid: String(s.id ?? \`goal-step-\${idx + 1}\`),
\t\t\t\ttext: String(s.text ?? s.step ?? s.content ?? \`Step \${idx + 1}\`).trim() || \`Step \${idx + 1}\`,
\t\t\t\tstatus: normalizePiPlanStepStatus(s.status)
\t\t\t});
\t\t}
\t}
\tif (steps.length === 0 && objective.length > 0) {
\t\tsteps.push({
\t\t\tid: "goal-objective-1",
\t\t\ttext: objective,
\t\t\tstatus: statusRaw === "completed" || statusRaw === "achieved" || statusRaw === "done" ? "completed" : statusRaw === "pending" ? "pending" : "running"
\t\t});
\t}
\tconst budget = typeof goal.tokenBudget === "number" ? \`Budget: \${goal.tokensUsed ?? 0}/\${goal.tokenBudget} tokens\` : void 0;
\treturn { steps, explanation: budget };
}
function ensurePrimeHtmlRenderAttachment(threadId, stableKey, html, title, height) {
\tconst safeTitle = String(title || "HTML Preview").trim().slice(0, 200) || "HTML Preview";
\tconst safeHeight = typeof height === "number" && Number.isFinite(height) ? Math.min(2000, Math.max(80, Math.round(height))) : 480;
\tlet attachmentId = typeof createDeterministicAttachmentId === "function" ? createDeterministicAttachmentId(String(threadId || "thread"), String(stableKey || "html")) : null;
\tif (attachmentId) attachmentId = \`\${attachmentId}-html\`;
\telse attachmentId = \`thread-00000000-0000-0000-0000-000000000001-html\`;
\tif (typeof html === "string" && html.trim().length > 0 && _bridgeFs && _bridgePath && _bridgeOs) {
\t\tconst attDir = _bridgePath.join(_bridgeOs.homedir(), ".t3", "userdata", "attachments");
\t\t_bridgeFs.mkdirSync(attDir, { recursive: true });
\t\tconst prepared = typeof injectHtmlRenderBootstrap === "function" ? injectHtmlRenderBootstrap(html) : html;
\t\t_bridgeFs.writeFileSync(_bridgePath.join(attDir, \`\${attachmentId}.html\`), prepared, "utf8");
\t}
\treturn { attachmentId, title: safeTitle, height: safeHeight };
}
function unpackPrimeIpythonCell(toolCallId, threadId, args, resultRecord, outputText, metaIpython) {
\tconst items = [];
\tconst details = resultRecord && typeof resultRecord === "object" ? resultRecord.details : void 0;
\tconst code = typeof args?.code === "string" ? args.code : "";
\tconst seenDiffPaths = new Set();
\tlet htmlCount = 0;
\tconst rawAttachments = [
\t\t...(Array.isArray(details?.attachments) ? details.attachments : []),
\t\t...(Array.isArray(metaIpython?.attachments) ? metaIpython.attachments : [])
\t];
\tconst rawDiffs = Array.isArray(details?.diffs) ? details.diffs : [];
\tfor (const [idx, d] of rawDiffs.entries()) {
\t\tif (!d || typeof d !== "object") continue;
\t\tconst p = String(d.path ?? d.fileName ?? "").trim();
\t\tif (!p) continue;
\t\tseenDiffPaths.add(p);
\t\tconst built = buildUnifiedDiffFromEdit(p, d.old_str ?? d.oldStr ?? "", d.new_str ?? d.newStr ?? "", d.start_line ?? d.startLine ?? 1);
\t\titems.push({
\t\t\tnativeItemId: \`\${toolCallId}:diff:\${idx}\`,
\t\t\tkind: "file_change",
\t\t\tfileName: p,
\t\t\toldStr: String(d.old_str ?? d.oldStr ?? ""),
\t\t\tnewStr: String(d.new_str ?? d.newStr ?? ""),
\t\t\tdiffStr: built.diffStr,
\t\t\tadditions: built.additions,
\t\t\tdeletions: built.deletions,
\t\t\tchanges: [{ operation: "edit", path: p }]
\t\t});
\t}
\tfor (const [idx, att] of rawAttachments.entries()) {
\t\tif (!att || typeof att !== "object") continue;
\t\tconst mime = String(att.mimeType ?? att.mime_type ?? "").trim();
\t\tconst payload = att.data && typeof att.data === "object" ? att.data : att;
\t\tif (mime === "application/vnd.prime-agent.diff+json") {
\t\t\tconst p = String(payload.path ?? att.path ?? "").trim();
\t\t\tif (!p) continue;
\t\t\tseenDiffPaths.add(p);
\t\t\tconst built = buildUnifiedDiffFromEdit(p, payload.old_str ?? payload.oldStr ?? "", payload.new_str ?? payload.newStr ?? "", payload.start_line ?? payload.startLine ?? 1);
\t\t\titems.push({
\t\t\t\tnativeItemId: \`\${toolCallId}:att-diff:\${idx}\`,
\t\t\t\tkind: "file_change",
\t\t\t\tfileName: p,
\t\t\t\toldStr: String(payload.old_str ?? payload.oldStr ?? ""),
\t\t\t\tnewStr: String(payload.new_str ?? payload.newStr ?? ""),
\t\t\t\tdiffStr: built.diffStr,
\t\t\t\tadditions: built.additions,
\t\t\t\tdeletions: built.deletions,
\t\t\t\tchanges: [{ operation: "edit", path: p }]
\t\t\t});
\t\t} else if (mime === "application/vnd.prime-agent.html-render+json" || mime === "text/html") {
\t\t\thtmlCount += 1;
\t\t\tconst htmlStr = typeof payload.html === "string" ? payload.html : typeof att.data === "string" ? att.data : "";
\t\t\tconst title = String(payload.title ?? att.title ?? "HTML Preview");
\t\t\tconst height = Number(payload.height ?? att.height ?? 480);
\t\t\tconst ref = payload.htmlRender && typeof payload.htmlRender.attachmentId === "string" ? payload.htmlRender : ensurePrimeHtmlRenderAttachment(threadId, \`\${toolCallId}:html:\${idx}\`, htmlStr, title, height);
\t\t\titems.push({
\t\t\t\tnativeItemId: \`\${toolCallId}:html:\${idx}\`,
\t\t\t\tkind: "html_render",
\t\t\t\ttitle: ref.title,
\t\t\t\thtmlRender: ref,
\t\t\t\tinput: { html: htmlStr, title: ref.title, height: ref.height, uri: "xd://127.0.0.1/html_render" }
\t\t\t});
\t\t}
\t}
\tif (code.length > 0) {
\t\tconst editRe = /\\bedit(?:\\.run)?\\s*\\(\\s*(?:path\\s*=\\s*)?(['"\`])([^'"\`]+)\\1\\s*,\\s*(?:old_str\\s*=\\s*)?(['"\`])([\\s\\S]*?)\\3\\s*,\\s*(?:new_str\\s*=\\s*)?(['"\`])([\\s\\S]*?)\\5/g;
\t\tlet m;
\t\tlet cIdx = 0;
\t\twhile ((m = editRe.exec(code)) !== null) {
\t\t\tconst p = m[2].trim();
\t\t\tif (!p || seenDiffPaths.has(p)) continue;
\t\t\tseenDiffPaths.add(p);
\t\t\tcIdx += 1;
\t\t\tconst built = buildUnifiedDiffFromEdit(p, m[4], m[6], 1);
\t\t\titems.push({
\t\t\t\tnativeItemId: \`\${toolCallId}:code-edit:\${cIdx}\`,
\t\t\t\tkind: "file_change",
\t\t\t\tfileName: p,
\t\t\t\toldStr: m[4],
\t\t\t\tnewStr: m[6],
\t\t\t\tdiffStr: built.diffStr,
\t\t\t\tadditions: built.additions,
\t\t\t\tdeletions: built.deletions,
\t\t\t\tchanges: [{ operation: "edit", path: p }]
\t\t\t});
\t\t}
\t\tconst readRe = /\\bread\\s*\\(\\s*(['"\`])([^'"\`]+)\\1(?:\\s*,\\s*(\\d+))?(?:\\s*,\\s*(\\d+))?\\s*\\)/g;
\t\tlet rIdx = 0;
\t\twhile ((m = readRe.exec(code)) !== null) {
\t\t\trIdx += 1;
\t\t\tconst card = formatPiReadCard({ path: m[2], ...(m[3] ? { offset: Number(m[3]) } : {}), ...(m[4] ? { limit: Number(m[4]) } : {}) });
\t\t\titems.push({
\t\t\t\tnativeItemId: \`\${toolCallId}:code-read:\${rIdx}\`,
\t\t\t\tkind: "read",
\t\t\t\ttitle: card.title,
\t\t\t\tinput: card.input,
\t\t\t\toutput: outputText
\t\t\t});
\t\t}
\t\tconst bashRe = /\\bbash\\s*\\(\\s*(['"\`])([\\s\\S]*?)\\1/g;
\t\tlet bIdx = 0;
\t\twhile ((m = bashRe.exec(code)) !== null) {
\t\t\tbIdx += 1;
\t\t\titems.push({
\t\t\t\tnativeItemId: \`\${toolCallId}:code-bash:\${bIdx}\`,
\t\t\t\tkind: "command_execution",
\t\t\t\tinput: m[2],
\t\t\t\toutput: outputText
\t\t\t});
\t\t}
\t\tif (bIdx === 0 && details?.bashCommands && typeof details.bashCommands.first === "string") {
\t\t\titems.push({
\t\t\t\tnativeItemId: \`\${toolCallId}:code-bash:1\`,
\t\t\t\tkind: "command_execution",
\t\t\t\tinput: details.bashCommands.first,
\t\t\t\toutput: outputText
\t\t\t});
\t\t}
\t\tif (htmlCount === 0 && (/\\bhtml_(?:render|preview)\\s*\\(/.test(code) || /call_tool\\s*\\([^)]*html_(?:render|preview)/.test(code))) {
\t\t\tconst htmlMatch = /(?:html_(?:render|preview)|call_tool)\\s*\\([\\s\\S]*?(['"\`])(<[\\s\\S]*?>)\\1/.exec(code);
\t\t\tconst titleMatch = /title\\s*[:=]\\s*(['"\`])([^'"\`]+)\\1/.exec(code);
\t\t\tconst htmlStr = htmlMatch ? htmlMatch[2] : "<div>HTML Preview</div>";
\t\t\tconst titleStr = titleMatch ? titleMatch[2] : "HTML Preview";
\t\t\tconst ref = ensurePrimeHtmlRenderAttachment(threadId, \`\${toolCallId}:code-html:1\`, htmlStr, titleStr, 480);
\t\t\titems.push({
\t\t\t\tnativeItemId: \`\${toolCallId}:code-html:1\`,
\t\t\t\tkind: "html_render",
\t\t\t\ttitle: ref.title,
\t\t\t\thtmlRender: ref,
\t\t\t\tinput: { html: htmlStr, title: ref.title, height: ref.height, uri: "xd://127.0.0.1/html_render" }
\t\t\t});
\t\t}
\t}
\treturn items;
}
`;

const EMIT_SUBAGENT_TASKS_SOURCE = `const emitSubagentTasks = fnUntraced(function* (turn, toolCallId, resultRecord, completed, args, currentToolName) {
\t\t\t\tconst details = piRecordField(resultRecord, "details");
\t\t\t\tlet items = [];
\t\t\t\tturn.subagentPrompts = turn.subagentPrompts ?? new Map();
\t\t\t\tconst rawResults = piRecordField(details, "results");
\t\t\t\tif (Array.isArray(rawResults) && rawResults.length > 0) {
\t\t\t\t\tfor (const [index, result] of rawResults.entries()) {
\t\t\t\t\t\tif (!result || typeof result !== "object") continue;
\t\t\t\t\t\tconst subName = piRecordString(result, "id") ?? piRecordString(result, "name") ?? piRecordString(result, "agent") ?? \`\${toolCallId}:subagent:\${piRecordNumber(result, "step") ?? index}\`;
\t\t\t\t\t\tconst agent = piRecordString(result, "agent") ?? subName;
\t\t\t\t\t\tconst task = piRecordString(result, "task") ?? piRecordString(result, "assignment") ?? piRecordString(result, "description") ?? "";
\t\t\t\t\t\tconst nativeTaskId = subName.startsWith("subagent:") ? subName : \`subagent:\${subName}\`;
\t\t\t\t\t\tif (task) turn.subagentPrompts.set(nativeTaskId, task);
\t\t\t\t\t\tconst rawStatus = piRecordString(result, "status");
\t\t\t\t\t\tconst finished = completed || piRecordField(result, "finished") === true || rawStatus === "completed" || rawStatus === "done" || rawStatus === "failed" || rawStatus === "error" || rawStatus === "interrupted" || rawStatus === "cancelled";
\t\t\t\t\t\tconst stopReason = piRecordString(result, "stopReason");
\t\t\t\t\t\tconst interrupted = finished && (stopReason === "aborted" || rawStatus === "interrupted" || rawStatus === "cancelled");
\t\t\t\t\t\tconst failed = finished && !interrupted && ((piRecordNumber(result, "exitCode") ?? 0) !== 0 || stopReason === "error" || rawStatus === "failed" || rawStatus === "error" || Boolean(piRecordString(result, "error")));
\t\t\t\t\t\tconst status = interrupted ? "interrupted" : failed ? "failed" : finished ? "completed" : "running";
\t\t\t\t\t\tconst outputText = piRecordString(result, "output") ?? piRecordString(result, "error") ?? piSubagentOutput(result);
\t\t\t\t\t\titems.push({
\t\t\t\t\t\t\tnativeTaskId,
\t\t\t\t\t\t\tagent,
\t\t\t\t\t\t\ttask: task || turn.subagentPrompts.get(nativeTaskId) || agent,
\t\t\t\t\t\t\tmodel: piRecordString(result, "model") ?? piRecordString(result, "resolvedModel") ?? null,
\t\t\t\t\t\t\tstatus,
\t\t\t\t\t\t\tfinished,
\t\t\t\t\t\t\toutputText
\t\t\t\t\t\t});
\t\t\t\t\t}
\t\t\t\t} else if (currentToolName === "task" || currentToolName === "subagent") {
\t\t\t\t\tconst rawProgress = piRecordField(details, "progress");
\t\t\t\t\tconst progressList = Array.isArray(rawProgress) ? rawProgress : [];
\t\t\t\t\tconst rawTasks = piRecordField(args, "tasks");
\t\t\t\t\tconst tasksArgs = Array.isArray(rawTasks) ? rawTasks : [];
\t\t\t\t\tconst maxLen = Math.max(progressList.length, tasksArgs.length);
\t\t\t\t\tfor (let index = 0; index < maxLen; index++) {
\t\t\t\t\t\tconst p = progressList[index] ?? {};
\t\t\t\t\t\tconst a = tasksArgs[index] ?? {};
\t\t\t\t\t\tconst subName = piRecordString(p, "id") ?? piRecordString(a, "name") ?? piRecordString(p, "agent") ?? piRecordString(a, "agent") ?? \`\${toolCallId}:\${index}\`;
\t\t\t\t\t\tconst nativeTaskId = \`subagent:\${subName}\`;
\t\t\t\t\t\tconst agent = piRecordString(p, "agent") ?? piRecordString(a, "agent") ?? subName;
\t\t\t\t\t\tconst task = piRecordString(p, "assignment") ?? piRecordString(p, "task") ?? piRecordString(a, "task") ?? piRecordString(a, "assignment") ?? "";
\t\t\t\t\t\tif (task) turn.subagentPrompts.set(nativeTaskId, task);
\t\t\t\t\t\tconst statusRaw = piRecordString(p, "status") ?? (completed ? "completed" : "running");
\t\t\t\t\t\tconst status = statusRaw === "completed" || statusRaw === "done" ? "completed" : statusRaw === "failed" || statusRaw === "error" ? "failed" : statusRaw === "interrupted" || statusRaw === "cancelled" ? "interrupted" : "running";
\t\t\t\t\t\tconst finished = status === "completed" || status === "failed" || status === "interrupted";
\t\t\t\t\t\tconst model = piRecordString(p, "resolvedModel") ?? piRecordString(p, "modelRole") ?? piRecordString(p, "model") ?? null;
\t\t\t\t\t\tconst outputText = piRecordString(p, "output") ?? piRecordString(p, "error") ?? "";
\t\t\t\t\t\titems.push({
\t\t\t\t\t\t\tnativeTaskId,
\t\t\t\t\t\t\tagent: piRecordString(p, "id") ?? piRecordString(a, "name") ?? agent,
\t\t\t\t\t\t\ttask: task || turn.subagentPrompts.get(nativeTaskId) || agent,
\t\t\t\t\t\t\tmodel,
\t\t\t\t\t\t\tstatus,
\t\t\t\t\t\t\tfinished,
\t\t\t\t\t\t\toutputText
\t\t\t\t\t\t});
\t\t\t\t\t}
\t\t\t\t} else if (currentToolName === "wait") {
\t\t\t\t\tconst rawJobs = piRecordField(details, "jobs");
\t\t\t\t\tif (Array.isArray(rawJobs)) {
\t\t\t\t\t\tfor (const [index, job] of rawJobs.entries()) {
\t\t\t\t\t\t\tconst subName = piRecordString(job, "id") ?? piRecordString(job, "label") ?? \`job-\${index}\`;
\t\t\t\t\t\t\tconst nativeTaskId = \`subagent:\${subName}\`;
\t\t\t\t\t\t\tconst statusRaw = piRecordString(job, "status");
\t\t\t\t\t\t\tconst finished = statusRaw === "completed" || statusRaw === "failed" || statusRaw === "cancelled" || statusRaw === "aborted";
\t\t\t\t\t\t\tconst status = statusRaw === "completed" ? "completed" : statusRaw === "failed" ? "failed" : statusRaw === "cancelled" || statusRaw === "aborted" ? "interrupted" : "running";
\t\t\t\t\t\t\tconst model = piRecordString(job, "resolvedModel") ?? piRecordString(job, "resolvedModelIdentity") ?? null;
\t\t\t\t\t\t\tconst outputText = piRecordString(job, "resultText") ?? piRecordString(job, "output") ?? piRecordString(job, "error") ?? "";
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

const EMIT_TOOL_ITEM_SOURCE = `const emitToolItem = fnUntraced(function* (turn, event, phase) {
\t\t\t\tconst toolCallId = piRecordString(event, "toolCallId");
\t\t\t\tconst rawToolName = piRecordString(event, "toolName") ?? "tool";
\t\t\t\tconst toolName = rawToolName.trim().toLowerCase();
\t\t\t\tif (toolCallId === void 0) return;
\t\t\t\tif (phase === "start") {
\t\t\t\t\tturn.toolArgs.set(toolCallId, event["args"]);
\t\t\t\t\tturn.toolNames = turn.toolNames ?? new Map();
\t\t\t\t\tturn.toolNames.set(toolCallId, toolName);
\t\t\t\t}
\t\t\t\tconst currentToolName = (event["toolName"] ? toolName : (turn.toolNames?.get(toolCallId) ?? toolName));
\t\t\t\tconst args = event["args"] ?? turn.toolArgs.get(toolCallId);
\t\t\t\tconst emittedAt = yield* now;
\t\t\t\tconst startedAt = turn.toolStartedAt.get(toolCallId) ?? emittedAt;
\t\t\t\tturn.toolStartedAt.set(toolCallId, startedAt);
\t\t\t\tconst completed = phase === "end";
\t\t\t\tconst isError = event["isError"] === true;
\t\t\t\tconst resultRecord = completed ? event["result"] : event["partialResult"];
\t\t\t\tconst outputText = contentText(piRecordField(resultRecord, "content"));
\t\t\t\tconst status = completed ? isError ? turn.interrupted ? "interrupted" : "failed" : "completed" : "running";
\t\t\t\tconst base = baseItemFields(turn, toolCallId, startedAt, emittedAt);
\t\t\t\tyield* emitItemNode(turn, toolCallId, "tool_call", status, startedAt, completed ? emittedAt : null);
\t\t\t\tconst shared = {
\t\t\t\t\t...base,
\t\t\t\t\tstatus,
\t\t\t\t\tcompletedAt: completed ? emittedAt : null
\t\t\t\t};
\t\t\t\tif (currentToolName === "bash" || currentToolName === "powershell") {
\t\t\t\t\tconst exitCode = piRecordNumber(piRecordField(resultRecord, "structuredContent"), "exit_code") ?? piRecordNumber(piRecordField(resultRecord, "details"), "exitCode");
\t\t\t\t\tyield* emit({
\t\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\tturnItem: {
\t\t\t\t\t\t\t...shared,
\t\t\t\t\t\t\ttitle: currentToolName,
\t\t\t\t\t\t\ttype: "command_execution",
\t\t\t\t\t\t\tinput: piRecordString(args, "command") ?? "",
\t\t\t\t\t\t\t...outputText.length > 0 ? { output: outputText } : {},
\t\t\t\t\t\t\t...exitCode === void 0 ? {} : { exitCode }
\t\t\t\t\t\t}
\t\t\t\t\t});
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tif (currentToolName === "edit" || currentToolName === "write" || currentToolName === "apply_patch") {
\t\t\t\t\tconst fileName = piRecordString(args, "path") ?? piRecordString(args, "file_path") ?? piRecordString(args, "filePath");
\t\t\t\t\tif (fileName !== void 0) {
\t\t\t\t\t\tconst details = piRecordField(resultRecord, "details");
\t\t\t\t\t\tlet diffStr = piRecordString(details, "patch") ?? piRecordString(details, "diff") ?? (isError && outputText.trim().length > 0 ? outputText : void 0);
\t\t\t\t\t\tconst oldStr = piRecordString(args, "old_str") ?? piRecordString(args, "oldStr") ?? piRecordString(args, "old_string");
\t\t\t\t\t\tconst newStr = currentToolName === "write" ? piRecordString(args, "content") : (piRecordString(args, "new_str") ?? piRecordString(args, "newStr") ?? piRecordString(args, "new_string"));
\t\t\t\t\t\tif (!diffStr && (oldStr !== void 0 || newStr !== void 0)) {
\t\t\t\t\t\t\tdiffStr = buildUnifiedDiffFromEdit(fileName, oldStr ?? "", newStr ?? "", 1).diffStr;
\t\t\t\t\t\t}
\t\t\t\t\t\tyield* emit({
\t\t\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\t\tturnItem: {
\t\t\t\t\t\t\t\t...shared,
\t\t\t\t\t\t\t\ttitle: currentToolName,
\t\t\t\t\t\t\t\ttype: "file_change",
\t\t\t\t\t\t\t\tfileName,
\t\t\t\t\t\t\t\tchanges: [{ operation: currentToolName === "write" ? "create" : "edit", path: fileName }],
\t\t\t\t\t\t\t\t...diffStr === void 0 ? {} : { diffStr },
\t\t\t\t\t\t\t\t...oldStr === void 0 ? {} : { oldStr },
\t\t\t\t\t\t\t\t...newStr === void 0 ? {} : { newStr }
\t\t\t\t\t\t\t}
\t\t\t\t\t\t});
\t\t\t\t\t\treturn;
\t\t\t\t\t}
\t\t\t\t}
\t\t\t\tif (currentToolName === "todo_write" || currentToolName === "todowrite" || currentToolName === "todo") {
\t\t\t\t\tconst extracted = extractPiTodoSteps(args, resultRecord);
\t\t\t\t\tturn.planIds = turn.planIds ?? new Map();
\t\t\t\t\tlet planId = turn.planIds.get(toolCallId);
\t\t\t\t\tif (!planId) {
\t\t\t\t\t\tplanId = yield* idAllocator.allocate.plan({ threadId: turn.turnInput.threadId, runId: turn.turnInput.runId, driver: PI_PROVIDER });
\t\t\t\t\t\tturn.planIds.set(toolCallId, planId);
\t\t\t\t\t}
\t\t\t\t\tconst allDone = extracted.steps.length > 0 && extracted.steps.every((s) => s.status === "completed");
\t\t\t\t\tyield* emit({
\t\t\t\t\t\ttype: "plan.updated",
\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\tplan: {
\t\t\t\t\t\t\tid: planId,
\t\t\t\t\t\t\tthreadId: turn.turnInput.threadId,
\t\t\t\t\t\t\trunId: turn.turnInput.runId,
\t\t\t\t\t\t\tnodeId: shared.nodeId,
\t\t\t\t\t\t\tstatus: allDone ? "completed" : "active",
\t\t\t\t\t\t\tkind: "todo_list",
\t\t\t\t\t\t\tsteps: extracted.steps,
\t\t\t\t\t\t\t...(extracted.explanation ? { explanation: extracted.explanation } : {})
\t\t\t\t\t\t}
\t\t\t\t\t});
\t\t\t\t\tyield* emit({
\t\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\tturnItem: {
\t\t\t\t\t\t\t...shared,
\t\t\t\t\t\t\ttitle: "Todo List",
\t\t\t\t\t\t\ttype: "todo_list",
\t\t\t\t\t\t\tplanId,
\t\t\t\t\t\t\tsteps: extracted.steps,
\t\t\t\t\t\t\t...(extracted.explanation ? { explanation: extracted.explanation } : {})
\t\t\t\t\t\t}
\t\t\t\t\t});
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tif (currentToolName === "exit_plan_mode" || currentToolName === "plan" || currentToolName === "submit_plan") {
\t\t\t\t\tconst planMarkdown = extractPiProposedPlanMarkdown(args, resultRecord, outputText);
\t\t\t\t\tif (planMarkdown.length > 0) {
\t\t\t\t\t\tturn.planIds = turn.planIds ?? new Map();
\t\t\t\t\t\tlet planId = turn.planIds.get(toolCallId);
\t\t\t\t\t\tif (!planId) {
\t\t\t\t\t\t\tplanId = yield* idAllocator.allocate.plan({ threadId: turn.turnInput.threadId, runId: turn.turnInput.runId, driver: PI_PROVIDER });
\t\t\t\t\t\t\tturn.planIds.set(toolCallId, planId);
\t\t\t\t\t\t}
\t\t\t\t\t\tyield* emit({
\t\t\t\t\t\t\ttype: "plan.updated",
\t\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\t\tplan: {
\t\t\t\t\t\t\t\tid: planId,
\t\t\t\t\t\t\t\tthreadId: turn.turnInput.threadId,
\t\t\t\t\t\t\t\trunId: turn.turnInput.runId,
\t\t\t\t\t\t\t\tnodeId: shared.nodeId,
\t\t\t\t\t\t\t\tstatus: "active",
\t\t\t\t\t\t\t\tkind: "proposed_plan",
\t\t\t\t\t\t\t\tmarkdown: planMarkdown
\t\t\t\t\t\t\t}
\t\t\t\t\t\t});
\t\t\t\t\t\tyield* emit({
\t\t\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\t\tturnItem: {
\t\t\t\t\t\t\t\t...shared,
\t\t\t\t\t\t\t\ttitle: "Proposed Plan",
\t\t\t\t\t\t\t\ttype: "proposed_plan",
\t\t\t\t\t\t\t\tplanId,
\t\t\t\t\t\t\t\tmarkdown: planMarkdown,
\t\t\t\t\t\t\t\tstreaming: !completed
\t\t\t\t\t\t\t}
\t\t\t\t\t\t});
\t\t\t\t\t\treturn;
\t\t\t\t\t}
\t\t\t\t}
\t\t\t\tif (currentToolName === "find" || currentToolName === "grep" || currentToolName === "glob" || currentToolName === "file_search") {
\t\t\t\t\tconst fsData = extractPiFileSearch(currentToolName, args, resultRecord, outputText);
\t\t\t\t\tyield* emit({
\t\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\tturnItem: {
\t\t\t\t\t\t\t...shared,
\t\t\t\t\t\t\ttitle: fsData.pattern ? \`Search: \${fsData.pattern}\` : currentToolName,
\t\t\t\t\t\t\ttype: "file_search",
\t\t\t\t\t\t\t...(fsData.pattern ? { pattern: fsData.pattern } : {}),
\t\t\t\t\t\t\tresults: fsData.results
\t\t\t\t\t\t}
\t\t\t\t\t});
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tif (currentToolName === "web_search" || currentToolName === "websearch" || currentToolName === "fetch" || currentToolName === "webfetch") {
\t\t\t\t\tconst wsData = extractPiWebSearch(args, resultRecord, outputText);
\t\t\t\t\tyield* emit({
\t\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\tturnItem: {
\t\t\t\t\t\t\t...shared,
\t\t\t\t\t\t\ttitle: wsData.patterns[0] ? \`Web Search: \${wsData.patterns[0]}\` : "Web Search",
\t\t\t\t\t\t\ttype: "web_search",
\t\t\t\t\t\t\tpatterns: wsData.patterns,
\t\t\t\t\t\t\tresults: wsData.results
\t\t\t\t\t\t}
\t\t\t\t\t});
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tif (currentToolName === "read") {
\t\t\t\t\tconst card = formatPiReadCard(args);
\t\t\t\t\tconst output = piToolOutput(resultRecord, currentToolName);
\t\t\t\t\tyield* emit({
\t\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\tturnItem: {
\t\t\t\t\t\t\t...shared,
\t\t\t\t\t\t\ttitle: card.title,
\t\t\t\t\t\t\ttype: "dynamic_tool",
\t\t\t\t\t\t\t...mcpToolPresentation$1({ toolName: "Read" }),
\t\t\t\t\t\t\ttoolName: "Read",
\t\t\t\t\t\t\tinput: card.input,
\t\t\t\t\t\t\t...(output === void 0 ? {} : { output })
\t\t\t\t\t\t}
\t\t\t\t\t});
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tif (currentToolName === "html_render" || currentToolName === "html_preview" || currentToolName === "mcp__t3-code__html_render" || currentToolName === "mcp__t3-code__html_preview") {
\t\t\t\t\tconst shortName = currentToolName.includes("preview") ? "html_preview" : "html_render";
\t\t\t\t\tconst htmlStr = piRecordString(args, "html") ?? "";
\t\t\t\t\tconst titleStr = piRecordString(args, "title") ?? "HTML Preview";
\t\t\t\t\tconst heightNum = piRecordNumber(args, "height") ?? 480;
\t\t\t\t\tconst details = piRecordField(resultRecord, "details");
\t\t\t\t\tconst existingRef = piRecordField(details, "htmlRender") ?? piRecordField(piRecordField(resultRecord, "structuredContent"), "htmlRender");
\t\t\t\t\tconst ref = existingRef && typeof existingRef === "object" && typeof existingRef.attachmentId === "string"
\t\t\t\t\t\t? existingRef
\t\t\t\t\t\t: ensurePrimeHtmlRenderAttachment(turn.turnInput.threadId, toolCallId, htmlStr, titleStr, heightNum);
\t\t\t\t\tyield* emit({
\t\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\tturnItem: {
\t\t\t\t\t\t\t...shared,
\t\t\t\t\t\t\ttitle: ref.title ?? titleStr,
\t\t\t\t\t\t\ttype: "dynamic_tool",
\t\t\t\t\t\t\t...mcpToolPresentation$1({ serverName: "t3-code", toolName: shortName }),
\t\t\t\t\t\t\ttoolName: shortName,
\t\t\t\t\t\t\tinput: { ...(args && typeof args === "object" ? args : {}), uri: "xd://127.0.0.1/" + shortName },
\t\t\t\t\t\t\toutput: {
\t\t\t\t\t\t\t\t...(shortName === "html_render" ? { htmlRender: ref } : {}),
\t\t\t\t\t\t\t\turi: "xd://127.0.0.1/" + shortName,
\t\t\t\t\t\t\t\t...(outputText.length > 0 ? { text: outputText } : {})
\t\t\t\t\t\t\t}
\t\t\t\t\t\t}
\t\t\t\t\t});
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tif (currentToolName === "ipython") {
\t\t\t\t\tconst unpacked = unpackPrimeIpythonCell(toolCallId, turn.turnInput.threadId, args, resultRecord, outputText, void 0);
\t\t\t\t\tfor (const child of unpacked) {
\t\t\t\t\t\tconst childBase = baseItemFields(turn, child.nativeItemId, startedAt, emittedAt);
\t\t\t\t\t\tyield* emitItemNode(turn, child.nativeItemId, "tool_call", status, startedAt, completed ? emittedAt : null);
\t\t\t\t\t\tconst childShared = { ...childBase, status, completedAt: completed ? emittedAt : null };
\t\t\t\t\t\tif (child.kind === "file_change") {
\t\t\t\t\t\t\tyield* emit({
\t\t\t\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\t\t\tturnItem: {
\t\t\t\t\t\t\t\t\t...childShared,
\t\t\t\t\t\t\t\t\ttitle: \`Edit \${child.fileName}\`,
\t\t\t\t\t\t\t\t\ttype: "file_change",
\t\t\t\t\t\t\t\t\tfileName: child.fileName,
\t\t\t\t\t\t\t\t\tdiffStr: child.diffStr,
\t\t\t\t\t\t\t\t\toldStr: child.oldStr,
\t\t\t\t\t\t\t\t\tnewStr: child.newStr,
\t\t\t\t\t\t\t\t\tadditions: child.additions,
\t\t\t\t\t\t\t\t\tdeletions: child.deletions,
\t\t\t\t\t\t\t\t\tchanges: child.changes
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t});
\t\t\t\t\t\t} else if (child.kind === "html_render") {
\t\t\t\t\t\t\tyield* emit({
\t\t\t\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\t\t\tturnItem: {
\t\t\t\t\t\t\t\t\t...childShared,
\t\t\t\t\t\t\t\t\ttitle: child.title,
\t\t\t\t\t\t\t\t\ttype: "dynamic_tool",
\t\t\t\t\t\t\t\t\t...mcpToolPresentation$1({ serverName: "t3-code", toolName: "html_render" }),
\t\t\t\t\t\t\t\t\ttoolName: "html_render",
\t\t\t\t\t\t\t\t\tinput: child.input,
\t\t\t\t\t\t\t\t\toutput: { htmlRender: child.htmlRender, uri: "xd://127.0.0.1/html_render" }
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t});
\t\t\t\t\t\t} else if (child.kind === "read") {
\t\t\t\t\t\t\tyield* emit({
\t\t\t\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\t\t\tturnItem: {
\t\t\t\t\t\t\t\t\t...childShared,
\t\t\t\t\t\t\t\t\ttitle: child.title,
\t\t\t\t\t\t\t\t\ttype: "dynamic_tool",
\t\t\t\t\t\t\t\t\t...mcpToolPresentation$1({ toolName: "Read" }),
\t\t\t\t\t\t\t\t\ttoolName: "Read",
\t\t\t\t\t\t\t\t\tinput: child.input,
\t\t\t\t\t\t\t\t\t...(child.output ? { output: child.output } : {})
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t});
\t\t\t\t\t\t} else if (child.kind === "command_execution") {
\t\t\t\t\t\t\tyield* emit({
\t\t\t\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\t\t\tturnItem: {
\t\t\t\t\t\t\t\t\t...childShared,
\t\t\t\t\t\t\t\t\ttitle: "bash",
\t\t\t\t\t\t\t\t\ttype: "command_execution",
\t\t\t\t\t\t\t\t\tinput: child.input,
\t\t\t\t\t\t\t\t\t...(child.output ? { output: child.output } : {})
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t});
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t}
\t\t\t\tconst output = piToolOutput(resultRecord, currentToolName);
\t\t\t\tyield* emit({
\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\tturnItem: {
\t\t\t\t\t\t...shared,
\t\t\t\t\t\ttitle: currentToolName === "ipython" ? "Python cell" : rawToolName,
\t\t\t\t\t\ttype: "dynamic_tool",
\t\t\t\t\t\t...mcpToolPresentation$1({ toolName: currentToolName }),
\t\t\t\t\t\ttoolName: currentToolName,
\t\t\t\t\t\tinput: args ?? {},
\t\t\t\t\t\t...output === void 0 ? {} : { output }
\t\t\t\t\t}
\t\t\t\t});
\t\t\t\tif (currentToolName === "subagent" || currentToolName === "task" || currentToolName === "wait") yield* emitSubagentTasks(turn, toolCallId, resultRecord, completed, args, currentToolName);
\t\t\t});`;

const PRIME_RPC_EVENT_CASES_SOURCE = `case "agent_end":
\t\t\t\t\tcase "agent_settled":
\t\t\t\t\t\tif (turn?.interrupted === true) {
\t\t\t\t\t\t\tif (state !== null) yield* finalizeTurn(state);
\t\t\t\t\t\t\treturn;
\t\t\t\t\t\t}
\t\t\t\t\t\tif (turn !== null) {
\t\t\t\t\t\t\tturn.nativeAborted = event["aborted"] === true;
\t\t\t\t\t\t\tturn.settleWhenIdle = true;
\t\t\t\t\t\t\tturn.settleProbeGeneration += 1;
\t\t\t\t\t\t\tif (turn.adoptedWake && pendingPromptResponses.some((pending) => pending.providerTurnId === turn.providerTurn.id && pending.kind === "turn_start")) return;
\t\t\t\t\t\t\tyield* scheduleSettleProbe(turn, true);
\t\t\t\t\t\t}
\t\t\t\t\t\treturn;
\t\t\t\t\tcase "goal_update": {
\t\t\t\t\t\tif (turn === null) return;
\t\t\t\t\t\tconst emittedAt = yield* now;
\t\t\t\t\t\tconst goalTodo = primeGoalToTodoSteps(event);
\t\t\t\t\t\tif (goalTodo.steps.length === 0) return;
\t\t\t\t\t\tconst nativeItemId = \`goal:\${turn.providerTurn.id}\`;
\t\t\t\t\t\tconst startedAt = turn.toolStartedAt.get(nativeItemId) ?? emittedAt;
\t\t\t\t\t\tturn.toolStartedAt.set(nativeItemId, startedAt);
\t\t\t\t\t\tturn.planIds = turn.planIds ?? new Map();
\t\t\t\t\t\tlet planId = turn.planIds.get(nativeItemId);
\t\t\t\t\t\tif (!planId) {
\t\t\t\t\t\t\tplanId = yield* idAllocator.allocate.plan({ threadId: turn.turnInput.threadId, runId: turn.turnInput.runId, driver: PI_PROVIDER });
\t\t\t\t\t\t\tturn.planIds.set(nativeItemId, planId);
\t\t\t\t\t\t}
\t\t\t\t\t\tconst allDone = goalTodo.steps.every((s) => s.status === "completed");
\t\t\t\t\t\tconst itemStatus = allDone ? "completed" : "running";
\t\t\t\t\t\tconst baseFields = baseItemFields(turn, nativeItemId, startedAt, emittedAt);
\t\t\t\t\t\tyield* emitItemNode(turn, nativeItemId, "todo_list", itemStatus, startedAt, allDone ? emittedAt : null);
\t\t\t\t\t\tyield* emit({
\t\t\t\t\t\t\ttype: "plan.updated",
\t\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\t\tplan: {
\t\t\t\t\t\t\t\tid: planId,
\t\t\t\t\t\t\t\tthreadId: turn.turnInput.threadId,
\t\t\t\t\t\t\t\trunId: turn.turnInput.runId,
\t\t\t\t\t\t\t\tnodeId: baseFields.nodeId,
\t\t\t\t\t\t\t\tstatus: allDone ? "completed" : "active",
\t\t\t\t\t\t\t\tkind: "todo_list",
\t\t\t\t\t\t\t\tsteps: goalTodo.steps,
\t\t\t\t\t\t\t\t...(goalTodo.explanation ? { explanation: goalTodo.explanation } : {})
\t\t\t\t\t\t\t}
\t\t\t\t\t\t});
\t\t\t\t\t\tyield* emit({
\t\t\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\t\t\tdriver: PI_PROVIDER,
\t\t\t\t\t\t\tturnItem: {
\t\t\t\t\t\t\t\t...baseFields,
\t\t\t\t\t\t\t\tstatus: itemStatus,
\t\t\t\t\t\t\t\ttitle: "Goal",
\t\t\t\t\t\t\t\tcompletedAt: allDone ? emittedAt : null,
\t\t\t\t\t\t\t\ttype: "todo_list",
\t\t\t\t\t\t\t\tplanId,
\t\t\t\t\t\t\t\tsteps: goalTodo.steps,
\t\t\t\t\t\t\t\t...(goalTodo.explanation ? { explanation: goalTodo.explanation } : {})
\t\t\t\t\t\t\t}
\t\t\t\t\t\t});
\t\t\t\t\t\treturn;
\t\t\t\t\t}
\t\t\t\t\tcase "rlm_child_update": {
\t\t\t\t\t\tif (turn === null) return;
\t\t\t\t\t\tconst serial = piRecordNumber(event, "serial") ?? 1;
\t\t\t\t\t\tconst stateStr = (piRecordString(event, "state") ?? "running").toLowerCase();
\t\t\t\t\t\tconst finished = stateStr === "completed" || stateStr === "done" || stateStr === "failed" || stateStr === "error" || stateStr === "cancelled" || stateStr === "interrupted";
\t\t\t\t\t\tconst status = stateStr === "failed" || stateStr === "error" ? "failed" : stateStr === "cancelled" || stateStr === "interrupted" ? "interrupted" : finished ? "completed" : "running";
\t\t\t\t\t\tconst promptText = piRecordString(event, "promptPreview") ?? \`Subagent #\${serial}\`;
\t\t\t\t\t\tconst outputText = piRecordString(event, "lastText") ?? piRecordString(event, "errorMessage") ?? "";
\t\t\t\t\t\tconst syntheticResult = {
\t\t\t\t\t\t\tdetails: {
\t\t\t\t\t\t\t\tresults: [{
\t\t\t\t\t\t\t\t\tid: \`rlm-child-\${serial}\`,
\t\t\t\t\t\t\t\t\tagent: \`Subagent #\${serial}\`,
\t\t\t\t\t\t\t\t\ttask: promptText,
\t\t\t\t\t\t\t\t\tstatus,
\t\t\t\t\t\t\t\t\tfinished,
\t\t\t\t\t\t\t\t\toutput: outputText
\t\t\t\t\t\t\t\t}]
\t\t\t\t\t\t\t}
\t\t\t\t\t\t};
\t\t\t\t\t\tyield* emitSubagentTasks(turn, \`rlm-root:\${turn.providerTurn.id}\`, syntheticResult, finished, {}, "subagent");
\t\t\t\t\t\treturn;
\t\t\t\t\t}`;

const PYTHON_RLM_HTML_SOURCE = `
# __T3_PRIME_HTML_BRIDGE__
def html_render(html: str, title: str = "HTML Preview", height: int = 480) -> dict:
    """Render an interactive HTML view inline inside T3 Code."""
    safe_title = str(title or "HTML Preview")
    safe_height = int(height or 480)
    safe_html = str(html or "")
    payload = {
        "mimeType": "application/vnd.prime-agent.html-render+json",
        "title": safe_title,
        "height": safe_height,
        "uri": "xd://127.0.0.1/html_render",
        "data": {
            "html": safe_html,
            "title": safe_title,
            "height": safe_height,
            "uri": "xd://127.0.0.1/html_render",
        },
    }
    emit_fn = globals().get("emit")
    if callable(emit_fn):
        try:
            emit_fn({
                "application/vnd.prime-agent.html-render+json": payload["data"],
                "text/html": safe_html,
            })
        except RuntimeError:
            pass
    try:
        from IPython import get_ipython
        ip = get_ipython()
        if ip is not None:
            atts = ip.user_ns.setdefault("__t3_attachments__", [])
            atts.append(payload)
    except ImportError:
        pass
    return payload

def html_preview(html: str, title: str = "HTML Preview", height: int = 480) -> dict:
    """Preview an interactive HTML snippet inside T3 Code."""
    return html_render(html=html, title=title, height=height)

if "_RLMNamespace" in globals():
    setattr(_RLMNamespace, "html_render", staticmethod(html_render))
    setattr(_RLMNamespace, "html_preview", staticmethod(html_preview))
`;

const ACP_PRIME_TOOL_HOOK_SOURCE = `const primeMetaTool = unknownRecord$2(unknownRecord$2(toolCall.data?._meta)?.["ai.primeintellect.prime-agent"]) ?? unknownRecord$2(unknownRecord$2(rawOutputRecord?._meta)?.["ai.primeintellect.prime-agent"]);
\t\t\t\tconst isPrimeIpythonAcp = (toolCall.title === "Python cell" || toolCall.title === "ipython" || typeof rawInputRecord?.code === "string" || primeMetaTool?.ipython !== void 0);
\t\t\t\tif (isPrimeIpythonAcp) {
\t\t\t\t\tconst unpacked = unpackPrimeIpythonCell(toolCall.toolCallId, context.input.threadId, rawInputRecord, { details: rawOutputRecord?.details ?? primeMetaTool?.ipython }, textFromUnknown(rawOutput) ?? "", primeMetaTool?.ipython);
\t\t\t\t\tfor (const child of unpacked) {
\t\t\t\t\t\tconst childOrdinal = yield* resolveItemOrdinal(context, child.nativeItemId);
\t\t\t\t\t\tconst childNodeId = providerNodeId(child.nativeItemId);
\t\t\t\t\t\tconst childTurnItemId = providerTurnItemId(child.nativeItemId);
\t\t\t\t\t\tconst childRef = { driver, nativeId: child.nativeItemId, strength: "weak" };
\t\t\t\t\t\tyield* emitProviderEvent({
\t\t\t\t\t\t\ttype: "node.updated",
\t\t\t\t\t\t\tdriver,
\t\t\t\t\t\t\tnode: {
\t\t\t\t\t\t\t\tid: childNodeId,
\t\t\t\t\t\t\t\tthreadId: context.input.threadId,
\t\t\t\t\t\t\t\trunId: context.input.runId,
\t\t\t\t\t\t\t\tparentNodeId: context.input.rootNodeId,
\t\t\t\t\t\t\t\trootNodeId: context.input.rootNodeId,
\t\t\t\t\t\t\t\tkind: "tool_call",
\t\t\t\t\t\t\t\tstatus: nodeStatus(status),
\t\t\t\t\t\t\t\tcountsForRun: false,
\t\t\t\t\t\t\t\tproviderThreadId: context.input.providerThread.id,
\t\t\t\t\t\t\t\tproviderTurnId: context.providerTurnId,
\t\t\t\t\t\t\t\tnativeItemRef: childRef,
\t\t\t\t\t\t\t\truntimeRequestId: null,
\t\t\t\t\t\t\t\tcheckpointScopeId: null,
\t\t\t\t\t\t\t\tstartedAt,
\t\t\t\t\t\t\t\tcompletedAt
\t\t\t\t\t\t\t}
\t\t\t\t\t\t});
\t\t\t\t\t\tconst childBase = {
\t\t\t\t\t\t\t...base,
\t\t\t\t\t\t\tid: childTurnItemId,
\t\t\t\t\t\t\tnodeId: childNodeId,
\t\t\t\t\t\t\tnativeItemRef: childRef,
\t\t\t\t\t\t\tordinal: childOrdinal
\t\t\t\t\t\t};
\t\t\t\t\t\tif (child.kind === "file_change") {
\t\t\t\t\t\t\tyield* emitProviderEvent({
\t\t\t\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\t\t\t\tdriver,
\t\t\t\t\t\t\t\tturnItem: {
\t\t\t\t\t\t\t\t\t...childBase,
\t\t\t\t\t\t\t\t\ttitle: \`Edit \${child.fileName}\`,
\t\t\t\t\t\t\t\t\ttype: "file_change",
\t\t\t\t\t\t\t\t\tfileName: child.fileName,
\t\t\t\t\t\t\t\t\tdiffStr: child.diffStr,
\t\t\t\t\t\t\t\t\toldStr: child.oldStr,
\t\t\t\t\t\t\t\t\tnewStr: child.newStr,
\t\t\t\t\t\t\t\t\tadditions: child.additions,
\t\t\t\t\t\t\t\t\tdeletions: child.deletions,
\t\t\t\t\t\t\t\t\tchanges: child.changes
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t});
\t\t\t\t\t\t} else if (child.kind === "html_render") {
\t\t\t\t\t\t\tyield* emitProviderEvent({
\t\t\t\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\t\t\t\tdriver,
\t\t\t\t\t\t\t\tturnItem: {
\t\t\t\t\t\t\t\t\t...childBase,
\t\t\t\t\t\t\t\t\ttitle: child.title,
\t\t\t\t\t\t\t\t\ttype: "dynamic_tool",
\t\t\t\t\t\t\t\t\t...mcpToolPresentation$1({ serverName: "t3-code", toolName: "html_render" }),
\t\t\t\t\t\t\t\t\ttoolName: "html_render",
\t\t\t\t\t\t\t\t\tinput: child.input,
\t\t\t\t\t\t\t\t\toutput: { htmlRender: child.htmlRender, uri: "xd://127.0.0.1/html_render" }
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t});
\t\t\t\t\t\t} else if (child.kind === "read") {
\t\t\t\t\t\t\tyield* emitProviderEvent({
\t\t\t\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\t\t\t\tdriver,
\t\t\t\t\t\t\t\tturnItem: {
\t\t\t\t\t\t\t\t\t...childBase,
\t\t\t\t\t\t\t\t\ttitle: child.title,
\t\t\t\t\t\t\t\t\ttype: "dynamic_tool",
\t\t\t\t\t\t\t\t\t...mcpToolPresentation$1({ toolName: "Read" }),
\t\t\t\t\t\t\t\t\ttoolName: "Read",
\t\t\t\t\t\t\t\t\tinput: child.input,
\t\t\t\t\t\t\t\t\t...(child.output ? { output: child.output } : {})
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t});
\t\t\t\t\t\t} else if (child.kind === "command_execution") {
\t\t\t\t\t\t\tyield* emitProviderEvent({
\t\t\t\t\t\t\t\ttype: "turn_item.updated",
\t\t\t\t\t\t\t\tdriver,
\t\t\t\t\t\t\t\tturnItem: {
\t\t\t\t\t\t\t\t\t...childBase,
\t\t\t\t\t\t\t\t\ttitle: "bash",
\t\t\t\t\t\t\t\t\ttype: "command_execution",
\t\t\t\t\t\t\t\t\tinput: child.input,
\t\t\t\t\t\t\t\t\t...(child.output ? { output: child.output } : {})
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t});
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t}`;

const ACP_PRIME_SESSION_INFO_HOOK_SOURCE = `const primeSessionMeta = unknownRecord$2(unknownRecord$2(update._meta)?.["ai.primeintellect.prime-agent"]);
\t\t\t\t\tif (context !== null && primeSessionMeta !== void 0) {
\t\t\t\t\t\tconst primeGoal = unknownRecord$2(primeSessionMeta.goal);
\t\t\t\t\t\tif (primeGoal !== void 0) {
\t\t\t\t\t\t\tconst goalTodo = primeGoalToTodoSteps(primeGoal);
\t\t\t\t\t\t\tif (goalTodo.steps.length > 0) {
\t\t\t\t\t\t\t\tyield* emitPlan(context, {
\t\t\t\t\t\t\t\t\tkind: "items",
\t\t\t\t\t\t\t\t\tnativePlanId: "prime-goal",
\t\t\t\t\t\t\t\t\tplan: goalTodo.steps.map((s) => ({
\t\t\t\t\t\t\t\t\t\tstep: s.text,
\t\t\t\t\t\t\t\t\t\tstatus: s.status === "running" ? "inProgress" : s.status === "completed" ? "completed" : "pending"
\t\t\t\t\t\t\t\t\t})),
\t\t\t\t\t\t\t\t\texplanation: goalTodo.explanation ?? null
\t\t\t\t\t\t\t\t});
\t\t\t\t\t\t\t}
\t\t\t\t\t\t}
\t\t\t\t\t\tconst primeSubs = primeSessionMeta.subagents;
\t\t\t\t\t\tif (Array.isArray(primeSubs)) {
\t\t\t\t\t\t\tfor (const sub of primeSubs) {
\t\t\t\t\t\t\t\tif (!sub || typeof sub !== "object") continue;
\t\t\t\t\t\t\t\tconst serial = typeof sub.serial === "number" ? sub.serial : 1;
\t\t\t\t\t\t\t\tconst st = String(sub.state ?? "running").toLowerCase();
\t\t\t\t\t\t\t\tconst subStatus = st === "failed" || st === "error" ? "failed" : st === "cancelled" || st === "interrupted" ? "interrupted" : st === "completed" || st === "done" ? "completed" : "running";
\t\t\t\t\t\t\t\tyield* emitSubagent(context, {
\t\t\t\t\t\t\t\t\tnativeTaskId: \`prime-subagent-\${serial}\`,
\t\t\t\t\t\t\t\t\tchildSessionId: null,
\t\t\t\t\t\t\t\t\ttitle: \`Subagent #\${serial}\`,
\t\t\t\t\t\t\t\t\tprompt: String(sub.promptPreview ?? \`Subagent #\${serial}\`),
\t\t\t\t\t\t\t\t\tstatus: subStatus,
\t\t\t\t\t\t\t\t\tmodel: null,
\t\t\t\t\t\t\t\t\tresult: typeof sub.lastText === "string" ? sub.lastText : typeof sub.errorMessage === "string" ? sub.errorMessage : null
\t\t\t\t\t\t\t\t});
\t\t\t\t\t\t\t}
\t\t\t\t\t\t}
\t\t\t\t\t\tconst primeCompaction = unknownRecord$2(primeSessionMeta.compaction);
\t\t\t\t\t\tif (primeCompaction !== void 0) {
\t\t\t\t\t\t\tconst compId = \`acp-compaction:\${context.providerTurnId}\`;
\t\t\t\t\t\t\tconst compDone = primeCompaction.status === "completed" || primeCompaction.status === "done";
\t\t\t\t\t\t\tyield* emitTool(context, {
\t\t\t\t\t\t\t\ttoolCallId: compId,
\t\t\t\t\t\t\t\tkind: "other",
\t\t\t\t\t\t\t\ttitle: compDone ? "Compacted context" : "Compacting context",
\t\t\t\t\t\t\t\tstatus: compDone ? "completed" : "inProgress",
\t\t\t\t\t\t\t\tdata: { toolCallId: compId, rawOutput: typeof primeCompaction.summary === "string" ? primeCompaction.summary : "Context compacted" }
\t\t\t\t\t\t\t});
\t\t\t\t\t\t}
\t\t\t\t\t}`;

module.exports = {
  BRIDGE_MARKER,
  BIN_CLI_BRIDGE_SOURCE,
  EMIT_SUBAGENT_TASKS_SOURCE,
  EMIT_TOOL_ITEM_SOURCE,
  PRIME_RPC_EVENT_CASES_SOURCE,
  ACP_PRIME_TOOL_HOOK_SOURCE,
  ACP_PRIME_SESSION_INFO_HOOK_SOURCE,
  PYTHON_RLM_HTML_SOURCE,
};
