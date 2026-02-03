import { useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Loader2, Globe, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'

interface AddWebsiteModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSuccess?: (siteId: string) => void
}

interface Account {
    id: string
    account_name: string
}

interface SiteResponse {
    id: string
    domain: string
    updated?: boolean
}

export function AddWebsiteModal({ open, onOpenChange, onSuccess }: AddWebsiteModalProps) {
    const [url, setUrl] = useState('')
    const [accountId, setAccountId] = useState<string>('')
    const [pageLimit, setPageLimit] = useState(200)
    const [excludePaths, setExcludePaths] = useState('')
    const [runClassifier, setRunClassifier] = useState(true)
    const [error, setError] = useState('')
    const queryClient = useQueryClient()
    const apiUrl = import.meta.env.VITE_API_URL || ''

    // Fetch accounts for dropdown
    const { data: accounts } = useQuery<Account[]>({
        queryKey: ['accounts-list'],
        queryFn: async () => {
            const response = await fetch(`${apiUrl}/api/admin/accounts`)
            if (!response.ok) throw new Error('Failed to fetch accounts')
            return response.json()
        }
    })

    // Create site mutation
    const createSite = useMutation({
        mutationFn: async (): Promise<SiteResponse> => {
            // Parse exclude paths (comma or newline separated)
            const excludeArray = excludePaths
                .split(/[,\n]/)
                .map(p => p.trim())
                .filter(p => p.length > 0)

            const response = await fetch(`${apiUrl}/api/sites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: url.startsWith('http') ? url : `https://${url}`,
                    account_id: accountId || null,
                    page_limit: pageLimit,
                    exclude_paths: excludeArray,
                    run_classifier: runClassifier
                })
            })
            if (!response.ok) {
                const data = await response.json()
                throw new Error(data.error || 'Failed to create site')
            }
            return response.json()
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['sites'] })
            queryClient.invalidateQueries({ queryKey: ['page-index'] })
            toast.success(
                data.updated
                    ? `Site ${data.domain} queued for re-crawl`
                    : `Site ${data.domain} created and crawling started`
            )
            onOpenChange(false)
            setUrl('')
            setAccountId('')
            setPageLimit(200)
            setExcludePaths('')
            setRunClassifier(true)
            setError('')
            onSuccess?.(data.id)
        },
        onError: (err: Error) => {
            setError(err.message)
        }
    })

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        setError('')

        // Validate URL
        try {
            new URL(url.startsWith('http') ? url : `https://${url}`)
        } catch {
            setError('Please enter a valid URL')
            return
        }

        createSite.mutate()
    }

    const normalizedUrl = url.startsWith('http') ? url : url ? `https://${url}` : ''

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Globe className="h-5 w-5" />
                        Add Website for Crawling
                    </DialogTitle>
                    <DialogDescription>
                        Enter a website URL to crawl and index all pages.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="url">Website URL</Label>
                        <Input
                            id="url"
                            type="text"
                            placeholder="https://example.com"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            autoFocus
                        />
                        {url && !url.startsWith('http') && (
                            <p className="text-xs text-muted-foreground">
                                Will be crawled as: {normalizedUrl}
                            </p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="account">Link to Account (Optional)</Label>
                        <Select value={accountId || 'none'} onValueChange={(val) => setAccountId(val === 'none' ? '' : val)}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select an account..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">No account</SelectItem>
                                {accounts?.map(account => (
                                    <SelectItem key={account.id} value={account.id}>
                                        {account.account_name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="pageLimit">Page Limit</Label>
                        <Input
                            id="pageLimit"
                            type="number"
                            min={1}
                            max={1000}
                            value={pageLimit}
                            onChange={(e) => setPageLimit(parseInt(e.target.value, 10) || 200)}
                        />
                        <p className="text-xs text-muted-foreground">
                            Maximum number of pages to crawl (default: 200)
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="excludePaths">Exclude Paths (Optional)</Label>
                        <Textarea
                            id="excludePaths"
                            placeholder="/blog/page/*&#10;/tag/*&#10;/author/*"
                            value={excludePaths}
                            onChange={(e) => setExcludePaths(e.target.value)}
                            rows={3}
                        />
                        <p className="text-xs text-muted-foreground">
                            URL paths to skip (one per line, * for wildcards)
                        </p>
                    </div>

                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id="runClassifier"
                            checked={runClassifier}
                            onCheckedChange={(checked) => setRunClassifier(checked === true)}
                        />
                        <Label htmlFor="runClassifier" className="text-sm font-normal cursor-pointer">
                            Also run Classifier?
                        </Label>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-md">
                            <AlertCircle className="h-4 w-4" />
                            {error}
                        </div>
                    )}

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={!url || createSite.isPending}
                        >
                            {createSite.isPending && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Start Crawl
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
