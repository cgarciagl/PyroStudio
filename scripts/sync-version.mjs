import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
if (typeof version !== "string" || !semverPattern.test(version)) {
  throw new Error("package.json contiene una versión SemVer inválida: " + String(version));
}

const cargoTomlPath = path.join(root, "src-tauri", "Cargo.toml");
const cargoLockPath = path.join(root, "src-tauri", "Cargo.lock");
const cargoToml = await readFile(cargoTomlPath, "utf8");
const cargoLock = await readFile(cargoLockPath, "utf8");

const cargoTomlPattern = /(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+(")/;
const cargoLockPattern = /(\[\[package\]\]\r?\nname = "pyro-studio"\r?\nversion = ")[^"]+(")/;

if (!cargoTomlPattern.test(cargoToml)) {
  throw new Error("No se encontró package.version en src-tauri/Cargo.toml");
}
const lockMatches = [...cargoLock.matchAll(new RegExp(cargoLockPattern.source, "g"))];
if (lockMatches.length !== 1) {
  throw new Error("Se esperaba una entrada pyro-studio en Cargo.lock; encontradas: " + lockMatches.length);
}

const nextCargoToml = cargoToml.replace(cargoTomlPattern, "$1" + version + "$2");
const nextCargoLock = cargoLock.replace(cargoLockPattern, "$1" + version + "$2");
const staleFiles = [];
if (nextCargoToml !== cargoToml) staleFiles.push("src-tauri/Cargo.toml");
if (nextCargoLock !== cargoLock) staleFiles.push("src-tauri/Cargo.lock");

if (checkOnly && staleFiles.length) {
  console.error("Versiones Rust desincronizadas respecto a package.json (" + version + "): " + staleFiles.join(", "));
  process.exitCode = 1;
} else if (!checkOnly && staleFiles.length) {
  await writeFile(cargoTomlPath, nextCargoToml);
  await writeFile(cargoLockPath, nextCargoLock);
  console.log("Versión " + version + " sincronizada en: " + staleFiles.join(", "));
} else {
  console.log("Versiones sincronizadas: " + version);
}
