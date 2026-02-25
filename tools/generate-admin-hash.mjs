#!/usr/bin/env node
import { pbkdf2Sync, randomBytes } from "node:crypto";

const password = process.argv[2] ?? process.env.ADMIN_PASSWORD ?? process.env.APP_PASSWORD;
const iterations = Number.parseInt(process.env.PBKDF2_ITERATIONS ?? "100000", 10);

if (!password) {
  console.error("Usage: npm run hash:admin -- \"your-password\"");
  process.exit(1);
}

if (!Number.isFinite(iterations) || iterations < 50000 || iterations > 100000) {
  console.error("PBKDF2_ITERATIONS must be between 50000 and 100000 for Cloudflare Workers compatibility.");
  process.exit(1);
}

const salt = randomBytes(16);
const digest = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const hash = `pbkdf2$sha256$${iterations}$${salt.toString("base64url")}$${digest.toString("base64url")}`;

console.log(hash);
