// Compila el ejecutable de Windows siguiendo AGENTS.md:
//   1. npm run build                       (TypeScript + frontend)
//   2. npm run tauri:build -- --no-bundle  (binario con dist/ embebido)
//   3. copia src-tauri/target/release/pyro-studio.exe → ./PyroStudio.exe
import { execSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit" });
};

if (process.platform !== "win32") {
  console.error("build:exe es solo para Windows. En macOS use: npm run build && npm run tauri:build");
  process.exit(1);
}

run("npm run build");
run("npm run tauri:build -- --no-bundle");

const exe = join(root, "src-tauri", "target", "release", "pyro-studio.exe");
if (!existsSync(exe)) {
  console.error(`No se encontró ${exe}`);
  process.exit(1);
}
copyFileSync(exe, join(root, "PyroStudio.exe"));
console.log("\n✔ PyroStudio.exe copiado a la raíz del repositorio");
