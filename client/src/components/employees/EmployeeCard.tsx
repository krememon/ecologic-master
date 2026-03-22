import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Mail, Phone, MapPin, MoreVertical, Edit, UserX, UserCheck, Trash2, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCan } from "@/hooks/useCan";
import { formatPhone } from "@shared/phoneUtils";

function EmployeeAvatar({ firstName, lastName, profileImageUrl, role }: {
  firstName: string | null;
  lastName: string | null;
  profileImageUrl?: string | null;
  role: string;
}) {
  const [imgError, setImgError] = useState(false);

  const initials = [firstName?.[0], lastName?.[0]].filter(Boolean).join("").toUpperCase() || "?";

  const roleColors: Record<string, string> = {
    OWNER:      "bg-slate-700 text-white",
    SUPERVISOR: "bg-indigo-600 text-white",
    TECHNICIAN: "bg-green-600 text-white",
  };
  const fallbackClass = roleColors[role] ?? "bg-gray-500 text-white";

  if (profileImageUrl && !imgError) {
    return (
      <img
        src={profileImageUrl}
        alt={`${firstName} ${lastName}`}
        onError={() => setImgError(true)}
        className="w-12 h-12 rounded-full object-cover flex-shrink-0 ring-2 ring-white dark:ring-slate-800 shadow-sm"
      />
    );
  }

  return (
    <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-semibold ring-2 ring-white dark:ring-slate-800 shadow-sm ${fallbackClass}`}>
      {initials}
    </div>
  );
}

type UserRole = "OWNER" | "SUPERVISOR" | "TECHNICIAN";

interface EmployeeCardProps {
  employee: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
    role: UserRole;
    status: string;
    createdAt: string;
    isClockedIn?: boolean;
    profileImageUrl?: string | null;
  };
  onRoleChange: (userId: string, newRole: UserRole) => void;
  onStatusToggle: (userId: string, newStatus: 'active' | 'inactive') => void;
  onRemove: (userId: string) => void;
  isUpdating: boolean;
  isRemoving: boolean;
}

export default function EmployeeCard({ employee, onRoleChange, onStatusToggle, onRemove, isUpdating, isRemoving }: EmployeeCardProps) {
  const { can } = useCan();
  const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole>(employee.role);
  const [isStatusDialogOpen, setIsStatusDialogOpen] = useState(false);
  const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false);

  const fullName = `${employee.firstName} ${employee.lastName}`.trim();
  
  // Format address
  const formatAddress = () => {
    const parts = [
      employee.addressLine1,
      employee.addressLine2,
      employee.city,
      employee.state,
      employee.postalCode,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  };

  const address = formatAddress();

  // Role badge colors
  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'OWNER':
        return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200';
      case 'SUPERVISOR':
        return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200';
      case 'TECHNICIAN':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    }
  };

  const getRoleLabel = (role: string) => {
    return role.charAt(0) + role.slice(1).toLowerCase();
  };

  const handleRoleChangeSubmit = () => {
    onRoleChange(employee.id, selectedRole);
    setIsRoleDialogOpen(false);
  };

  const handleStatusToggle = () => {
    const newStatus = employee.status === 'ACTIVE' ? 'inactive' : 'active';
    onStatusToggle(employee.id, newStatus);
    setIsStatusDialogOpen(false);
  };

  const canModify = can('users.manage') && employee.role !== 'OWNER';

  return (
    <Card className="hover:shadow-md transition-shadow" data-testid={`card-employee-${employee.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          {/* Avatar + name/badges */}
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <EmployeeAvatar
              firstName={employee.firstName}
              lastName={employee.lastName}
              profileImageUrl={employee.profileImageUrl}
              role={employee.role}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                <Badge className={getRoleBadgeColor(employee.role)} data-testid={`badge-role-${employee.id}`}>
                  {getRoleLabel(employee.role)}
                </Badge>
                <Badge 
                  className={employee.isClockedIn
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                  }
                  data-testid={`badge-status-${employee.id}`}
                >
                  {employee.isClockedIn ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              <CardTitle className="text-base leading-snug truncate" data-testid={`text-employee-name-${employee.id}`}>
                {fullName}
              </CardTitle>
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {canModify && (
              <TooltipProvider>
                <Tooltip>
                  <AlertDialog open={isRemoveDialogOpen} onOpenChange={setIsRemoveDialogOpen}>
                    <TooltipTrigger asChild>
                      <AlertDialogTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-slate-600 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                          data-testid={`button-remove-${employee.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Remove from company</p>
                    </TooltipContent>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove from company?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will immediately revoke access to your company. The user's account remains but they'll need a new company invite code to continue.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                          onClick={() => {
                            onRemove(employee.id);
                            setIsRemoveDialogOpen(false);
                          }}
                          disabled={isRemoving}
                          className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                        >
                          {isRemoving ? 'Removing...' : 'Remove'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </Tooltip>
              </TooltipProvider>
            )}
            
            {can('users.view') && (
              <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" data-testid={`button-kebab-${employee.id}`}>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canModify && (
                  <>
                    <DropdownMenuItem
                      onSelect={() => {
                        setSelectedRole(employee.role);
                        setIsRoleDialogOpen(true);
                      }}
                      data-testid={`menu-change-role-${employee.id}`}
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Change Role
                    </DropdownMenuItem>
                  </>
                )}
                
                {canModify && (
                  <AlertDialog open={isStatusDialogOpen} onOpenChange={setIsStatusDialogOpen}>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem onSelect={(e) => e.preventDefault()} data-testid={`menu-toggle-status-${employee.id}`}>
                        {employee.status === 'ACTIVE' ? (
                          <>
                            <UserX className="h-4 w-4 mr-2" />
                            Deactivate
                          </>
                        ) : (
                          <>
                            <UserCheck className="h-4 w-4 mr-2" />
                            Activate
                          </>
                        )}
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {employee.status === 'ACTIVE' ? 'Deactivate' : 'Activate'} Employee
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to {employee.status === 'ACTIVE' ? 'deactivate' : 'activate'} {fullName}?
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleStatusToggle} disabled={isUpdating}>
                          {isUpdating ? 'Updating...' : 'Confirm'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-2">
        {employee.email && (
          <a 
            href={`mailto:${employee.email}`}
            className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer min-w-0"
            data-testid={`link-email-${employee.id}`}
          >
            <Mail className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">{employee.email}</span>
          </a>
        )}
        
        {employee.phone && (
          <a 
            href={`tel:${employee.phone}`}
            className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer min-w-0"
            data-testid={`link-phone-${employee.id}`}
          >
            <Phone className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">{formatPhone(employee.phone)}</span>
          </a>
        )}
        
        {address && (
          <button
            onClick={() => {
              const encodedAddress = encodeURIComponent(address);
              if (navigator.userAgent.includes('iPhone') || navigator.userAgent.includes('iPad')) {
                window.open(`maps://maps.apple.com/?q=${encodedAddress}`, '_self');
              } else if (navigator.userAgent.includes('Android')) {
                window.open(`geo:0,0?q=${encodedAddress}`, '_self');
              } else {
                window.open(`https://maps.google.com/?q=${encodedAddress}`, '_blank');
              }
            }}
            className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer text-left w-full min-w-0"
            data-testid={`link-address-${employee.id}`}
          >
            <MapPin className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">{address}</span>
          </button>
        )}
        
        {!employee.phone && !address && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span>—</span>
          </div>
        )}
        
        <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
          <p className="text-xs text-slate-500">
            Joined {new Date(employee.createdAt).toLocaleDateString()}
          </p>
        </div>
      </CardContent>

      <Dialog open={isRoleDialogOpen} onOpenChange={setIsRoleDialogOpen}>
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0 overflow-hidden rounded-2xl" hideCloseButton preventAutoFocus>
          <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="min-w-[44px]" />
            <div className="text-center">
              <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Change Role
              </DialogTitle>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Select a new role for {fullName}
              </p>
            </div>
            <button
              onClick={() => setIsRoleDialogOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="px-4 py-5 bg-white dark:bg-slate-900">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">Role</label>
            <Select value={selectedRole} onValueChange={(value) => setSelectedRole(value as UserRole)}>
              <SelectTrigger className="w-full h-11 bg-slate-100 dark:bg-slate-800 border-0 rounded-xl text-sm focus:ring-2 focus:ring-blue-600 focus:ring-offset-0" data-testid={`select-new-role-${employee.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SUPERVISOR">Supervisor</SelectItem>
                <SelectItem value="TECHNICIAN">Technician</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex flex-col gap-2">
            <Button
              onClick={handleRoleChangeSubmit}
              disabled={isUpdating || selectedRole === employee.role}
              className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium"
              data-testid={`button-confirm-role-${employee.id}`}
            >
              {isUpdating ? 'Updating...' : 'Change Role'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setIsRoleDialogOpen(false)}
              className="w-full h-10 rounded-xl text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-medium"
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
