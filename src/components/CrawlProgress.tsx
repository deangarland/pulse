import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Loader2, CheckCircle, AlertCircle, Globe } from 'lucide-react'

interface CrawlProgressProps {
    siteId: string
    onComplete?: () => void
}

interface SiteStatus {
    id: string
    domain: string
    status: 'pending' | 'in_progress' | 'classifying' | 'complete' | 'error'
    pages_crawled: number
    page_limit: number
    current_url: string | null
    percent_complete: number
    updated_at: string
}

export function CrawlProgress({ siteId, onComplete }: CrawlProgressProps) {
    const apiUrl = import.meta.env.VITE_API_URL || ''
    const [wasComplete, setWasComplete] = useState(false)

    const { data: status, isLoading } = useQuery<SiteStatus>({
        queryKey: ['site-status', siteId],
        queryFn: async () => {
            const response = await fetch(`${apiUrl}/api/sites/${siteId}/status`)
            if (!response.ok) throw new Error('Failed to fetch status')
            return response.json()
        },
        refetchInterval: (query) => {
            const data = query.state.data
            // Stop polling when complete or error
            if (data?.status === 'complete' || data?.status === 'error') {
                return false
            }
            return 2000 // Poll every 2 seconds
        },
        enabled: !!siteId
    })

    // Trigger onComplete when status changes to complete
    useEffect(() => {
        if (status?.status === 'complete' && !wasComplete) {
            setWasComplete(true)
            onComplete?.()
        }
    }, [status?.status, wasComplete, onComplete])

    if (isLoading || !status) {
        return (
            <div className="flex items-center gap-2 p-4 bg-muted/50 rounded-lg">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading crawl status...</span>
            </div>
        )
    }

    const getStatusBadge = () => {
        switch (status.status) {
            case 'pending':
                return <Badge variant="secondary">Pending</Badge>
            case 'in_progress':
                return <Badge variant="default" className="bg-blue-500">Crawling...</Badge>
            case 'classifying':
                return <Badge variant="default" className="bg-purple-500">Classifying...</Badge>
            case 'complete':
                return <Badge variant="default" className="bg-green-500">Complete</Badge>
            case 'error':
                return <Badge variant="destructive">Error</Badge>
            default:
                return <Badge variant="secondary">{status.status}</Badge>
        }
    }

    const getIcon = () => {
        switch (status.status) {
            case 'complete':
                return <CheckCircle className="h-5 w-5 text-green-500" />
            case 'error':
                return <AlertCircle className="h-5 w-5 text-red-500" />
            default:
                return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
        }
    }

    return (
        <div className="p-4 bg-muted/50 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {getIcon()}
                    <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{status.domain}</span>
                    </div>
                </div>
                {getStatusBadge()}
            </div>

            {(status.status === 'in_progress' || status.status === 'classifying') && (
                <>
                    <Progress value={Math.min(status.percent_complete, 100)} className="h-2" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                        <span>
                            {status.pages_crawled} / {status.page_limit} pages
                        </span>
                        <span>{status.percent_complete}%</span>
                    </div>
                    {status.current_url && (
                        <p className="text-xs text-muted-foreground truncate">
                            {status.status === 'classifying' ? 'Classifying pages...' : `Crawling: ${status.current_url}`}
                        </p>
                    )}
                </>
            )}

            {status.status === 'complete' && (
                <p className="text-sm text-green-600">
                    ✓ Successfully crawled and classified {status.pages_crawled} pages
                </p>
            )}

            {status.status === 'error' && (
                <p className="text-sm text-red-600">
                    Crawl failed. Check server logs for details.
                </p>
            )}
        </div>
    )
}
