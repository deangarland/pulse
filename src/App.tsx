import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import DashboardLayout from "./layouts/DashboardLayout"
import PageIndex from "./pages/seo/PageIndex"
import PlaceholderView from "./pages/Placeholder"

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/" element={<PageIndex />} />

          {/* SEO Engine */}
          <Route path="/seo/meta" element={<PlaceholderView />} />
          <Route path="/seo/content" element={<PlaceholderView />} />
          <Route path="/seo/blog" element={<PlaceholderView />} />
          <Route path="/seo/gmb" element={<PlaceholderView />} />

          {/* Ads */}
          <Route path="/ads/meta" element={<PlaceholderView />} />
          <Route path="/ads/google" element={<PlaceholderView />} />

          {/* Performance */}
          <Route path="/performance" element={<PlaceholderView />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
