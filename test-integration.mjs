import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  BRIDGE_MARKER,
  BIN_CLI_BRIDGE_SOURCE,
  EMIT_SUBAGENT_TASKS_SOURCE,
  EMIT_TOOL_ITEM_SOURCE,
  PRIME_RPC_EVENT_CASES_SOURCE,
  ACP_PRIME_TOOL_HOOK_SOURCE,
  ACP_PRIME_SESSION_INFO_HOOK_SOURCE,
} = require('./t3-prime-bridge.js');
const {
  checkT3CodeRunning,
  loadAsarModule,
  patchBinCliContent,
} = require('./apply-t3-patch.js');
import { analyzeT3Threads } from './analyze-thread-logs.mjs';

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const inspectBinCli = path.join(localAppData, 'Temp', 'opencode', 't3-inspect', 'apps', 'server', 'dist', 'binCli-CyxUejOW.mjs');
const inspectClientDir = path.join(localAppData, 'Temp', 'opencode', 't3-inspect', 'apps', 'server', 'dist', 'client', 'assets');
const t3SettingsPath = path.join(os.homedir(), '.t3', 'userdata', 'settings.json');
const primeExe = path.join(os.homedir(), '.local', 'share', 'prime-agent', 'prime-agent.exe');
const kernelPython = path.join(os.homedir(), '.prime', 'agent', 'kernel-venv', 'Scripts', 'python.exe');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name}:`, err);
    process.exitCode = 1;
  }
}

// Evaluate bridge helper functions in the current realm
const sandbox = (() => {
  const createDeterministicAttachmentId = (threadId, key) => `thread-11111111-2222-4333-8444-555555555555`;
  const injectHtmlRenderBootstrap = (html) => `<!--bootstrap-->${html}`;
  const fn = new Function(
    'require',
    'createDeterministicAttachmentId',
    'injectHtmlRenderBootstrap',
    `${BIN_CLI_BRIDGE_SOURCE}\nreturn { isPrimeAgentBinary, resolvePrimeCmdShim, filterPrimeAgentLaunchArgs, buildUnifiedDiffFromEdit, normalizePiPlanStepStatus, extractPiTodoSteps, extractPiProposedPlanMarkdown, extractPiFileSearch, extractPiWebSearch, formatPiReadCard, primeGoalToTodoSteps, ensurePrimeHtmlRenderAttachment, unpackPrimeIpythonCell };`
  );
  return fn(require, createDeterministicAttachmentId, injectHtmlRenderBootstrap);
})();

console.log('1. Testing Bridge Helper Functions (Variant 1 & Variant 2)...');

test('isPrimeAgentBinary & resolvePrimeCmdShim detect prime-agent and pa on Windows', () => {
  assert.equal(sandbox.isPrimeAgentBinary('prime-agent'), true);
  assert.equal(sandbox.isPrimeAgentBinary('C:\\Users\\Ak417ytrfg\\.local\\bin\\pa.cmd'), true);
  assert.equal(sandbox.isPrimeAgentBinary('C:\\Users\\Ak417ytrfg\\.local\\share\\prime-agent\\prime-agent.exe'), true);
  assert.equal(sandbox.isPrimeAgentBinary('omp.exe'), false);
  assert.equal(sandbox.isPrimeAgentBinary('pi'), false);
  const resolved = sandbox.resolvePrimeCmdShim('C:\\Users\\Ak417ytrfg\\.local\\bin\\prime-agent.cmd');
  assert.match(resolved, /prime-agent\.exe$/i);
});

test('filterPrimeAgentLaunchArgs strips unsupported Pi CLI flags for prime-agent only', () => {
  const rawArgs = ['--mode', 'rpc', '--no-session', '--extension', '/tmp/ext.ts', '--no-extensions', '--no-tools', '--tools', 'read,edit', '--model', 'openai/gpt-5.4'];
  const filteredPrime = sandbox.filterPrimeAgentLaunchArgs(rawArgs, true);
  assert.deepEqual(filteredPrime, ['--mode', 'rpc', '--no-session', '--model', 'openai/gpt-5.4']);
  const untouchedPi = sandbox.filterPrimeAgentLaunchArgs(rawArgs, false);
  assert.deepEqual(untouchedPi, rawArgs);
});

test('extractPiTodoSteps normalizes flat todos and Oh-My-Pi phases to valid OrchestrationV2PlanStep status', () => {
  const flat = sandbox.extractPiTodoSteps({
    todos: [
      { id: '1', content: 'Inspect server.asar', status: 'completed' },
      { id: '2', content: 'Patch PiAdapterV2', status: 'in_progress' },
      { id: '3', content: 'Verify tests', status: 'pending' },
    ],
    explanation: '3 steps',
  }, {});
  assert.equal(flat.steps.length, 3);
  assert.deepEqual(flat.steps.map((s) => s.status), ['completed', 'running', 'pending']);

  const phased = sandbox.extractPiTodoSteps({}, {
    details: {
      phases: [
        { name: 'Phase 1', tasks: [{ content: 'Research', status: 'done' }, { content: 'Build', status: 'active' }] },
      ],
    },
  });
  assert.equal(phased.steps.length, 2);
  assert.equal(phased.steps[0].text, 'Phase 1: Research');
  assert.equal(phased.steps[0].status, 'completed');
  assert.equal(phased.steps[1].status, 'running');
});

test('extractPiProposedPlanMarkdown, extractPiFileSearch, extractPiWebSearch, and formatPiReadCard', () => {
  const planMd = sandbox.extractPiProposedPlanMarkdown({ plan: '# Implementation Plan\n1. Step A' }, {}, '');
  assert.equal(planMd, '# Implementation Plan\n1. Step A');

  const fsRes = sandbox.extractPiFileSearch('grep', { pattern: 'makePiAdapterV2' }, {}, 'src/adapter.ts:42:export const makePiAdapterV2 = ...\nsrc/index.ts:10:import { makePiAdapterV2 }');
  assert.equal(fsRes.pattern, 'makePiAdapterV2');
  assert.equal(fsRes.results.length, 2);
  assert.equal(fsRes.results[0].fileName, 'src/adapter.ts');
  assert.equal(fsRes.results[0].line, 42);

  const wsRes = sandbox.extractPiWebSearch({ query: 'prime intellect rlm' }, { details: { results: [{ url: 'https://primeintellect.ai', title: 'Prime Intellect', snippet: 'RLM runtime' }] } }, '');
  assert.deepEqual(wsRes.patterns, ['prime intellect rlm']);
  assert.equal(wsRes.results[0].url, 'https://primeintellect.ai');

  const readCard = sandbox.formatPiReadCard({ path: 'src/adapter.ts', offset: 10, limit: 50 });
  assert.equal(readCard.title, 'Read src/adapter.ts (L10-60)');
  assert.equal(readCard.input.path, 'src/adapter.ts');
});

test('unpackPrimeIpythonCell unpacks diffs, attachments, edit/read/bash/html_render calls with deterministic IDs', () => {
  const unpacked = sandbox.unpackPrimeIpythonCell(
    'cell-1',
    'thread-1',
    {
      code: [
        'edit("src/app.ts", "const a = 1;", "const a = 2;")',
        'await edit(path="src/kw.ts", old_str="foo()", new_str="bar()")',
        'read("src/config.ts", 1, 25)',
        'bash("npm test")',
        'rlm.html_render("<div>Widget</div>", title="Dashboard")',
      ].join('\n'),
    },
    {
      details: {
        attachments: [
          {
            mimeType: 'application/vnd.prime-agent.diff+json',
            data: { path: 'src/att.ts', old_str: 'old()', new_str: 'new()', start_line: 5 },
          },
        ],
      },
    },
    'All tests passed',
    undefined
  );

  const kinds = unpacked.map((i) => i.kind);
  assert.ok(kinds.includes('file_change'), 'should unpack file_change items');
  assert.ok(kinds.includes('read'), 'should unpack read item');
  assert.ok(kinds.includes('command_execution'), 'should unpack command_execution item');
  assert.ok(kinds.includes('html_render'), 'should unpack html_render item');

  const attDiff = unpacked.find((i) => i.fileName === 'src/att.ts');
  assert.equal(attDiff.nativeItemId, 'cell-1:att-diff:0');
  assert.match(attDiff.diffStr, /--- a\/src\/att\.ts/);
  assert.deepEqual(attDiff.changes, [{ operation: 'edit', path: 'src/att.ts' }]);

  const codeDiff = unpacked.find((i) => i.fileName === 'src/app.ts');
  assert.equal(codeDiff.nativeItemId, 'cell-1:code-edit:1');
  assert.match(codeDiff.diffStr, /\-const a = 1;/);
  assert.match(codeDiff.diffStr, /\+const a = 2;/);

  const kwDiff = unpacked.find((i) => i.fileName === 'src/kw.ts');
  assert.equal(kwDiff.nativeItemId, 'cell-1:code-edit:2');
  assert.match(kwDiff.diffStr, /\-foo\(\)/);
  assert.match(kwDiff.diffStr, /\+bar\(\)/);

  const htmlItem = unpacked.find((i) => i.kind === 'html_render');
  assert.match(htmlItem.htmlRender.attachmentId, /-html$/);
  assert.equal(htmlItem.title, 'Dashboard');

  // Verify keyword-argument read(), variable-argument html_render with JSON marker, goal.create, and rlm.spawn unpacking
  const unpackedE2e = sandbox.unpackPrimeIpythonCell(
    'cell-2',
    'thread-123',
    {
      code: [
        'read("README.md", limit=10)',
        'html_card = """<div><h2>Prime Agent Live Status</h2></div>"""',
        'rlm.html_render(html_card, title="Prime Agent Telemetry", height=320)',
        'await goal.create("1. Проверка RPC\\n2. Проверка субагента")',
        'h = await rlm.spawn("Return the string: SUBAGENT_OK", name="probe-worker")',
        'await goal.complete("E2E passed")',
      ].join('\n'),
    },
    {},
    '__T3_HTML_RENDER_JSON__:{"html":"<div><h2>Prime Agent Live Status</h2></div>","title":"Prime Agent Telemetry","height":320}\nSubagent result: SUBAGENT_OK',
    null
  );
  const readCard = unpackedE2e.find((i) => i.kind === 'read');
  assert.ok(readCard, 'unpacks read("README.md", limit=10) with keyword argument');
  assert.equal(readCard.input.path, 'README.md');
  assert.equal(readCard.input.limit, 10);

  const htmlCardItem = unpackedE2e.find((i) => i.kind === 'html_render');
  assert.ok(htmlCardItem, 'unpacks variable-argument html_render via __T3_HTML_RENDER_JSON__');
  assert.equal(htmlCardItem.title, 'Prime Agent Telemetry');
  assert.equal(htmlCardItem.htmlRender.height, 320);
  assert.match(htmlCardItem.input.html, /Prime Agent Live Status/);

  const goalItem = unpackedE2e.find((i) => i.kind === 'goal');
  assert.ok(goalItem, 'unpacks goal.create / goal.complete into goal item');
  assert.equal(goalItem.steps.length, 2);
  assert.equal(goalItem.allDone, true);

  const subItem = unpackedE2e.find((i) => i.kind === 'subagent');
  assert.ok(subItem, 'unpacks rlm.spawn into subagent item');
  assert.equal(subItem.agent, 'probe-worker');
});

test('primeGoalToTodoSteps maps Prime Agent goal_update / _meta.goal to T3 todo steps', () => {
  const goalRes = sandbox.primeGoalToTodoSteps({
    active: true,
    objective: 'Implement full parity for Pi and Prime Agent',
    tokenBudget: 50000,
    tokensUsed: 12000,
  });
  assert.equal(goalRes.steps.length, 1);
  assert.equal(goalRes.steps[0].status, 'running');
  assert.equal(goalRes.explanation, 'Budget: 12000/50000 tokens');
});

console.log('\n2. Testing Patched Bundle & Idempotency...');

test('Patched binCli bundle contains all Variant 1 and Variant 2 hooks, schema-compliant events, and is 100% idempotent', () => {
  let content = fs.readFileSync(inspectBinCli, 'utf8');
  if (!content.includes('rawCompErr === void 0') || !content.includes('child.kind === "goal"') || !content.includes('rawGoal.goal && typeof rawGoal.goal') || !content.includes('parentSession: resumeId')) {
    const patched = patchBinCliContent(content);
    content = patched.content;
    fs.writeFileSync(inspectBinCli, content, 'utf8');
  }
  assert.ok(content.includes(BRIDGE_MARKER), 'bridge marker present');
  assert.ok(content.includes('parentSession: resumeId'), 'registerThread uses new_session with parentSession for Prime Agent to avoid Windows switch_session tokio panic');
  assert.ok(content.includes('turn.toolNames = turn.toolNames ?? new Map()'), 'emitToolItem replacement active in binCli');
  assert.ok(content.includes('child.kind === "goal"'), 'emitToolItem unpacks goal items into plan.updated and todo_list');
  assert.ok(content.includes('child.kind === "subagent"'), 'emitToolItem unpacks subagent items into emitSubagentTasks');
  assert.ok(content.includes('rawCompErr === void 0'), 'compaction_end handles short-session no-op compaction cleanly');
  assert.ok(content.includes('too short to compact'), 'compact response handles short-session message without failing turn');
  assert.ok(content.includes('supportsSkillInvocation: true'), 'PiProviderCapabilitiesV2.supportsSkillInvocation enabled');
  assert.ok(content.includes('emitsTodoList: true'), 'PiProviderCapabilitiesV2.planning.emitsTodoList enabled');
  assert.ok(content.includes('emitsProposedPlan: true'), 'PiProviderCapabilitiesV2.planning.emitsProposedPlan enabled');
  assert.ok(content.includes('showInteractionModeToggle: true'), 'PI_PRESENTATION.showInteractionModeToggle enabled');
  assert.ok(content.includes('"orchestrator_capabilities", "delegate_task", "task_status", "html_render", "html_preview"'), 'PI_T3_MCP_EXTENSION_SOURCE directTools includes html_render and html_preview');
  assert.ok(content.includes('case "rlm_child_update":'), 'Prime Agent rlm_child_update RPC handler present');
  assert.ok(content.includes('case "goal_update":'), 'Prime Agent goal_update RPC handler present');
  assert.ok(content.includes('get_fork_messages'), 'Prime Agent get_fork_messages fallback present');
  assert.ok(content.includes('message: { role: "user" }'), 'get_fork_messages maps message.role = user for piSessionEntries');
  assert.ok(content.includes('isPrimeIpythonAcp'), 'Prime Agent ACP ipython hook present');
  assert.ok(content.includes('primeSessionMeta'), 'Prime Agent ACP session_info_update hook present');
  assert.ok(!EMIT_TOOL_ITEM_SOURCE.includes('thread.todos.updated'), 'EMIT_TOOL_ITEM_SOURCE uses V2 plan.updated instead of thread.todos.updated');
  assert.ok(!EMIT_TOOL_ITEM_SOURCE.includes('thread.proposed_plan.upserted'), 'EMIT_TOOL_ITEM_SOURCE uses V2 plan.updated instead of thread.proposed_plan.upserted');
  assert.ok(!EMIT_TOOL_ITEM_SOURCE.includes('mcp_tool_call'), 'EMIT_TOOL_ITEM_SOURCE uses V2 dynamic_tool instead of mcp_tool_call');
  assert.ok(content.includes('const isPrime = snapshot.auth?.type === "prime-agent"'), 'applyProviderCompatibility intercepts Prime Agent to prevent false unsupported warning');
  assert.ok(content.includes('versionAdvisory: {\n\t\t\t\tstatus: "current",'), 'enrichPiSnapshot prevents false update command for Prime Agent');
  assert.ok(content.includes('return capacity ?? 500000;'), 'windowOf dynamically resolves maxTokens from opencode.json with 500000 default');
  assert.ok(content.includes('usedTokens: tokens.input + tokens.cache.read + tokens.cache.write + tokens.output,'), 'session.step.ended emits live usedTokens on every step finish');
  assert.ok(content.includes('setSessionStatus(anyActive ? "running" : "ready", null)'), 'forgetRequest verifies anyActive to prevent permanent running session lock');
  assert.ok(content.includes('turn.lastLiveUsedTokens = afterTokenCount;'), 'compaction_end in PiAdapterV2 updates live tokens and schedules settle probe');

  const rePatched = patchBinCliContent(content);
  assert.equal(rePatched.changes, 0, 'second pass of patchBinCliContent must make 0 changes');
  assert.equal(rePatched.content, content, 'second pass output must be byte-for-byte identical');
});

test('Process and port 3773 detection accurately inspects active T3 Code instance', () => {
  const status = checkT3CodeRunning();
  assert.equal(typeof status.isRunning, 'boolean');
  assert.equal(typeof status.portListening, 'boolean');
  assert.ok(Array.isArray(status.pids));
});

test('E2E ASAR integrity: index.html starts with <!doctype html> and ASAR header is valid', () => {
  const asar = loadAsarModule();
  const serverAsar = path.join(localAppData, 'Programs', 't3code', 'resources', 'server.asar');
  assert.ok(fs.existsSync(serverAsar), 'server.asar exists');

  // Verify 16-byte ASAR header (magic: uint32 4, uint32 headerSize+8, uint32 headerSize+4, uint32 jsonLen)
  const fd = fs.openSync(serverAsar, 'r');
  const headerBuf = Buffer.alloc(16);
  fs.readSync(fd, headerBuf, 0, 16, 0);
  fs.closeSync(fd);
  assert.equal(headerBuf.readUInt32LE(0), 4, 'ASAR format magic number must be 4');
  assert.ok(headerBuf.readUInt32LE(4) > 0, 'ASAR header total size must be positive');
  assert.ok(headerBuf.readUInt32LE(12) > 0, 'ASAR header JSON length must be positive');

  // Verify extracted client/index.html is valid HTML (no mojibake, no corrupt offsets)
  const target = path.join('apps', 'server', 'dist', 'client', 'index.html');
  const indexHtml = asar.extractFile(serverAsar, target).toString('utf8');
  assert.ok(indexHtml.trim().startsWith('<!doctype html>'), 'index.html in server.asar starts strictly with <!doctype html>');
  assert.ok(indexHtml.length > 10000, `index.html size must be > 10KB (got ${indexHtml.length} bytes)`);
  assert.ok(indexHtml.includes('<html lang="en">'), 'index.html contains valid HTML structure');
});

test('Strict Windows binary unpack guarantees all 12 native win32 binaries in server.asar.unpacked', () => {
  const unpackedDir = path.join(localAppData, 'Programs', 't3code', 'resources', 'server.asar.unpacked');
  assert.ok(fs.existsSync(unpackedDir), 'server.asar.unpacked directory exists');

  const binaryExts = new Set(['.node', '.dll', '.exe']);
  const binaries = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (binaryExts.has(path.extname(entry.name).toLowerCase())) binaries.push(full);
    }
  }
  walk(unpackedDir);
  assert.ok(binaries.length >= 12, `Expected at least 12 unpacked native binaries (found ${binaries.length})`);
  assert.ok(binaries.some((b) => b.includes('conpty.node')), 'node-pty conpty.node present');
  assert.ok(binaries.some((b) => b.includes('OpenConsole.exe')), 'node-pty OpenConsole.exe present');
  assert.ok(binaries.some((b) => b.includes('fff_c.dll')), '@ff-labs fff_c.dll present');
  assert.ok(binaries.some((b) => b.includes('keyring-win32-x64-msvc')), '@napi-rs keyring present');
  assert.ok(binaries.some((b) => b.includes('ffi-rs')), '@yuuang ffi-rs present');
});

test('Prime Agent compatibility advisory & version advisory are clean (no false >=1.0.0 warning)', () => {
  const primeCachePath = path.join(os.homedir(), '.t3', 'caches', 'primeAgent.json');
  if (fs.existsSync(primeCachePath)) {
    const cacheObj = JSON.parse(fs.readFileSync(primeCachePath, 'utf8'));
    assert.equal(cacheObj.compatibilityAdvisory, undefined, 'Prime Agent must have no unsupported compatibilityAdvisory');
    assert.equal(cacheObj.versionAdvisory?.status, 'current', 'Prime Agent versionAdvisory status must be current');
    assert.equal(cacheObj.versionAdvisory?.updateCommand, null, 'Prime Agent updateCommand must be null');
  }
});

test('Repeat execution of apply-t3-patch.js preserves archive integrity and handles running process gracefully', () => {
  const result = cp.spawnSync('node', ['apply-t3-patch.js'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `apply-t3-patch.js repeat run must exit 0: ${result.stderr}`);
  const status = checkT3CodeRunning();
  const output = result.stdout + result.stderr;
  if (status.isRunning) {
    assert.ok(
      output.includes('server.patched.asar') || output.includes('applied 0 patch group(s)'),
      'when T3 Code is running without --restart-app, apply-t3-patch.js must safely stage archive to prevent corruption'
    );
  } else {
    assert.ok(output.includes('applied 0 patch group(s)'), 'repeat run must apply 0 patch groups when app is not running');
  }
});

test('Client assets & ~/.t3/userdata/settings.json are patched for Prime Agent', () => {
  const chatFiles = fs.readdirSync(inspectClientDir).filter((f) => f.startsWith('ChatGptUsageButton-') && f.endsWith('.js'));
  assert.ok(chatFiles.length > 0);
  const chatContent = fs.readFileSync(path.join(inspectClientDir, chatFiles[0]), 'utf8');
  assert.ok(chatContent.includes('M12 2L3 7v10l9 5'), 'Custom Prime Agent SVG icon present in client bundle');

  const settings = JSON.parse(fs.readFileSync(t3SettingsPath, 'utf8'));
  assert.equal(settings.providerInstances?.primeAgent?.driver, 'pi');
  assert.equal(settings.providerInstances?.primeAgent?.displayName, 'Prime Agent');
  assert.equal(settings.providerInstances?.primeAgent?.enabled, true);
});

console.log('\n3. Testing Live Python RLM Kernel & Prime Agent RPC Subprocess...');

test('Python kernel-venv rlm.html_render, read(), PRIME_AGENT_BASH_SHELL, and subagents module execute cleanly', () => {
  if (!fs.existsSync(kernelPython)) {
    console.log('    (Skipping Python execution: kernel-venv not installed on this host)');
    return;
  }
  const out = cp.execFileSync(
    kernelPython,
    [
      '-c',
      'import os, json, rlm as rlm_mod; from rlm import rlm as rlm_ns; from subagents import collect; p1 = rlm_mod.html_render("<h1>Hello T3</h1>", title="Live RLM", height=360); p2 = rlm_ns.html_preview("<h2>Sub</h2>", title="Preview", height=240); r_txt = read("README.md", limit=2); print(json.dumps([p1, p2, bool(os.environ.get("PRIME_AGENT_BASH_SHELL")), callable(collect), "1:" in r_txt]))',
    ],
    { encoding: 'utf8' }
  );
  const lines = out.trim().split(/\r?\n/);
  assert.ok(lines[0].startsWith('__T3_HTML_RENDER_JSON__:'), 'html_render prints __T3_HTML_RENDER_JSON__ marker');
  const [parsed, preview, hasBashEnv, hasCollect, hasReadLines] = JSON.parse(lines[lines.length - 1]);
  assert.equal(parsed.mimeType, 'application/vnd.prime-agent.html-render+json');
  assert.equal(parsed.title, 'Live RLM');
  assert.equal(parsed.height, 360);
  assert.equal(parsed.uri, 'xd://127.0.0.1/html_render');
  assert.equal(parsed.data.html, '<h1>Hello T3</h1>');
  assert.equal(preview.title, 'Preview');
  assert.equal(preview.height, 240);
  assert.equal(hasBashEnv, true, 'PRIME_AGENT_BASH_SHELL auto-configured on Windows');
  assert.equal(hasCollect, true, 'from subagents import collect is callable');
  assert.equal(hasReadLines, true, 'built-in read(path, limit=2) returns numbered lines');
});

await (async () => {
  try {
    const child = cp.spawn(primeExe, ['--mode', 'rpc', '--no-session'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const responses = new Map();
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'response' && msg.id) {
            responses.set(msg.id, msg);
          }
        } catch (_parseErr) {
          continue;
        }
      }
    });
    const send = (id, payload) => child.stdin.write(JSON.stringify({ id, ...payload }) + '\n');
    send('1', { type: 'get_state' });
    send('2', { type: 'get_available_models' });
    send('3', { type: 'get_commands' });
    send('4', { type: 'get_fork_messages' });

    const deadline = Date.now() + 8000;
    while (responses.size < 4 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    child.kill();

    test('Live prime-agent --mode rpc responds to get_state, get_available_models, get_commands, and get_fork_messages', () => {
      assert.equal(responses.get('1')?.success, true, 'get_state succeeded');
      assert.equal(responses.get('2')?.success, true, 'get_available_models succeeded');
      assert.ok(Array.isArray(responses.get('2')?.data?.models), 'models array returned');
      assert.equal(responses.get('3')?.success, true, 'get_commands succeeded');
      assert.ok(Array.isArray(responses.get('3')?.data?.commands), 'commands/skills array returned');
      assert.equal(responses.get('4')?.success, true, 'get_fork_messages succeeded');
    });
  } catch (err) {
    console.error('  [FAIL] Live prime-agent --mode rpc test:', err);
    process.exitCode = 1;
  }
})();

test('Forensic log analyzer (analyze-thread-logs.mjs) inspects statev2.sqlite projection tables and provider logs', () => {
  const report = analyzeT3Threads({ limit: 3 });
  assert.ok(Array.isArray(report), 'analyzeT3Threads returns array of thread telemetry');
  assert.ok(report.length > 0, 'at least 1 thread inspected in statev2.sqlite');
  const first = report[0];
  assert.equal(typeof first.threadId, 'string');
  assert.equal(typeof first.turnsCount, 'number');
  assert.equal(typeof first.itemsCount, 'number');
  assert.equal(typeof first.itemTypeCounts, 'object');
});

console.log(`\nCompleted ${passed} integration checks.`);

