import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import { Loader2, Users, Shield, Building2 } from "lucide-react"
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

export default function UsersAdmin() {
    const queryClient = useQueryClient()
    const [selectedUser, setSelectedUser] = useState<User | null>(null)
    const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false)
    const [isAccountsDialogOpen, setIsAccountsDialogOpen] = useState(false)

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

    const getRoleBadgeColor = (roleName: string | null) => {
        switch (roleName) {
            case 'super_admin': return 'bg-red-100 text-red-800 border-red-200'
            case 'admin': return 'bg-purple-100 text-purple-800 border-purple-200'
            case 'manager': return 'bg-blue-100 text-blue-800 border-blue-200'
            case 'viewer': return 'bg-gray-100 text-gray-800 border-gray-200'
            default: return 'bg-yellow-100 text-yellow-800 border-yellow-200'
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
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

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
