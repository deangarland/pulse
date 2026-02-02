import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion"
import { Loader2, Shield, Settings, Check } from "lucide-react"
import { toast } from "sonner"

interface Role {
    id: string
    name: string
    description: string
    permissions: Permission[]
}

interface Permission {
    id: string
    name: string
    description: string
}

// Group permissions by section
const PERMISSION_SECTIONS: Record<string, string[]> = {
    'Dashboard': ['dashboard.read'],
    'SEO Engine': ['pages.read', 'pages.write', 'links.read', 'links.write', 'meta.read', 'meta.write'],
    'Ads Engine': ['ads.read', 'ads.write'],
    'Performance': ['performance.read'],
    'Admin': ['users.read', 'users.write', 'roles.read', 'roles.write', 'prompts.read', 'prompts.write', 'accounts.read', 'accounts.write', 'sites.read', 'sites.write']
}

export default function RolesAdmin() {
    const queryClient = useQueryClient()
    const [selectedRole, setSelectedRole] = useState<Role | null>(null)
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
    const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set())

    const apiUrl = import.meta.env.VITE_API_URL || ''

    // Fetch roles with permissions
    const { data: roles, isLoading } = useQuery({
        queryKey: ['admin-roles-full'],
        queryFn: async () => {
            const response = await fetch(`${apiUrl}/api/admin/roles`)
            if (!response.ok) throw new Error('Failed to fetch roles')
            return response.json() as Promise<Role[]>
        }
    })

    // Fetch all permissions
    const { data: allPermissions } = useQuery({
        queryKey: ['all-permissions'],
        queryFn: async () => {
            const response = await fetch(`${apiUrl}/api/admin/permissions`)
            if (!response.ok) throw new Error('Failed to fetch permissions')
            return response.json() as Promise<Permission[]>
        }
    })

    // Update role permissions mutation
    const updateRoleMutation = useMutation({
        mutationFn: async ({ roleId, permissionIds }: { roleId: string, permissionIds: string[] }) => {
            const response = await fetch(`${apiUrl}/api/admin/roles/${roleId}/permissions`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ permission_ids: permissionIds })
            })
            if (!response.ok) {
                const err = await response.json()
                throw new Error(err.error || 'Failed to update role')
            }
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-roles-full'] })
            queryClient.invalidateQueries({ queryKey: ['admin-roles'] })
            toast.success('Role permissions updated')
            setIsEditDialogOpen(false)
        },
        onError: (error) => {
            toast.error(`Failed to update role: ${error.message}`)
        }
    })

    // Initialize selected permissions when role is selected
    useEffect(() => {
        if (selectedRole) {
            setSelectedPermissions(new Set(selectedRole.permissions.map(p => p.id)))
        }
    }, [selectedRole])

    const openEditDialog = (role: Role) => {
        setSelectedRole(role)
        setIsEditDialogOpen(true)
    }

    const handleSave = () => {
        if (!selectedRole) return
        updateRoleMutation.mutate({
            roleId: selectedRole.id,
            permissionIds: Array.from(selectedPermissions)
        })
    }

    const togglePermission = (permId: string) => {
        setSelectedPermissions(prev => {
            const next = new Set(prev)
            if (next.has(permId)) {
                next.delete(permId)
            } else {
                next.add(permId)
            }
            return next
        })
    }

    const toggleSection = (sectionPerms: string[]) => {
        const sectionPermIds = sectionPerms
            .map(name => allPermissions?.find(p => p.name === name)?.id)
            .filter((id): id is string => !!id)

        const allSelected = sectionPermIds.every(id => selectedPermissions.has(id))

        setSelectedPermissions(prev => {
            const next = new Set(prev)
            if (allSelected) {
                sectionPermIds.forEach(id => next.delete(id))
            } else {
                sectionPermIds.forEach(id => next.add(id))
            }
            return next
        })
    }

    const getRoleBadgeColor = (roleName: string) => {
        switch (roleName) {
            case 'super_admin': return 'bg-red-100 text-red-800 border-red-200'
            case 'admin': return 'bg-purple-100 text-purple-800 border-purple-200'
            case 'manager': return 'bg-blue-100 text-blue-800 border-blue-200'
            case 'viewer': return 'bg-gray-100 text-gray-800 border-gray-200'
            default: return 'bg-yellow-100 text-yellow-800 border-yellow-200'
        }
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Role Management</h1>
                <p className="text-muted-foreground">
                    Define what permissions each role grants to users
                </p>
            </div>

            {/* Roles Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {roles?.map((role) => (
                    <Card key={role.id} className="relative">
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-muted rounded-lg">
                                        <Shield className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <CardTitle className="flex items-center gap-2">
                                            <Badge variant="outline" className={getRoleBadgeColor(role.name)}>
                                                {role.name}
                                            </Badge>
                                        </CardTitle>
                                        <CardDescription className="mt-1">
                                            {role.description}
                                        </CardDescription>
                                    </div>
                                </div>
                                <Button variant="outline" size="sm" onClick={() => openEditDialog(role)}>
                                    <Settings className="h-4 w-4 mr-1" />
                                    Edit
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3">
                                <p className="text-sm font-medium">
                                    {role.permissions.length} permissions assigned
                                </p>
                                <div className="flex flex-wrap gap-1">
                                    {role.permissions.slice(0, 8).map(perm => (
                                        <Badge key={perm.id} variant="secondary" className="text-xs">
                                            {perm.name}
                                        </Badge>
                                    ))}
                                    {role.permissions.length > 8 && (
                                        <Badge variant="secondary" className="text-xs">
                                            +{role.permissions.length - 8} more
                                        </Badge>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Edit Role Dialog */}
            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            Edit Permissions for
                            <Badge variant="outline" className={selectedRole ? getRoleBadgeColor(selectedRole.name) : ''}>
                                {selectedRole?.name}
                            </Badge>
                        </DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        <Accordion type="multiple" defaultValue={Object.keys(PERMISSION_SECTIONS)}>
                            {Object.entries(PERMISSION_SECTIONS).map(([section, permNames]) => {
                                const sectionPermIds = permNames
                                    .map(name => allPermissions?.find(p => p.name === name)?.id)
                                    .filter((id): id is string => !!id)
                                const selectedCount = sectionPermIds.filter(id => selectedPermissions.has(id)).length
                                const allSelected = selectedCount === sectionPermIds.length

                                return (
                                    <AccordionItem key={section} value={section}>
                                        <AccordionTrigger className="text-sm font-medium">
                                            <div className="flex items-center gap-2">
                                                <span>{section}</span>
                                                <Badge variant={allSelected ? "default" : "secondary"} className="text-xs">
                                                    {selectedCount}/{sectionPermIds.length}
                                                </Badge>
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent>
                                            <div className="space-y-2">
                                                <button
                                                    type="button"
                                                    className="text-xs text-primary hover:underline mb-2"
                                                    onClick={() => toggleSection(permNames)}
                                                >
                                                    {allSelected ? 'Deselect all' : 'Select all'}
                                                </button>
                                                {permNames.map(permName => {
                                                    const perm = allPermissions?.find(p => p.name === permName)
                                                    if (!perm) return null
                                                    const isSelected = selectedPermissions.has(perm.id)
                                                    return (
                                                        <div
                                                            key={permName}
                                                            className="flex items-center space-x-3 p-2 rounded hover:bg-muted cursor-pointer"
                                                            onClick={() => togglePermission(perm.id)}
                                                        >
                                                            <Checkbox checked={isSelected} />
                                                            <div className="flex-1">
                                                                <span className="text-sm font-medium">{permName}</span>
                                                                <p className="text-xs text-muted-foreground">{perm.description}</p>
                                                            </div>
                                                            {isSelected && <Check className="h-4 w-4 text-green-600" />}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>
                                )
                            })}
                        </Accordion>
                    </div>
                    <div className="flex justify-end gap-2 pt-4 border-t">
                        <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={updateRoleMutation.isPending}>
                            {updateRoleMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Save Permissions
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
