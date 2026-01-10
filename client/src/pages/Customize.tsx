import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Edit2, Trash2, Package, Wrench, Loader2, DollarSign } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCan } from "@/hooks/useCan";
import type { ServiceCatalogItem } from "@shared/schema";

const UNIT_OPTIONS = [
  { value: "each", label: "Each" },
  { value: "hour", label: "Hour" },
  { value: "ft", label: "Foot" },
  { value: "sq_ft", label: "Sq Ft" },
  { value: "job", label: "Job" },
  { value: "day", label: "Day" },
];

export default function Customize() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { can } = useCan();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ServiceCatalogItem | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    defaultPriceCents: 0,
    unit: "each",
    category: "",
  });

  const { data: catalogItems = [], isLoading } = useQuery<ServiceCatalogItem[]>({
    queryKey: ['/api/service-catalog'],
    enabled: isAuthenticated && can('customize.manage'),
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest('POST', '/api/service-catalog', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/service-catalog'] });
      toast({ title: "Success", description: "Service item created" });
      resetForm();
      setIsCreateDialogOpen(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create service item", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof formData }) => {
      const res = await apiRequest('PATCH', `/api/service-catalog/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/service-catalog'] });
      toast({ title: "Success", description: "Service item updated" });
      resetForm();
      setEditingItem(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update service item", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest('DELETE', `/api/service-catalog/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/service-catalog'] });
      toast({ title: "Success", description: "Service item deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete service item", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      defaultPriceCents: 0,
      unit: "each",
      category: "",
    });
  };

  const openEditDialog = (item: ServiceCatalogItem) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      description: item.description || "",
      defaultPriceCents: item.defaultPriceCents,
      unit: item.unit,
      category: item.category || "",
    });
  };

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      toast({ title: "Validation Error", description: "Name is required", variant: "destructive" });
      return;
    }

    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  const handlePriceChange = (value: string) => {
    const cleanValue = value.replace(/[^0-9.]/g, '');
    const dollars = parseFloat(cleanValue) || 0;
    setFormData({ ...formData, defaultPriceCents: Math.round(dollars * 100) });
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
      </div>
    );
  }

  if (!can('customize.manage')) {
    return (
      <div className="container mx-auto px-4 py-6">
        <Card>
          <CardContent className="p-8 text-center">
            <Wrench className="mx-auto h-12 w-12 text-slate-400 mb-4" />
            <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2">Access Restricted</h2>
            <p className="text-slate-600 dark:text-slate-400">
              Only Owners and Supervisors can access customization settings.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const groupedItems = catalogItems.reduce((acc, item) => {
    const category = item.category || "Uncategorized";
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {} as Record<string, ServiceCatalogItem[]>);

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Wrench className="h-6 w-6 text-teal-600" />
            Customize
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            Manage templates and settings for your company
          </p>
        </div>
      </div>

      <Tabs defaultValue="service-catalog" className="space-y-4">
        <TabsList>
          <TabsTrigger value="service-catalog" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Service Catalog
          </TabsTrigger>
        </TabsList>

        <TabsContent value="service-catalog" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Service Catalog</CardTitle>
                <CardDescription>
                  Create reusable line items for estimates. These templates save time when building estimates.
                </CardDescription>
              </div>
              <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
                setIsCreateDialogOpen(open);
                if (!open) resetForm();
              }}>
                <DialogTrigger asChild>
                  <Button className="bg-teal-600 hover:bg-teal-700">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Service
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Service Item</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Name *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g., Standard Inspection"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        placeholder="Describe this service..."
                        rows={3}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="price">Default Price</Label>
                        <div className="relative">
                          <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                          <Input
                            id="price"
                            type="text"
                            className="pl-9"
                            value={(formData.defaultPriceCents / 100).toFixed(2)}
                            onChange={(e) => handlePriceChange(e.target.value)}
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="unit">Unit</Label>
                        <Select
                          value={formData.unit}
                          onValueChange={(value) => setFormData({ ...formData, unit: value })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {UNIT_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="category">Category</Label>
                      <Input
                        id="category"
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        placeholder="e.g., Inspections, Repairs"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button
                      onClick={handleSubmit}
                      disabled={createMutation.isPending}
                      className="bg-teal-600 hover:bg-teal-700"
                    >
                      {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Create
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
                </div>
              ) : catalogItems.length === 0 ? (
                <div className="text-center py-8">
                  <Package className="mx-auto h-12 w-12 text-slate-300 mb-4" />
                  <p className="text-slate-500 dark:text-slate-400">
                    No service items yet. Add your first service to get started.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {Object.entries(groupedItems).map(([category, items]) => (
                    <div key={category}>
                      <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wide">
                        {category}
                      </h3>
                      <div className="space-y-2">
                        {items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700"
                          >
                            <div className="flex-1">
                              <div className="font-medium text-slate-900 dark:text-slate-100">
                                {item.name}
                              </div>
                              {item.description && (
                                <div className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                                  {item.description}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <div className="font-medium text-slate-900 dark:text-slate-100">
                                  {formatCurrency(item.defaultPriceCents)}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  per {UNIT_OPTIONS.find(u => u.value === item.unit)?.label.toLowerCase() || item.unit}
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <Dialog
                                  open={editingItem?.id === item.id}
                                  onOpenChange={(open) => {
                                    if (!open) {
                                      setEditingItem(null);
                                      resetForm();
                                    }
                                  }}
                                >
                                  <DialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => openEditDialog(item)}
                                    >
                                      <Edit2 className="h-4 w-4" />
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent>
                                    <DialogHeader>
                                      <DialogTitle>Edit Service Item</DialogTitle>
                                    </DialogHeader>
                                    <div className="space-y-4 py-4">
                                      <div className="space-y-2">
                                        <Label htmlFor="edit-name">Name *</Label>
                                        <Input
                                          id="edit-name"
                                          value={formData.name}
                                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <Label htmlFor="edit-description">Description</Label>
                                        <Textarea
                                          id="edit-description"
                                          value={formData.description}
                                          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                          rows={3}
                                        />
                                      </div>
                                      <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                          <Label htmlFor="edit-price">Default Price</Label>
                                          <div className="relative">
                                            <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                                            <Input
                                              id="edit-price"
                                              type="text"
                                              className="pl-9"
                                              value={(formData.defaultPriceCents / 100).toFixed(2)}
                                              onChange={(e) => handlePriceChange(e.target.value)}
                                            />
                                          </div>
                                        </div>
                                        <div className="space-y-2">
                                          <Label htmlFor="edit-unit">Unit</Label>
                                          <Select
                                            value={formData.unit}
                                            onValueChange={(value) => setFormData({ ...formData, unit: value })}
                                          >
                                            <SelectTrigger>
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {UNIT_OPTIONS.map((opt) => (
                                                <SelectItem key={opt.value} value={opt.value}>
                                                  {opt.label}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      </div>
                                      <div className="space-y-2">
                                        <Label htmlFor="edit-category">Category</Label>
                                        <Input
                                          id="edit-category"
                                          value={formData.category}
                                          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                        />
                                      </div>
                                    </div>
                                    <DialogFooter>
                                      <DialogClose asChild>
                                        <Button variant="outline">Cancel</Button>
                                      </DialogClose>
                                      <Button
                                        onClick={handleSubmit}
                                        disabled={updateMutation.isPending}
                                        className="bg-teal-600 hover:bg-teal-700"
                                      >
                                        {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                        Save Changes
                                      </Button>
                                    </DialogFooter>
                                  </DialogContent>
                                </Dialog>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50">
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete Service Item</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Are you sure you want to delete "{item.name}"? This action cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => deleteMutation.mutate(item.id)}
                                        className="bg-red-600 hover:bg-red-700"
                                      >
                                        Delete
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
