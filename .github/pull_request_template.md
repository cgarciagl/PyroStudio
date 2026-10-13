## 📋 Descripción del Cambio

<!-- Describe brevemente qué problema resuelve este Pull Request y qué enfoque técnico adoptaste. -->

Fixes #(número_de_issue)

---

## 🔍 Tipo de Cambio

- [ ] 🐛 Corrección de error (*Bug fix*)
- [ ] ✨ Nueva funcionalidad (*New feature*)
- [ ] ⚡ Optimización de rendimiento (*Performance improvement*)
- [ ] 🛡️ Mejora de seguridad o confiabilidad (*Security / Reliability*)
- [ ] 📝 Documentación (*Documentation*)
- [ ] 🧪 Pruebas automatizadas (*Tests*)

---

## 🧪 Pruebas Realizadas

- [ ] `cargo fmt --check --manifest-path src-tauri/Cargo.toml` (Formato Rust)
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` (Tests Rust)
- [ ] `npm test` (Tests Vitest frontend)
- [ ] `npm run build` (Compilación TypeScript + Vite sin errores)
- [ ] Probado manualmente en la aplicación de escritorio:
  - Sistema Operativo: Windows [ ] / macOS [ ] / Linux [ ]
  - Motor de Base de Datos: MariaDB [ ] / MySQL [ ]

---

## 🔐 Verificación de Seguridad y Arquitectura (AGENTS.md)

- [ ] **Cero credenciales en logs/IPC:** No se exponen contraseñas, tokens ni cadenas de conexión en texto plano.
- [ ] **Sin diálogos nativos:** No se introdujo `alert()`, `confirm()` ni `prompt()`; se utilizó `ConfirmModal` o UI Store.
- [ ] **Tablas sin PK:** Se respetan las políticas de Safe Mode y PrimaryKeyCondition sin fallback arbitrario.
- [ ] **Compatibilidad de compilación:** No se utiliza `cargo build --release` directo para binarios de producción.

