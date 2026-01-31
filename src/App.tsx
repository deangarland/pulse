import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import DashboardLayout from "./layouts/DashboardLayout"
import PageIndex from "./pages/seo/PageIndex"
import MetaSchema from "./pages/seo/MetaSchema"
import PlaceholderView from "./pages/Placeholder"
import Prompts from "./pages/admin/Prompts"

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/" element={<PageIndex />} />

          {/* SEO Engine */}
          <Route path="/seo/meta" element={<MetaSchema />} />
          <Route path="/seo/content" element={<PlaceholderView />} />
          <Route path="/seo/blog" element={<PlaceholderView />} />
          <Route path="/seo/gmb" element={<PlaceholderView />} />

          {/* Ads */}
          <Route path="/ads/meta" element={<PlaceholderView />} />
          <Route path="/ads/google" element={<PlaceholderView />} />

          {/* Performance */}
          <Route path="/performance" element={<PlaceholderView />} />

          {/* Admin */}
          <Route path="/admin/prompts" element={<Prompts />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
