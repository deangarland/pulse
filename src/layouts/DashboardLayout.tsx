import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Separator } from "@/components/ui/separator"
import { Toaster } from "@/components/ui/sonner"
import { CustomerSelector } from "@/components/CustomerSelector"
import { Outlet, useLocation } from "react-router-dom"

export default function DashboardLayout() {
    const location = useLocation()
    const isAdminRoute = location.pathname.startsWith('/admin')

    return (
        <SidebarProvider>
            <AppSidebar />
            <main className="flex-1 flex flex-col min-h-screen">
                <header className="h-14 shrink-0 border-b bg-background">
                    <div className="h-full flex items-center gap-2 px-4 lg:px-6">
                        <SidebarTrigger className="-ml-1" />
                        <Separator orientation="vertical" className="mr-2 h-4" />
                        {!isAdminRoute && <CustomerSelector />}
                    </div>
                </header>
                <div className="flex-1 bg-muted/20 overflow-auto">
                    <div className="max-w-7xl mx-auto p-4 lg:p-6">
                        <Outlet />
                    </div>
                </div>
            </main>
            <Toaster />
        </SidebarProvider>
    )
}
