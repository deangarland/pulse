import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import DashboardLayout from "./layouts/DashboardLayout"
import Home from "./pages/Home"
import PageIndex from "./pages/seo/PageIndex"
import MetaSchema from "./pages/seo/MetaSchema"
import PageContent from "./pages/seo/PageContent"
import LinkPlan from "./pages/seo/LinkPlan"
import PlaceholderView from "./pages/Placeholder"
import Prompts from "./pages/admin/Prompts"
import TokenCostLog from "./pages/admin/TokenCostLog"
import Taxonomy from "./pages/admin/Taxonomy"
import Schema from "./pages/admin/Schema"
import Accounts from "./pages/admin/Accounts"
import Users from "./pages/admin/Users"
import Roles from "./pages/admin/Roles"
import Login from "./pages/Login"
import { ProtectedRoute } from "./components/ProtectedRoute"

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />

        {/* Protected routes */}
        <Route element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }>
          <Route path="/" element={<Home />} />

          {/* SEO Engine */}
          <Route path="/seo/pages" element={<PageIndex />} />
          <Route path="/seo/meta" element={<MetaSchema />} />
          <Route path="/seo/links" element={<LinkPlan />} />
          <Route path="/seo/content" element={<PageContent />} />
          <Route path="/seo/blog" element={<PlaceholderView />} />
          <Route path="/seo/gmb" element={<PlaceholderView />} />

          {/* Ads */}
          <Route path="/ads/meta" element={<PlaceholderView />} />
          <Route path="/ads/google" element={<PlaceholderView />} />

          {/* Performance */}
          <Route path="/performance" element={<PlaceholderView />} />

          {/* Admin */}
          <Route path="/admin/prompts" element={<Prompts />} />
          <Route path="/admin/tokens" element={<TokenCostLog />} />
          <Route path="/admin/taxonomy" element={<Taxonomy />} />
          <Route path="/admin/schema" element={<Schema />} />
          <Route path="/admin/accounts" element={<Accounts />} />
          <Route path="/admin/users" element={<Users />} />
          <Route path="/admin/roles" element={<Roles />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
