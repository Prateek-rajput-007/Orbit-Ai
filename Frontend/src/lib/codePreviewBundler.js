/**
 * Transforms ES module export statements into standard browser-compatible declarations
 * for safe inline execution in sandboxed preview iframes.
 */
export function transformScriptForSandboxClient(code = "") {
  if (!code || typeof code !== "string") return ""
  return code
    .replace(/^export\s+default\s+[a-zA-Z0-9_$]+;?/gm, "")
    .replace(/^export\s+default\s+/gm, "")
    .replace(/^export\s+(const|let|var|function\*?|class|async\s+function\*?)\s+/gm, "$1 ")
    .replace(/^export\s*\{[^}]*\};?/gm, "")
}

/**
 * Inlines CSS and JS into an HTML entry file client-side.
 * Used as a fallback when opening restored artifacts from conversation history.
 *
 * @param {Array<{ path: string, content: string }>} files
 * @param {string} entryPath
 * @returns {string} Self-contained HTML with CSP and error catcher
 */
export function bundleCodePreviewClient(files = [], entryPath = "index.html") {
  if (!Array.isArray(files) || files.length === 0) {
    return "<!DOCTYPE html><html><body class='bg-slate-900 text-white p-4'>No files to preview.</body></html>";
  }

  const fileMap = new Map();
  for (const file of files) {
    if (file?.path && typeof file?.content === "string") {
      fileMap.set(file.path.toLowerCase(), file.content);
    }
  }

  let htmlContent = fileMap.get((entryPath || "index.html").toLowerCase()) || "";

  // If no HTML file is present, look for any .html file
  if (!htmlContent) {
    for (const [path, content] of fileMap.entries()) {
      if (path.endsWith(".html")) {
        htmlContent = content;
        break;
      }
    }
  }

  // If still no HTML, construct a host document
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

    for (const css of cssFiles) {
      htmlContent = htmlContent.replace("</head>", `<style>\n${css.content}\n</style>\n</head>`);
    }
    for (const js of jsFiles) {
      const transformedJs = transformScriptForSandboxClient(js.content);
      htmlContent = htmlContent.replace("</body>", `<script>\n${transformedJs}\n</script>\n</body>`);
    }
  } else {
    // Inline external CSS / JS
    for (const file of files) {
      const fileName = file.path.split("/").pop();
      const escapedFileName = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      if (file.path.endsWith(".css")) {
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
        const transformedJs = transformScriptForSandboxClient(file.content);
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
</script>
`;

  if (htmlContent.includes("<head>")) {
    htmlContent = htmlContent.replace("<head>", `<head>\n  ${cspMeta}\n${sandboxStorageShim}`);
  } else if (htmlContent.includes("<html>")) {
    htmlContent = htmlContent.replace("<html>", `<html><head>${cspMeta}\n${sandboxStorageShim}</head>`);
  } else {
    htmlContent = `<head>${cspMeta}\n${sandboxStorageShim}</head>\n${htmlContent}`;
  }

  // Inject error catcher
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
}
