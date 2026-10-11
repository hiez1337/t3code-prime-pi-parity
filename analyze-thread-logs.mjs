import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultDbPath = path.join(os.homedir(), '.t3', 'userdata', 'statev2.sqlite');
const defaultLogsDir = path.join(os.homedir(), '.t3', 'userdata', 'logs', 'provider');

export function analyzeT3Threads(options = {}) {
  const dbPath = options.dbPath ?? defaultDbPath;
  const logsDir = options.logsDir ?? defaultLogsDir;
  const providerFilter = options.provider ?? null;
  const threadIdFilter = options.threadId ?? null;
  const limit = options.limit ?? 5;

  if (!fs.existsSync(dbPath)) {
    throw new Error(`T3 Code database not found at: ${dbPath}`);
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    let query = `
      SELECT thread_id, title, default_provider, provider_instance_id, runtime_mode, interaction_mode, created_at, updated_at
      FROM orchestration_v2_projection_threads
      WHERE deleted_at IS NULL
    `;
    const params = [];
    if (threadIdFilter) {
      query += ' AND thread_id = ?';
      params.push(threadIdFilter);
    } else if (providerFilter && providerFilter !== 'all') {
      query += ' AND (provider_instance_id = ? OR default_provider = ?)';
      params.push(providerFilter, providerFilter);
    }
    query += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(limit);

    const threads = db.prepare(query).all(...params);
    const results = [];

    for (const t of threads) {
      const tid = t.thread_id;
      const turns = db
        .prepare(
          'SELECT provider_turn_id, ordinal, status, started_at, completed_at, payload_json FROM orchestration_v2_projection_provider_turns WHERE thread_id = ? ORDER BY ordinal ASC'
        )
        .all(tid)
        .map((row) => {
          let payload = {};
          try {
            payload = JSON.parse(row.payload_json || '{}');
          } catch (_e) {}
          return {
            providerTurnId: row.provider_turn_id,
            ordinal: row.ordinal,
            status: row.status,
            startedAt: row.started_at,
            completedAt: row.completed_at,
            tokenUsage: payload.tokenUsage ?? null,
            turnTokenUsage: payload.turnTokenUsage ?? null,
          };
        });

      const items = db
        .prepare(
          'SELECT turn_item_id, parent_item_id, ordinal, type, status, updated_at, payload_json FROM orchestration_v2_projection_turn_items WHERE thread_id = ? ORDER BY ordinal ASC'
        )
        .all(tid)
        .map((row) => {
          let payload = {};
          try {
            payload = JSON.parse(row.payload_json || '{}');
          } catch (_e) {}
          return {
            id: row.turn_item_id,
            parentId: row.parent_item_id,
            ordinal: row.ordinal,
            type: row.type,
            status: row.status,
            toolName: payload.toolName ?? null,
            title: payload.title ?? null,
            command: payload.command ?? null,
            hasHtmlRender: Boolean(payload.output?.htmlRender),
            changesCount: Array.isArray(payload.changes) ? payload.changes.length : 0,
            hasDiff: Boolean(payload.diff),
          };
        });

      const plans = db
        .prepare(
          'SELECT plan_id, kind, status, payload_json FROM orchestration_v2_projection_plans WHERE thread_id = ?'
        )
        .all(tid)
        .map((row) => {
          let payload = {};
          try {
            payload = JSON.parse(row.payload_json || '{}');
          } catch (_e) {}
          return {
            planId: row.plan_id,
            kind: row.kind,
            status: row.status,
            stepsCount: Array.isArray(payload.steps) ? payload.steps.length : 0,
            explanation: payload.explanation ?? null,
          };
        });

      const subagents = db
        .prepare(
          'SELECT subagent_id, driver, provider_instance_id, origin, status, payload_json FROM orchestration_v2_projection_subagents WHERE thread_id = ?'
        )
        .all(tid)
        .map((row) => {
          let payload = {};
          try {
            payload = JSON.parse(row.payload_json || '{}');
          } catch (_e) {}
          return {
            subagentId: row.subagent_id,
            driver: row.driver,
            instanceId: row.provider_instance_id,
            origin: row.origin,
            status: row.status,
            title: payload.title ?? payload.agentLabel ?? null,
          };
        });

      const eventLogPath = path.join(logsDir, `events.${tid}.log`);
      const hasEventLog = fs.existsSync(eventLogPath);
      const eventLogLines = hasEventLog
        ? fs.readFileSync(eventLogPath, 'utf8').trim().split('\n').filter(Boolean).length
        : 0;

      results.push({
        threadId: tid,
        title: (t.title || '').replace(/\s+/g, ' ').slice(0, 80),
        defaultProvider: t.default_provider,
        providerInstanceId: t.provider_instance_id,
        runtimeMode: t.runtime_mode,
        interactionMode: t.interaction_mode,
        updatedAt: t.updated_at,
        turnsCount: turns.length,
        turns,
        itemsCount: items.length,
        itemTypeCounts: items.reduce((acc, it) => {
          const key = it.toolName ? `${it.type}(${it.toolName})` : it.type;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
        items,
        plans,
        subagents,
        eventLogPath: hasEventLog ? eventLogPath : null,
        eventLogLines,
      });
    }

    return results;
  } finally {
    db.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const providerIdx = args.indexOf('--provider');
  const threadIdx = args.indexOf('--thread');
  const limitIdx = args.indexOf('--limit');
  const provider = providerIdx !== -1 ? args[providerIdx + 1] : null;
  const threadId = threadIdx !== -1 ? args[threadIdx + 1] : null;
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 5;

  const report = analyzeT3Threads({ provider, threadId, limit });
  console.log(`=== T3 Code Thread Forensic Report (${report.length} thread(s)) ===`);
  for (const r of report) {
    console.log(`\nThread: ${r.threadId}`);
    console.log(`  Title: ${r.title}`);
    console.log(`  Provider: ${r.defaultProvider} (instance: ${r.providerInstanceId}, mode: ${r.interactionMode})`);
    console.log(`  Updated: ${r.updatedAt}`);
    console.log(`  Turns (${r.turnsCount}):`, r.turns.map((t) => `#${t.ordinal}[${t.status}] tokens=${t.tokenUsage ? `${t.tokenUsage.usedTokens}/${t.tokenUsage.maxTokens}` : 'n/a'}`).join(', '));
    console.log(`  Turn Items (${r.itemsCount}):`, JSON.stringify(r.itemTypeCounts));
    console.log(`  Plans (${r.plans.length}):`, JSON.stringify(r.plans));
    console.log(`  Subagents (${r.subagents.length}):`, JSON.stringify(r.subagents));
    if (r.eventLogPath) {
      console.log(`  Provider Event Log: ${r.eventLogPath} (${r.eventLogLines} lines)`);
    }
  }
}
