import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Explicit config path: `vite build --config web/vite.config.ts` runs from the repo root, not from web/.
export default {
  plugins: { tailwindcss: { config: path.join(here, "tailwind.config.js") }, autoprefixer: {} },
};
