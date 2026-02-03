import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { LocationsTable } from "@/components/LocationsTable"
import { toast } from "sonner"
import {
    Building2,
    MapPin,
    Save,
    Loader2,
    Phone,
    Mail,
    Globe,
    Image
} from "lucide-react"
import { useSearchParams } from 'react-router-dom'

interface AccountSettings {
    id: string
    account_name: string
    provider_name?: string
    legal_name?: string
    default_phone?: string
    default_email?: string
    business_type?: string
    logo_url?: string
    website_url?: string
}

export default function Accounts() {
    const [searchParams] = useSearchParams()
    const accountId = searchParams.get('cid')
    const queryClient = useQueryClient()

    // Fetch account details
    const { data: account } = useQuery({
        queryKey: ['account', accountId],
        queryFn: async () => {
            if (!accountId) return null
            const { data, error } = await supabase
                .from('accounts')
                .select('*')
                .eq('hs_account_id', accountId)
                .single()
            if (error) throw error
            return data as AccountSettings
        },
        enabled: !!accountId
    })

    // Local form state
    const [formData, setFormData] = useState<Partial<AccountSettings>>({})

    // Update when account loads
    useState(() => {
        if (account) {
            setFormData(account)
        }
    })

    // Save mutation
    const saveMutation = useMutation({
        mutationFn: async (data: Partial<AccountSettings>) => {
            if (!account?.id) throw new Error('No account selected')
            const { error } = await supabase
                .from('accounts')
                .update(data)
                .eq('id', account.id)
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['account', accountId] })
            toast.success('Account settings saved')
        },
        onError: (error: Error) => {
            toast.error('Failed to save', { description: error.message })
        }
    })

    const handleInputChange = (field: string, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }))
    }

    const handleSave = () => {
        saveMutation.mutate(formData)
    }

    if (!accountId) {
        return (
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Account Settings</h1>
                    <p className="text-muted-foreground">
                        Select a client from the dropdown to manage their settings
                    </p>
                </div>
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>No client selected</p>
                        <p className="text-sm">Use the client dropdown in the header to select a client</p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Account Settings</h1>
                    <p className="text-muted-foreground">
                        Manage client configuration and locations for {account?.account_name || 'loading...'}
                    </p>
                </div>
                <Button
                    onClick={handleSave}
                    disabled={saveMutation.isPending}
                >
                    {saveMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                        <Save className="h-4 w-4 mr-2" />
                    )}
                    Save Changes
                </Button>
            </div>

            <Tabs defaultValue="config" className="w-full">
                <TabsList>
                    <TabsTrigger value="config">
                        <Building2 className="h-4 w-4 mr-2" />
                        Client Config
                    </TabsTrigger>
                    <TabsTrigger value="locations">
                        <MapPin className="h-4 w-4 mr-2" />
                        Locations
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="config" className="mt-4">
                    <div className="grid gap-6 md:grid-cols-2">
                        {/* Business Identity */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Business Identity</CardTitle>
                                <CardDescription>Core business information for schema generation</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="provider_name">Provider Name</Label>
                                    <Input
                                        id="provider_name"
                                        placeholder="e.g., Laser Skin Solutions"
                                        value={formData.provider_name || account?.provider_name || ''}
                                        onChange={(e) => handleInputChange('provider_name', e.target.value)}
                                    />
                                    <p className="text-xs text-muted-foreground">Used in schema.org as the main business name</p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="legal_name">Legal Name</Label>
                                    <Input
                                        id="legal_name"
                                        placeholder="e.g., Laser Skin Solutions LLC"
                                        value={formData.legal_name || account?.legal_name || ''}
                                        onChange={(e) => handleInputChange('legal_name', e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="business_type">Business Type</Label>
                                    <Input
                                        id="business_type"
                                        placeholder="e.g., MedicalBusiness, LocalBusiness"
                                        value={formData.business_type || account?.business_type || ''}
                                        onChange={(e) => handleInputChange('business_type', e.target.value)}
                                    />
                                    <p className="text-xs text-muted-foreground">Schema.org LocalBusiness subtype</p>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Contact Defaults */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Contact Defaults</CardTitle>
                                <CardDescription>Default contact info for schemas</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="default_phone">
                                        <Phone className="h-3 w-3 inline mr-1" />
                                        Default Phone
                                    </Label>
                                    <Input
                                        id="default_phone"
                                        placeholder="e.g., (555) 123-4567"
                                        value={formData.default_phone || account?.default_phone || ''}
                                        onChange={(e) => handleInputChange('default_phone', e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="default_email">
                                        <Mail className="h-3 w-3 inline mr-1" />
                                        Default Email
                                    </Label>
                                    <Input
                                        id="default_email"
                                        type="email"
                                        placeholder="e.g., contact@example.com"
                                        value={formData.default_email || account?.default_email || ''}
                                        onChange={(e) => handleInputChange('default_email', e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="website_url">
                                        <Globe className="h-3 w-3 inline mr-1" />
                                        Website URL
                                    </Label>
                                    <Input
                                        id="website_url"
                                        type="url"
                                        placeholder="e.g., https://example.com"
                                        value={formData.website_url || account?.website_url || ''}
                                        onChange={(e) => handleInputChange('website_url', e.target.value)}
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        {/* Branding */}
                        <Card className="md:col-span-2">
                            <CardHeader>
                                <CardTitle className="text-base">Branding</CardTitle>
                                <CardDescription>Logo and images for schema output</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="logo_url">
                                        <Image className="h-3 w-3 inline mr-1" />
                                        Logo URL
                                    </Label>
                                    <Input
                                        id="logo_url"
                                        type="url"
                                        placeholder="e.g., https://example.com/logo.png"
                                        value={formData.logo_url || account?.logo_url || ''}
                                        onChange={(e) => handleInputChange('logo_url', e.target.value)}
                                    />
                                    <p className="text-xs text-muted-foreground">Used in Organization and LocalBusiness schemas</p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="locations" className="mt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Locations</CardTitle>
                            <CardDescription>Manage business locations for this client</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <LocationsTable />
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
