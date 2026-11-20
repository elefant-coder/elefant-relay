// Copy the built CLI library into the app (works on macOS and Windows).
import { cpSync, rmSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const app = join(dirname(fileURLToPath(import.meta.url)), "..");
rmSync(join(app, "lib"), { recursive: true, force: true });
cpSync(join(app, "..", "dist", "src"), join(app, "lib"), { recursive: true });
copyFileSync(join(app, "..", "package.json"), join(app, "lib", "relay-package.json"));
