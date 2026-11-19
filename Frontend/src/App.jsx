import { useEffect } from "react"
import Home from "./pages/Home.jsx"
import { prewarmBackend } from "./api/prewarm.js"

export default function App() {
  useEffect(() => {
    prewarmBackend()
  }, [])

  return <Home />
}
