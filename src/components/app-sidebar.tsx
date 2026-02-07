import { useState, useEffect } from "react"
import {
    ChevronDown,
    ChevronRight,
    BarChart3,
    Megaphone,
    Search,
    Settings,
    Home,
    LogOut,
    LayoutDashboard,
    FileText,
    Link2,
    FileEdit,
    Newspaper,
    MapPin,
    Users,
    Shield,
    MessageSquare,
    Tags,
    DollarSign,
    X,
    Building2,
    Braces
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

// Regular menu items (not Admin)
const menuItems = [
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
            { title: "Page Content", url: "/seo/content", icon: FileEdit },
            { title: "Link Plan", url: "/seo/links", icon: Link2 },
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
    }
]

// Admin items (rendered in slide-out panel)
const adminItems = [
    { title: "Users", url: "/admin/users", icon: Users },
    { title: "Roles", url: "/admin/roles", icon: Shield },
    { title: "Prompts", url: "/admin/prompts", icon: MessageSquare },
    { title: "Page Types", url: "/admin/templates", icon: FileText },
    { title: "Token Usage", url: "/admin/tokens", icon: DollarSign },
    { title: "Taxonomy", url: "/admin/taxonomy", icon: Tags },
    { title: "Schema", url: "/admin/schema", icon: Braces },
    { title: "Accounts", url: "/admin/accounts", icon: Building2 },
]

export function AppSidebar() {
    const location = useLocation()
    const [searchParams] = useSearchParams()
    const { state } = useSidebar()
    const isCollapsed = state === "collapsed"
    const [adminPanelOpen, setAdminPanelOpen] = useState(false)

    // Close admin panel when navigating away from admin routes
    useEffect(() => {
        if (!location.pathname.startsWith('/admin')) {
            setAdminPanelOpen(false)
        }
    }, [location.pathname])

    const handleAdminClick = () => {
        setAdminPanelOpen(!adminPanelOpen)
    }

    const handleAdminLinkClick = () => {
        setAdminPanelOpen(false)
    }

    return (
        <div className="flex">
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
                    {menuItems.map((group) => (
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

                    {/* Admin - Click to toggle slide-out panel */}
                    <SidebarGroup>
                        <SidebarGroupLabel asChild>
                            <button
                                onClick={handleAdminClick}
                                className="flex items-center w-full text-left hover:bg-accent rounded-md transition-colors"
                            >
                                <Settings className="h-4 w-4 mr-2" />
                                {!isCollapsed && "Admin"}
                                {!isCollapsed && (
                                    <ChevronRight className={cn(
                                        "ml-auto transition-transform",
                                        adminPanelOpen && "rotate-180"
                                    )} />
                                )}
                            </button>
                        </SidebarGroupLabel>
                    </SidebarGroup>
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

            {/* Admin Slide-Out Panel */}
            <div className={cn(
                "fixed top-0 h-full bg-sidebar border-r border-border shadow-lg transition-all duration-200 ease-in-out z-40",
                isCollapsed ? "left-[--sidebar-width-icon]" : "left-[--sidebar-width]",
                adminPanelOpen ? "w-48 opacity-100" : "w-0 opacity-0 overflow-hidden"
            )}>
                <div className="flex flex-col h-full">
                    <div className="flex items-center justify-between p-4 border-b">
                        <span className="font-semibold text-sm">Admin</span>
                        <button
                            onClick={() => setAdminPanelOpen(false)}
                            className="p-1 rounded hover:bg-accent"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    <nav className="flex-1 p-2">
                        {adminItems.map((item) => (
                            <Link
                                key={item.url}
                                to={`${item.url}${searchParams.get('cid') ? `?cid=${searchParams.get('cid')}` : ''}`}
                                onClick={handleAdminLinkClick}
                                className={cn(
                                    "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                                    location.pathname === item.url
                                        ? "bg-accent text-accent-foreground font-medium"
                                        : "hover:bg-accent/50"
                                )}
                            >
                                <item.icon className="h-4 w-4" />
                                {item.title}
                            </Link>
                        ))}
                    </nav>
                </div>
            </div>
        </div>
    )
}
