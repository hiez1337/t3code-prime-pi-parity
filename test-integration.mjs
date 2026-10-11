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
const { patchBinCliContent } = require('./apply-t3-patch.js');

const inspectBinCli = 'C:/Users/Ak417ytrfg/AppData/Local/Temp/opencode/t3-inspect/apps/server/dist/binCli-CyxUejOW.mjs';
const inspectClientDir = 'C:/Users/Ak417ytrfg/AppData/Local/Temp/opencode/t3-inspect/apps/server/dist/client/assets';
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
  const content = fs.readFileSync(inspectBinCli, 'utf8');
  assert.ok(content.includes(BRIDGE_MARKER), 'bridge marker present');
  assert.ok(content.includes('turn.toolNames = turn.toolNames ?? new Map()'), 'emitToolItem replacement active in binCli');
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

  const rePatched = patchBinCliContent(content);
  assert.equal(rePatched.changes, 0, 'second pass of patchBinCliContent must make 0 changes');
  assert.equal(rePatched.content, content, 'second pass output must be byte-for-byte identical');
});

test('Repeat execution of apply-t3-patch.js on server.asar is idempotent and preserves archive integrity', () => {
  const result = cp.spawnSync('node', ['apply-t3-patch.js'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `apply-t3-patch.js repeat run must exit 0: ${result.stderr}`);
  assert.ok(result.stdout.includes('applied 0 patch group(s)'), 'repeat run must apply 0 patch groups');
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

test('Python kernel-venv rlm.html_render and rlm.html_preview execute via both module and _RLMNamespace', () => {
  const out = cp.execFileSync(
    kernelPython,
    [
      '-c',
      'import json, rlm as rlm_mod; from rlm import rlm as rlm_ns; p1 = rlm_mod.html_render("<h1>Hello T3</h1>", title="Live RLM", height=360); p2 = rlm_ns.html_preview("<h2>Sub</h2>", title="Preview", height=240); print(json.dumps([p1, p2]))',
    ],
    { encoding: 'utf8' }
  );
  const [parsed, preview] = JSON.parse(out.trim());
  assert.equal(parsed.mimeType, 'application/vnd.prime-agent.html-render+json');
  assert.equal(parsed.title, 'Live RLM');
  assert.equal(parsed.height, 360);
  assert.equal(parsed.uri, 'xd://127.0.0.1/html_render');
  assert.equal(parsed.data.html, '<h1>Hello T3</h1>');
  assert.equal(preview.title, 'Preview');
  assert.equal(preview.height, 240);
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

console.log(`\nCompleted ${passed} integration checks.`);

