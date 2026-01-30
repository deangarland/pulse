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
                    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4 bg-background">
                        <div className="flex items-center gap-2">
                            <SidebarTrigger className="-ml-1" />
                            <Separator orientation="vertical" className="mr-2 h-4" />
                            <h1 className="font-semibold text-sm">Platform Overview</h1>
                        </div>
                        <CustomerSelector />
                    </header>
                    <div className="flex-1 p-4 bg-muted/20 overflow-auto">
                        <Outlet />
                    </div>
                </main>
            </div>
            <Toaster />
        </SidebarProvider>
    )
}
