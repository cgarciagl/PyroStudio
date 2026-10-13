# Guía de Contribución a PyroStudio

¡Gracias por tu interés en contribuir a **PyroStudio**! Este proyecto es un cliente moderno, ultra rápido y ligero para MariaDB y MySQL, construido sobre **Tauri v2 (Rust)** y **React 19 (TypeScript + Tailwind CSS)**.

Para mantener la calidad, seguridad y velocidad del producto, todas las contribuciones deben seguir las siguientes directrices.

---

## 📜 Código de Conducta

Nos comprometemos a mantener un entorno inclusivo, respetuoso y profesional para todos los colaboradores, independientemente de su nivel de experiencia, identidad o procedencia. Se espera comunicación constructiva y respeto mutuo en todos los canales de discusión, issues y pull requests.

---

## 🛠️ Requisitos de Desarrollo Local

Antes de comenzar, asegúrate de tener instalado:
1. **Node.js** (versión 20 LTS recomendada, mínimo v18).
2. **Rust** (versión stable más reciente con `rustfmt` y `clippy`).
3. Herramientas nativas según tu sistema operativo:
   - **Windows:** C++ Build Tools (Visual Studio Installer con el workload "Desarrollo para el escritorio con C++").
   - **macOS:** Xcode Command Line Tools (`xcode-select --install`).
   - **Linux:** `sudo apt install build-essential libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`.

---

## 🔄 Flujo de Trabajo para Contribuir

1. **Haz un Fork** del repositorio y clona tu copia local:
   ```bash
   git clone https://github.com/TU_USUARIO/PyroStudio.git
   cd PyroStudio
   ```
2. **Instala dependencias del frontend:**
   ```bash
   npm install
   ```
3. **Crea una rama descriptiva** para tu cambio:
   ```bash
   git checkout -b feature/nueva-funcionalidad
   # o
   git checkout -b fix/correccion-error
   ```
4. **Ejecuta la aplicación en modo desarrollo:**
   ```bash
   npm run tauri:dev
   ```

---

## ⚠️ Reglas Críticas del Proyecto (Ver AGENTS.md)

Cualquier contribución que viole estas reglas será rechazada en la revisión de código:

1. **Compilación de Producción:**
   - **NUNCA** ejecutar `cargo build --release` directamente en la carpeta `src-tauri` para generar binarios de usuario. Esto omitirá los assets embebidos del frontend.
   - Usar siempre el pipeline: `npm run build` seguido de `npx tauri build --no-bundle` (en Windows) o `npx tauri build` (en macOS).
2. **Seguridad de Credenciales:**
   - Las contraseñas, tokens y claves privadas **NUNCA** deben guardarse en `localStorage` ni enviarse en texto plano al frontend.
   - Utiliza siempre la bóveda cifrada AES-256-GCM (`credentials.rs`).
3. **Prohibición de Diálogos Nativos del Navegador:**
   - **NUNCA** usar `alert()`, `confirm()`, `prompt()` ni `window.alert()`. Estos diálogos congelan el WebView en Tauri bajo WebKit/WebKitGTK.
   - Utiliza `ConfirmModal` o las acciones globales `useUIStore.getState().showAlert(...)` y `showConfirm(...)`.

---

## 🧪 Validación y Pruebas Obligatorias

Antes de enviar un Pull Request, ejecuta **todas** las pruebas locales:

```bash
# 1. Comprobar formato de código Rust
cargo fmt --check --manifest-path src-tauri/Cargo.toml

# 2. Ejecutar pruebas unitarias de Rust
cargo test --manifest-path src-tauri/Cargo.toml

# 3. Ejecutar pruebas unitarias de Frontend (Vitest)
npm test

# 4. Comprobar tipos TypeScript y empaquetado Vite
npm run build
```

---

## 📝 Formato de Commits y Pull Requests

- **Commits claros y atómicos:** Usa mensajes concisos, preferiblemente siguiendo Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `perf:`).
- **Describe tus pruebas:** Explica qué escenarios probaste, en qué sistema operativo y contra qué motor (MariaDB o MySQL).
- **Vincula el Issue:** Si tu PR resuelve un problema existente, vincúlalo usando `Fixes #123`.

