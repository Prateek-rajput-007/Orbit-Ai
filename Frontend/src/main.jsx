import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App.jsx"
import QueryProvider from "./providers/QueryProvider.jsx"
import { TooltipProvider } from "./components/ui/tooltip.jsx"

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QueryProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </QueryProvider>
  </StrictMode>,
)
