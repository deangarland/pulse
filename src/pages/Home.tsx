import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { useAccountStore } from "@/lib/account-store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Link } from "react-router-dom"
import {
    FileText,
    Sparkles,
    Code2,
    ArrowRight,
    Zap,
    Target,
    TrendingUp,
    Clock
} from "lucide-react"

export default function Home() {
    const { selectedAccountId, selectedAccountName } = useAccountStore()

    // Fetch metrics for selected account
    const { data: metrics } = useQuery({
        queryKey: ['home-metrics', selectedAccountId],
        queryFn: async () => {
            if (!selectedAccountId) return null

            // Get site for account
            const { data: site } = await supabase
                .from('site_index')
                .select('id')
                .eq('account_id', selectedAccountId)
                .single()

            if (!site) return { pages: 0, recommendations: 0, schemas: 0 }

            // Count pages (excluding 301s)
            const { count: pagesCount } = await supabase
                .from('page_index')
                .select('*', { count: 'exact', head: true })
                .eq('site_id', site.id)
                .neq('status_code', 301)

            // Count pages with recommendations
            const { count: recsCount } = await supabase
                .from('page_index')
                .select('*', { count: 'exact', head: true })
                .eq('site_id', site.id)
                .not('meta_recommendation', 'is', null)

            // Count pages with schema recommendations
            const { count: schemasCount } = await supabase
                .from('page_index')
                .select('*', { count: 'exact', head: true })
                .eq('site_id', site.id)
                .not('schema_recommendation', 'is', null)

            return {
                pages: pagesCount || 0,
                recommendations: recsCount || 0,
                schemas: schemasCount || 0
            }
        },
        enabled: !!selectedAccountId
    })

    // Fetch recent pages with recommendations
    const { data: recentActivity } = useQuery({
        queryKey: ['recent-activity', selectedAccountId],
        queryFn: async () => {
            if (!selectedAccountId) return []

            const { data: site } = await supabase
                .from('site_index')
                .select('id')
                .eq('account_id', selectedAccountId)
                .single()

            if (!site) return []

            const { data } = await supabase
                .from('page_index')
                .select('id, url, title, page_type, recommendation_generated_at')
                .eq('site_id', site.id)
                .not('recommendation_generated_at', 'is', null)
                .order('recommendation_generated_at', { ascending: false })
                .limit(5)

            return data || []
        },
        enabled: !!selectedAccountId
    })

    // Fetch pages by type counts
    const { data: pagesByType } = useQuery({
        queryKey: ['pages-by-type', selectedAccountId],
        queryFn: async () => {
            if (!selectedAccountId) return []

            const { data: site } = await supabase
                .from('site_index')
                .select('id')
                .eq('account_id', selectedAccountId)
                .single()

            if (!site) return []

            const { data } = await supabase
                .from('page_index')
                .select('page_type')
                .eq('site_id', site.id)
                .neq('status_code', 301)

            // Count by type
            const counts: Record<string, number> = {}
            data?.forEach(p => {
                const type = p.page_type || 'Unclassified'
                counts[type] = (counts[type] || 0) + 1
            })

            return Object.entries(counts)
                .map(([type, count]) => ({ type, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 6)
        },
        enabled: !!selectedAccountId
    })

    const formatUrl = (url: string) => {
        try {
            return new URL(url).pathname || '/'
        } catch {
            return url
        }
    }

    const formatTimeAgo = (date: string) => {
        const now = new Date()
        const then = new Date(date)
        const diffMs = now.getTime() - then.getTime()
        const diffMins = Math.floor(diffMs / 60000)
        const diffHours = Math.floor(diffMins / 60)
        const diffDays = Math.floor(diffHours / 24)

        if (diffDays > 0) return `${diffDays}d ago`
        if (diffHours > 0) return `${diffHours}h ago`
        if (diffMins > 0) return `${diffMins}m ago`
        return 'just now'
    }

    if (!selectedAccountId) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-center">
                <Target className="h-12 w-12 text-muted-foreground mb-4" />
                <h2 className="text-xl font-semibold mb-2">Select an Account</h2>
                <p className="text-muted-foreground">
                    Choose a customer from the dropdown above to view their dashboard
                </p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
                <p className="text-muted-foreground">
                    {selectedAccountName} • SEO & Schema Performance
                </p>
            </div>

            {/* Metric Cards */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            Pages Indexed
                        </CardTitle>
                        <FileText className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">{metrics?.pages?.toLocaleString() || 0}</div>
                        <p className="text-xs text-muted-foreground mt-1">
                            Active pages in site
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            AI Recommendations
                        </CardTitle>
                        <Sparkles className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">{metrics?.recommendations || 0}</div>
                        <p className="text-xs text-muted-foreground mt-1">
                            Meta tags optimized
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            Schema Generated
                        </CardTitle>
                        <Code2 className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">{metrics?.schemas || 0}</div>
                        <p className="text-xs text-muted-foreground mt-1">
                            Rich snippets ready
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            Coverage
                        </CardTitle>
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">
                            {metrics?.pages ? Math.round((metrics.recommendations / metrics.pages) * 100) : 0}%
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                            Pages with recommendations
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Quick Actions */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <Zap className="h-4 w-4" />
                        Quick Actions
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex gap-3">
                    <Button asChild>
                        <Link to="/seo/meta">
                            Generate Recommendations
                            <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                    </Button>
                    <Button variant="outline" asChild>
                        <Link to="/">
                            View Page Index
                        </Link>
                    </Button>
                    <Button variant="outline" asChild>
                        <Link to="/admin/prompts">
                            Manage AI Prompts
                        </Link>
                    </Button>
                </CardContent>
            </Card>

            {/* Two Column Layout */}
            <div className="grid gap-4 md:grid-cols-2">
                {/* Recent Activity */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-base font-semibold flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            Recent AI Activity
                        </CardTitle>
                        <Link
                            to="/seo/meta"
                            className="text-sm text-primary hover:underline"
                        >
                            View all
                        </Link>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="divide-y">
                            {recentActivity?.map((item) => (
                                <div key={item.id} className="px-4 py-3 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                                            <Sparkles className="h-4 w-4 text-primary" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium truncate max-w-[200px]">
                                                {formatUrl(item.url)}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                Recommendations generated
                                            </p>
                                        </div>
                                    </div>
                                    <span className="text-xs text-muted-foreground">
                                        {formatTimeAgo(item.recommendation_generated_at)}
                                    </span>
                                </div>
                            ))}
                            {(!recentActivity || recentActivity.length === 0) && (
                                <div className="px-4 py-8 text-center text-muted-foreground">
                                    <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                    <p className="text-sm">No recommendations generated yet</p>
                                    <p className="text-xs mt-1">Go to Meta & Schema to generate your first</p>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Pages by Type */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-base font-semibold">Pages by Type</CardTitle>
                        <Link
                            to="/"
                            className="text-sm text-primary hover:underline"
                        >
                            View all
                        </Link>
                    </CardHeader>
                    <CardContent className="p-0">
                        <table className="w-full">
                            <tbody className="divide-y">
                                {pagesByType?.map((item) => (
                                    <tr key={item.type}>
                                        <td className="px-4 py-3">
                                            <span className="text-sm font-medium">{item.type}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <span className="text-sm font-bold">{item.count}</span>
                                        </td>
                                    </tr>
                                ))}
                                {(!pagesByType || pagesByType.length === 0) && (
                                    <tr>
                                        <td className="px-4 py-8 text-center text-muted-foreground" colSpan={2}>
                                            <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                            <p className="text-sm">No pages indexed yet</p>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
