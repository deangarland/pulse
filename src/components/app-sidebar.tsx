import {
    ChevronDown,
    BarChart3,
    Megaphone,
    Search,
    Settings,
    Home,
    LogOut,
    LayoutDashboard,
    FileText,
    Code,
    Link2,
    FileEdit,
    Newspaper,
    MapPin,
    Users,
    Shield,
    MessageSquare,
    Tags,
    DollarSign
} from "lucide-react"
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
    useSidebar,
} from "@/components/ui/sidebar"
import {
    Collapsible,
    CollapsibleTrigger,
    CollapsibleContent,
} from "@/components/ui/collapsible"
import { Link, useLocation, useSearchParams } from "react-router-dom"
import { useAuthStore } from "@/lib/auth-store"
import { cn } from "@/lib/utils"

// Menu items with icons for each item
const items = [
    {
        title: "Dashboard",
        icon: Home,
        items: [
            { title: "Overview", url: "/", icon: LayoutDashboard },
        ]
    },
    {
        title: "SEO Engine",
        icon: Search,
        items: [
            { title: "Page Index", url: "/seo/pages", icon: FileText },
            { title: "Meta & Schema", url: "/seo/meta", icon: Code },
            { title: "Link Plan", url: "/seo/links", icon: Link2 },
            { title: "Page Content", url: "/seo/content", icon: FileEdit },
            { title: "Blog Posts", url: "/seo/blog", icon: Newspaper },
            { title: "GMB Posts", url: "/seo/gmb", icon: MapPin },
        ]
    },
    {
        title: "Ads Engine",
        icon: Megaphone,
        items: [
            { title: "Meta Ads", url: "/ads/meta", icon: Megaphone },
            { title: "Google Ads", url: "/ads/google", icon: BarChart3 },
        ]
    },
    {
        title: "Performance",
        icon: BarChart3,
        items: [
            { title: "Dashboards", url: "/performance", icon: BarChart3 },
        ]
    },
    {
        title: "Admin",
        icon: Settings,
        items: [
            { title: "Users", url: "/admin/users", icon: Users },
            { title: "Roles", url: "/admin/roles", icon: Shield },
            { title: "Prompts", url: "/admin/prompts", icon: MessageSquare },
            { title: "Token Usage", url: "/admin/tokens", icon: DollarSign },
            { title: "Taxonomy", url: "/admin/taxonomy", icon: Tags },
        ]
    }
]

export function AppSidebar() {
    const location = useLocation()
    const [searchParams] = useSearchParams()
    const { state } = useSidebar()
    const isCollapsed = state === "collapsed"

    return (
        <Sidebar collapsible="icon">
            <SidebarHeader>
                <div className={cn(
                    "flex items-center py-3",
                    isCollapsed ? "justify-center px-0" : "gap-3 px-3"
                )}>
                    <div className="h-7 w-7 min-w-7 shrink-0 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">P</div>
                    {!isCollapsed && <span className="font-bold text-lg tracking-tight">Pulse</span>}
                </div>
            </SidebarHeader>
            <SidebarContent>
                {items.map((group) => (
                    <Collapsible key={group.title} defaultOpen className="group/collapsible">
                        <SidebarGroup>
                            <SidebarGroupLabel asChild>
                                <CollapsibleTrigger>
                                    <group.icon className="h-4 w-4 mr-2" />
                                    {!isCollapsed && group.title}
                                    {!isCollapsed && <ChevronDown className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />}
                                </CollapsibleTrigger>
                            </SidebarGroupLabel>
                            <CollapsibleContent>
                                <SidebarGroupContent>
                                    <SidebarMenu className={!isCollapsed ? "pl-4" : ""}>
                                        {group.items.map((item) => (
                                            <SidebarMenuItem key={item.title}>
                                                <SidebarMenuButton
                                                    asChild
                                                    isActive={location.pathname === item.url}
                                                    tooltip={item.title}
                                                >
                                                    <Link to={`${item.url}${searchParams.get('cid') ? `?cid=${searchParams.get('cid')}` : ''}`}>
                                                        <item.icon className="h-4 w-4" />
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
                <div className="p-2 flex flex-col items-center gap-2">
                    <SidebarMenuButton
                        tooltip="Sign Out"
                        className="w-full"
                        onClick={() => useAuthStore.getState().signOut()}
                    >
                        <LogOut className="h-4 w-4" />
                        <span>Sign Out</span>
                    </SidebarMenuButton>
                    {!isCollapsed && (
                        <>
                            <img
                                src="/dean-garland-logo.png"
                                alt="Dean Garland"
                                className="h-8 opacity-60"
                            />
                            <span className="text-xs text-muted-foreground">v1.0.0</span>
                        </>
                    )}
                </div>
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    )
}

