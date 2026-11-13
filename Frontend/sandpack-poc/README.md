# Orbit Coding Agent — Phase 2 Sandpack Proof of Concept (POC)

An isolated evaluation and runtime demonstration of CodeSandbox's **Sandpack** as a modern React execution engine for Orbit's Coding Agent.

---

## 1. Directory Structure

```text
Frontend/sandpack-poc/
├── package.json               # Isolated POC dependencies (zero impact on main Frontend/package.json)
├── vite.config.js             # Standalone Vite configuration
├── index.html                 # Host HTML document
├── README.md                  # POC documentation and evaluation findings
├── src/
│   ├── main.jsx               # Demo root with Sandpack Workspace vs. Standalone view toggle
│   ├── App.jsx                # Multi-file React Todo application (Header, List, Filters, Dark Mode)
│   ├── SandpackWorkspace.jsx  # Sandpack layout with File Explorer, Code Editor, Preview, and Console
│   ├── orbitSandpackAdapter.js # Portable mapping adapter: Orbit CodeArtifact <-> Sandpack file map
│   ├── components/
│   │   ├── Header.jsx         # Component with dark/light mode toggle
│   │   ├── TodoList.jsx       # Component rendering filtered list
│   │   └── TodoItem.jsx       # Component with completion toggle and delete
│   └── styles/
│       └── index.css          # Scoped CSS with CSS variables and responsive rules
└── test/
    └── sandpack_poc_validation.test.js # Automated tests for incremental update simulation
```

---

## 2. Capabilities Validated

* **Real React 18/19 Execution**: Native JSX compilation and hooks (`useState`, `useEffect`, `useMemo`) without requiring inline `@babel/standalone` scripts.
* **True ES Modules**: Clean `import` and `export default` statements across multi-file structures.
* **Auto Dependency Resolution**: Automatically resolves npm packages (`lucide-react`, `date-fns`, `recharts`, `clsx`) via Sandpack's remote registry.
* **Incremental Updates**: Supports `create`, `update`, and `delete` file operations matching Orbit Phase 1 & 1.1 contracts.
* **Zero Disruption to Orbit Core**: Completely decoupled from main Orbit frontend workspace, Netlify deployment, and backend LangGraph agent.

---

## 3. How to Run

```bash
cd Frontend/sandpack-poc
npm install
npm run dev
```

To run the automated validation tests:

```bash
npm test
```

