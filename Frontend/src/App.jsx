import { useEffect } from "react"
import { Routes, Route, Navigate } from "react-router-dom"
import Home from "./pages/Home.jsx"
import { prewarmBackend } from "./api/prewarm.js"

export default function App() {
  useEffect(() => {
    prewarmBackend()
  }, [])

  return (
    <Routes>
      <Route element={<Home />}>
        <Route index element={null} />
        <Route path="c/:conversationId" element={null} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
