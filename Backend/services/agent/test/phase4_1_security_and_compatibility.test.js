import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

import {
    buildReactProjectToStatic,
    validateInputPayload,
    SUPPORTED_DEPENDENCIES,
} from "../utils/deployment/reactBuildService.js";
import { packProjectZip } from "../utils/deployment/netlifyAdapter.js";

test("Phase 4.1 - Test 1: Generated vite.config.js is ignored and never executed", async () => {
    // Malicious config trying to create a side-effect file on disk
    const sideEffectFile = path.resolve(process.cwd(), "unwanted_side_effect.txt");
    if (fs.existsSync(sideEffectFile)) {
        fs.unlinkSync(sideEffectFile);
    }

    const filesWithMaliciousConfig = [
        {
            path: "vite.config.js",
            content: `
                const fs = require('fs');
                fs.writeFileSync('${sideEffectFile.replace(/\\/g, "/")}', 'COMPROMISED');
                export default {};
            `,
        },
        {
            path: "src/main.jsx",
            content: `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
createRoot(document.getElementById("root")).render(<App />);`,
        },
        {
            path: "src/App.jsx",
            content: `import React from "react";
export default function App() { return <h1>Safe Build</h1>; }`,
        },
    ];

    const result = await buildReactProjectToStatic(filesWithMaliciousConfig, { title: "Config Isolation Test" });

    assert.equal(result.success, true, "Build should succeed while ignoring malicious config");
    assert.equal(fs.existsSync(sideEffectFile), false, "Untrusted vite.config.js must never be executed");
});

test("Phase 4.1 - Test 2: Input size and file count boundaries are enforced", () => {
    // 1. Rejects project with more than 80 files
    const tooManyFiles = Array.from({ length: 85 }, (_, i) => ({
        path: `src/component_${i}.jsx`,
        content: `export default function C${i}() { return null; }`,
    }));
    assert.throws(() => validateInputPayload(tooManyFiles), /maximum file count limit/i);

    // 2. Rejects single file exceeding 2 MB
    const hugeFile = [
        {
            path: "src/huge.jsx",
            content: "a".repeat(2.5 * 1024 * 1024),
        },
    ];
    assert.throws(() => validateInputPayload(hugeFile), /exceeds maximum size limit of 2 MB/i);

    // 3. Rejects total source exceeding 10 MB
    const largeFiles = [
        { path: "src/file1.jsx", content: "b".repeat(1.8 * 1024 * 1024) },
        { path: "src/file2.jsx", content: "b".repeat(1.8 * 1024 * 1024) },
        { path: "src/file3.jsx", content: "b".repeat(1.8 * 1024 * 1024) },
        { path: "src/file4.jsx", content: "b".repeat(1.8 * 1024 * 1024) },
        { path: "src/file5.jsx", content: "b".repeat(1.8 * 1024 * 1024) },
        { path: "src/file6.jsx", content: "b".repeat(1.8 * 1024 * 1024) },
    ];
    assert.throws(() => validateInputPayload(largeFiles), /exceeds 10 MB limit/i);
});

test("Phase 4.1 - Test 3: Process timeout safely kills worker without hanging", async () => {
    const validProject = [
        {
            path: "src/main.jsx",
            content: `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
createRoot(document.getElementById("root")).render(<App />);`,
        },
        {
            path: "src/App.jsx",
            content: `import React from "react";
export default function App() { return <div>Timeout Test</div>; }`,
        },
    ];

    // Force build to time out by passing an ultra-short 10ms timeout
    const startTime = Date.now();
    const result = await buildReactProjectToStatic(validProject, { timeoutMs: 10 });
    const elapsed = Date.now() - startTime;

    assert.equal(result.success, false);
    assert.equal(result.status, "build_failed");
    assert.ok(result.error.includes("timed out"), `Expected timeout error, got: ${result.error}`);
    assert.ok(elapsed < 2000, "Timeout must terminate worker promptly");
});

test("Phase 4.1 - Test 4: Concurrency limit prevents server resource exhaustion", async () => {
    const project = [
        {
            path: "src/main.jsx",
            content: `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
createRoot(document.getElementById("root")).render(<App />);`,
        },
        {
            path: "src/App.jsx",
            content: `import React from "react";
export default function App() { return <h1>Concurrent</h1>; }`,
        },
    ];

    // Fire 3 simultaneous builds when MAX_CONCURRENT_BUILDS = 2
    const p1 = buildReactProjectToStatic(project);
    const p2 = buildReactProjectToStatic(project);
    const p3 = buildReactProjectToStatic(project);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    const busyResult = [r1, r2, r3].find((r) => r.status === "busy");
    assert.ok(busyResult, "At least one build should be rejected with status: 'busy' when capacity is exceeded");
    assert.ok(busyResult.error.includes("busy processing concurrent builds"));
});

test("Phase 4.1 - Test 5: Supported dependency framer-motion bundles cleanly", async () => {
    const motionProject = [
        {
            path: "src/main.jsx",
            content: `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
createRoot(document.getElementById("root")).render(<App />);`,
        },
        {
            path: "src/App.jsx",
            content: `import React from "react";
import { motion } from "framer-motion";
export default function App() {
  return <motion.div animate={{ opacity: 1 }}>Animated</motion.div>;
}`,
        },
    ];

    const result = await buildReactProjectToStatic(motionProject);
    assert.equal(result.success, true, "framer-motion should compile cleanly");
    assert.ok(result.files.some((f) => f.path.startsWith("assets/") && f.path.endsWith(".js")));
});

test("Phase 4.1 - Test 6: Supported dependency @tanstack/react-query bundles cleanly", async () => {
    const queryProject = [
        {
            path: "src/main.jsx",
            content: `import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.jsx";

const queryClient = new QueryClient();
createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);`,
        },
        {
            path: "src/App.jsx",
            content: `import React from "react";
export default function App() { return <h1>Query App</h1>; }`,
        },
    ];

    const result = await buildReactProjectToStatic(queryProject);
    assert.equal(result.success, true, "@tanstack/react-query should compile cleanly");
});

test("Phase 4.1 - Test 7: Unsupported dependency produces clear actionable error", async () => {
    const unsupportedProject = [
        {
            path: "src/main.jsx",
            content: `import React from "react";
import { createRoot } from "react-dom/client";
import { ResponsiveContainer } from "recharts";
import App from "./App.jsx";
createRoot(document.getElementById("root")).render(<App />);`,
        },
        {
            path: "src/App.jsx",
            content: `import React from "react";
export default function App() { return null; }`,
        },
    ];

    const result = await buildReactProjectToStatic(unsupportedProject);
    assert.equal(result.success, false);
    assert.equal(result.status, "build_failed");
    assert.ok(result.error.includes("Unsupported dependency 'recharts' requested"));
    assert.ok(result.error.includes("react, react-dom, lucide-react"));
});

test("Phase 4.1 - Test 8: Netlify packProjectZip automatically provides _redirects for SPA routing", async () => {
    const staticFiles = [
        {
            path: "index.html",
            content: "<!DOCTYPE html><html><body><div id='root'></div></body></html>",
        },
        {
            path: "assets/index.js",
            content: "console.log('spa bundle');",
        },
    ];

    const { preparedFiles } = await packProjectZip(staticFiles, "spa-routing-test");

    const redirectsFile = preparedFiles.find((f) => f.path === "_redirects");
    assert.ok(redirectsFile, "Netlify deploy payload must contain _redirects");
    assert.ok(redirectsFile.content.includes("/*    /index.html   200"), "_redirects must route /* to /index.html with status 200");
});

