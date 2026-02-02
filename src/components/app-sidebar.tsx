import { ChevronDown, BarChart3, Megaphone, Search, Settings, Home, LogOut } from "lucide-react"
import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarHeader,
    SidebarFooter,
    SidebarRail,
} from "@/components/ui/sidebar"
import {
    Collapsible,
    CollapsibleTrigger,
    CollapsibleContent,
} from "@/components/ui/collapsible"
import { Link, useLocation, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { useAuthStore } from "@/lib/auth-store"

// Menu items
const items = [
    {
        title: "Dashboard",
        icon: Home,
        items: [
            { title: "Overview", url: "/" },
        ]
    },
    {
        title: "SEO Engine",
        icon: Search,
        items: [
            { title: "Page Index", url: "/seo/pages" },
            { title: "Meta & Schema", url: "/seo/meta" },
            { title: "Link Plan", url: "/seo/links" },
            { title: "Page Content", url: "/seo/content" },
            { title: "Blog Posts", url: "/seo/blog" },
            { title: "GMB Posts", url: "/seo/gmb" },
        ]
    },
    {
        title: "Ads Engine",
        icon: Megaphone,
        items: [
            { title: "Meta Ads", url: "/ads/meta" },
            { title: "Google Ads", url: "/ads/google" },
        ]
    },
    {
        title: "Performance",
        icon: BarChart3,
        items: [
            { title: "Dashboards", url: "/performance" },
        ]
    },
    {
        title: "Admin",
        icon: Settings,
        items: [
            { title: "Users", url: "/admin/users" },
            { title: "Roles", url: "/admin/roles" },
            { title: "Prompts", url: "/admin/prompts" },
            { title: "Taxonomy", url: "/admin/taxonomy" },
        ]
    }
]

export function AppSidebar() {
    const location = useLocation()
    const [searchParams] = useSearchParams()

    return (
        <Sidebar collapsible="icon">
            <SidebarHeader>
                <div className="flex items-center gap-3 px-3 py-3">
                    <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">P</div>
                    <span className="font-bold text-lg tracking-tight">Pulse</span>
                </div>
            </SidebarHeader>
            <SidebarContent>
                {items.map((group) => (
                    <Collapsible key={group.title} defaultOpen className="group/collapsible">
                        <SidebarGroup>
                            <SidebarGroupLabel asChild>
                                <CollapsibleTrigger>
                                    {group.title}
                                    <ChevronDown className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
                                </CollapsibleTrigger>
                            </SidebarGroupLabel>
                            <CollapsibleContent>
                                <SidebarGroupContent>
                                    <SidebarMenu>
                                        {group.items.map((item) => (
                                            <SidebarMenuItem key={item.title}>
                                                <SidebarMenuButton asChild isActive={location.pathname === item.url}>
                                                    <Link to={`${item.url}${searchParams.get('cid') ? `?cid=${searchParams.get('cid')}` : ''}`}>
                                                        <span>{item.title}</span>
                                                    </Link>
                                                </SidebarMenuButton>
                                            </SidebarMenuItem>
                                        ))}
                                    </SidebarMenu>
                                </SidebarGroupContent>
                            </CollapsibleContent>
                        </SidebarGroup>
                    </Collapsible>
                ))}
            </SidebarContent>
            <SidebarFooter>
                <div className="p-4 flex flex-col items-center gap-3">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start text-muted-foreground hover:text-foreground"
                        onClick={() => useAuthStore.getState().signOut()}
                    >
                        <LogOut className="h-4 w-4 mr-2" />
                        Sign Out
                    </Button>
                    <img
                        src="/dean-garland-logo.png"
                        alt="Dean Garland"
                        className="h-8 opacity-60"
                    />
                    <span className="text-xs text-muted-foreground">v1.0.0</span>
                </div>
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    )
}
