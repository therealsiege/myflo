// macOS launchd plist generator for `flo inbox watch --once` loops.
// Generates one launch agent per registered inbox slug.
// No automatic launchctl load — prints the bootstrap command instead, so the
// user keeps control. (Same pattern watchthis uses; less footgun.)

import { mkdir, writeFile, unlink, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { loadRegistry } from './inbox-registry.js';

const LAUNCH_AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents');
const LABEL_PREFIX = 'io.myflo.inbox';

function plistFor({ label, dir, interval, floBin, logDir }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(process.execPath)}</string>
    <string>${escapeXml(floBin)}</string>
    <string>inbox</string>
    <string>watch</string>
    <string>${escapeXml(dir)}</string>
    <string>--once</string>
  </array>
  <key>WorkingDirectory</key><string>${escapeXml(dirname(floBin))}</string>
  <key>StartInterval</key><integer>${Number(interval) || 30}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(join(logDir, label + '.out.log'))}</string>
  <key>StandardErrorPath</key><string>${escapeXml(join(logDir, label + '.err.log'))}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>${escapeXml(homedir())}</string>
  </dict>
</dict>
</plist>
`;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function labelFor(slug) {
  return `${LABEL_PREFIX}.${slug}`;
}

function plistPathFor(slug) {
  return join(LAUNCH_AGENTS_DIR, `${labelFor(slug)}.plist`);
}

async function resolveFloBin() {
  if (process.env.FLO_BIN) return process.env.FLO_BIN;
  return new URL('../bin/flo.js', import.meta.url).pathname;
}

export async function installLaunchAgent({ slug, interval = 30 }) {
  if (process.platform !== 'darwin') {
    throw new Error(`launchd install is macOS-only (current: ${process.platform})`);
  }
  const reg = await loadRegistry();
  const entry = reg.inboxes.find((i) => i.slug === slug);
  if (!entry) {
    throw new Error(`no inbox registered with slug '${slug}'. Run 'flo inbox add <dir>' first.`);
  }
  await mkdir(LAUNCH_AGENTS_DIR, { recursive: true });
  const logDir = join(homedir(), '.flo', 'logs');
  await mkdir(logDir, { recursive: true });
  const floBin = await resolveFloBin();
  const label = labelFor(slug);
  const plistPath = plistPathFor(slug);
  const content = plistFor({ label, dir: entry.dir, interval, floBin, logDir });
  await writeFile(plistPath, content, 'utf8');
  return { label, plistPath, dir: entry.dir, interval };
}

export async function uninstallLaunchAgent({ slug }) {
  if (process.platform !== 'darwin') {
    throw new Error(`launchd uninstall is macOS-only (current: ${process.platform})`);
  }
  const plistPath = plistPathFor(slug);
  if (!existsSync(plistPath)) return { removed: false, plistPath };
  await unlink(plistPath);
  return { removed: true, plistPath };
}

export async function listInstalledAgents() {
  if (!existsSync(LAUNCH_AGENTS_DIR)) return [];
  const entries = await readdir(LAUNCH_AGENTS_DIR);
  const out = [];
  for (const name of entries) {
    if (!name.startsWith(`${LABEL_PREFIX}.`) || !name.endsWith('.plist')) continue;
    const slug = name.slice(`${LABEL_PREFIX}.`.length, -'.plist'.length);
    out.push({ slug, plistPath: join(LAUNCH_AGENTS_DIR, name) });
  }
  return out;
}

// Exported for tests / introspection
export const _internal = { plistFor, labelFor, plistPathFor, LAUNCH_AGENTS_DIR };
