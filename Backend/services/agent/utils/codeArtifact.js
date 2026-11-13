import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const MAX_PROJECT_FILES = 50;
export const MAX_PROJECT_TOTAL_SIZE = 5 * 1024 * 1024; // 5 MB
export const MAX_SINGLE_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

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
 * Checks if code content or file path involves React JSX or React DOM components.
 */
export const isJsxOrReactContent = (content = "", path = "") => {
    if (typeof path === "string" && (path.toLowerCase().endsWith(".jsx") || path.toLowerCase().endsWith(".tsx"))) {
        return true;
    }
    if (!content || typeof content !== "string") return false;
    return (
        /<[A-Za-z][A-Za-z0-9_.-]*[\s\S]*\/?>/.test(content) ||
        /className\s*=|onClick\s*=|ReactDOM\.createRoot|ReactDOM\.render|React\.useState|React\.useEffect/.test(content)
    );
};

/**
 * Verified standard versions for widely used browser-compatible packages in Sandpack.
 */
export const KNOWN_PACKAGE_VERSIONS = {
    react: "^18.2.0",
    "react-dom": "^18.2.0",
    "lucide-react": "^0.263.1",
    "date-fns": "^2.30.0",
    recharts: "^2.8.0",
    "react-router-dom": "^6.16.0",
    "canvas-confetti": "^1.9.0",
    clsx: "^2.0.0",
    "tailwind-merge": "^1.14.0",
    uuid: "^9.0.0",
};

/**
 * Checks whether an artifact or a file array represents a modern React project.
 *
 * @param {object|Array} target Artifact object or files array
 * @returns {boolean}
 */
export const isReactProject = (target) => {
    const files = Array.isArray(target) ? target : (Array.isArray(target?.files) ? target.files : []);
    if (files.length === 0) return false;

    return files.some((f) => {
        const p = (f.path || "").toLowerCase();
        if (
            p.endsWith(".jsx") ||
            p.endsWith(".tsx") ||
            p.includes("src/main.") ||
            p.includes("src/app.") ||
            p.includes("components/")
        ) {
            return true;
        }
        if (p === "package.json" && typeof f.content === "string") {
            try {
                const pkg = JSON.parse(f.content);
                const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
                if (all.react || all["react-dom"]) return true;
            } catch {
                // fall through
            }
        }
        if (typeof f.content === "string") {
            if (/from\s+["']react["']/.test(f.content) || /from\s+["']react-dom(\/client)?["']/.test(f.content)) {
                return true;
            }
        }
        return false;
    });
};

/**
 * Extracts bare external npm dependencies from import statements in source code.
 *
 * @param {string} content
 * @returns {string[]}
 */
export const extractNpmDependenciesFromCode = (content = "") => {
    if (typeof content !== "string" || !content) return [];
    const deps = new Set();
    const importRegex = /(?:import\s+(?:[\w*\s{},]*\s+from\s+)?|import\s*\(?)\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
        const specifier = match[1].trim();
        // Skip relative paths, absolute paths, or URLs
        if (
            specifier.startsWith(".") ||
            specifier.startsWith("/") ||
            specifier.startsWith("http://") ||
            specifier.startsWith("https://")
        ) {
            continue;
        }
        // Extract package name (handles scoped packages like @scope/pkg)
        let pkgName = specifier;
        if (specifier.startsWith("@")) {
            const parts = specifier.split("/");
            pkgName = parts.slice(0, 2).join("/");
        } else {
            pkgName = specifier.split("/")[0];
        }
        if (pkgName && pkgName !== "node") {
            deps.add(pkgName);
        }
    }
    return Array.from(deps);
};

/**
 * Creates a structured integrity error object that is backwards-compatible
 * with string assertions (e.g. `err.includes(...)`, `String(err)`).
 *
 * @param {object} params
 * @param {string} params.type Error classification code
 * @param {string|null} [params.file] File where the error occurred
 * @param {string|null} [params.importPath] Import specifier
 * @param {string|null} [params.resolvedPath] Resolved path
 * @param {string} params.message Human-readable error message
 * @returns {String} Enhanced String object with structured properties
 */
export const createIntegrityError = ({ type, file = null, importPath = null, resolvedPath = null, message }) => {
    const err = new String(message);
    err.type = type;
    err.file = file;
    err.importPath = importPath;
    err.resolvedPath = resolvedPath;
    err.message = message;
    return err;
};

/**
 * Detailed resolution of a relative import path against the current file's directory.
 * Detects path traversal attempts that escape the project root.
 *
 * @param {string} importPath Relative import (e.g. "./components/Card.jsx", "../styles/index.css")
 * @param {string} currentFilePath Current file path (e.g. "src/App.jsx")
 * @returns {{ resolvedPath: string|null, isRelative: boolean, isPathTraversal: boolean, error: string|null }}
 */
export const resolveRelativeImportDetailed = (importPath = "", currentFilePath = "") => {
    if (!importPath || typeof importPath !== "string" || !importPath.startsWith(".")) {
        return { resolvedPath: null, isRelative: false, isPathTraversal: false, error: "NOT_RELATIVE" };
    }
    const cleanCurrent = sanitizePath(currentFilePath);
    const currentDir = cleanCurrent.includes("/")
        ? cleanCurrent.slice(0, cleanCurrent.lastIndexOf("/"))
        : "";
    const baseSegments = currentDir ? currentDir.split("/") : [];
    const importSegments = importPath.split("/");

    let isPathTraversal = false;
    for (const seg of importSegments) {
        if (!seg || seg === ".") continue;
        if (seg === "..") {
            if (baseSegments.length === 0) {
                isPathTraversal = true;
            } else {
                baseSegments.pop();
            }
        } else {
            baseSegments.push(seg);
        }
    }

    if (isPathTraversal) {
        return {
            resolvedPath: null,
            isRelative: true,
            isPathTraversal: true,
            error: "PATH_TRAVERSAL",
        };
    }

    return {
        resolvedPath: baseSegments.join("/"),
        isRelative: true,
        isPathTraversal: false,
        error: null,
    };
};

/**
 * Resolves a relative import path against the current file's directory.
 *
 * @param {string} importPath Relative import (e.g. "./components/Card.jsx", "../styles/index.css")
 * @param {string} currentFilePath Current file path (e.g. "src/App.jsx")
 * @returns {string|null} Resolved relative path without leading slash, or null if invalid/traversal
 */
export const resolveRelativeImport = (importPath = "", currentFilePath = "") => {
    const detailed = resolveRelativeImportDetailed(importPath, currentFilePath);
    return detailed.resolvedPath;
};

/**
 * Extracts all relative / local import specifiers from source code,
 * ignoring commented-out imports, external npm packages, and absolute URLs.
 *
 * Supports:
 * - Static imports: import App from "./App.jsx"; import "./styles.css";
 * - Re-exports: export { x } from "./x"; export * from "./x";
 * - Dynamic imports: import("./dynamicModule")
 * - CommonJS require: require("./localModule")
 * - CSS @import: @import "./theme.css";
 *
 * @param {string} code
 * @returns {string[]} Array of unique relative import paths
 */
export const extractLocalImportsFromCode = (code = "") => {
    if (!code || typeof code !== "string") return [];

    // Strip comments to prevent false positives from commented-out code
    const cleanCode = code
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/[^\r\n]*/g, "$1");

    const imports = new Set();

    // 1. Static ES imports & re-exports:
    const staticImportRegex = /(?:^|\n|;)\s*(?:import|export)\s+(?:[\w*\s{},$]+from\s+)?['"](\.[^'"]+)['"]/g;
    let match;
    while ((match = staticImportRegex.exec(cleanCode)) !== null) {
        if (match[1]) imports.add(match[1].trim());
    }

    // 2. Dynamic imports: import("./dynamicModule")
    const dynamicImportRegex = /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    while ((match = dynamicImportRegex.exec(cleanCode)) !== null) {
        if (match[1]) imports.add(match[1].trim());
    }

    // 3. CommonJS require: require("./localModule")
    const requireRegex = /\brequire\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(cleanCode)) !== null) {
        if (match[1]) imports.add(match[1].trim());
    }

    // 4. CSS @import: @import "./theme.css";
    const cssImportRegex = /@import\s+(?:url\s*\(\s*)?['"](\.[^'"]+)['"](?:\s*\))?/g;
    while ((match = cssImportRegex.exec(cleanCode)) !== null) {
        if (match[1]) imports.add(match[1].trim());
    }

    return Array.from(imports);
};

/**
 * Analyzes how an imported module or component is used in the parent source code.
 * Extracts default and named import identifiers, passed JSX props, event handlers, and data bindings.
 *
 * @param {string} targetPath File path of the module being imported
 * @param {string} [parentContent] Source code of the file importing it
 * @returns {{
 *   componentName: string,
 *   namedImports: string[],
 *   props: string[],
 *   handlers: string[],
 *   dataProps: string[],
 *   hasChildren: boolean,
 *   isForm: boolean,
 *   isList: boolean,
 *   isModal: boolean,
 *   isCard: boolean
 * }}
 */
export const analyzeComponentUsage = (targetPath = "", parentContent = "") => {
    const fileName = targetPath.includes("/") ? targetPath.slice(targetPath.lastIndexOf("/") + 1) : targetPath;
    const baseName = fileName.replace(/\.[^.]+$/, "");

    let componentName = baseName;
    const namedImports = [];

    if (parentContent && typeof parentContent === "string") {
        const cleanCode = parentContent
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/(^|[^:])\/\/[^\r\n]*/g, "$1");

        const importRegex = /(?:import|export)\s+(?:([a-zA-Z0-9_$]+)\s*,?\s*)?(?:\{([^}]*)\}\s*)?from\s*['"]([^'"]+)['"]/g;
        let match;
        while ((match = importRegex.exec(cleanCode)) !== null) {
            const specifier = match[3];
            if (specifier.includes(baseName) || targetPath.includes(specifier.replace(/^\.\//, ""))) {
                if (match[1]) componentName = match[1].trim();
                if (match[2]) {
                    const names = match[2]
                        .split(",")
                        .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
                        .filter(Boolean);
                    namedImports.push(...names);
                }
            }
        }
    }

    const propNames = new Set();
    const handlers = new Set();
    const dataProps = new Set();
    let hasChildren = false;

    if (parentContent && componentName) {
        // Find JSX tag occurrences: <ComponentName prop1="val" prop2={val} ...>
        const jsxRegex = new RegExp(`<${componentName}\\b([\\s\\S]*?)(?:\\/>|>)`, "g");
        let jsxMatch;
        while ((jsxMatch = jsxRegex.exec(parentContent)) !== null) {
            const attrBlock = jsxMatch[1];
            const attrRegex = /([a-zA-Z0-9_$]+)(?:\s*=\s*(?:\{([^}]*)\}|"([^"]*)"|'([^']*)'))?/g;
            let attrMatch;
            while ((attrMatch = attrRegex.exec(attrBlock)) !== null) {
                const prop = attrMatch[1];
                if (["key", "ref", "className", "style"].includes(prop)) continue;
                propNames.add(prop);
                if (/^on[A-Z]/.test(prop)) {
                    handlers.add(prop);
                } else {
                    dataProps.add(prop);
                }
            }
        }

        const closingRegex = new RegExp(`<${componentName}\\b[^>]*>[\\s\\S]*?<\\/${componentName}>`);
        if (closingRegex.test(parentContent)) {
            hasChildren = true;
        }
    }

    const propsList = Array.from(propNames);
    const isForm = handlers.has("onChange") || handlers.has("onSubmit") || /form/i.test(componentName);
    const isList = propsList.some((p) => /s$|list|items|data|entries/i.test(p)) && (handlers.has("onDelete") || handlers.has("onSelect") || handlers.has("onAdd") || isForm);
    const isModal = propsList.some((p) => /open|close|visible|show/i.test(p)) || handlers.has("onClose");
    const isCard = propsList.some((p) => /title|value|metric|count|amount|icon|subtitle/i.test(p));

    return {
        componentName,
        namedImports,
        props: propsList,
        handlers: Array.from(handlers),
        dataProps: Array.from(dataProps),
        hasChildren,
        isForm,
        isList,
        isModal,
        isCard,
    };
};

let cachedBabelParser = undefined;

/**
 * Resolves the Babel parser instance dynamically from available node_modules.
 *
 * @returns {Function|null} Babel parse function
 */
export const getBabelParser = () => {
    if (cachedBabelParser !== undefined) return cachedBabelParser;
    try {
        const require = createRequire(import.meta.url);
        const thisDir = path.dirname(fileURLToPath(import.meta.url));
        const candidatePaths = [
            path.resolve(thisDir, "../../../../Frontend/node_modules/@babel/parser/lib/index.js"),
            path.resolve(thisDir, "../node_modules/@babel/parser/lib/index.js"),
            path.resolve(thisDir, "../../node_modules/@babel/parser/lib/index.js"),
            path.resolve(process.cwd(), "Frontend/node_modules/@babel/parser/lib/index.js"),
            path.resolve(process.cwd(), "../Frontend/node_modules/@babel/parser/lib/index.js"),
            path.resolve(process.cwd(), "../../Frontend/node_modules/@babel/parser/lib/index.js"),
            path.resolve(process.cwd(), "../../../Frontend/node_modules/@babel/parser/lib/index.js"),
        ];
        for (const p of candidatePaths) {
            if (fs.existsSync(p)) {
                const mod = require(p);
                cachedBabelParser = mod.parse || mod.default?.parse || mod;
                return cachedBabelParser;
            }
        }
        const direct = require("@babel/parser");
        cachedBabelParser = direct.parse || direct.default?.parse || direct;
        return cachedBabelParser;
    } catch (_) {
        cachedBabelParser = null;
        return null;
    }
};

/**
 * Validates the JavaScript, JSX, JSON, or stylesheet syntax of a code file.
 * Detects unterminated strings, unclosed brackets/tags, and bundler compilation errors.
 *
 * @param {string} filePath
 * @param {string} content
 * @returns {{ valid: boolean, error?: string }}
 */
export const checkFileSyntax = (filePath = "", content = "") => {
    if (!content || typeof content !== "string") {
        return { valid: false, error: "File content is empty or not a string." };
    }

    const cleanPath = filePath.toLowerCase();

    // 1. JSON file syntax check
    if (cleanPath.endsWith(".json")) {
        try {
            JSON.parse(content);
            return { valid: true };
        } catch (e) {
            return { valid: false, error: `Invalid JSON syntax: ${e.message}` };
        }
    }

    const isCodeFile = /\.(jsx?|tsx?)$/i.test(cleanPath);
    if (!isCodeFile) return { valid: true };

    // 2. High-precision Babel AST parser validation
    const parser = getBabelParser();
    if (typeof parser === "function") {
        try {
            parser(content, { sourceType: "module", plugins: ["jsx", "typescript"] });
            return { valid: true };
        } catch (err) {
            return { valid: false, error: err.message };
        }
    }

    // 3. Fallback heuristic check if Babel parser is unavailable
    const trimmed = content.trim();
    if (
        trimmed.endsWith('="') ||
        trimmed.endsWith("='") ||
        trimmed.endsWith("={") ||
        trimmed.endsWith("className=") ||
        trimmed.endsWith("<") ||
        /<[a-zA-Z0-9_$]+[^>]*$/.test(trimmed) ||
        /onClick=\{[^}]*$/.test(trimmed) ||
        /onChange=\{[^}]*$/.test(trimmed)
    ) {
        return { valid: false, error: "File appears truncated mid-attribute or mid-tag." };
    }

    return { valid: true };
};

/**
 * Parses JSX opening, closing, and self-closing tags while properly respecting
 * Javascript expressions inside curly braces (e.g. arrow functions in callbacks: onClick={() => ...}).
 *
 * @param {string} code
 * @returns {Array<{ name: string, isClosing: boolean, isSelf: boolean }>}
 */
export const parseJsxTags = (code = "") => {
    const tags = [];
    let i = 0;
    while (i < code.length) {
        if (code[i] === "<") {
            const rest = code.slice(i);
            // Check closing tag: </TagName>
            const closeMatch = rest.match(/^<\/\s*([A-Za-z0-9_$-]+)\s*>/);
            if (closeMatch) {
                tags.push({ isClosing: true, isSelf: false, name: closeMatch[1] });
                i += closeMatch[0].length;
                continue;
            }
            // Check opening tag: <TagName
            const openMatch = rest.match(/^<([A-Za-z0-9_$-]+)/);
            if (openMatch && !/^[0-9]/.test(openMatch[1])) {
                const tagName = openMatch[1];
                let j = i + openMatch[0].length;
                let inBrace = 0;
                let inQ = false, qChar = "";
                let isSelf = false;
                while (j < code.length) {
                    const ch = code[j];
                    if (inQ) {
                        if (ch === qChar) inQ = false;
                    } else if (ch === '"' || ch === "'") {
                        inQ = true;
                        qChar = ch;
                    } else if (ch === "{") {
                        inBrace++;
                    } else if (ch === "}") {
                        if (inBrace > 0) inBrace--;
                    } else if (inBrace === 0 && ch === ">") {
                        const prev = code.slice(i, j).trimEnd();
                        if (prev.endsWith("/")) isSelf = true;
                        j++;
                        break;
                    }
                    j++;
                }
                tags.push({ isClosing: false, isSelf, name: tagName });
                i = j;
                continue;
            }
        }
        i++;
    }
    return tags;
};

/**
 * Repairs truncated or malformed source code in-place without discarding existing user logic.
 * Balances JSX tags, unclosed strings, missing closing brackets/parentheses/braces,
 * and fixes broken import/export lines.
 *
 * @param {string} filePath
 * @param {string} content
 * @returns {string|null} Repaired code string if syntax becomes valid, or null if unrepairable.
 */
export const repairCodeFileSyntax = (filePath = "", content = "") => {
    if (!content || typeof content !== "string") return content;
    if (checkFileSyntax(filePath, content).valid) return content;

    // 1. Line-by-line single/double quote repair (standard strings cannot cross line boundaries)
    const rawLines = content.split("\n");
    for (let i = 0; i < rawLines.length; i++) {
        let line = rawLines[i];
        let inD = false, inS = false, esc = false;
        for (let j = 0; j < line.length; j++) {
            const ch = line[j];
            if (esc) { esc = false; continue; }
            if (ch === "\\") { esc = true; continue; }
            if (ch === '"' && !inS) inD = !inD;
            else if (ch === "'" && !inD) inS = !inS;
        }
        if (inD) line += '"';
        if (inS) line += "'";
        rawLines[i] = line;
    }
    let text = rawLines.join("\n").trimEnd();

    // 2. Clean broken imports/exports (e.g. import { from "react"; or empty/broken exports)
    text = text.replace(/import\s*\{\s*\}\s*from\s*['"][^'"]+['"];?\n?/g, "");
    text = text.replace(/import\s*\{\s*from\s*['"][^'"]+['"];?\n?/g, "");
    text = text.replace(/export\s*\{\s*\}\s*;?\n?/g, "");
    text = text.replace(/export\s*\{\s*;\n?/g, "");

    // 3. Fix unclosed template literals
    let inTemplate = false;
    let isEscaped = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (isEscaped) {
            isEscaped = false;
            continue;
        }
        if (ch === "\\") {
            isEscaped = true;
            continue;
        }
        if (ch === "`") inTemplate = !inTemplate;
    }
    if (inTemplate) text += "`";

    // 4. Fix truncated JSX attributes or open tags at the end of the file
    let lines = text.split("\n");
    if (lines.length > 0) {
        let last = lines[lines.length - 1].trimEnd();
        const trimmedLast = last.trim();
        // Attribute open: onClick={something without closing }
        if (/\{[^}]*$/.test(last)) {
            last += "}";
        }
        // Check if last line or whole text ends in an unclosed JSX opening tag
        if (/<[A-Za-z0-9_$]+[^>]*$/.test(last)) {
            last += " />";
        } else if (
            /^[a-zA-Z0-9_$-]+=\{[\s\S]*\}\s*$/.test(trimmedLast) ||
            /^[a-zA-Z0-9_$-]+="[^"]*"\s*$/.test(trimmedLast) ||
            /^[a-zA-Z0-9_$-]+='[^']*'\s*$/.test(trimmedLast)
        ) {
            last += " />";
        }
        lines[lines.length - 1] = last;
        text = lines.join("\n");
    }

    // Double check if any opening tag across lines was left without '>': e.g. <button \n onClick={...}
    if (/<[A-Za-z0-9_$]+[^>]*$/.test(text)) {
        text += " />";
    }

    // 5. Detect and balance JSX tags using robust parser
    const returnSuffixMatch = text.match(/(\n?\s*\);\s*(?:\}\s*)?)$/);
    let mainBody = text;
    let returnSuffix = "";
    if (returnSuffixMatch) {
        mainBody = text.slice(0, returnSuffixMatch.index);
        returnSuffix = returnSuffixMatch[1];
    }

    const selfClosing = new Set([
        "area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr"
    ]);

    const getOpenTags = (code) => {
        const tagList = parseJsxTags(code);
        const tagStack = [];
        for (const t of tagList) {
            if (t.isSelf || selfClosing.has(t.name.toLowerCase())) continue;
            if (t.isClosing) {
                if (tagStack.length > 0 && tagStack[tagStack.length - 1] === t.name) {
                    tagStack.pop();
                }
            } else {
                tagStack.push(t.name);
            }
        }
        return tagStack;
    };

    // If truncated inside an array map expression: {items.map(it => ( <div ...
    const hasUnclosedMap = /\.map\s*\([\s\S]*=>\s*\(/.test(text) && !text.includes("))}");
    if (hasUnclosedMap) {
        const tagStack = getOpenTags(mainBody);
        let mapRepair = mainBody;
        if (tagStack.length > 0) {
            mapRepair += `\n</${tagStack.pop()}>`;
        }
        mapRepair += "\n))}";
        while (tagStack.length > 0) {
            mapRepair += `\n</${tagStack.pop()}>`;
        }
        mapRepair += "\n);\n}";
        if (checkFileSyntax(filePath, mapRepair).valid) {
            return mapRepair;
        }
    }

    // Standard LIFO tag balancing
    const tagStack = getOpenTags(mainBody);
    while (tagStack.length > 0) {
        const t = tagStack.pop();
        mainBody += `\n</${t}>`;
    }

    text = mainBody + returnSuffix;

    // 6. Balance parentheses, brackets, and curly braces
    let openParens = 0;
    let openBrackets = 0;
    let openBraces = 0;
    let inStr = false;
    let strChar = "";
    let esc = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const next = text[i + 1];

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
            if (esc) esc = false;
            else if (c === "\\") esc = true;
            else if (c === strChar) inStr = false;
            continue;
        }
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
        if (c === '"' || c === "'" || c === "`") {
            inStr = true;
            strChar = c;
            continue;
        }

        if (c === "(") openParens++;
        else if (c === ")") { if (openParens > 0) openParens--; }
        else if (c === "[") openBrackets++;
        else if (c === "]") { if (openBrackets > 0) openBrackets--; }
        else if (c === "{") openBraces++;
        else if (c === "}") { if (openBraces > 0) openBraces--; }
    }

    while (openParens > 0) {
        text += "\n);";
        openParens--;
    }
    while (openBrackets > 0) {
        text += "\n]";
        openBrackets--;
    }
    while (openBraces > 0) {
        text += "\n}";
        openBraces--;
    }

    if (checkFileSyntax(filePath, text).valid) {
        return text;
    }

    // Fallback: Check if missing final semicolon
    if (!text.endsWith(";")) {
        if (checkFileSyntax(filePath, text + ";").valid) return text + ";";
    }

    return null;
};

/**
 * Synthesizes a high-quality, production-ready replacement for an omitted React component or stylesheet.
 * Analyzes the importing file's usage, JSX attributes, and expected props to generate tailored implementations.
 *
 * @param {string} targetPath File path to synthesize
 * @param {string} [parentContent] Content of the file importing this missing component
 * @returns {string} Source code of synthesized component
 */
export const synthesizeMissingComponent = (targetPath = "", parentContent = "") => {
    const fileName = targetPath.includes("/") ? targetPath.slice(targetPath.lastIndexOf("/") + 1) : targetPath;
    const baseName = fileName.replace(/\.[^.]+$/, "");
    const usage = analyzeComponentUsage(targetPath, parentContent);
    const componentName = usage.componentName || baseName;

    // 1. Missing stylesheet
    if (targetPath.endsWith(".css")) {
        return `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    @apply bg-slate-900 text-slate-100 antialiased min-h-screen;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  }
}

@media print {
  body {
    background: white !important;
    color: black !important;
  }
  .no-print {
    display: none !important;
  }
  .printable {
    box-shadow: none !important;
    border: none !important;
  }
}
`;
    }

    // 2. Named function exports (for JS/TS utilities or helper modules)
    if (usage.namedImports.length > 0 && !targetPath.endsWith(".jsx") && !targetPath.endsWith(".tsx")) {
        const exportsList = usage.namedImports.map((fn) => {
            if (/format|display|print/i.test(fn)) {
                return `export const ${fn} = (val) => (val != null ? String(val) : "");`;
            }
            if (/calculate|calc|sum|total|count/i.test(fn)) {
                return `export const ${fn} = (...args) => args.reduce((acc, n) => acc + (Number(n) || 0), 0);`;
            }
            if (/is[A-Z]|has[A-Z]|validate/i.test(fn)) {
                return `export const ${fn} = (val) => Boolean(val);`;
            }
            return `export const ${fn} = (arg) => arg;`;
        });
        return `${exportsList.join("\n\n")}\n\nexport default {\n  ${usage.namedImports.join(",\n  ")}\n};\n`;
    }

    // 2b. Custom Hooks (e.g. useCalculator.js, useTheme.js, useResume.js)
    if (targetPath.includes("/hooks/") || /^use[A-Z]/.test(baseName)) {
        if (/calc/i.test(baseName)) {
            return `import { useState } from "react";

export function ${componentName}() {
  const [display, setDisplay] = useState("0");
  const [formula, setFormula] = useState("");
  const [history, setHistory] = useState([]);

  const pressKey = (key) => {
    if (key === "C" || key === "AC") {
      setDisplay("0");
      setFormula("");
    } else if (key === "=") {
      try {
        const evalResult = String(Function('"use strict";return (' + (formula || display) + ')')());
        setDisplay(evalResult);
        setHistory((prev) => [{ formula: formula || display, result: evalResult }, ...prev]);
        setFormula("");
      } catch {
        setDisplay("Error");
      }
    } else {
      setDisplay((prev) => (prev === "0" ? key : prev + key));
      setFormula((prev) => prev + key);
    }
  };

  const clearAll = () => {
    setDisplay("0");
    setFormula("");
  };

  return { display, formula, history, pressKey, clearAll, result: display };
}

export default ${componentName};
`;
        }
        if (/theme/i.test(baseName)) {
            return `import { useState, useEffect } from "react";

export function ${componentName}() {
  const [theme, setTheme] = useState("light");
  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return { theme, toggleTheme };
}

export default ${componentName};
`;
        }
        return `import { useState } from "react";

export function ${componentName}() {
  const [state, setState] = useState({});
  return { state, setState };
}

export default ${componentName};
`;
    }

    // 2c. Declarative Constants (e.g. src/constants/keypadLayout.js)
    if (targetPath.includes("/constants/") || /layout|config|constants/i.test(baseName)) {
        if (/calc|keypad|button/i.test(baseName)) {
            return `export const KEYPAD_BUTTONS = [
  { label: "C", type: "clear", span: 1 },
  { label: "+/-", type: "function", span: 1 },
  { label: "%", type: "function", span: 1 },
  { label: "/", type: "operator", span: 1 },
  { label: "7", type: "digit", span: 1 },
  { label: "8", type: "digit", span: 1 },
  { label: "9", type: "digit", span: 1 },
  { label: "*", type: "operator", span: 1 },
  { label: "4", type: "digit", span: 1 },
  { label: "5", type: "digit", span: 1 },
  { label: "6", type: "digit", span: 1 },
  { label: "-", type: "operator", span: 1 },
  { label: "1", type: "digit", span: 1 },
  { label: "2", type: "digit", span: 1 },
  { label: "3", type: "digit", span: 1 },
  { label: "+", type: "operator", span: 1 },
  { label: "0", type: "digit", span: 2 },
  { label: ".", type: "digit", span: 1 },
  { label: "=", type: "equals", span: 1 },
];

export default KEYPAD_BUTTONS;
`;
        }
    }

    // 2d. Domain Engines & Utilities (e.g. calculatorEngine.js, formatters.js)
    if (/engine|math|calc.*util/i.test(baseName)) {
        return `export const evaluateExpression = (expr) => {
  try {
    const sanitized = String(expr).replace(/[^0-9+\\-*\\/().%]/g, "");
    if (!sanitized) return "0";
    return String(Function('"use strict";return (' + sanitized + ')')());
  } catch {
    return "Error";
  }
};

export const formatDisplayNumber = (num) => {
  if (!num || isNaN(Number(num))) return String(num || "0");
  const parts = String(num).split(".");
  parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
  return parts.join(".");
};

export default { evaluateExpression, formatDisplayNumber };
`;
    }

    // 2e. ThemeToggle / ModeSwitch Component
    if (/theme.*toggle|toggle.*theme|theme.*switch|dark.*mode/i.test(baseName)) {
        return `import React from "react";
import { Sun, Moon } from "lucide-react";

export default function ${componentName}({
  theme,
  setTheme,
  onToggle,
  toggleTheme,
  dark,
  isDark,
}) {
  const currentDark = Boolean(dark || isDark || theme === "dark");

  const handleToggle = () => {
    if (typeof onToggle === "function") {
      onToggle();
    } else if (typeof toggleTheme === "function") {
      toggleTheme();
    } else if (typeof setTheme === "function") {
      setTheme((prev) => (prev === "dark" ? "light" : "dark"));
    }
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      className="inline-flex items-center justify-center size-9 rounded-xl border border-white/10 bg-slate-800/80 hover:bg-slate-700/80 text-amber-400 hover:text-amber-300 transition-colors shadow-sm cursor-pointer"
      title={currentDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle theme"
    >
      {currentDark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
`;
    }

    // 2f. HistoryDrawer / Calculation History Component
    if (/history.*drawer|history.*modal|history.*panel|calc.*history|^history$/i.test(baseName)) {
        return `import React from "react";
import { History, X, Trash2 } from "lucide-react";

export default function ${componentName}({
  isOpen,
  open,
  isHistoryOpen,
  onToggle,
  onClose,
  setIsHistoryOpen,
  history = [],
  items = [],
  onSelect,
  clearHistory,
  onClear,
}) {
  const isVisible = Boolean(isOpen ?? open ?? isHistoryOpen);
  const calculationHistory = Array.isArray(history) && history.length > 0
    ? history
    : (Array.isArray(items) && items.length > 0 ? items : []);

  const handleClose = () => {
    if (typeof onClose === "function") onClose();
    else if (typeof onToggle === "function") onToggle();
    else if (typeof setIsHistoryOpen === "function") setIsHistoryOpen(false);
  };

  const handleSelect = (item) => {
    if (typeof onSelect === "function") onSelect(item);
  };

  const handleClear = () => {
    if (typeof clearHistory === "function") clearHistory();
    else if (typeof onClear === "function") onClear();
  };

  if (!isVisible) {
    return (
      <button
        type="button"
        onClick={() => {
          if (typeof onToggle === "function") onToggle();
          else if (typeof setIsHistoryOpen === "function") setIsHistoryOpen(true);
        }}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/90 px-3.5 py-2 text-xs font-medium text-slate-300 shadow-xl backdrop-blur hover:bg-slate-800 hover:text-white transition cursor-pointer"
        title="View calculation history"
      >
        <History size={14} className="text-amber-400" />
        <span>History</span>
        {calculationHistory.length > 0 && (
          <span className="size-4 rounded-full bg-amber-500/20 text-amber-300 text-[10px] flex items-center justify-center font-bold">
            {calculationHistory.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-80 max-w-full h-full bg-slate-950 border-l border-white/10 p-4 sm:p-5 flex flex-col shadow-2xl text-slate-100">
        <div className="flex items-center justify-between pb-3.5 border-b border-white/10">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <History size={16} className="text-amber-400" />
            <span>Calculation History</span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition cursor-pointer"
            title="Close history"
          >
            <X size={17} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-3 space-y-2">
          {calculationHistory.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs italic">
              No calculations recorded yet.
            </div>
          ) : (
            calculationHistory.map((item, idx) => {
              const expr = typeof item === "object" ? (item.expression || item.formula || JSON.stringify(item)) : String(item);
              const res = typeof item === "object" ? (item.result ?? item.value ?? "") : "";
              return (
                <div
                  key={idx}
                  onClick={() => handleSelect(item)}
                  className="p-2.5 rounded-xl bg-slate-900 border border-white/5 hover:border-amber-500/40 hover:bg-slate-800/80 cursor-pointer transition text-right group"
                  title="Click to recall calculation"
                >
                  <div className="text-xs text-slate-400 font-mono truncate">{expr}</div>
                  {res !== "" && (
                    <div className="text-base font-bold text-amber-400 font-mono mt-0.5 group-hover:text-amber-300">
                      = {res}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="pt-3 border-t border-white/10 flex items-center justify-between">
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-rose-400 transition cursor-pointer"
          >
            <Trash2 size={13} />
            <span>Clear</span>
          </button>
          <span className="text-[11px] text-slate-500 font-mono">
            {calculationHistory.length} {calculationHistory.length === 1 ? "entry" : "entries"}
          </span>
        </div>
      </div>
    </div>
  );
}
`;
    }

    // 3. Domain-specific Resume Builder components
    if (/project.*form/i.test(baseName)) {
        return `import React, { useState, useEffect } from "react";
import { Plus, X, FolderGit2 } from "lucide-react";

export default function ProjectsForm({ data, onChange }) {
  const [projects, setProjects] = useState(Array.isArray(data) ? data : []);

  useEffect(() => {
    if (Array.isArray(data)) {
      setProjects(data);
    }
  }, [data]);

  const addProject = () => {
    const updated = [
      ...projects,
      {
        id: Date.now(),
        name: "",
        role: "",
        technologies: "",
        link: "",
        start: "",
        end: "",
        description: "",
      },
    ];
    setProjects(updated);
    onChange?.(updated);
  };

  const updateProject = (id, field, value) => {
    const updated = projects.map((p) => (p.id === id ? { ...p, [field]: value } : p));
    setProjects(updated);
    onChange?.(updated);
  };

  const removeProject = (id) => {
    const updated = projects.filter((p) => p.id !== id);
    setProjects(updated);
    onChange?.(updated);
  };

  return (
    <section className="bg-white p-4 rounded shadow">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-medium flex items-center gap-2">
          <FolderGit2 size={18} className="text-indigo-600" /> Projects
        </h3>
        <button
          type="button"
          onClick={addProject}
          className="flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          <Plus size={16} className="mr-1" /> Add Project
        </button>
      </div>

      {projects.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No projects added yet.</p>
      ) : (
        projects.map((proj) => (
          <div key={proj.id} className="border rounded p-3 mb-3 bg-gray-50">
            <div className="flex justify-between items-center mb-2">
              <input
                placeholder="Project Name (e.g. Orbit Coding Agent)"
                value={proj.name}
                onChange={(e) => updateProject(proj.id, "name", e.target.value)}
                className="font-medium border-b bg-transparent flex-1 mr-2 p-1 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={() => removeProject(proj.id)}
                className="text-red-500 hover:text-red-700 p-1"
                aria-label="Remove project"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
              <input
                placeholder="Role / Title"
                value={proj.role}
                onChange={(e) => updateProject(proj.id, "role", e.target.value)}
                className="border rounded p-1 text-sm bg-white"
              />
              <input
                placeholder="Technologies (e.g. React, Tailwind)"
                value={proj.technologies}
                onChange={(e) => updateProject(proj.id, "technologies", e.target.value)}
                className="border rounded p-1 text-sm bg-white"
              />
              <input
                placeholder="Project / Demo URL"
                value={proj.link}
                onChange={(e) => updateProject(proj.id, "link", e.target.value)}
                className="border rounded p-1 text-sm bg-white md:col-span-2"
              />
            </div>
            <textarea
              placeholder="Key achievements, architecture, and impact..."
              value={proj.description}
              onChange={(e) => updateProject(proj.id, "description", e.target.value)}
              className="border rounded p-1 text-sm w-full bg-white h-20"
            />
          </div>
        ))
      )}
    </section>
  );
}
`;
    }

    // 4. CertificationsForm
    if (/cert.*form/i.test(baseName)) {
        return `import React, { useState, useEffect } from "react";
import { Plus, X, Award } from "lucide-react";

export default function CertificationsForm({ data, onChange }) {
  const [certs, setCerts] = useState(Array.isArray(data) ? data : []);

  useEffect(() => {
    if (Array.isArray(data)) {
      setCerts(data);
    }
  }, [data]);

  const addCert = () => {
    const updated = [
      ...certs,
      {
        id: Date.now(),
        name: "",
        issuer: "",
        date: "",
        credentialUrl: "",
      },
    ];
    setCerts(updated);
    onChange?.(updated);
  };

  const updateCert = (id, field, value) => {
    const updated = certs.map((c) => (c.id === id ? { ...c, [field]: value } : c));
    setCerts(updated);
    onChange?.(updated);
  };

  const removeCert = (id) => {
    const updated = certs.filter((c) => c.id !== id);
    setCerts(updated);
    onChange?.(updated);
  };

  return (
    <section className="bg-white p-4 rounded shadow">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-medium flex items-center gap-2">
          <Award size={18} className="text-indigo-600" /> Certifications
        </h3>
        <button
          type="button"
          onClick={addCert}
          className="flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          <Plus size={16} className="mr-1" /> Add Certification
        </button>
      </div>

      {certs.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No certifications added yet.</p>
      ) : (
        certs.map((c) => (
          <div key={c.id} className="border rounded p-3 mb-3 bg-gray-50">
            <div className="flex justify-between items-center mb-2">
              <input
                placeholder="Certification Name"
                value={c.name}
                onChange={(e) => updateCert(c.id, "name", e.target.value)}
                className="font-medium border-b bg-transparent flex-1 mr-2 p-1 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={() => removeCert(c.id)}
                className="text-red-500 hover:text-red-700 p-1"
                aria-label="Remove certification"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                placeholder="Issuing Organization (e.g. AWS, Google)"
                value={c.issuer}
                onChange={(e) => updateCert(c.id, "issuer", e.target.value)}
                className="border rounded p-1 text-sm bg-white"
              />
              <input
                type="date"
                placeholder="Issue Date"
                value={c.date}
                onChange={(e) => updateCert(c.id, "date", e.target.value)}
                className="border rounded p-1 text-sm bg-white"
              />
              <input
                placeholder="Credential URL"
                value={c.credentialUrl}
                onChange={(e) => updateCert(c.id, "credentialUrl", e.target.value)}
                className="border rounded p-1 text-sm bg-white md:col-span-2"
              />
            </div>
          </div>
        ))
      )}
    </section>
  );
}
`;
    }

    // 5. ResumePreview
    if (/resume.*preview|preview/i.test(baseName)) {
        return `import React from "react";
import { Mail, Phone, MapPin, Globe, Linkedin, Briefcase, GraduationCap, Award, FolderGit2 } from "lucide-react";

export default function ResumePreview({ resume = {}, data = {} }) {
  const r = resume?.name ? resume : (data?.name ? data : resume);
  const template = r?.template || "modern";

  const isExecutive = template === "executive";
  const isClassic = template === "classic";

  return (
    <div className="max-w-4xl mx-auto bg-white p-8 text-gray-800 shadow-sm print:p-0 print:shadow-none min-h-[900px]">
      {/* Header */}
      <header className={\`border-b-2 \${isExecutive ? "border-amber-600 pb-6" : isClassic ? "border-gray-800 pb-4 text-center" : "border-indigo-600 pb-5"}\`}>
        <h1 className={\`text-3xl font-bold tracking-tight \${isExecutive ? "text-amber-900" : isClassic ? "font-serif text-gray-900" : "text-indigo-900"}\`}>
          {r.name || "Candidate Name"}
        </h1>
        {r.title && (
          <p className="text-lg text-gray-600 mt-1 font-medium">{r.title}</p>
        )}
        <div className={\`flex flex-wrap gap-4 mt-3 text-xs text-gray-600 \${isClassic ? "justify-center" : ""}\`}>
          {r.email && <span className="flex items-center gap-1"><Mail size={13} /> {r.email}</span>}
          {r.phone && <span className="flex items-center gap-1"><Phone size={13} /> {r.phone}</span>}
          {r.location && <span className="flex items-center gap-1"><MapPin size={13} /> {r.location}</span>}
          {r.linkedin && <span className="flex items-center gap-1"><Linkedin size={13} /> {r.linkedin}</span>}
          {r.portfolio && <span className="flex items-center gap-1"><Globe size={13} /> {r.portfolio}</span>}
        </div>
      </header>

      {/* Summary */}
      {r.summary && (
        <section className="mt-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-2">Professional Summary</h2>
          <p className="text-sm leading-relaxed text-gray-700">{r.summary}</p>
        </section>
      )}

      {/* Experience */}
      {Array.isArray(r.work) && r.work.length > 0 && (
        <section className="mt-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-1.5">
            <Briefcase size={15} /> Work Experience
          </h2>
          <div className="space-y-4">
            {r.work.map((w, idx) => (
              <div key={w.id || idx}>
                <div className="flex justify-between items-baseline">
                  <h3 className="font-semibold text-gray-900 text-sm">{w.position || "Position"}</h3>
                  <span className="text-xs text-gray-500">{w.start} — {w.current ? "Present" : w.end}</span>
                </div>
                <p className="text-xs font-medium text-indigo-700">{w.company}</p>
                {w.description && (
                  <p className="text-xs text-gray-600 mt-1 whitespace-pre-line leading-relaxed">{w.description}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Education */}
      {Array.isArray(r.education) && r.education.length > 0 && (
        <section className="mt-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-1.5">
            <GraduationCap size={15} /> Education
          </h2>
          <div className="space-y-3">
            {r.education.map((e, idx) => (
              <div key={e.id || idx} className="flex justify-between items-baseline">
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">{e.institution || e.school}</h3>
                  <p className="text-xs text-gray-600">{e.degree} {e.field ? \`in \${e.field}\` : ""}</p>
                </div>
                <span className="text-xs text-gray-500">{e.year || e.start}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Projects */}
      {Array.isArray(r.projects) && r.projects.length > 0 && (
        <section className="mt-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-1.5">
            <FolderGit2 size={15} /> Projects
          </h2>
          <div className="space-y-3">
            {r.projects.map((p, idx) => (
              <div key={p.id || idx}>
                <div className="flex justify-between items-baseline">
                  <h3 className="font-semibold text-gray-900 text-sm">{p.name}</h3>
                  {p.link && <a href={p.link} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline">{p.link}</a>}
                </div>
                {p.technologies && <p className="text-xs text-gray-500">Tech: {p.technologies}</p>}
                {p.description && <p className="text-xs text-gray-600 mt-1">{p.description}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Certifications */}
      {Array.isArray(r.certifications) && r.certifications.length > 0 && (
        <section className="mt-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-1.5">
            <Award size={15} /> Certifications
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {r.certifications.map((c, idx) => (
              <div key={c.id || idx} className="p-2 border rounded bg-gray-50">
                <p className="font-medium text-gray-900">{c.name}</p>
                <p className="text-gray-500">{c.issuer} {c.date ? \`• \${c.date}\` : ""}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Skills */}
      {Array.isArray(r.skills) && r.skills.length > 0 && (
        <section className="mt-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-2">Skills</h2>
          <div className="flex flex-wrap gap-1.5">
            {r.skills.map((s, idx) => {
              const skillName = typeof s === "string" ? s : s.name || s.skill || "";
              return (
                <span key={idx} className="bg-gray-100 text-gray-800 text-xs px-2.5 py-1 rounded-full font-medium">
                  {skillName}
                </span>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
`;
    }

    // 5.1 SkillsForm
    if (/skill.*form/i.test(baseName)) {
        return `import React, { useState, useEffect } from "react";
import { Plus, X, Wrench } from "lucide-react";

export default function SkillsForm({ data, onChange }) {
  const [skills, setSkills] = useState(Array.isArray(data) ? data : []);
  const [newSkill, setNewSkill] = useState("");

  useEffect(() => {
    if (Array.isArray(data)) setSkills(data);
  }, [data]);

  const addSkill = (e) => {
    e?.preventDefault?.();
    const trimmed = newSkill.trim();
    if (!trimmed) return;
    const updated = [...skills, trimmed];
    setSkills(updated);
    setNewSkill("");
    onChange?.(updated);
  };

  const removeSkill = (index) => {
    const updated = skills.filter((_, idx) => idx !== index);
    setSkills(updated);
    onChange?.(updated);
  };

  return (
    <section className="bg-white p-4 rounded shadow border border-slate-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold flex items-center gap-2 text-slate-800">
          <Wrench size={18} className="text-indigo-600" /> Skills
        </h3>
      </div>
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          placeholder="Add a skill (e.g. React, Node.js, TypeScript)"
          value={newSkill}
          onChange={(e) => setNewSkill(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addSkill(e); }}
          className="flex-1 border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="button"
          onClick={addSkill}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium flex items-center gap-1 cursor-pointer"
        >
          <Plus size={16} /> Add
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {skills.map((skill, idx) => {
          const name = typeof skill === "string" ? skill : (skill?.name || skill?.skill || "");
          return (
            <span key={idx} className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-xs font-medium border border-indigo-100">
              {name}
              <button
                type="button"
                onClick={() => removeSkill(idx)}
                className="hover:text-red-600 cursor-pointer"
                aria-label="Remove skill"
              >
                <X size={12} />
              </button>
            </span>
          );
        })}
      </div>
    </section>
  );
}
`;
    }

    // 5.2 EducationForm
    if (/edu.*form/i.test(baseName)) {
        return `import React, { useState, useEffect } from "react";
import { Plus, X, GraduationCap } from "lucide-react";

export default function EducationForm({ data, onChange }) {
  const [items, setItems] = useState(Array.isArray(data) ? data : []);

  useEffect(() => {
    if (Array.isArray(data)) setItems(data);
  }, [data]);

  const addItem = () => {
    const updated = [
      ...items,
      {
        id: Date.now(),
        institution: "",
        degree: "",
        field: "",
        year: "",
      },
    ];
    setItems(updated);
    onChange?.(updated);
  };

  const updateItem = (id, field, value) => {
    const updated = items.map((it) => (it.id === id ? { ...it, [field]: value } : it));
    setItems(updated);
    onChange?.(updated);
  };

  const removeItem = (id) => {
    const updated = items.filter((it) => it.id !== id);
    setItems(updated);
    onChange?.(updated);
  };

  return (
    <section className="bg-white p-4 rounded shadow border border-slate-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold flex items-center gap-2 text-slate-800">
          <GraduationCap size={18} className="text-indigo-600" /> Education
        </h3>
        <button
          type="button"
          onClick={addItem}
          className="flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-700 cursor-pointer"
        >
          <Plus size={16} className="mr-1" /> Add Education
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No education entries added yet.</p>
      ) : (
        items.map((it) => (
          <div key={it.id} className="border rounded p-3 mb-3 bg-gray-50">
            <div className="flex justify-between items-center mb-2">
              <input
                placeholder="School / University (e.g. Stanford University)"
                value={it.institution || it.school || ""}
                onChange={(e) => updateItem(it.id, "institution", e.target.value)}
                className="font-medium border-b bg-transparent flex-1 mr-2 p-1 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={() => removeItem(it.id)}
                className="text-red-500 hover:text-red-700 p-1 cursor-pointer"
                aria-label="Remove education"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                placeholder="Degree (e.g. B.S., M.S.)"
                value={it.degree || ""}
                onChange={(e) => updateItem(it.id, "degree", e.target.value)}
                className="border rounded p-1 text-sm bg-white"
              />
              <input
                placeholder="Field of Study"
                value={it.field || ""}
                onChange={(e) => updateItem(it.id, "field", e.target.value)}
                className="border rounded p-1 text-sm bg-white"
              />
              <input
                placeholder="Graduation Year"
                value={it.year || ""}
                onChange={(e) => updateItem(it.id, "year", e.target.value)}
                className="border rounded p-1 text-sm bg-white"
              />
            </div>
          </div>
        ))
      )}
    </section>
  );
}
`;
    }

    // 5.3 WorkExperienceForm
    if (/exp.*form|work.*form/i.test(baseName)) {
        return `import React, { useState, useEffect } from "react";
import { Plus, X, Briefcase } from "lucide-react";

export default function WorkExperienceForm({ data, onChange }) {
  const [items, setItems] = useState(Array.isArray(data) ? data : []);

  useEffect(() => {
    if (Array.isArray(data)) setItems(data);
  }, [data]);

  const addItem = () => {
    const updated = [
      ...items,
      {
        id: Date.now(),
        company: "",
        position: "",
        start: "",
        end: "",
        current: false,
        description: "",
      },
    ];
    setItems(updated);
    onChange?.(updated);
  };

  const updateItem = (id, field, value) => {
    const updated = items.map((it) => (it.id === id ? { ...it, [field]: value } : it));
    setItems(updated);
    onChange?.(updated);
  };

  const removeItem = (id) => {
    const updated = items.filter((it) => it.id !== id);
    setItems(updated);
    onChange?.(updated);
  };

  return (
    <section className="bg-white p-4 rounded shadow border border-slate-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold flex items-center gap-2 text-slate-800">
          <Briefcase size={18} className="text-indigo-600" /> Work Experience
        </h3>
        <button
          type="button"
          onClick={addItem}
          className="flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-700 cursor-pointer"
        >
          <Plus size={16} className="mr-1" /> Add Experience
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No work experience added yet.</p>
      ) : (
        items.map((it) => (
          <div key={it.id} className="border rounded p-3 mb-3 bg-gray-50">
            <div className="flex justify-between items-center mb-2">
              <input
                placeholder="Company Name (e.g. Google, Stripe)"
                value={it.company || ""}
                onChange={(e) => updateItem(it.id, "company", e.target.value)}
                className="font-medium border-b bg-transparent flex-1 mr-2 p-1 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={() => removeItem(it.id)}
                className="text-red-500 hover:text-red-700 p-1 cursor-pointer"
                aria-label="Remove experience"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
              <input
                placeholder="Job Title / Role"
                value={it.position || ""}
                onChange={(e) => updateItem(it.id, "position", e.target.value)}
                className="border rounded p-1 text-sm bg-white"
              />
              <input
                placeholder="Start Date (e.g. 2021)"
                value={it.start || ""}
                onChange={(e) => updateItem(it.id, "start", e.target.value)}
                className="border rounded p-1 text-sm bg-white"
              />
              <input
                placeholder="End Date (e.g. Present)"
                value={it.end || ""}
                onChange={(e) => updateItem(it.id, "end", e.target.value)}
                className="border rounded p-1 text-sm bg-white"
              />
            </div>
            <textarea
              placeholder="Responsibilities, achievements, impact..."
              value={it.description || ""}
              onChange={(e) => updateItem(it.id, "description", e.target.value)}
              className="border rounded p-1 text-sm w-full bg-white h-16"
            />
          </div>
        ))
      )}
    </section>
  );
}
`;
    }

    // 5.4 PersonalInfoForm
    if (/personal.*form/i.test(baseName)) {
        return `import React, { useState, useEffect } from "react";
import { User } from "lucide-react";

export default function PersonalInfoForm({ data, onChange }) {
  const [formData, setFormData] = useState(data || {});

  useEffect(() => {
    if (data) setFormData(data);
  }, [data]);

  const handleChange = (field, val) => {
    const updated = { ...formData, [field]: val };
    setFormData(updated);
    onChange?.(updated);
  };

  return (
    <section className="bg-white p-4 rounded shadow border border-slate-200">
      <h3 className="text-base font-semibold flex items-center gap-2 text-slate-800 mb-3">
        <User size={18} className="text-indigo-600" /> Personal Information
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-slate-600">Full Name</label>
          <input
            type="text"
            placeholder="John Doe"
            value={formData.name || ""}
            onChange={(e) => handleChange("name", e.target.value)}
            className="w-full border rounded p-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">Professional Title</label>
          <input
            type="text"
            placeholder="Senior Software Engineer"
            value={formData.title || ""}
            onChange={(e) => handleChange("title", e.target.value)}
            className="w-full border rounded p-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">Email Address</label>
          <input
            type="email"
            placeholder="john@example.com"
            value={formData.email || ""}
            onChange={(e) => handleChange("email", e.target.value)}
            className="w-full border rounded p-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">Phone Number</label>
          <input
            type="text"
            placeholder="+1 (555) 000-0000"
            value={formData.phone || ""}
            onChange={(e) => handleChange("phone", e.target.value)}
            className="w-full border rounded p-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">Location</label>
          <input
            type="text"
            placeholder="San Francisco, CA"
            value={formData.location || ""}
            onChange={(e) => handleChange("location", e.target.value)}
            className="w-full border rounded p-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">LinkedIn URL</label>
          <input
            type="text"
            placeholder="linkedin.com/in/username"
            value={formData.linkedin || ""}
            onChange={(e) => handleChange("linkedin", e.target.value)}
            className="w-full border rounded p-1.5 text-sm"
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-medium text-slate-600">Professional Summary</label>
          <textarea
            placeholder="Brief overview of your professional career and aspirations..."
            value={formData.summary || ""}
            onChange={(e) => handleChange("summary", e.target.value)}
            className="w-full border rounded p-1.5 text-sm h-20"
          />
        </div>
      </div>
    </section>
  );
}
`;
    }

    // 5.5 ModernTemplate
    if (/moderntemplate/i.test(baseName)) {
        return `import React from "react";
import { Mail, Phone, MapPin, Linkedin, Briefcase } from "lucide-react";

export default function ModernTemplate({ resume = {} }) {
  const r = resume;
  return (
    <div className="max-w-4xl mx-auto bg-white p-8 text-gray-800 shadow-sm min-h-[900px] border-t-4 border-indigo-600">
      <header className="border-b pb-5">
        <h1 className="text-3xl font-bold text-indigo-900 tracking-tight">{r.name || "Candidate Name"}</h1>
        {r.title && <p className="text-lg text-gray-600 font-medium mt-1">{r.title}</p>}
        <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-600">
          {r.email && <span className="flex items-center gap-1"><Mail size={13} /> {r.email}</span>}
          {r.phone && <span className="flex items-center gap-1"><Phone size={13} /> {r.phone}</span>}
          {r.location && <span className="flex items-center gap-1"><MapPin size={13} /> {r.location}</span>}
          {r.linkedin && <span className="flex items-center gap-1"><Linkedin size={13} /> {r.linkedin}</span>}
        </div>
      </header>
      {r.summary && (
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-indigo-600 mb-2">Professional Summary</h2>
          <p className="text-sm leading-relaxed text-gray-700">{r.summary}</p>
        </section>
      )}
      {Array.isArray(r.work) && r.work.length > 0 && (
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-indigo-600 mb-3 flex items-center gap-1.5"><Briefcase size={14} /> Work Experience</h2>
          <div className="space-y-4">
            {r.work.map((w, idx) => (
              <div key={idx}>
                <div className="flex justify-between items-baseline"><h3 className="font-semibold text-gray-900 text-sm">{w.position}</h3><span className="text-xs text-gray-500">{w.start} — {w.end || "Present"}</span></div>
                <p className="text-xs font-medium text-indigo-700">{w.company}</p>
                {w.description && <p className="text-xs text-gray-600 mt-1">{w.description}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
      {Array.isArray(r.skills) && r.skills.length > 0 && (
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-indigo-600 mb-2">Skills</h2>
          <div className="flex flex-wrap gap-1.5">
            {r.skills.map((s, idx) => (<span key={idx} className="bg-indigo-50 text-indigo-700 text-xs px-2.5 py-1 rounded-full font-medium">{typeof s === "string" ? s : s.name}</span>))}
          </div>
        </section>
      )}
    </div>
  );
}
`;
    }

    // 5.6 ClassicTemplate
    if (/classictemplate/i.test(baseName)) {
        return `import React from "react";

export default function ClassicTemplate({ resume = {} }) {
  const r = resume;
  return (
    <div className="max-w-4xl mx-auto bg-white p-8 text-gray-900 shadow-sm min-h-[900px] font-serif">
      <header className="border-b-2 border-gray-800 pb-4 text-center">
        <h1 className="text-3xl font-bold tracking-wide uppercase">{r.name || "Candidate Name"}</h1>
        {r.title && <p className="text-base italic text-gray-700 mt-1">{r.title}</p>}
        <div className="flex justify-center flex-wrap gap-4 mt-2 text-xs font-sans text-gray-600">
          {r.email && <span>{r.email}</span>}
          {r.phone && <span>• {r.phone}</span>}
          {r.location && <span>• {r.location}</span>}
        </div>
      </header>
      {r.summary && (
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-800 border-b pb-1 mb-2">Summary</h2>
          <p className="text-sm leading-relaxed font-sans text-gray-700">{r.summary}</p>
        </section>
      )}
      {Array.isArray(r.work) && r.work.length > 0 && (
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-800 border-b pb-1 mb-3">Experience</h2>
          <div className="space-y-4 font-sans">
            {r.work.map((w, idx) => (
              <div key={idx}>
                <div className="flex justify-between items-baseline"><h3 className="font-semibold text-gray-900 text-sm">{w.position}</h3><span className="text-xs text-gray-500">{w.start} — {w.end || "Present"}</span></div>
                <p className="text-xs italic text-gray-700">{w.company}</p>
                {w.description && <p className="text-xs text-gray-600 mt-1">{w.description}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
      {Array.isArray(r.skills) && r.skills.length > 0 && (
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-800 border-b pb-1 mb-2">Skills</h2>
          <p className="text-xs font-sans text-gray-700">{r.skills.map(s => typeof s === "string" ? s : s.name).join(" • ")}</p>
        </section>
      )}
    </div>
  );
}
`;
    }

    // 5.7 ExecutiveTemplate
    if (/executivetemplate/i.test(baseName)) {
        return `import React from "react";
import { Mail, Phone, MapPin, Briefcase } from "lucide-react";

export default function ExecutiveTemplate({ resume = {} }) {
  const r = resume;
  return (
    <div className="max-w-4xl mx-auto bg-white p-8 text-gray-900 shadow-sm min-h-[900px] border-l-8 border-amber-600">
      <header className="border-b-2 border-amber-600 pb-5">
        <h1 className="text-3xl font-extrabold text-amber-950 uppercase tracking-tight">{r.name || "Candidate Name"}</h1>
        {r.title && <p className="text-lg text-amber-800 font-semibold mt-1">{r.title}</p>}
        <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-600">
          {r.email && <span className="flex items-center gap-1"><Mail size={13} /> {r.email}</span>}
          {r.phone && <span className="flex items-center gap-1"><Phone size={13} /> {r.phone}</span>}
          {r.location && <span className="flex items-center gap-1"><MapPin size={13} /> {r.location}</span>}
        </div>
      </header>
      {r.summary && (
        <section className="mt-5 bg-amber-50/50 p-3 rounded border border-amber-100">
          <h2 className="text-xs font-bold uppercase tracking-wider text-amber-900 mb-1">Executive Summary</h2>
          <p className="text-sm leading-relaxed text-gray-800">{r.summary}</p>
        </section>
      )}
      {Array.isArray(r.work) && r.work.length > 0 && (
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-amber-900 mb-3 flex items-center gap-1.5"><Briefcase size={14} /> Leadership & Experience</h2>
          <div className="space-y-4">
            {r.work.map((w, idx) => (
              <div key={idx} className="border-b border-gray-100 pb-3">
                <div className="flex justify-between items-baseline"><h3 className="font-bold text-gray-900 text-sm">{w.position}</h3><span className="text-xs font-semibold text-amber-800">{w.start} — {w.end || "Present"}</span></div>
                <p className="text-xs font-medium text-gray-700">{w.company}</p>
                {w.description && <p className="text-xs text-gray-600 mt-1">{w.description}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
      {Array.isArray(r.skills) && r.skills.length > 0 && (
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-amber-900 mb-2">Core Competencies</h2>
          <div className="flex flex-wrap gap-2">
            {r.skills.map((s, idx) => (<span key={idx} className="bg-amber-100/70 text-amber-900 text-xs px-2.5 py-1 rounded font-semibold">{typeof s === "string" ? s : s.name}</span>))}
          </div>
        </section>
      )}
    </div>
  );
}
`;
    }

    // 5.8 storage.js LocalStorage helper
    if (/storage(\.js|\.ts)?$/i.test(targetPath)) {
        return `export const loadResumes = () => {
  try {
    const raw = localStorage.getItem("resumecraft_resumes");
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to load resumes", e);
  }
  return [
    {
      id: "resume-1",
      name: "Alex Morgan",
      title: "Senior Full Stack Engineer",
      email: "alex.morgan@example.com",
      phone: "+1 (555) 234-5678",
      location: "San Francisco, CA",
      linkedin: "linkedin.com/in/alexmorgan",
      portfolio: "alexmorgan.dev",
      template: "modern",
      summary: "High-impact Full Stack Engineer with 7+ years of experience leading teams, architecting distributed cloud systems, and building intuitive user interfaces.",
      skills: ["React", "TypeScript", "Node.js", "GraphQL", "Tailwind CSS", "Docker", "PostgreSQL", "AWS"],
      work: [
        {
          id: "w1",
          company: "Acme Tech Innovations",
          position: "Lead Software Architect",
          start: "2021",
          end: "Present",
          current: true,
          description: "Led migration to micro-frontends reducing build times by 40%. Mentored 8 junior engineers."
        },
        {
          id: "w2",
          company: "Nexus Digital",
          position: "Senior Frontend Engineer",
          start: "2018",
          end: "2021",
          current: false,
          description: "Built high-performance design system adopted across 14 enterprise web applications."
        }
      ],
      education: [
        {
          id: "e1",
          institution: "UC Berkeley",
          degree: "B.S. Computer Science",
          field: "Computer Science",
          year: "2018"
        }
      ],
      projects: [
        {
          id: "p1",
          name: "ResumeCraft SaaS",
          role: "Lead Developer",
          technologies: "React, Tailwind, LocalStorage",
          link: "https://github.com",
          description: "Feature-rich resume builder with instant live A4 print preview and custom template engine."
        }
      ],
      certifications: [
        {
          id: "c1",
          name: "AWS Certified Solutions Architect",
          issuer: "Amazon Web Services",
          date: "2023"
        }
      ]
    }
  ];
};

export const saveResumes = (resumes) => {
  try {
    localStorage.setItem("resumecraft_resumes", JSON.stringify(resumes));
  } catch (e) {
    console.error("Failed to save resumes", e);
  }
};

export default { loadResumes, saveResumes };
`;
    }

    // 6. Props-informed Form component
    if (usage.isForm || usage.handlers.includes("onChange")) {
        const propsParam = usage.props.length > 0 ? `{ ${usage.props.join(", ")} }` : "{ data = {}, onChange }";
        return `import React, { useState, useEffect } from "react";

export default function ${componentName}(${propsParam}) {
  const [formData, setFormData] = useState(data || {});

  useEffect(() => {
    if (data) setFormData(data);
  }, [data]);

  const handleChange = (field, val) => {
    const updated = { ...formData, [field]: val };
    setFormData(updated);
    onChange?.(updated);
  };

  return (
    <section className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
      <h3 className="text-base font-semibold text-slate-800 mb-3">${componentName.replace(/Form$/, " Details")}</h3>
      <div className="space-y-3">
        {formData && typeof formData === "object" && Object.keys(formData).length > 0 ? (
          Object.keys(formData).map((key) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600 capitalize">{key}</label>
              <input
                type="text"
                value={formData[key] || ""}
                onChange={(e) => handleChange(key, e.target.value)}
                className="border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          ))
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Name / Title"
              onChange={(e) => handleChange("title", e.target.value)}
              className="border border-slate-300 rounded px-2.5 py-1.5 text-sm"
            />
            <input
              type="text"
              placeholder="Description / Value"
              onChange={(e) => handleChange("value", e.target.value)}
              className="border border-slate-300 rounded px-2.5 py-1.5 text-sm"
            />
          </div>
        )}
      </div>
    </section>
  );
}
`;
    }

    // 7. Props-informed Card / Metric component
    if (usage.isCard || usage.props.some((p) => /title|value|amount|metric/i.test(p))) {
        const propsParam = usage.props.length > 0 ? `{ ${usage.props.join(", ")} }` : "{ title = 'Metric', value = '0', icon: Icon, onClick }";
        return `import React from "react";

export default function ${componentName}(${propsParam}) {
  return (
    <div
      onClick={typeof onClick === "function" ? onClick : undefined}
      className={\`bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between \${typeof onClick === "function" ? "cursor-pointer hover:border-indigo-400 transition" : ""}\`}
    >
      <div>
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{title || "Metric"}</p>
        <p className="text-2xl font-bold text-slate-900 mt-1">{value || "0"}</p>
      </div>
      {Icon && (
        <div className="size-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
          <Icon size={20} />
        </div>
      )}
    </div>
  );
}
`;
    }

    // 8. Generic Props-driven Component
    const propsParam = usage.props.length > 0 ? `{ ${usage.props.join(", ")} }` : "{ ...props }";
    const dataProps = usage.props.filter((p) => !/^(on[A-Z]|set[A-Z]|handle[A-Z]|fn|action)/.test(p));
    const actionProps = usage.props.filter((p) => /^(on[A-Z]|set[A-Z]|handle[A-Z]|fn|action)/.test(p));

    return `import React from "react";

export default function ${componentName}(${propsParam}) {
  return (
    <div className="p-3 rounded-xl bg-slate-900/90 border border-white/10 shadow-md my-2 text-slate-200">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">${componentName}</h4>
        ${actionProps.length > 0 ? `<div className="flex items-center gap-1.5">
          ${actionProps.map((fn) => `{typeof ${fn} === "function" && (
            <button
              type="button"
              onClick={${fn}}
              className="px-2 py-1 text-[11px] font-medium rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition cursor-pointer"
            >
              ${fn}
            </button>
          )}`).join("\n          ")}
        </div>` : ""}
      </div>
      ${dataProps.length > 0 ? `<div className="mt-2 flex flex-wrap gap-1.5 text-xs text-slate-400">
        ${dataProps.map((p) => `{${p} !== undefined && typeof ${p} !== "function" ? (
          <span key="${p}" className="px-2 py-0.5 rounded bg-white/5 border border-white/10 font-mono text-[11px]">
            ${p}: {String(${p})}
          </span>
        ) : null}`).join("\n        ")}
      </div>` : "{props.children || null}"}
    </div>
  );
}
`;
};

export const MAX_REPAIR_ATTEMPTS = 3;
export const MAX_SYNTHESIZED_FILES = 8;

/**
 * Automatically repairs an artifact with missing local React imports by synthesizing
 * functional, styled replacement components and stylesheets.
 *
 * @param {object} artifact
 * @param {object|null} validationResult
 * @param {string|null} runtimeStrategy
 * @returns {object|null} Repaired artifact if successful, or null if unrepairable
 */
export const repairMissingReactImports = (artifact, validationResult = null, runtimeStrategy = null) => {
    if (!artifact || !Array.isArray(artifact.files)) return null;

    let validation = validationResult || validateArtifactIntegrity(artifact, runtimeStrategy);
    if (validation.valid) return artifact;

    let files = [...artifact.files];

    // 1. Identify and repair any corrupted files failing syntax validation
    const syntaxErrors = (validation.errors || []).filter((e) => e.type === "SYNTAX_ERROR" && e.file);
    if (syntaxErrors.length > 0) {
        for (const err of syntaxErrors) {
            const idx = files.findIndex((f) => (f.path || "").toLowerCase() === (err.file || "").toLowerCase());
            if (idx !== -1) {
                const targetPath = files[idx].path;
                const originalCode = files[idx].content || "";

                // Tier 1: Non-destructive in-place syntax repair (balances tags, closes strings, brackets, parens)
                const inPlaceRepaired = repairCodeFileSyntax(targetPath, originalCode);
                if (inPlaceRepaired) {
                    files[idx] = {
                        ...files[idx],
                        content: inPlaceRepaired,
                        size: Buffer.byteLength(inPlaceRepaired, "utf8"),
                    };
                    continue;
                }

                // Tier 2: Synthesize replacement if in-place repair was not possible
                const parentFile = files.find(
                    (f) =>
                        f.path.toLowerCase() !== targetPath.toLowerCase() &&
                        (f.content || "").includes(targetPath.replace(/^src\//, "").replace(/^\/+/, ""))
                );
                const synthesized = synthesizeMissingComponent(targetPath, parentFile ? parentFile.content : "");
                if (synthesized) {
                    files[idx] = {
                        ...files[idx],
                        content: synthesized,
                        size: Buffer.byteLength(synthesized, "utf8"),
                    };
                }
            }
        }
        syncReactDependencies(files);
        ensureReactHtmlShell(files);
        validation = validateArtifactIntegrity({ files, entryFile: artifact.entryFile }, runtimeStrategy);
        if (validation.valid) {
            artifact.files = files;
            artifact.totalFiles = files.length;
            artifact.totalSize = files.reduce((acc, f) => acc + (f.size || 0), 0);
            artifact.integrity = validation;
            return artifact;
        }
    }

    const missingErrors = (validation.errors || []).filter(
        (e) => e.type === "MISSING_LOCAL_IMPORT" && e.resolvedPath
    );

    if (missingErrors.length === 0) {
        return null;
    }

    // Limit maximum repair batch to prevent uncontrolled mass-generation
    if (missingErrors.length > MAX_SYNTHESIZED_FILES) {
        console.warn(
            `Too many missing local imports (${missingErrors.length} > ${MAX_SYNTHESIZED_FILES}); skipping auto-repair to prevent runaway synthesis.`
        );
        return null;
    }

    const existingPaths = new Set(files.map((f) => f.path.toLowerCase()));
    let repairedCount = 0;

    for (const err of missingErrors) {
        const targetPath = err.resolvedPath.replace(/^\/+/, "");
        if (existingPaths.has(targetPath.toLowerCase())) continue;

        const parentFile = files.find((f) => f.path.toLowerCase() === (err.file || "").toLowerCase());
        const parentContent = parentFile ? parentFile.content : "";
        const synthesizedContent = synthesizeMissingComponent(targetPath, parentContent);
        const language = detectLanguage(targetPath);
        const size = Buffer.byteLength(synthesizedContent, "utf8");

        files.push({
            path: targetPath,
            content: synthesizedContent,
            language,
            size,
        });
        existingPaths.add(targetPath.toLowerCase());
        repairedCount++;
    }

    if (repairedCount === 0) return null;

    syncReactDependencies(files);
    ensureReactHtmlShell(files);

    const recheck = validateArtifactIntegrity({ files, entryFile: artifact.entryFile }, runtimeStrategy);
    if (!recheck.valid) {
        return null;
    }

    // Success! Update artifact in place
    artifact.files = files;
    artifact.totalFiles = files.length;
    artifact.totalSize = files.reduce((acc, f) => acc + (f.size || 0), 0);
    artifact.integrity = recheck;

    if (artifact.previewType === "html") {
        artifact.bundledHtml = bundleCodePreview(artifact.files, artifact.entryFile);
        const base64Html = Buffer.from(artifact.bundledHtml, "utf8").toString("base64");
        artifact.previewDataUrl = `data:text/html;charset=utf-8;base64,${base64Html}`;
    }

    return artifact;
};

/**
 * Synchronizes package.json dependencies for React projects, ensuring react,
 * react-dom, and all imported external packages are declared.
 *
 * @param {Array<{ path: string, content: string, language: string, size: number }>} files
 */
export const syncReactDependencies = (files = []) => {
    let pkgFile = files.find((f) => f.path.toLowerCase() === "package.json");
    let pkgJson = {
        name: "orbit-react-app",
        version: "1.0.0",
        private: true,
        dependencies: {
            react: KNOWN_PACKAGE_VERSIONS.react,
            "react-dom": KNOWN_PACKAGE_VERSIONS["react-dom"],
        },
    };

    if (pkgFile && typeof pkgFile.content === "string") {
        try {
            const parsed = JSON.parse(pkgFile.content);
            pkgJson = {
                ...parsed,
                dependencies: {
                    react: KNOWN_PACKAGE_VERSIONS.react,
                    "react-dom": KNOWN_PACKAGE_VERSIONS["react-dom"],
                    ...(parsed.dependencies || {}),
                },
            };
        } catch {
            // Malformed package.json; re-initialize with base dependencies
        }
    }

    // Scan all code files for imported packages
    for (const file of files) {
        if (file.path.endsWith(".jsx") || file.path.endsWith(".tsx") || file.path.endsWith(".js")) {
            const importedPackages = extractNpmDependenciesFromCode(file.content);
            for (const pkg of importedPackages) {
                if (!pkgJson.dependencies[pkg]) {
                    pkgJson.dependencies[pkg] = KNOWN_PACKAGE_VERSIONS[pkg] || "latest";
                }
            }
        }
    }

    const updatedContent = JSON.stringify(pkgJson, null, 2);
    const updatedSize = Buffer.byteLength(updatedContent, "utf8");

    if (pkgFile) {
        pkgFile.content = updatedContent;
        pkgFile.size = updatedSize;
        pkgFile.language = "json";
    } else {
        files.push({
            path: "package.json",
            content: updatedContent,
            language: "json",
            size: updatedSize,
        });
    }
};

/**
 * Guarantees that a React project has a standard index.html entry document.
 *
 * @param {Array<{ path: string, content: string, language: string, size: number }>} files
 */
export const ensureReactHtmlShell = (files = []) => {
    const hasHtml = files.some(
        (f) => f.path.toLowerCase() === "index.html" || f.path.toLowerCase() === "public/index.html"
    );
    if (!hasHtml) {
        const shell = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Orbit Application</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="bg-slate-900 text-slate-100 min-h-screen">
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`;
        files.push({
            path: "index.html",
            content: shell,
            language: "html",
            size: Buffer.byteLength(shell, "utf8"),
        });
    }
};

/**
 * Validates the architectural and static integrity of an artifact.
 *
 * Checks:
 * 1. Project has at least one file (EMPTY_PROJECT).
 * 2. Project does not exceed file count limit (FILE_COUNT_EXCEEDED).
 * 3. Project does not exceed total size limit (SIZE_LIMIT_EXCEEDED).
 * 4. Project contains no duplicate file paths (DUPLICATE_FILE_PATH).
 * 5. If React:
 *    a. package.json exists and is valid JSON (MISSING_PACKAGE_JSON / INVALID_PACKAGE_JSON).
 *    b. HTML entry document exists (MISSING_HTML_SHELL).
 *    c. React entry point exists (MISSING_ENTRY_POINT).
 *    d. Every local relative import resolves to an actual file (MISSING_LOCAL_IMPORT).
 *    e. Local imports do not escape project root (PATH_TRAVERSAL).
 *    f. Local imports have exact matching casing (INCORRECT_CASING).
 * 6. If Legacy Web:
 *    a. At least one HTML document exists (MISSING_HTML_ENTRY).
 *
 * @param {object} artifact
 * @param {string|null} runtimeStrategy
 * @returns {{ valid: boolean, errors: Array<String>, warnings: string[] }}
 */
export const validateArtifactIntegrity = (artifact, runtimeStrategy = null) => {
    const errors = [];
    const warnings = [];

    if (!artifact || typeof artifact !== "object") {
        errors.push(createIntegrityError({
            type: "EMPTY_PROJECT",
            message: "Artifact must be a valid object."
        }));
        return { valid: false, errors, warnings };
    }

    const files = Array.isArray(artifact.files) ? artifact.files : [];
    if (files.length === 0) {
        errors.push(createIntegrityError({
            type: "EMPTY_PROJECT",
            message: "Project must contain at least one file."
        }));
        return { valid: false, errors, warnings };
    }

    if (files.length > MAX_PROJECT_FILES) {
        errors.push(createIntegrityError({
            type: "FILE_COUNT_EXCEEDED",
            message: `Project exceeds file count limit (${files.length} > ${MAX_PROJECT_FILES}).`
        }));
    }

    const totalBytes = files.reduce((acc, f) => acc + (f.size || Buffer.byteLength(f.content || "", "utf8")), 0);
    if (totalBytes > MAX_PROJECT_TOTAL_SIZE) {
        errors.push(createIntegrityError({
            type: "SIZE_LIMIT_EXCEEDED",
            message: `Project exceeds total size limit (${(totalBytes / 1024 / 1024).toFixed(2)} MB > ${(MAX_PROJECT_TOTAL_SIZE / 1024 / 1024)} MB).`
        }));
    }

    const exactFileMap = new Map();
    const lowerFileMap = new Map();
    const seenLowerPaths = new Set();

    for (const f of files) {
        const clean = sanitizePath(f.path);
        const lower = clean.toLowerCase();
        if (seenLowerPaths.has(lower)) {
            errors.push(createIntegrityError({
                type: "DUPLICATE_FILE_PATH",
                file: clean,
                message: `Duplicate file path detected: "${clean}".`
            }));
        }
        seenLowerPaths.add(lower);
        exactFileMap.set(clean, f);
        lowerFileMap.set(lower, f);

        // Validate syntax across all project code files
        const syntax = checkFileSyntax(clean, f.content);
        if (!syntax.valid) {
            errors.push(createIntegrityError({
                type: "SYNTAX_ERROR",
                file: clean,
                message: `Syntax error in "${clean}": ${syntax.error}`
            }));
        }
    }

    const isReact = runtimeStrategy === "REACT_APPLICATION" || isReactProject(files);

    if (isReact) {
        // Validate package.json
        const pkgFile = lowerFileMap.get("package.json");
        if (pkgFile) {
            try {
                const parsed = JSON.parse(pkgFile.content);
                const deps = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
                if (!deps.react && !deps["react-dom"]) {
                    warnings.push("package.json does not explicitly declare 'react' dependency.");
                }
            } catch {
                errors.push(createIntegrityError({
                    type: "INVALID_PACKAGE_JSON",
                    file: "package.json",
                    message: "package.json contains invalid JSON syntax."
                }));
            }
        } else {
            errors.push(createIntegrityError({
                type: "MISSING_PACKAGE_JSON",
                file: "package.json",
                message: "React project is missing package.json."
            }));
        }

        // Validate HTML entry shell
        const hasHtmlShell = lowerFileMap.has("index.html") || lowerFileMap.has("public/index.html");
        if (!hasHtmlShell) {
            errors.push(createIntegrityError({
                type: "MISSING_HTML_SHELL",
                message: "React project is missing an HTML entry document (index.html or public/index.html)."
            }));
        }

        // Validate React entry point
        const hasReactEntry =
            lowerFileMap.has("src/main.jsx") ||
            lowerFileMap.has("src/main.tsx") ||
            lowerFileMap.has("src/main.js") ||
            lowerFileMap.has("src/index.jsx") ||
            lowerFileMap.has("src/index.js") ||
            lowerFileMap.has("src/app.jsx") ||
            lowerFileMap.has("src/app.tsx") ||
            lowerFileMap.has("src/app.js") ||
            lowerFileMap.has("main.jsx") ||
            lowerFileMap.has("index.jsx") ||
            lowerFileMap.has("app.jsx") ||
            lowerFileMap.has("index.html");
        if (!hasReactEntry) {
            errors.push(createIntegrityError({
                type: "MISSING_ENTRY_POINT",
                message: "React project is missing an entry point (src/main.jsx, src/App.jsx, or index.html)."
            }));
        }

        // Candidates to resolve extensionless imports and index directory imports
        const CANDIDATE_EXTENSIONS = [
            "",
            ".jsx",
            ".js",
            ".tsx",
            ".ts",
            ".json",
            ".css",
            "/index.jsx",
            "/index.js",
            "/index.tsx",
            "/index.ts",
        ];

        // Statically detect missing local relative imports across all project source files
        for (const file of files) {
            const isCodeFile =
                file.path.endsWith(".jsx") ||
                file.path.endsWith(".tsx") ||
                file.path.endsWith(".js") ||
                file.path.endsWith(".ts") ||
                file.path.endsWith(".css");

            if (!isCodeFile || !file.content) continue;

            const localImports = extractLocalImportsFromCode(file.content);

            for (const relativePath of localImports) {
                const detailed = resolveRelativeImportDetailed(relativePath, file.path);

                if (detailed.isPathTraversal) {
                    errors.push(createIntegrityError({
                        type: "PATH_TRAVERSAL",
                        file: file.path,
                        importPath: relativePath,
                        resolvedPath: null,
                        message: `Path traversal violation: Import "${relativePath}" in "${file.path}" escapes the project root.`
                    }));
                    continue;
                }

                const resolved = detailed.resolvedPath;
                if (!resolved) continue;

                let exactMatch = null;
                let casingMismatchMatch = null;

                for (const ext of CANDIDATE_EXTENSIONS) {
                    const candidate = `${resolved}${ext}`;
                    if (exactFileMap.has(candidate)) {
                        exactMatch = exactFileMap.get(candidate);
                        break;
                    }
                    const lowerCandidate = candidate.toLowerCase();
                    if (!casingMismatchMatch && lowerFileMap.has(lowerCandidate)) {
                        casingMismatchMatch = lowerFileMap.get(lowerCandidate);
                    }
                }

                if (exactMatch) {
                    // Valid resolved import
                    continue;
                } else if (casingMismatchMatch) {
                    // File exists, but casing is different (fails on Linux/Vercel/Sandpack bundlers)
                    errors.push(createIntegrityError({
                        type: "INCORRECT_CASING",
                        file: file.path,
                        importPath: relativePath,
                        resolvedPath: casingMismatchMatch.path,
                        message: `Import casing mismatch: "${relativePath}" in "${file.path}" resolves to "${casingMismatchMatch.path}", but casing does not match.`
                    }));
                } else {
                    // File is completely missing
                    const assumedPath =
                        resolved.endsWith(".jsx") ||
                        resolved.endsWith(".js") ||
                        resolved.endsWith(".css") ||
                        resolved.endsWith(".tsx") ||
                        resolved.endsWith(".json")
                            ? resolved
                            : `${resolved}.jsx`;

                    errors.push(createIntegrityError({
                        type: "MISSING_LOCAL_IMPORT",
                        file: file.path,
                        importPath: relativePath,
                        resolvedPath: assumedPath,
                        message: `Missing relative import: "${relativePath}" referenced in "${file.path}" cannot be resolved. File "${assumedPath}" is not present.`
                    }));
                }
            }
        }
    } else {
        // Legacy web application validation
        const hasHtml = files.some((f) => f.path.toLowerCase().endsWith(".html"));
        if (!hasHtml) {
            errors.push(createIntegrityError({
                type: "MISSING_HTML_ENTRY",
                message: "Legacy web application must contain at least one HTML document."
            }));
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
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

            if ((file.path.endsWith(".js") || file.path.endsWith(".jsx")) && !file.path.endsWith(".test.js")) {
                const transformedJs = transformScriptForSandbox(file.content);
                const scriptRegex = new RegExp(`<script([^>]*)src=["'][^"']*${escapedFileName}["']([^>]*)>(?:\\s*<\\/script>)?`, "gi");
                const isReactOrJsx =
                    isJsxOrReactContent(file.content, file.path) ||
                    htmlContent.includes("text/babel") ||
                    htmlContent.includes("@babel/standalone") ||
                    htmlContent.includes("babel.min.js");

                if (scriptRegex.test(htmlContent)) {
                    htmlContent = htmlContent.replace(scriptRegex, (match, before, after) => {
                        const attrs = `${before || ""} ${after || ""}`;
                        let scriptType = "";
                        if (/type=["']text\/babel["']/i.test(attrs) || isReactOrJsx) {
                            scriptType = ' type="text/babel"';
                        } else if (/type=["']module["']/i.test(attrs)) {
                            scriptType = ' type="module"';
                        } else {
                            const typeMatch = attrs.match(/type=["']([^"']+)["']/i);
                            if (typeMatch) scriptType = ` type="${typeMatch[1]}"`;
                        }
                        return `<script${scriptType}>\n/* Inlined: ${file.path} */\n${transformedJs}\n</script>`;
                    });
                } else if (!htmlContent.includes(file.content.slice(0, 30))) {
                    const tag = isReactOrJsx ? '<script type="text/babel">' : '<script>';
                    if (htmlContent.includes("</body>")) {
                        htmlContent = htmlContent.replace("</body>", `${tag}\n/* Inlined: ${file.path} */\n${transformedJs}\n</script>\n</body>`);
                    } else {
                        htmlContent += `\n${tag}\n/* Inlined: ${file.path} */\n${transformedJs}\n</script>`;
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

        // Auto-inject Babel CDN if JSX or Babel script tag is present and Babel is not loaded
        const requiresBabel = htmlContent.includes('type="text/babel"') || isJsxOrReactContent(htmlContent);
        if (requiresBabel && !htmlContent.includes("@babel/standalone") && !htmlContent.includes("babel.min.js")) {
            const babelTag = '  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>';
            if (htmlContent.includes("<head>")) {
                htmlContent = htmlContent.replace("<head>", `<head>\n${babelTag}`);
            } else if (htmlContent.includes("<html>")) {
                htmlContent = htmlContent.replace("<html>", `<html>\n<head>\n${babelTag}\n</head>`);
            } else {
                htmlContent = `${babelTag}\n${htmlContent}`;
            }
        }

        // Auto-inject React & ReactDOM CDN if React/ReactDOM is referenced but not loaded
        const referencesReact = htmlContent.includes("React.") || htmlContent.includes("ReactDOM.") || requiresBabel;
        const hasReactCdn =
            htmlContent.includes("/react@") ||
            htmlContent.includes("/react.") ||
            htmlContent.includes("react.development") ||
            htmlContent.includes("react.production");
        if (referencesReact && !hasReactCdn) {
            const reactTags =
                '  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>\n  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>';
            if (htmlContent.includes("<head>")) {
                htmlContent = htmlContent.replace("<head>", `<head>\n${reactTags}`);
            }
        }
    }

    // Inject CSP (Content Security Policy) to restrict outbound frame/object execution while permitting CDN styles, fonts, and images
    const cspMeta = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' \'unsafe-inline\' \'unsafe-eval\' data: blob: https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://fonts.googleapis.com https://fonts.gstatic.com https://unpkg.com https://cdn.jsdelivr.net https://esm.sh; img-src * data: blob: https:; font-src * data: https:; style-src \'self\' \'unsafe-inline\' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://fonts.googleapis.com https://unpkg.com https://cdn.jsdelivr.net; script-src \'self\' \'unsafe-inline\' \'unsafe-eval\' data: blob: https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://unpkg.com https://cdn.jsdelivr.net https://esm.sh; connect-src \'self\' data: blob:; frame-src \'none\'; object-src \'none\'; base-uri \'none\';">';

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

    // Early error catcher injected into <head> so it captures parsing & execution errors
    const errorCatcherScript = `
  <script id="orbit-runtime-error-catcher">
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
      if (document.body) {
        document.body.appendChild(banner);
      } else {
        window.addEventListener('DOMContentLoaded', function() {
          if (document.body && !document.getElementById('orbit-runtime-error-banner')) {
            document.body.appendChild(banner);
          }
        });
      }
    }
    var span = document.getElementById('orbit-runtime-error-text');
    if (span) span.textContent = 'Runtime error: ' + (event.message || 'Script error');
  });
  </script>`;

    const headInject = `${cspMeta}\n${sandboxStorageShim}\n${errorCatcherScript}`;
    if (htmlContent.includes("<head>")) {
        htmlContent = htmlContent.replace("<head>", `<head>\n  ${headInject}`);
    } else if (htmlContent.includes("<html>")) {
        htmlContent = htmlContent.replace("<html>", `<html><head>${headInject}</head>`);
    } else {
        htmlContent = `<head>${headInject}</head>\n${htmlContent}`;
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
export const normalizeCodeProject = (raw = {}, userPrompt = "", runtimeStrategy = null) => {
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
        if ((language === "javascript" || language === "jsx" || cleanPath.endsWith(".js") || cleanPath.endsWith(".jsx") || cleanPath.endsWith(".tsx")) && content) {
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

    const isReact = runtimeStrategy === "REACT_APPLICATION" || isReactProject(files);

    if (isReact) {
        syncReactDependencies(files);
        ensureReactHtmlShell(files);
    }

    // Determine preview capability
    const hasHtml = files.some((f) => f.path.endsWith(".html"));
    const previewType = (hasHtml || isReact) ? "html" : "code";

    // Resolve entry file: verify entryFile exists among files, otherwise select appropriate entry point
    let resolvedEntryFile = entryFile;
    if (!files.some((f) => f.path.toLowerCase() === resolvedEntryFile.toLowerCase())) {
        if (isReact) {
            const reactEntry = files.find((f) =>
                f.path.toLowerCase().endsWith("main.jsx") ||
                f.path.toLowerCase().endsWith("app.jsx")
            );
            const firstHtml = files.find((f) => f.path.endsWith(".html"));
            resolvedEntryFile = reactEntry ? reactEntry.path : (firstHtml ? firstHtml.path : (files[0]?.path || "src/main.jsx"));
        } else {
            const firstHtml = files.find((f) => f.path.endsWith(".html"));
            if (firstHtml) {
                resolvedEntryFile = firstHtml.path;
            } else if (files.length > 0) {
                resolvedEntryFile = files[0].path;
            }
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
        baseArtifactId: raw.baseArtifactId || null,
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

/**
 * Applies incremental file operations (create, update, delete) to an existing project artifact.
 * Validates operation types, file paths, size limits, and ensures critical files remain protected.
 *
 * @param {object} existingArtifact
 * @param {object} operationPayload
 * @param {string} userPrompt
 * @returns {object} Updated CodeArtifact
 */
export const applyFileOperations = (existingArtifact, operationPayload = {}, userPrompt = "", runtimeStrategy = null) => {
    if (!existingArtifact || !Array.isArray(existingArtifact.files)) {
        if (operationPayload && (Array.isArray(operationPayload.files) || operationPayload.entryFile)) {
            return normalizeCodeProject(operationPayload, userPrompt, runtimeStrategy);
        }
        throw new Error("Cannot apply file operations: No existing artifact provided.");
    }

    // Backward compatibility: If the model emitted a full artifact with a "files" array instead of "operations"
    if (Array.isArray(operationPayload?.files) && (!operationPayload?.operations || !Array.isArray(operationPayload.operations))) {
        return normalizeCodeProject({
            ...operationPayload,
            baseArtifactId: existingArtifact.artifactId,
        }, userPrompt, runtimeStrategy);
    }

    const operations = operationPayload?.operations;
    if (!Array.isArray(operations)) {
        // If no operations array provided, return existing artifact preserving baseArtifactId
        return normalizeCodeProject({
            ...existingArtifact,
            title: operationPayload?.title || existingArtifact.title,
            description: operationPayload?.description || existingArtifact.description,
            summary: operationPayload?.summary || existingArtifact.summary,
            baseArtifactId: existingArtifact.artifactId,
        }, userPrompt, runtimeStrategy);
    }

    // Build map of existing files
    const fileMap = new Map();
    for (const f of existingArtifact.files) {
        if (f && f.path) {
            fileMap.set(f.path.toLowerCase(), {
                path: f.path,
                content: f.content ?? "",
                language: f.language || detectLanguage(f.path),
                size: f.size ?? Buffer.byteLength(f.content ?? "", "utf8"),
            });
        }
    }

    const isReact = runtimeStrategy === "REACT_APPLICATION" || isReactProject(existingArtifact);
    const seenOps = new Set();
    const VALID_TYPES = new Set(["create", "update", "delete"]);

    for (const op of operations) {
        if (!op || typeof op !== "object") {
            throw new Error("Invalid operation item: must be an object.");
        }

        const rawType = String(op.type || "").trim().toLowerCase();
        if (!VALID_TYPES.has(rawType)) {
            throw new Error(`Invalid operation type: "${op.type}". Supported types are "create", "update", "delete".`);
        }

        if (!op.path || typeof op.path !== "string" || !op.path.trim()) {
            throw new Error("Invalid operation path: file path must be a non-empty string.");
        }

        const trimmedPath = op.path.trim();

        // Security check: Prevent path traversal sequences (e.g. "../", "..\", "/..") or Windows drive letters
        if (
            trimmedPath.includes("..") ||
            /^[a-zA-Z]:/.test(trimmedPath) ||
            /^[/\\]/.test(trimmedPath)
        ) {
            throw new Error(`Invalid or unsafe file path: "${op.path}". Path traversal and absolute paths are prohibited.`);
        }

        const cleanPath = sanitizePath(trimmedPath);
        if (!cleanPath) {
            throw new Error(`Invalid file path after sanitization: "${op.path}".`);
        }

        const key = cleanPath.toLowerCase();

        // Conflict check: Disallow multiple conflicting or duplicate operations on the same path in one turn
        if (seenOps.has(key)) {
            throw new Error(`Duplicate or conflicting operation for file path: "${cleanPath}".`);
        }
        seenOps.add(key);

        if (rawType === "delete") {
            // Guard critical project files:
            const entryKey = (existingArtifact.entryFile || "index.html").toLowerCase();
            if (isReact) {
                if (key === entryKey || key === "src/main.jsx" || key === "index.html" || key === "src/app.jsx") {
                    const remainingEntries = Array.from(fileMap.values()).filter(
                        (f) =>
                            f.path.toLowerCase() !== key &&
                            (f.path.toLowerCase().endsWith("main.jsx") ||
                                f.path.toLowerCase().endsWith("app.jsx") ||
                                f.path.toLowerCase().endsWith(".html"))
                    );
                    if (remainingEntries.length === 0) {
                        throw new Error(`Cannot delete entry file "${cleanPath}" without an alternative React entry point in the project.`);
                    }
                }
            } else {
                if (key === "index.html" || key === entryKey) {
                    const remainingHtml = Array.from(fileMap.values()).filter(
                        (f) => f.path.toLowerCase() !== key && f.path.toLowerCase().endsWith(".html")
                    );
                    if (remainingHtml.length === 0) {
                        throw new Error(`Cannot delete entry file "${cleanPath}" without an alternative HTML entry point in the project.`);
                    }
                }
            }
            fileMap.delete(key);
        } else {
            // "create" or "update"
            if (typeof op.content !== "string") {
                throw new Error(`Operation "${rawType}" on file "${cleanPath}" requires string content.`);
            }

            const size = Buffer.byteLength(op.content, "utf8");
            if (size > MAX_SINGLE_FILE_SIZE) {
                throw new Error(`File "${cleanPath}" size (${(size / 1024 / 1024).toFixed(2)} MB) exceeds single file limit of ${(MAX_SINGLE_FILE_SIZE / 1024 / 1024)} MB.`);
            }

            const existingFile = fileMap.get(key);
            const targetPath = existingFile ? existingFile.path : cleanPath;
            const language = op.language || detectLanguage(targetPath);

            fileMap.set(key, {
                path: targetPath,
                content: op.content,
                language,
                size,
            });
        }
    }

    const updatedFiles = Array.from(fileMap.values());

    if (updatedFiles.length === 0) {
        throw new Error("Project must contain at least one file after applying operations.");
    }

    if (updatedFiles.length > MAX_PROJECT_FILES) {
        throw new Error(`Project file count (${updatedFiles.length}) exceeds maximum allowed limit of ${MAX_PROJECT_FILES} files.`);
    }

    const totalBytes = updatedFiles.reduce((acc, f) => acc + (f.size || 0), 0);
    if (totalBytes > MAX_PROJECT_TOTAL_SIZE) {
        throw new Error(`Project total size (${(totalBytes / 1024 / 1024).toFixed(2)} MB) exceeds maximum allowed limit of ${(MAX_PROJECT_TOTAL_SIZE / 1024 / 1024)} MB.`);
    }

    // Determine entry file: preserve existing entry file if it still exists, else find alternative
    let resolvedEntry = operationPayload.entryFile || existingArtifact.entryFile || "index.html";
    if (!fileMap.has(resolvedEntry.toLowerCase())) {
        if (isReact) {
            const firstJsx = updatedFiles.find(
                (f) => f.path.toLowerCase().endsWith("main.jsx") || f.path.toLowerCase().endsWith("app.jsx")
            );
            const firstHtml = updatedFiles.find((f) => f.path.toLowerCase().endsWith(".html"));
            resolvedEntry = firstJsx ? firstJsx.path : (firstHtml ? firstHtml.path : updatedFiles[0].path);
        } else {
            const firstHtml = updatedFiles.find((f) => f.path.toLowerCase().endsWith(".html"));
            resolvedEntry = firstHtml ? firstHtml.path : updatedFiles[0].path;
        }
    }

    const candidateArtifact = normalizeCodeProject({
        title: operationPayload.title || existingArtifact.title,
        description: operationPayload.description || existingArtifact.description,
        summary: operationPayload.summary || "Applied incremental updates to project.",
        entryFile: resolvedEntry,
        files: updatedFiles,
        baseArtifactId: existingArtifact.artifactId,
    }, userPrompt, runtimeStrategy);

    const integrity = validateArtifactIntegrity(candidateArtifact, runtimeStrategy);
    if (!integrity.valid) {
        // Attempt automatic repair of missing components or stylesheets
        const repaired = repairMissingReactImports(candidateArtifact, integrity, runtimeStrategy);
        if (repaired && repaired.integrity?.valid) {
            return repaired;
        }

        // If repair could not resolve errors and an existing valid artifact exists, preserve existing
        console.warn(
            "Incremental update failed integrity validation; preserving existing valid artifact:",
            integrity.errors.map((e) => e.message).join("; ")
        );
        return normalizeCodeProject(
            {
                ...existingArtifact,
                summary: `Incremental update could not be applied due to integrity errors (${integrity.errors.map((e) => e.message).join("; ")}). Existing functional project preserved.`,
                baseArtifactId: existingArtifact.artifactId,
            },
            userPrompt,
            runtimeStrategy
        );
    }

    return candidateArtifact;
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
        const parsed = JSON.parse(repaired);
        if (parsed && Array.isArray(parsed.files)) {
            // Drop any files that fail syntax validation (e.g. truncated last file)
            parsed.files = parsed.files.filter((f) => {
                if (!f || !f.path || typeof f.content !== "string") return false;
                const syn = checkFileSyntax(f.path, f.content);
                return syn.valid;
            });
        }
        if (parsed && Array.isArray(parsed.operations)) {
            parsed.operations = parsed.operations.filter((op) => {
                if (!op || !op.path) return false;
                if (op.type === "delete") return true;
                if (typeof op.content !== "string") return false;
                const syn = checkFileSyntax(op.path, op.content);
                return syn.valid;
            });
        }
        return parsed;
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
 * 5. Incremental file operations application when existingArtifact is present
 * 6. Direct file object scanner from partial JSON
 * 7. Markdown file block extraction (### filename.js \n ```js)
 * 8. Single code block fallback
 *
 * @param {string} text
 * @param {string} userPrompt
 * @param {object|null} existingArtifact
 * @returns {object} Validated CodeArtifact
 */
export const parseCodeArtifact = (text = "", userPrompt = "", existingArtifact = null, runtimeStrategy = null) => {
    const hasExisting = Boolean(
        existingArtifact &&
        Array.isArray(existingArtifact.files) &&
        existingArtifact.files.length > 0
    );

    if (!text || typeof text !== "string") {
        if (hasExisting) {
            return normalizeCodeProject({ ...existingArtifact, baseArtifactId: existingArtifact.artifactId }, userPrompt, runtimeStrategy);
        }
        return normalizeCodeProject({}, userPrompt, runtimeStrategy);
    }

    const ensureArtifactIntegrity = (artifact) => {
        if (!artifact) return null;
        const integrity = validateArtifactIntegrity(artifact, runtimeStrategy);
        if (integrity.valid) {
            artifact.integrity = integrity;
            return artifact;
        }

        const repaired = repairMissingReactImports(artifact, integrity, runtimeStrategy);
        if (repaired && repaired.integrity?.valid) {
            return repaired;
        }

        if (hasExisting) {
            console.warn(
                "New/updated artifact failed integrity validation; preserving existing project artifact:",
                integrity.errors.map((e) => e.message).join("; ")
            );
            return normalizeCodeProject(
                {
                    ...existingArtifact,
                    summary: `Generated code failed integrity validation (${integrity.errors.map((e) => e.message).join("; ")}). Existing project preserved.`,
                    baseArtifactId: existingArtifact.artifactId,
                },
                userPrompt,
                runtimeStrategy
            );
        }

        artifact.integrity = integrity;
        return artifact;
    };

    const processCandidate = (parsed) => {
        if (!parsed || typeof parsed !== "object") return null;
        if (hasExisting) {
            if (Array.isArray(parsed.operations) || Array.isArray(parsed.files)) {
                try {
                    const res = applyFileOperations(existingArtifact, parsed, userPrompt, runtimeStrategy);
                    return ensureArtifactIntegrity(res);
                } catch (opErr) {
                    console.warn("Failed to apply file operations:", opErr.message);
                    return null;
                }
            }
            if (parsed.entryFile || parsed.title) {
                const res = normalizeCodeProject({ ...existingArtifact, ...parsed, baseArtifactId: existingArtifact.artifactId }, userPrompt, runtimeStrategy);
                return ensureArtifactIntegrity(res);
            }
        } else {
            if (Array.isArray(parsed.files) || parsed.files || parsed.entryFile) {
                const res = normalizeCodeProject(parsed, userPrompt, runtimeStrategy);
                return ensureArtifactIntegrity(res);
            }
        }
        return null;
    };

    // 1. Direct JSON parse
    try {
        const parsed = JSON.parse(text.trim());
        const result = processCandidate(parsed);
        if (result) return result;
    } catch (_) {}

    // 2. Fenced JSON code block
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
    if (jsonMatch && jsonMatch[1]) {
        try {
            const parsed = JSON.parse(jsonMatch[1]);
            const result = processCandidate(parsed);
            if (result) return result;
        } catch (_) {}
    }

    // 3. Outermost JSON object with "files" or "operations" key
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
            const candidate = text.slice(firstBrace, lastBrace + 1);
            if (candidate.includes('"files"') || candidate.includes('"operations"') || candidate.includes('"title"')) {
                const parsed = JSON.parse(candidate);
                const result = processCandidate(parsed);
                if (result) return result;
            }
        } catch (_) {}
    }

    // 4. Truncated or incomplete JSON auto-repair
    const repaired = repairTruncatedJson(text);
    if (repaired) {
        try {
            const result = processCandidate(repaired);
            if (result) return result;
        } catch (_) {}
    }

    // 5. If hasExisting, and failed to parse valid operations, safely preserve previous artifact
    if (hasExisting) {
        console.warn("Could not parse incremental operations from model response; preserving existing project artifact.");
        return normalizeCodeProject(
            {
                ...existingArtifact,
                summary: `Could not apply code updates. Existing project preserved.`,
                baseArtifactId: existingArtifact.artifactId,
            },
            userPrompt
        );
    }

    // 6. Raw file object scanner from partial JSON
    const extractedFiles = extractFilesFromRawJson(text);
    if (extractedFiles.length > 0) {
        return ensureArtifactIntegrity(
            normalizeCodeProject(
                {
                    title: userPrompt ? userPrompt.slice(0, 50) : "Generated Application",
                    entryFile: extractedFiles.find((f) => f.path.endsWith(".html"))?.path || "index.html",
                    files: extractedFiles,
                },
                userPrompt,
                runtimeStrategy
            )
        );
    }

    // 7. Markdown multi-file blocks (### filename \n ```lang)
    const mdBlocks = parseMarkdownFileBlocks(text, userPrompt);
    if (mdBlocks && mdBlocks.files.length > 0) {
        return ensureArtifactIntegrity(mdBlocks);
    }

    // 8. Single standalone code block fallback
    const singleCodeMatch = text.match(/```([a-zA-Z0-9_-]*)\s*([\s\S]*?)\s*```/);
    if (singleCodeMatch) {
        const lang = (singleCodeMatch[1] || "").toLowerCase();
        const code = singleCodeMatch[2];
        const fileName = defaultPathByLang(lang);

        return ensureArtifactIntegrity(
            normalizeCodeProject(
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
                userPrompt,
                runtimeStrategy
            )
        );
    }

    // 9. Generic fallback
    return ensureArtifactIntegrity(normalizeCodeProject({}, userPrompt, runtimeStrategy));
};
