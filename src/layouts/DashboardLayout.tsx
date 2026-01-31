import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Separator } from "@/components/ui/separator"
import { Toaster } from "@/components/ui/sonner"
import { CustomerSelector } from "@/components/CustomerSelector"
import { Outlet } from "react-router-dom"

export default function DashboardLayout() {
    return (
        <SidebarProvider>
            <div className="flex min-h-screen w-full">
                <AppSidebar />
                <main className="flex-1 flex flex-col ml-56">
                    <header className="h-14 shrink-0 border-b bg-background">
                        <div className="h-full max-w-7xl mx-auto flex items-center justify-between gap-2 px-4 lg:px-6">
                            <div className="flex items-center gap-2">
                                <SidebarTrigger className="-ml-1" />
                                <Separator orientation="vertical" className="mr-2 h-4" />
                                <h1 className="font-semibold text-sm">Platform Overview</h1>
                            </div>
                            <CustomerSelector />
                        </div>
                    </header>
                    <div className="flex-1 bg-muted/20 overflow-auto">
                        <div className="max-w-7xl mx-auto p-4 lg:p-6">
                            <Outlet />
                        </div>
                    </div>
                </main>
            </div>
            <Toaster />
        </SidebarProvider>
    )
}
