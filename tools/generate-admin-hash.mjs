#!/usr/bin/env node
import { pbkdf2Sync, randomBytes } from "node:crypto";

const adminKey = process.argv[2] ?? process.env.ADMIN_KEY;
const iterations = Number.parseInt(process.env.PBKDF2_ITERATIONS ?? "210000", 10);

if (!adminKey) {
  console.error("Usage: npm run hash:admin -- \"your-admin-key\"");
  process.exit(1);
}

if (!Number.isFinite(iterations) || iterations < 100000) {
  console.error("PBKDF2_ITERATIONS must be a number >= 100000.");
  process.exit(1);
}

const salt = randomBytes(16);
const digest = pbkdf2Sync(adminKey, salt, iterations, 32, "sha256");
const hash = `pbkdf2$sha256$${iterations}$${salt.toString("base64url")}$${digest.toString("base64url")}`;

console.log(hash);
