import path from "path";
import { pathToFileURL } from "url";

/**
 * Dedicated isolated worker process for compiling React applications via Vite.
 * Executed in a child process with:
 * - Stripped environment variables (zero Orbit secrets)
 * - V8 memory ceiling (--max-old-space-size=512)
 * - OS-level process boundary terminating on timeout
 */
process.on("message", async (msg) => {
    if (!msg || msg.type !== "build") {
        return;
    }

    const { tmpDir, fModules } = msg;

    try {
        const vitePath = path.join(fModules, "vite/dist/node/index.js");
        const reactPluginPath = path.join(fModules, "@vitejs/plugin-react/dist/index.js");

        const { build } = await import(pathToFileURL(vitePath).href);
        const reactPlugin = (await import(pathToFileURL(reactPluginPath).href)).default;

        // Construct runtime aliases directly inside worker process to avoid IPC RegExp serialization loss
        const aliases = [
            { find: /^react\/jsx-runtime$/, replacement: path.join(fModules, "react/jsx-runtime.js") },
            { find: /^react\/jsx-dev-runtime$/, replacement: path.join(fModules, "react/jsx-dev-runtime.js") },
            { find: /^react-dom\/client$/, replacement: path.join(fModules, "react-dom/client.js") },
            { find: /^react-dom$/, replacement: path.join(fModules, "react-dom/index.js") },
            { find: /^react$/, replacement: path.join(fModules, "react/index.js") },
            { find: /^lucide-react$/, replacement: path.join(fModules, "lucide-react/dist/esm/lucide-react.mjs") },
            { find: /^clsx$/, replacement: path.join(fModules, "clsx/dist/clsx.mjs") },
            { find: /^tailwind-merge$/, replacement: path.join(fModules, "tailwind-merge/dist/bundle-mjs.mjs") },
            { find: /^framer-motion$/, replacement: path.join(fModules, "framer-motion/dist/es/index.mjs") },
            { find: /^@tanstack\/react-query$/, replacement: path.join(fModules, "@tanstack/react-query/build/modern/index.js") },
        ];

        await build({
            root: tmpDir,
            base: "./",
            configFile: false, // Strict: Never evaluate untrusted vite.config.* from project
            plugins: [reactPlugin()],
            resolve: {
                alias: aliases,
                extensions: [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"],
            },
            build: {
                outDir: "dist",
                emptyOutDir: true,
                write: true,
                minify: true,
            },
            logLevel: "warn",
        });

        if (process.send) {
            process.send({ success: true });
        }
        process.exit(0);
    } catch (err) {
        if (process.send) {
            process.send({
                success: false,
                error: err.message || String(err),
                stack: err.stack,
            });
        }
        process.exit(1);
    }
});
