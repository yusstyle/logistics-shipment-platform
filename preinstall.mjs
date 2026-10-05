import { rmSync } from "node:fs";
for (const f of ["package-lock.json", "yarn.lock"]) rmSync(f, { force: true });
if (!/^pnpm\//.test(process.env.npm_config_user_agent ?? "")) {
  console.error("Use pnpm instead");
  process.exit(1);
}
