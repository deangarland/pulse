import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion"
import { Loader2, Users, Shield, Building2, Plus, Key, Check, X, Minus, Trash2 } from "lucide-react"
import { toast } from "sonner"

interface User {
    id: string
    email: string
    created_at: string
    role_name: string | null
    role_id: string | null
    account_count: number
}

interface Role {
    id: string
    name: string
    description: string
    permission_count: number
}

interface Account {
    id: string
    account_name: string
}

interface UserAccount {
    account_id: string
    account_name: string
}

interface Permission {
    id: string
    name: string
    description: string
}

interface PermissionOverride {
    permission_id: string
    granted: boolean
    permissions: Permission
}

// Group permissions by section - granular page-level
const PERMISSION_SECTIONS: Record<string, string[]> = {
    'Dashboard': ['dashboard.read'],
    'SEO - Page Index': ['seo.pageindex.read', 'seo.pageindex.write'],
    'SEO - Meta & Schema': ['seo.metaschema.read', 'seo.metaschema.write'],
    'SEO - Link Plan': ['seo.linkplan.read', 'seo.linkplan.write'],
    'SEO - Content Hub': ['seo.content.read', 'seo.content.write'],
    'SEO - Blog Posts': ['seo.blog.read', 'seo.blog.write'],
    'SEO - GMB Posts': ['seo.gmb.read', 'seo.gmb.write'],
    'Ads - Meta': ['ads.meta.read', 'ads.meta.write'],
    'Ads - Google': ['ads.google.read', 'ads.google.write'],
    'Performance': ['performance.read'],
    'Admin - Users': ['users.read', 'users.write'],
    'Admin - Roles': ['roles.read', 'roles.write'],
    'Admin - Prompts': ['prompts.read', 'prompts.write'],
    'Admin - Taxonomy': ['admin.taxonomy.read', 'admin.taxonomy.write'],
    'Admin - Accounts': ['accounts.read', 'accounts.write'],
    'Admin - Sites': ['sites.read', 'sites.write']
}

export default function UsersAdmin() {
    const queryClient = useQueryClient()
    const [selectedUser, setSelectedUser] = useState<User | null>(null)
    const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false)
    const [isAccountsDialogOpen, setIsAccountsDialogOpen] = useState(false)
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
    const [isPermissionsDialogOpen, setIsPermissionsDialogOpen] = useState(false)

    // Create user form state (no password - invite flow)
    const [createForm, setCreateForm] = useState({
        email: '',
        role_id: '',
        account_ids: [] as string[]
    })

    // Permission overrides state
    const [permissionOverrides, setPermissionOverrides] = useState<Record<string, 'inherit' | 'grant' | 'revoke'>>({})

    const apiUrl = import.meta.env.VITE_API_URL || ''

    // Fetch users with their roles
    const { data: users, isLoading: usersLoading } = useQuery({
        queryKey: ['admin-users'],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('query_sql', {
                sql: `SELECT u.id, u.email, u.created_at, r.name as role_name, r.id as role_id,
                      (SELECT COUNT(*) FROM user_accounts ua WHERE ua.user_id = u.id) as account_count
                      FROM auth.users u
                      LEFT JOIN user_roles ur ON u.id = ur.user_id
                      LEFT JOIN roles r ON ur.role_id = r.id
                      ORDER BY u.email`
            })
            if (error) throw error
            return data as User[]
        }
    })

    // Fetch roles for the dropdown
    const { data: roles } = useQuery({
        queryKey: ['admin-roles'],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('query_sql', {
                sql: `SELECT r.id, r.name, r.description, 
                      (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) as permission_count
                      FROM roles r ORDER BY r.name`
            })
            if (error) throw error
            return data as Role[]
        }
    })

    // Fetch all accounts
    const { data: allAccounts } = useQuery({
        queryKey: ['all-accounts'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('accounts')
                .select('id, account_name')
                .order('account_name')
            if (error) throw error
            return data as Account[]
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

    // Fetch user's assigned accounts
    const { data: userAccounts, refetch: refetchUserAccounts } = useQuery({
        queryKey: ['user-accounts', selectedUser?.id],
        queryFn: async () => {
            if (!selectedUser) return []
            const { data, error } = await supabase.rpc('query_sql', {
                sql: `SELECT ua.account_id, a.account_name
                      FROM user_accounts ua
                      JOIN accounts a ON ua.account_id = a.id
                      WHERE ua.user_id = '${selectedUser.id}'
                      ORDER BY a.account_name`
            })
            if (error) throw error
            return data as UserAccount[]
        },
        enabled: !!selectedUser
    })

    // Fetch user's permission overrides
    const { data: userPermissionOverrides, refetch: refetchUserPermissions } = useQuery({
        queryKey: ['user-permissions', selectedUser?.id],
        queryFn: async () => {
            if (!selectedUser) return []
            const response = await fetch(`${apiUrl}/api/admin/users/${selectedUser.id}/permissions`)
            if (!response.ok) throw new Error('Failed to fetch user permissions')
            return response.json() as Promise<PermissionOverride[]>
        },
        enabled: !!selectedUser && isPermissionsDialogOpen
    })

    // Create user mutation
    const createUserMutation = useMutation({
        mutationFn: async (data: typeof createForm) => {
            const response = await fetch(`${apiUrl}/api/admin/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            })
            if (!response.ok) {
                const err = await response.json()
                throw new Error(err.error || 'Failed to create user')
            }
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-users'] })
            toast.success('Invite sent! User will receive an email to set their password.')
            setIsCreateDialogOpen(false)
            setCreateForm({ email: '', role_id: '', account_ids: [] })
        },
        onError: (error) => {
            toast.error(`Failed to invite user: ${error.message}`)
        }
    })

    // Assign role mutation
    const assignRoleMutation = useMutation({
        mutationFn: async ({ userId, roleId }: { userId: string, roleId: string }) => {
            const { error } = await supabase.rpc('exec_sql', {
                sql: `INSERT INTO user_roles (user_id, role_id) 
                      VALUES ('${userId}'::UUID, '${roleId}'::UUID)
                      ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id, updated_at = NOW()`
            })
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-users'] })
            toast.success('Role assigned successfully')
            setIsRoleDialogOpen(false)
        },
        onError: (error) => {
            toast.error(`Failed to assign role: ${error.message}`)
        }
    })

    // Add account assignment mutation
    const addAccountMutation = useMutation({
        mutationFn: async ({ userId, accountId }: { userId: string, accountId: string }) => {
            const { error } = await supabase.rpc('exec_sql', {
                sql: `INSERT INTO user_accounts (user_id, account_id) 
                      VALUES ('${userId}'::UUID, '${accountId}'::UUID)
                      ON CONFLICT (user_id, account_id) DO NOTHING`
            })
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-users'] })
            refetchUserAccounts()
            toast.success('Account assigned')
        },
        onError: (error) => {
            toast.error(`Failed to assign account: ${error.message}`)
        }
    })

    // Remove account assignment mutation
    const removeAccountMutation = useMutation({
        mutationFn: async ({ userId, accountId }: { userId: string, accountId: string }) => {
            const { error } = await supabase.rpc('exec_sql', {
                sql: `DELETE FROM user_accounts 
                      WHERE user_id = '${userId}'::UUID AND account_id = '${accountId}'::UUID`
            })
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-users'] })
            refetchUserAccounts()
            toast.success('Account removed')
        },
        onError: (error) => {
            toast.error(`Failed to remove account: ${error.message}`)
        }
    })

    // Delete user mutation
    const deleteUserMutation = useMutation({
        mutationFn: async (userId: string) => {
            const response = await fetch(`${apiUrl}/api/admin/users/${userId}`, {
                method: 'DELETE'
            })
            if (!response.ok) {
                const err = await response.json()
                throw new Error(err.error || 'Failed to delete user')
            }
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-users'] })
            toast.success('User deleted successfully')
        },
        onError: (error) => {
            toast.error(`Failed to delete user: ${error.message}`)
        }
    })

    // Update user permissions mutation
    const updatePermissionsMutation = useMutation({
        mutationFn: async ({ userId, overrides }: { userId: string, overrides: { permission_id: string, granted: boolean }[] }) => {
            const response = await fetch(`${apiUrl}/api/admin/users/${userId}/permissions`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ overrides })
            })
            if (!response.ok) {
                const err = await response.json()
                throw new Error(err.error || 'Failed to update permissions')
            }
            return response.json()
        },
        onSuccess: () => {
            refetchUserPermissions()
            toast.success('Permissions updated')
        },
        onError: (error) => {
            toast.error(`Failed to update permissions: ${error.message}`)
        }
    })

    const handleSavePermissions = () => {
        if (!selectedUser) return

        const overrides: { permission_id: string, granted: boolean }[] = []

        Object.entries(permissionOverrides).forEach(([permName, state]) => {
            if (state !== 'inherit') {
                const perm = allPermissions?.find(p => p.name === permName)
                if (perm) {
                    overrides.push({
                        permission_id: perm.id,
                        granted: state === 'grant'
                    })
                }
            }
        })

        updatePermissionsMutation.mutate({ userId: selectedUser.id, overrides })
    }

    const openPermissionsDialog = (user: User) => {
        setSelectedUser(user)
        setPermissionOverrides({})
        setIsPermissionsDialogOpen(true)
    }

    // When permission overrides load, update state
    const initializeOverrides = () => {
        if (userPermissionOverrides) {
            const overrides: Record<string, 'inherit' | 'grant' | 'revoke'> = {}
            userPermissionOverrides.forEach(o => {
                overrides[o.permissions.name] = o.granted ? 'grant' : 'revoke'
            })
            setPermissionOverrides(overrides)
        }
    }

    const getRoleBadgeColor = (roleName: string | null) => {
        switch (roleName) {
            case 'super_admin': return 'bg-red-100 text-red-800 border-red-200'
            case 'admin': return 'bg-purple-100 text-purple-800 border-purple-200'
            case 'manager': return 'bg-blue-100 text-blue-800 border-blue-200'
            case 'viewer': return 'bg-gray-100 text-gray-800 border-gray-200'
            default: return 'bg-yellow-100 text-yellow-800 border-yellow-200'
        }
    }

    const getPermissionState = (permName: string): 'inherit' | 'grant' | 'revoke' => {
        return permissionOverrides[permName] || 'inherit'
    }

    const cyclePermissionState = (permName: string) => {
        const current = getPermissionState(permName)
        const next = current === 'inherit' ? 'grant' : current === 'grant' ? 'revoke' : 'inherit'
        setPermissionOverrides(prev => ({ ...prev, [permName]: next }))
    }

    const getPermissionIcon = (state: 'inherit' | 'grant' | 'revoke') => {
        switch (state) {
            case 'grant': return <Check className="h-4 w-4 text-green-600" />
            case 'revoke': return <X className="h-4 w-4 text-red-600" />
            default: return <Minus className="h-4 w-4 text-gray-400" />
        }
    }

    if (usersLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
                    <p className="text-muted-foreground">
                        Manage users, assign roles, and control account access
                    </p>
                </div>
                <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="h-4 w-4 mr-2" />
                            Add User
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-lg">
                        <DialogHeader>
                            <DialogTitle>Create New User</DialogTitle>
                        </DialogHeader>
                        <form onSubmit={(e) => { e.preventDefault(); createUserMutation.mutate(createForm) }} className="space-y-4">
                            <div>
                                <Label>Email *</Label>
                                <Input
                                    type="email"
                                    value={createForm.email}
                                    onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
                                    placeholder="user@example.com"
                                    required
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                    User will receive an email invite to set their own password.
                                </p>
                            </div>
                            <div>
                                <Label>Role</Label>
                                <Select value={createForm.role_id} onValueChange={v => setCreateForm(f => ({ ...f, role_id: v }))}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a role" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {roles?.map(role => (
                                            <SelectItem key={role.id} value={role.id}>
                                                {role.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            {/* Hide account selection for super_admin and admin - they get all accounts */}
                            {roles?.find(r => r.id === createForm.role_id)?.name === 'super_admin' ||
                                roles?.find(r => r.id === createForm.role_id)?.name === 'admin' ? (
                                <div className="p-3 bg-muted rounded-md">
                                    <p className="text-sm text-muted-foreground">
                                        <strong>{roles?.find(r => r.id === createForm.role_id)?.name}</strong> users automatically have access to all accounts, including any new accounts added in the future.
                                    </p>
                                </div>
                            ) : (
                                <div>
                                    <Label>Account Access</Label>
                                    <div className="border rounded-md p-3 max-h-40 overflow-y-auto space-y-2">
                                        <div className="flex items-center space-x-2 pb-2 border-b mb-2">
                                            <Checkbox
                                                id="all-accounts"
                                                checked={allAccounts && createForm.account_ids.length === allAccounts.length}
                                                onCheckedChange={(checked: boolean) => {
                                                    if (checked && allAccounts) {
                                                        setCreateForm(f => ({ ...f, account_ids: allAccounts.map(a => a.id) }))
                                                    } else {
                                                        setCreateForm(f => ({ ...f, account_ids: [] }))
                                                    }
                                                }}
                                            />
                                            <label htmlFor="all-accounts" className="text-sm font-medium cursor-pointer">
                                                All Accounts ({allAccounts?.length || 0})
                                            </label>
                                        </div>
                                        {allAccounts?.map(account => (
                                            <div key={account.id} className="flex items-center space-x-2">
                                                <Checkbox
                                                    id={`account-${account.id}`}
                                                    checked={createForm.account_ids.includes(account.id)}
                                                    onCheckedChange={(checked: boolean) => {
                                                        if (checked) {
                                                            setCreateForm(f => ({ ...f, account_ids: [...f.account_ids, account.id] }))
                                                        } else {
                                                            setCreateForm(f => ({ ...f, account_ids: f.account_ids.filter(id => id !== account.id) }))
                                                        }
                                                    }}
                                                />
                                                <label htmlFor={`account-${account.id}`} className="text-sm cursor-pointer">
                                                    {account.account_name}
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={createUserMutation.isPending}>
                                    {createUserMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                    Create User
                                </Button>
                            </div>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-100 rounded-lg">
                                <Users className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{users?.length || 0}</p>
                                <p className="text-sm text-muted-foreground">Total Users</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-purple-100 rounded-lg">
                                <Shield className="h-5 w-5 text-purple-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{roles?.length || 0}</p>
                                <p className="text-sm text-muted-foreground">Roles</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-green-100 rounded-lg">
                                <Building2 className="h-5 w-5 text-green-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{allAccounts?.length || 0}</p>
                                <p className="text-sm text-muted-foreground">Accounts</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Users Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5" />
                        Users
                    </CardTitle>
                    <CardDescription>
                        All users in the system with their assigned roles and account access
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Email</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Accounts</TableHead>
                                <TableHead>Created</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {users?.map((user) => (
                                <TableRow key={user.id}>
                                    <TableCell className="font-medium">{user.email}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className={getRoleBadgeColor(user.role_name)}>
                                            {user.role_name || 'No Role'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="secondary">
                                            {user.account_count} account{user.account_count !== 1 ? 's' : ''}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {new Date(user.created_at).toLocaleDateString()}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Dialog open={isRoleDialogOpen && selectedUser?.id === user.id} onOpenChange={(open) => {
                                                setIsRoleDialogOpen(open)
                                                if (open) setSelectedUser(user)
                                            }}>
                                                <DialogTrigger asChild>
                                                    <Button variant="outline" size="sm">
                                                        <Shield className="h-4 w-4 mr-1" />
                                                        Role
                                                    </Button>
                                                </DialogTrigger>
                                                <DialogContent>
                                                    <DialogHeader>
                                                        <DialogTitle>Assign Role to {user.email}</DialogTitle>
                                                    </DialogHeader>
                                                    <div className="py-4">
                                                        <Select
                                                            defaultValue={user.role_id || undefined}
                                                            onValueChange={(roleId) => {
                                                                assignRoleMutation.mutate({ userId: user.id, roleId })
                                                            }}
                                                        >
                                                            <SelectTrigger>
                                                                <SelectValue placeholder="Select a role" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {roles?.map((role) => (
                                                                    <SelectItem key={role.id} value={role.id}>
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="font-medium">{role.name}</span>
                                                                            <span className="text-xs text-muted-foreground">
                                                                                ({role.permission_count} permissions)
                                                                            </span>
                                                                        </div>
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        {roles?.find(r => r.id === user.role_id)?.description && (
                                                            <p className="text-sm text-muted-foreground mt-2">
                                                                {roles.find(r => r.id === user.role_id)?.description}
                                                            </p>
                                                        )}
                                                    </div>
                                                </DialogContent>
                                            </Dialog>

                                            <Dialog open={isAccountsDialogOpen && selectedUser?.id === user.id} onOpenChange={(open) => {
                                                setIsAccountsDialogOpen(open)
                                                if (open) setSelectedUser(user)
                                            }}>
                                                <DialogTrigger asChild>
                                                    <Button variant="outline" size="sm">
                                                        <Building2 className="h-4 w-4 mr-1" />
                                                        Accounts
                                                    </Button>
                                                </DialogTrigger>
                                                <DialogContent className="max-w-lg">
                                                    <DialogHeader>
                                                        <DialogTitle>Manage Account Access for {user.email}</DialogTitle>
                                                    </DialogHeader>
                                                    <div className="py-4 space-y-4">
                                                        {/* Add account */}
                                                        <div>
                                                            <h4 className="text-sm font-medium mb-2">Add Account Access</h4>
                                                            <Select
                                                                onValueChange={(accountId) => {
                                                                    addAccountMutation.mutate({ userId: user.id, accountId })
                                                                }}
                                                            >
                                                                <SelectTrigger>
                                                                    <SelectValue placeholder="Select an account to add" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {allAccounts
                                                                        ?.filter(a => !userAccounts?.some(ua => ua.account_id === a.id))
                                                                        .map((account) => (
                                                                            <SelectItem key={account.id} value={account.id}>
                                                                                {account.account_name}
                                                                            </SelectItem>
                                                                        ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>

                                                        {/* Current accounts */}
                                                        <div>
                                                            <h4 className="text-sm font-medium mb-2">Current Account Access</h4>
                                                            {userAccounts?.length === 0 ? (
                                                                <p className="text-sm text-muted-foreground">No accounts assigned</p>
                                                            ) : (
                                                                <div className="space-y-2">
                                                                    {userAccounts?.map((ua) => (
                                                                        <div key={ua.account_id} className="flex items-center justify-between p-2 bg-muted rounded">
                                                                            <span className="text-sm">{ua.account_name}</span>
                                                                            <Button
                                                                                variant="ghost"
                                                                                size="sm"
                                                                                className="text-destructive hover:text-destructive"
                                                                                onClick={() => removeAccountMutation.mutate({
                                                                                    userId: user.id,
                                                                                    accountId: ua.account_id
                                                                                })}
                                                                            >
                                                                                Remove
                                                                            </Button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </DialogContent>
                                            </Dialog>

                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => openPermissionsDialog(user)}
                                            >
                                                <Key className="h-4 w-4 mr-1" />
                                                Permissions
                                            </Button>

                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                onClick={() => {
                                                    if (confirm(`Are you sure you want to delete ${user.email}? This action cannot be undone.`)) {
                                                        deleteUserMutation.mutate(user.id)
                                                    }
                                                }}
                                                disabled={deleteUserMutation.isPending}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Permissions Override Dialog */}
            <Dialog open={isPermissionsDialogOpen} onOpenChange={(open) => {
                setIsPermissionsDialogOpen(open)
                if (open && userPermissionOverrides) initializeOverrides()
            }}>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Permission Overrides for {selectedUser?.email}</DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        <p className="text-sm text-muted-foreground mb-4">
                            Click on a permission to toggle between: <span className="text-gray-500">Inherit</span> → <span className="text-green-600">Grant</span> → <span className="text-red-600">Revoke</span>
                        </p>
                        <Accordion type="multiple" defaultValue={Object.keys(PERMISSION_SECTIONS)}>
                            {Object.entries(PERMISSION_SECTIONS).map(([section, perms]) => (
                                <AccordionItem key={section} value={section}>
                                    <AccordionTrigger className="text-sm font-medium">
                                        {section}
                                    </AccordionTrigger>
                                    <AccordionContent>
                                        <div className="space-y-2">
                                            {perms.map(permName => {
                                                const perm = allPermissions?.find(p => p.name === permName)
                                                if (!perm) return null
                                                const state = getPermissionState(permName)
                                                return (
                                                    <button
                                                        key={permName}
                                                        type="button"
                                                        className="w-full flex items-center justify-between p-2 rounded hover:bg-muted transition-colors text-left"
                                                        onClick={() => cyclePermissionState(permName)}
                                                    >
                                                        <div>
                                                            <span className="text-sm font-medium">{permName}</span>
                                                            <p className="text-xs text-muted-foreground">{perm.description}</p>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            {getPermissionIcon(state)}
                                                            <span className={`text-xs ${state === 'grant' ? 'text-green-600' :
                                                                state === 'revoke' ? 'text-red-600' : 'text-gray-400'
                                                                }`}>
                                                                {state.charAt(0).toUpperCase() + state.slice(1)}
                                                            </span>
                                                        </div>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            ))}
                        </Accordion>
                    </div>
                    <div className="flex justify-end gap-2 pt-4 border-t">
                        <Button variant="outline" onClick={() => setIsPermissionsDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSavePermissions} disabled={updatePermissionsMutation.isPending}>
                            {updatePermissionsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Save Permissions
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Roles Reference */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Shield className="h-5 w-5" />
                        Roles Reference
                    </CardTitle>
                    <CardDescription>
                        Available roles and their permission counts
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {roles?.map((role) => (
                            <div key={role.id} className="p-4 border rounded-lg">
                                <div className="flex items-center justify-between mb-2">
                                    <Badge variant="outline" className={getRoleBadgeColor(role.name)}>
                                        {role.name}
                                    </Badge>
                                    <span className="text-sm text-muted-foreground">
                                        {role.permission_count} perms
                                    </span>
                                </div>
                                <p className="text-sm text-muted-foreground">{role.description}</p>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
