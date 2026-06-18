// ~/.flo/inboxes.json — small registry of named inboxes that flo manages.
// Used by `flo inbox list`, `/inbox` web panel, and the launchd installer.

import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, basename } from 'node:path';

const FLO_HOME = process.env.FLO_HOME || join(homedir(), '.flo');
const REGISTRY_PATH = join(FLO_HOME, 'inboxes.json');

function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'inbox';
}

async function ensureHome() {
  if (!existsSync(FLO_HOME)) await mkdir(FLO_HOME, { recursive: true });
}

export async function loadRegistry() {
  await ensureHome();
  if (!existsSync(REGISTRY_PATH)) return { version: 1, inboxes: [] };
  try {
    const raw = await readFile(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.inboxes)) {
      return { version: 1, inboxes: [] };
    }
    return parsed;
  } catch {
    return { version: 1, inboxes: [] };
  }
}

export async function saveRegistry(reg) {
  await ensureHome();
  await writeFile(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n', 'utf8');
}

export async function addInbox({ dir, slug, handlerHints }) {
  const reg = await loadRegistry();
  const resolved = resolve(dir.replace(/^~/, homedir()));
  const finalSlug = slug ? slugify(slug) : slugify(basename(resolved));
  // Ensure slug uniqueness
  const existingByDir = reg.inboxes.find((i) => i.dir === resolved);
  if (existingByDir) {
    // Idempotent: return existing entry
    return existingByDir;
  }
  let uniqueSlug = finalSlug;
  let n = 1;
  while (reg.inboxes.find((i) => i.slug === uniqueSlug)) {
    uniqueSlug = `${finalSlug}-${++n}`;
  }
  const entry = {
    slug: uniqueSlug,
    dir: resolved,
    createdAt: new Date().toISOString(),
    handlerHints: Array.isArray(handlerHints) ? handlerHints : [],
  };
  reg.inboxes.push(entry);
  await saveRegistry(reg);
  return entry;
}

export async function removeInbox(slug) {
  const reg = await loadRegistry();
  const before = reg.inboxes.length;
  reg.inboxes = reg.inboxes.filter((i) => i.slug !== slug);
  const removed = before - reg.inboxes.length;
  await saveRegistry(reg);
  return removed > 0;
}

export async function listInboxes() {
  const reg = await loadRegistry();
  const enriched = [];
  for (const i of reg.inboxes) {
    enriched.push({ ...i, ...(await statInbox(i.dir)) });
  }
  return enriched;
}

async function statInbox(dir) {
  const out = { exists: false, pending: 0, processed: 0, failed: 0, lastActivity: null };
  if (!existsSync(dir)) return out;
  out.exists = true;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (e.name.startsWith('.')) continue;
      if (e.name === 'inbox.log') continue;
      out.pending++;
    }
  } catch {}
  for (const subdir of ['.processed', '.failed']) {
    const p = join(dir, subdir);
    if (existsSync(p)) {
      try {
        const list = await readdir(p);
        if (subdir === '.processed') out.processed = list.length;
        else out.failed = list.length;
      } catch {}
    }
  }
  const logPath = join(dir, 'inbox.log');
  if (existsSync(logPath)) {
    try {
      const st = await stat(logPath);
      out.lastActivity = st.mtimeMs;
    } catch {}
  }
  return out;
}

export const REGISTRY = { FLO_HOME, REGISTRY_PATH };
export { slugify };
