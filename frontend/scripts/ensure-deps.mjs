#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.cwd();
const lockFile = join(cwd, 'package-lock.json');
const tscBin = join(cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');

if (existsSync(tscBin)) {
	process.exit(0);
}

const hasLockFile = existsSync(lockFile);
const installCommand = hasLockFile ? 'ci' : 'install';
const installArgs = [installCommand, '--include=dev', '--no-audit', '--no-fund'];
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

console.log(`[bootstrap] Frontend dependencies are missing. Running: npm ${installArgs.join(' ')}`);

const result = spawnSync(npmExecutable, installArgs, {
	cwd,
	stdio: 'inherit',
});

if (result.status !== 0) {
	process.exit(typeof result.status === 'number' ? result.status : 1);
}

if (!existsSync(tscBin)) {
	console.error('[bootstrap] typescript binary is still missing after install.');
	process.exit(1);
}

console.log('[bootstrap] Frontend dependencies are ready.');
