import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import DashboardLayout from "./layouts/DashboardLayout"
import Home from "./pages/Home"
import PageIndex from "./pages/seo/PageIndex"
import MetaSchema from "./pages/seo/MetaSchema"
import PlaceholderView from "./pages/Placeholder"
import Prompts from "./pages/admin/Prompts"
import Taxonomy from "./pages/admin/Taxonomy"

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/" element={<Home />} />

          {/* SEO Engine */}
          <Route path="/seo/pages" element={<PageIndex />} />
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
          <Route path="/admin/taxonomy" element={<Taxonomy />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
