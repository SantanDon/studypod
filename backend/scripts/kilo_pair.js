#!/usr/bin/env node
import { chmodSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "../../.env.agent");

const API_BASE = process.env.STUDYPOD_API || "http://localhost:4000/api";
const PIN = process.argv[2];

if (!PIN || PIN.length !== 6 || !/^\d{6}$/.test(PIN)) {
  console.error("Usage: node backend/scripts/kilo_pair.js <6-DIGIT-PIN>");
  console.error("  Generate PIN from StudyPodLM → Profile → Agent Pairing");
  process.exit(1);
}

async function main() {
  console.log(`\n[kilo] Exchanging pairing code...`);
  const pairRes = await fetch(`${API_BASE}/auth/pair/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: PIN, label: "KiloPaired", expiresInHours: 1 }),
  });

  if (!pairRes.ok) {
    const err = await pairRes.json().catch(() => ({}));
    console.error(`[kilo] Pairing failed: ${err.error || pairRes.statusText}`);
    process.exit(1);
  }

  const { key, expiresAt, id } = await pairRes.json();
  console.log(`[kilo] Paired successfully!`);
  console.log(`       Key ID: ${id}`);
  console.log(`       Expires: ${expiresAt}`);

  // Safely merge env variables:
  let existingEnv = {};
  if (existsSync(ENV_PATH)) {
    chmodSync(ENV_PATH, 0o600);
    const fileLines = readFileSync(ENV_PATH, "utf-8").split("\n");
    for (const line of fileLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        existingEnv[trimmed.slice(0, idx).trim()] = trimmed
          .slice(idx + 1)
          .trim();
      }
    }
  }

  existingEnv["AGENT_API_KEY"] = key;

  const newEnvContent =
    Object.entries(existingEnv)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n";

  writeFileSync(ENV_PATH, newEnvContent, { encoding: "utf-8", mode: 0o600 });
  console.log(`[kilo] API key saved to ${ENV_PATH}`);

  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  console.log(`\n[kilo] Verifying identity...`);
  const meRes = await fetch(`${API_BASE}/auth/me`, { headers });
  const me = await meRes.json();
  console.log(`       Name: ${me.displayName}`);
  console.log(`       Type: ${me.accountType || me.account_type}`);

  console.log(
    `\n[kilo] Pairing complete. Use AGENT_API_KEY from .env.agent until the expiry shown above.`,
  );
}

main().catch((err) => {
  console.error(`[kilo] Fatal: ${err.message}`);
  process.exit(1);
});
