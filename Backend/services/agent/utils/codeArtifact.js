import crypto from "node:crypto";

/**
 * Sanitizes and normalizes file paths to prevent directory traversal and invalid paths.
 * Enforces safe relative paths inside the virtual project root.
 *
 * @param {string} rawPath
 * @returns {string}
 */
export const sanitizePath = (rawPath = "") => {
    if (!rawPath || typeof rawPath !== "string") return "index.html";

    let clean = rawPath.trim();

    // Remove Windows drive letters (e.g., C:, D:)
    clean = clean.replace(/^[a-zA-Z]:/, "");

    // Normalize slashes
    clean = clean.replace(/\\+/g, "/");

    // Remove leading slashes and dot-slashes
    clean = clean.replace(/^(\.\/|\/)+/, "");

    // Prevent path traversal sequences
    clean = clean.replace(/\.\.+[/\\]?/g, "");

    // Remove unsafe characters (allow alphanumeric, dots, dashes, underscores, slashes)
    clean = clean.replace(/[^a-zA-Z0-9._\-/]/g, "");

    // Remove double slashes
    clean = clean.replace(/\/+/g, "/");

    // Clean leading or trailing slashes
    clean = clean.replace(/^\/+|\/+$/g, "");

    return clean || "index.html";
};

/**
 * Infers the programming or markup language from a file path.
 *
 * @param {string} filePath
 * @returns {string}
 */
export const detectLanguage = (filePath = "") => {
    const ext = filePath.split(".").pop()?.toLowerCase();
    switch (ext) {
        case "html":
        case "htm":
            return "html";
        case "css":
            return "css";
        case "js":
        case "mjs":
        case "cjs":
            return "javascript";
        case "jsx":
            return "jsx";
        case "ts":
            return "typescript";
        case "tsx":
            return "tsx";
        case "json":
            return "json";
        case "md":
            return "markdown";
        case "py":
            return "python";
        case "sql":
            return "sql";
        case "sh":
        case "bash":
            return "shell";
        default:
            return "text";
    }
};

/**
 * Sanitizes a title string for filenames or identifiers.
 */
export const sanitizeProjectTitle = (title = "Project") => {
    return (
        String(title || "Project")
            .replace(/[^\w\s-]/g, "")
            .trim()
            .slice(0, 60) || "Project"
    );
};

/**
 * Transforms ES module export statements into standard browser-compatible declarations
 * for safe inline execution in sandboxed preview iframes.
 */
export const transformScriptForSandbox = (code = "") => {
    if (!code || typeof code !== "string") return "";
    return code
        .replace(/^export\s+default\s+[a-zA-Z0-9_$]+;?/gm, "")
        .replace(/^export\s+default\s+/gm, "")
        .replace(/^export\s+(const|let|var|function\*?|class|async\s+function\*?)\s+/gm, "$1 ")
        .replace(/^export\s*\{[^}]*\};?/gm, "");
};

/**
 * Inlines CSS and JS files into an HTML entry file, creating a self-contained sandboxed preview.
 * Includes Tailwind CDN if modern styling classes are used, and attaches a safe error catcher.
 *
 * @param {Array<{ path: string, content: string }>} files
 * @param {string} entryPath
 * @returns {string} Fully self-contained HTML
 */
export const bundleCodePreview = (files = [], entryPath = "index.html") => {
    const fileMap = new Map();
    for (const file of files) {
        fileMap.set(file.path.toLowerCase(), file.content);
    }

    let htmlContent = fileMap.get(entryPath.toLowerCase()) || "";

    // If no HTML file is present, look for any .html file
    if (!htmlContent) {
        for (const [path, content] of fileMap.entries()) {
            if (path.endsWith(".html")) {
                htmlContent = content;
                break;
            }
        }
    }

    // If still no HTML, construct a minimal host document for JS/CSS files
    if (!htmlContent) {
        const jsFiles = files.filter((f) => f.path.endsWith(".js") || f.path.endsWith(".jsx"));
        const cssFiles = files.filter((f) => f.path.endsWith(".css"));

        htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 p-6 font-sans">
  <div id="root" class="max-w-4xl mx-auto">
    <div id="app"></div>
  </div>
</body>
</html>`;

        // Append CSS
        for (const css of cssFiles) {
            htmlContent = htmlContent.replace("</head>", `<style>\n${css.content}\n</style>\n</head>`);
        }

        // Append JS
        for (const js of jsFiles) {
            const transformedJs = transformScriptForSandbox(js.content);
            htmlContent = htmlContent.replace("</body>", `<script>\n${transformedJs}\n</script>\n</body>`);
        }
    } else {
        // We have HTML content. Check if we need to inline external CSS / JS that exist in the files list.
        for (const file of files) {
            const fileName = file.path.split("/").pop();
            const escapedFileName = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

            if (file.path.endsWith(".css")) {
                // If HTML references this stylesheet, replace or inline it
                const linkRegex = new RegExp(`<link[^>]*href=["'][^"']*${escapedFileName}["'][^>]*\\/?>`, "gi");
                if (linkRegex.test(htmlContent)) {
                    htmlContent = htmlContent.replace(linkRegex, `<style>\n/* Inlined: ${file.path} */\n${file.content}\n</style>`);
                } else if (!htmlContent.includes(file.content.slice(0, 30))) {
                    if (htmlContent.includes("</head>")) {
                        htmlContent = htmlContent.replace("</head>", `<style>\n/* Inlined: ${file.path} */\n${file.content}\n</style>\n</head>`);
                    } else {
                        htmlContent = `<style>\n/* Inlined: ${file.path} */\n${file.content}\n</style>\n` + htmlContent;
                    }
                }
            }

            if (file.path.endsWith(".js") && !file.path.endsWith(".test.js")) {
                const transformedJs = transformScriptForSandbox(file.content);
                const scriptRegex = new RegExp(`<script[^>]*src=["'][^"']*${escapedFileName}["'][^>]*>(?:\\s*<\\/script>)?`, "gi");
                if (scriptRegex.test(htmlContent)) {
                    htmlContent = htmlContent.replace(scriptRegex, `<script>\n/* Inlined: ${file.path} */\n${transformedJs}\n</script>`);
                } else if (!htmlContent.includes(file.content.slice(0, 30))) {
                    if (htmlContent.includes("</body>")) {
                        htmlContent = htmlContent.replace("</body>", `<script>\n/* Inlined: ${file.path} */\n${transformedJs}\n</script>\n</body>`);
                    } else {
                        htmlContent += `\n<script>\n/* Inlined: ${file.path} */\n${transformedJs}\n</script>`;
                    }
                }
            }
        }

        // Ensure Tailwind CDN is included if not already present
        if (!htmlContent.includes("cdn.tailwindcss.com") && !htmlContent.includes("bootstrap")) {
            if (htmlContent.includes("<head>")) {
                htmlContent = htmlContent.replace("<head>", '<head>\n  <script src="https://cdn.tailwindcss.com"></script>');
            } else if (htmlContent.includes("<html>")) {
                htmlContent = htmlContent.replace("<html>", '<html>\n<head>\n  <script src="https://cdn.tailwindcss.com"></script>\n</head>');
            }
        }
    }

    // Inject CSP (Content Security Policy) to restrict outbound frame/object execution while permitting CDN styles, fonts, and images
    const cspMeta = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' \'unsafe-inline\' \'unsafe-eval\' data: blob: https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://fonts.googleapis.com https://fonts.gstatic.com https://unpkg.com; img-src * data: blob: https:; font-src * data: https:; style-src \'self\' \'unsafe-inline\' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://fonts.googleapis.com; connect-src \'self\' data: blob:; frame-src \'none\'; object-src \'none\'; base-uri \'none\';">';

    // In-memory Storage & Cookie polyfill for strict sandboxed previews (prevents SecurityError when allow-same-origin is omitted)
    const sandboxStorageShim = `
  <script id="orbit-sandbox-shims">
  (function() {
    function createStorageShim() {
      var store = new Map();
      var shim = {
        getItem: function(key) {
          var k = String(key);
          return store.has(k) ? store.get(k) : null;
        },
        setItem: function(key, val) {
          store.set(String(key), String(val));
        },
        removeItem: function(key) {
          store.delete(String(key));
        },
        clear: function() {
          store.clear();
        },
        key: function(index) {
          var keys = Array.from(store.keys());
          return keys[index] !== undefined ? keys[index] : null;
        },
        get length() {
          return store.size;
        }
      };

      return new Proxy(shim, {
        get: function(target, prop, receiver) {
          if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
          if (prop in target || typeof target[prop] === 'function') {
            var val = target[prop];
            return typeof val === 'function' ? val.bind(target) : val;
          }
          return store.has(String(prop)) ? store.get(String(prop)) : undefined;
        },
        set: function(target, prop, val, receiver) {
          if (typeof prop === 'symbol') return Reflect.set(target, prop, val, receiver);
          if (prop in target && typeof target[prop] !== 'function') {
            return Reflect.set(target, prop, val, receiver);
          }
          store.set(String(prop), String(val));
          return true;
        },
        deleteProperty: function(target, prop) {
          if (typeof prop === 'symbol') return Reflect.deleteProperty(target, prop);
          if (prop in target) return false;
          return store.delete(String(prop));
        },
        has: function(target, prop) {
          return prop in target || store.has(String(prop));
        },
        ownKeys: function(target) {
          var builtInKeys = Object.getOwnPropertyNames(target);
          var storedKeys = Array.from(store.keys());
          return Array.from(new Set(builtInKeys.concat(storedKeys)));
        },
        getOwnPropertyDescriptor: function(target, prop) {
          if (prop in target) return Object.getOwnPropertyDescriptor(target, prop);
          if (store.has(String(prop))) {
            return {
              value: store.get(String(prop)),
              writable: true,
              enumerable: true,
              configurable: true
            };
          }
          return undefined;
        }
      });
    }

    var localShim = createStorageShim();
    var sessionShim = createStorageShim();

    var targets = [];
    if (typeof window !== 'undefined') targets.push(window);
    if (typeof Window !== 'undefined' && Window.prototype) targets.push(Window.prototype);

    targets.forEach(function(t) {
      try {
        Object.defineProperty(t, 'localStorage', {
          get: function() { return localShim; },
          set: function() {},
          configurable: true,
          enumerable: true
        });
      } catch (_) {}
      try {
        Object.defineProperty(t, 'sessionStorage', {
          get: function() { return sessionShim; },
          set: function() {},
          configurable: true,
          enumerable: true
        });
      } catch (_) {}
    });

    var docTargets = [];
    if (typeof document !== 'undefined') docTargets.push(document);
    if (typeof Document !== 'undefined' && Document.prototype) docTargets.push(Document.prototype);

    var cookieJar = '';
    docTargets.forEach(function(dt) {
      try {
        Object.defineProperty(dt, 'cookie', {
          get: function() { return cookieJar; },
          set: function(val) { cookieJar = String(val); },
          configurable: true,
          enumerable: true
        });
      } catch (_) {}
    });
  })();
  </script>`;

    if (htmlContent.includes("<head>")) {
        htmlContent = htmlContent.replace("<head>", `<head>\n  ${cspMeta}\n${sandboxStorageShim}`);
    } else if (htmlContent.includes("<html>")) {
        htmlContent = htmlContent.replace("<html>", `<html><head>${cspMeta}\n${sandboxStorageShim}</head>`);
    } else {
        htmlContent = `<head>${cspMeta}\n${sandboxStorageShim}</head>\n${htmlContent}`;
    }

    // Inject iframe error catching banner
    const errorCatcherScript = `
<script>
window.addEventListener('error', function(event) {
  var banner = document.getElementById('orbit-runtime-error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'orbit-runtime-error-banner';
    banner.style.cssText = 'position:fixed;bottom:12px;left:12px;right:12px;background:#ef4444;color:#ffffff;padding:10px 14px;border-radius:8px;font-family:monospace;font-size:12px;z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:space-between;';
    var textSpan = document.createElement('span');
    textSpan.id = 'orbit-runtime-error-text';
    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;color:#fff;font-size:14px;cursor:pointer;padding:0 4px;margin-left:8px;opacity:0.8;';
    closeBtn.onclick = function() { banner.remove(); };
    banner.appendChild(textSpan);
    banner.appendChild(closeBtn);
    document.body.appendChild(banner);
  }
  var span = document.getElementById('orbit-runtime-error-text');
  if (span) span.textContent = 'Runtime error: ' + (event.message || 'Script error');
});
</script>
`;
    if (htmlContent.includes("</body>")) {
        htmlContent = htmlContent.replace("</body>", `${errorCatcherScript}\n</body>`);
    } else {
        htmlContent += errorCatcherScript;
    }

    return htmlContent;
};

/**
 * Normalizes an arbitrary parsed object into a clean CodeArtifact project schema.
 *
 * @param {object} raw
 * @param {string} userPrompt
 * @returns {object} Validated CodeArtifact
 */
export const normalizeCodeProject = (raw = {}, userPrompt = "") => {
    const title = sanitizeProjectTitle(raw.title || raw.name || userPrompt.slice(0, 45) || "Generated Application");
    const description = String(raw.description || raw.summary || `Code implementation for: ${userPrompt.slice(0, 80)}`).trim();
    const entryFile = sanitizePath(raw.entryFile || "index.html");

    let rawFiles = Array.isArray(raw.files) ? raw.files : [];

    // If files was provided as an object { "index.html": "..." }
    if (!Array.isArray(raw.files) && typeof raw.files === "object" && raw.files !== null) {
        rawFiles = Object.entries(raw.files).map(([path, content]) => ({
            path,
            content: typeof content === "string" ? content : JSON.stringify(content, null, 2),
        }));
    }

    const files = [];
    const seenPaths = new Set();

    for (const f of rawFiles) {
        if (!f) continue;
        const rawPath = typeof f === "string" ? f : f.path || f.fileName || f.name;
        const cleanPath = sanitizePath(rawPath);
        if (!cleanPath || seenPaths.has(cleanPath.toLowerCase())) continue;
        seenPaths.add(cleanPath.toLowerCase());

        let content = "";
        if (typeof f.content === "string") {
            content = f.content;
        } else if (f.content && typeof f.content === "object") {
            content = JSON.stringify(f.content, null, 2);
        } else if (typeof f === "string") {
            content = "";
        } else if (f.content !== undefined && f.content !== null) {
            content = String(f.content);
        }

        const language = f.language || detectLanguage(cleanPath);
        if ((language === "javascript" || cleanPath.endsWith(".js")) && content) {
            content = repairIncompleteJavascript(content);
        }
        const size = Buffer.byteLength(content, "utf8");

        files.push({
            path: cleanPath,
            content,
            language,
            size,
        });
    }

    // Determine preview capability
    const hasHtml = files.some((f) => f.path.endsWith(".html"));
    const previewType = hasHtml ? "html" : "code";

    // Resolve entry file: verify entryFile exists among files, otherwise select first .html or first file
    let resolvedEntryFile = entryFile;
    if (!files.some((f) => f.path.toLowerCase() === resolvedEntryFile.toLowerCase())) {
        const firstHtml = files.find((f) => f.path.endsWith(".html"));
        if (firstHtml) {
            resolvedEntryFile = firstHtml.path;
        } else if (files.length > 0) {
            resolvedEntryFile = files[0].path;
        }
    }

    let bundledHtml = "";
    let previewDataUrl = "";

    if (previewType === "html") {
        bundledHtml = bundleCodePreview(files, resolvedEntryFile);
        const base64Html = Buffer.from(bundledHtml, "utf8").toString("base64");
        previewDataUrl = `data:text/html;charset=utf-8;base64,${base64Html}`;
    }

    const artifactId = `code_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const totalSize = files.reduce((acc, f) => acc + f.size, 0);

    return {
        artifactId,
        title,
        description,
        summary: raw.summary || "",
        entryFile: resolvedEntryFile,
        files,
        totalFiles: files.length,
        totalSize,
        previewType,
        previewDataUrl,
        bundledHtml,
        status: "ready",
        deployment: {
            status: "sandbox",
            url: null,
            provider: "Orbit In-App Sandbox",
            note: "Interactive sandbox preview is ready. Cloud hosting (Vercel/Netlify) can be configured via API token.",
        },
    };
};

export const defaultPathByLang = (lang = "") => {
    switch (String(lang || "").toLowerCase()) {
        case "html":
        case "htm":
            return "index.html";
        case "css":
            return "style.css";
        case "python":
        case "py":
            return "main.py";
        case "sql":
            return "query.sql";
        case "json":
            return "data.json";
        case "ts":
        case "typescript":
            return "index.ts";
        case "tsx":
            return "App.tsx";
        case "jsx":
            return "App.jsx";
        case "sh":
        case "bash":
            return "script.sh";
        default:
            return "app.js";
    }
};

/**
 * Extracts multiple files formatted as markdown blocks:
 * e.g.:
 * ### index.html
 * ```html
 * ...
 * ```
 * ### styles.css
 * ```css
 * ...
 * ```
 */
export const parseMarkdownFileBlocks = (text = "", userPrompt = "") => {
    const fileBlocks = [];
    const lines = text.split("\n");

    let currentPath = null;
    let inCodeBlock = false;
    let currentCode = [];
    let currentLang = "";

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Check for file headers like "### index.html", "File: script.js", "**style.css**", or "// index.html"
        const headerMatch =
            trimmed.match(/^#{1,4}\s+`?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)`?/i) ||
            trimmed.match(/^(?:File|Filename|Path):\s*`?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)`?/i) ||
            trimmed.match(/^\*\*`?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)`?\*\*/i);

        if (!inCodeBlock && headerMatch && headerMatch[1]) {
            currentPath = sanitizePath(headerMatch[1]);
            continue;
        }

        // Detect code block fences
        const fenceMatch = trimmed.match(/^```([a-zA-Z0-9_-]*)/);
        if (fenceMatch) {
            if (!inCodeBlock) {
                inCodeBlock = true;
                currentLang = fenceMatch[1] || "";
                currentCode = [];
            } else {
                // End of code block
                inCodeBlock = false;
                const content = currentCode.join("\n");
                const path = currentPath || defaultPathByLang(currentLang);

                fileBlocks.push({
                    path,
                    content,
                    language: currentLang || detectLanguage(path),
                });

                currentPath = null;
                currentCode = [];
                currentLang = "";
            }
            continue;
        }

        if (inCodeBlock) {
            currentCode.push(line);
        }
    }

    if (fileBlocks.length > 0) {
        return normalizeCodeProject(
            {
                title: userPrompt ? userPrompt.slice(0, 50) : "Generated Application",
                files: fileBlocks,
            },
            userPrompt
        );
    }

    return null;
};

/**
 * Repairs a truncated JSON string by closing open strings and unwinding
 * the syntax stack of unclosed objects '{' and arrays '['.
 *
 * @param {string} str
 * @returns {object|null} Parsed object or null
 */
export function repairTruncatedJson(str = "") {
    if (!str || typeof str !== "string") return null;
    let s = str.trim();

    // Strip leading markdown fences
    const fenceStart = s.match(/^```(?:json)?\s*/i);
    if (fenceStart) s = s.slice(fenceStart[0].length);
    // Strip trailing markdown fences if present
    s = s.replace(/```\s*$/, "").trim();

    const startIdx = s.indexOf("{");
    if (startIdx === -1) return null;
    s = s.slice(startIdx);

    let inString = false;
    let isEscaped = false;
    const stack = [];

    for (let i = 0; i < s.length; i++) {
        const char = s[i];
        if (inString) {
            if (isEscaped) {
                isEscaped = false;
            } else if (char === "\\") {
                isEscaped = true;
            } else if (char === '"') {
                inString = false;
            }
        } else {
            if (char === '"') {
                inString = true;
            } else if (char === "{" || char === "[") {
                stack.push(char);
            } else if (char === "}") {
                if (stack.length > 0 && stack[stack.length - 1] === "{") {
                    stack.pop();
                }
            } else if (char === "]") {
                if (stack.length > 0 && stack[stack.length - 1] === "[") {
                    stack.pop();
                }
            }
        }
    }

    let repaired = s;
    if (inString) {
        if (isEscaped) repaired = repaired.slice(0, -1);
        repaired += '"';
    }

    while (stack.length > 0) {
        const open = stack.pop();
        if (open === "{") repaired += "}";
        else if (open === "[") repaired += "]";
    }

    try {
        return JSON.parse(repaired);
    } catch (_) {
        return null;
    }
}

/**
 * Fallback scanner: Extracts completed files from partially truncated JSON
 * using regex patterns when full JSON repair cannot parse.
 *
 * @param {string} text
 * @returns {Array<{ path: string, content: string, language: string }>}
 */
export function extractFilesFromRawJson(text = "") {
    const files = [];
    const seenPaths = new Set();

    // Match { "path": "...", ... "content": "..." }
    const regex1 = /\{\s*"path"\s*:\s*"([^"]+)"\s*,\s*(?:"language"\s*:\s*"([^"]+)"\s*,\s*)?"content"\s*:\s*"((?:[^"\\]|\\.)*?)"/g;
    let match;
    while ((match = regex1.exec(text)) !== null) {
        try {
            const rawPath = match[1];
            const cleanPath = sanitizePath(rawPath);
            if (seenPaths.has(cleanPath.toLowerCase())) continue;
            seenPaths.add(cleanPath.toLowerCase());
            const content = JSON.parse(`"${match[3]}"`);
            const language = match[2] || detectLanguage(cleanPath);
            files.push({ path: cleanPath, language, content });
        } catch (_) {}
    }

    // Match { "content": "...", ... "path": "..." }
    if (files.length === 0) {
        const regex2 = /\{\s*"content"\s*:\s*"((?:[^"\\]|\\.)*?)"\s*,\s*(?:"language"\s*:\s*"([^"]+)"\s*,\s*)?"path"\s*:\s*"([^"]+)"/g;
        while ((match = regex2.exec(text)) !== null) {
            try {
                const rawPath = match[3];
                const cleanPath = sanitizePath(rawPath);
                if (seenPaths.has(cleanPath.toLowerCase())) continue;
                seenPaths.add(cleanPath.toLowerCase());
                const content = JSON.parse(`"${match[1]}"`);
                const language = match[2] || detectLanguage(cleanPath);
                files.push({ path: cleanPath, language, content });
            } catch (_) {}
        }
    }

    return files;
}

/**
 * Repairs incomplete JavaScript source code by commenting out an unclosed trailing line
 * and balancing unclosed curly braces. Never mutates already valid JavaScript.
 *
 * @param {string} code
 * @returns {string}
 */
export function repairIncompleteJavascript(code = "") {
    if (!code || typeof code !== "string") return code;

    // Fast check: If the code is already syntactically valid in JS runtime, DO NOT touch it!
    try {
        new Function(code);
        return code;
    } catch (_) {
        // Code has a syntax error or is incomplete; proceed with careful repair
    }

    let trimmed = code.trimEnd();

    // If the last line ends abruptly (e.g. inside an unfinished assignment or call):
    const lines = trimmed.split("\n");
    if (lines.length > 0) {
        const lastLine = lines[lines.length - 1].trim();
        if (
            lastLine.match(/[=+\-*\/?:,(]\s*$/) ||
            lastLine.match(/\b(const|let|var|function|return|if|else|while|for)\s+[a-zA-Z0-9_$]*\s*$/)
        ) {
            lines[lines.length - 1] = `// [Auto-repaired incomplete statement]: ${lastLine}`;
            trimmed = lines.join("\n");
        }
    }

    // Balance unclosed braces with comment and string awareness
    let openBraces = 0;
    let inStr = false;
    let strChar = "";
    let isEsc = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < trimmed.length; i++) {
        const c = trimmed[i];
        const next = trimmed[i + 1];

        if (inLineComment) {
            if (c === "\n") inLineComment = false;
            continue;
        }

        if (inBlockComment) {
            if (c === "*" && next === "/") {
                inBlockComment = false;
                i++;
            }
            continue;
        }

        if (inStr) {
            if (isEsc) {
                isEsc = false;
            } else if (c === "\\") {
                isEsc = true;
            } else if (c === strChar) {
                inStr = false;
            }
            continue;
        }

        // Check comment starts
        if (c === "/" && next === "/") {
            inLineComment = true;
            i++;
            continue;
        }
        if (c === "/" && next === "*") {
            inBlockComment = true;
            i++;
            continue;
        }

        // Check string starts
        if (c === '"' || c === "'" || c === "`") {
            inStr = true;
            strChar = c;
            continue;
        }

        if (c === "{") {
            openBraces++;
        } else if (c === "}") {
            if (openBraces > 0) openBraces--;
        }
    }

    if (inStr) {
        trimmed += strChar;
    }

    while (openBraces > 0) {
        trimmed += "\n}";
        openBraces--;
    }

    return trimmed;
}

/**
 * Main parser: Parses LLM output into a validated CodeArtifact.
 * Supports:
 * 1. Direct JSON string
 * 2. Fenced JSON code block
 * 3. Outermost JSON object extraction
 * 4. Truncated / partial JSON auto-repair (preserves full multi-file projects upon token cutoff)
 * 5. Direct file object scanner from partial JSON
 * 6. Markdown file block extraction (### filename.js \n ```js)
 * 7. Single code block fallback
 *
 * @param {string} text
 * @param {string} userPrompt
 * @returns {object} Validated CodeArtifact
 */
export const parseCodeArtifact = (text = "", userPrompt = "") => {
    if (!text || typeof text !== "string") {
        return normalizeCodeProject({}, userPrompt);
    }

    // 1. Direct JSON parse
    try {
        const parsed = JSON.parse(text.trim());
        if (parsed && (Array.isArray(parsed.files) || parsed.files || parsed.entryFile)) {
            return normalizeCodeProject(parsed, userPrompt);
        }
    } catch (_) {}

    // 2. Fenced JSON code block
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
    if (jsonMatch && jsonMatch[1]) {
        try {
            const parsed = JSON.parse(jsonMatch[1]);
            if (parsed && (Array.isArray(parsed.files) || parsed.files || parsed.entryFile)) {
                return normalizeCodeProject(parsed, userPrompt);
            }
        } catch (_) {}
    }

    // 3. Outermost JSON object with "files" key
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
            const candidate = text.slice(firstBrace, lastBrace + 1);
            if (candidate.includes('"files"') || candidate.includes('"title"')) {
                const parsed = JSON.parse(candidate);
                if (parsed && (Array.isArray(parsed.files) || parsed.files || parsed.entryFile)) {
                    return normalizeCodeProject(parsed, userPrompt);
                }
            }
        } catch (_) {}
    }

    // 4. Truncated or incomplete JSON auto-repair
    const repaired = repairTruncatedJson(text);
    if (repaired && (Array.isArray(repaired.files) || repaired.files || repaired.entryFile)) {
        return normalizeCodeProject(repaired, userPrompt);
    }

    // 5. Raw file object scanner from partial JSON
    const extractedFiles = extractFilesFromRawJson(text);
    if (extractedFiles.length > 0) {
        return normalizeCodeProject(
            {
                title: userPrompt ? userPrompt.slice(0, 50) : "Generated Application",
                entryFile: extractedFiles.find((f) => f.path.endsWith(".html"))?.path || "index.html",
                files: extractedFiles,
            },
            userPrompt
        );
    }

    // 6. Markdown multi-file blocks (### filename \n ```lang)
    const mdBlocks = parseMarkdownFileBlocks(text, userPrompt);
    if (mdBlocks && mdBlocks.files.length > 0) {
        return mdBlocks;
    }

    // 7. Single standalone code block fallback
    const singleCodeMatch = text.match(/```([a-zA-Z0-9_-]*)\s*([\s\S]*?)\s*```/);
    if (singleCodeMatch) {
        const lang = (singleCodeMatch[1] || "").toLowerCase();
        const code = singleCodeMatch[2];
        const fileName = defaultPathByLang(lang);

        return normalizeCodeProject(
            {
                title: userPrompt ? userPrompt.slice(0, 50) : "Code Snippet",
                entryFile: fileName,
                files: [
                    {
                        path: fileName,
                        content: code,
                        language: lang || detectLanguage(fileName),
                    },
                ],
            },
            userPrompt
        );
    }

    // 8. Generic fallback
    return normalizeCodeProject({}, userPrompt);
};
