import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Edit2, Trash2, Loader2, DollarSign, ChevronLeft, Search, Settings2, X, FolderOpen, Pencil } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCan } from "@/hooks/useCan";
import type { ServiceCatalogItem, PricebookCategory } from "@shared/schema";

const UNIT_OPTIONS = [
  { value: "each", label: "Each" },
  { value: "hour", label: "Hour" },
  { value: "ft", label: "Foot" },
  { value: "sq_ft", label: "Sq Ft" },
  { value: "job", label: "Job" },
  { value: "day", label: "Day" },
];

export default function PriceBook() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { can } = useCan();

  const [activeCategory, setActiveCategory] = useState<number | "all" | "uncategorized">("all");
  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ServiceCatalogItem | null>(null);
  const [editingCategory, setEditingCategory] = useState<PricebookCategory | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [renamingCategoryId, setRenamingCategoryId] = useState<number | null>(null);
  const [renamingCategoryName, setRenamingCategoryName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [priceDisplay, setPriceDisplay] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    defaultPriceCents: 0,
    unit: "each",
    categoryId: null as number | null,
    taskCode: "",
  });

  const { data: catalogItems = [], isLoading } = useQuery<ServiceCatalogItem[]>({
    queryKey: ['/api/service-catalog'],
    enabled: isAuthenticated && can('customize.manage'),
  });

  const { data: categories = [], isLoading: categoriesLoading } = useQuery<PricebookCategory[]>({
    queryKey: ['/api/service-catalog/categories'],
    enabled: isAuthenticated && can('customize.manage'),
  });

  const createItemMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest('POST', '/api/service-catalog', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/service-catalog'] });
      toast({ title: "Item added" });
      resetItemForm();
      setIsItemDialogOpen(false);
    },
    onError: () => toast({ title: "Error", description: "Failed to create item", variant: "destructive" }),
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof formData }) => {
      const res = await apiRequest('PATCH', `/api/service-catalog/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/service-catalog'] });
      toast({ title: "Item updated" });
      resetItemForm();
      setIsItemDialogOpen(false);
      setEditingItem(null);
    },
    onError: () => toast({ title: "Error", description: "Failed to update item", variant: "destructive" }),
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest('DELETE', `/api/service-catalog/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/service-catalog'] });
      toast({ title: "Item deleted" });
    },
    onError: () => toast({ title: "Error", description: "Failed to delete item", variant: "destructive" }),
  });

  const createCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest('POST', '/api/service-catalog/categories', { name });
      return res.json();
    },
    onSuccess: (cat: PricebookCategory) => {
      queryClient.invalidateQueries({ queryKey: ['/api/service-catalog/categories'] });
      setNewCategoryName("");
      setActiveCategory(cat.id);
      toast({ title: `Category "${cat.name}" created` });
    },
    onError: () => toast({ title: "Error", description: "Failed to create category", variant: "destructive" }),
  });

  const renameCategoryMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const res = await apiRequest('PATCH', `/api/service-catalog/categories/${id}`, { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/service-catalog/categories'] });
      setRenamingCategoryId(null);
      setRenamingCategoryName("");
      toast({ title: "Category renamed" });
    },
    onError: () => toast({ title: "Error", description: "Failed to rename category", variant: "destructive" }),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest('DELETE', `/api/service-catalog/categories/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/service-catalog/categories'] });
      queryClient.invalidateQueries({ queryKey: ['/api/service-catalog'] });
      setActiveCategory("all");
      toast({ title: "Category deleted", description: "Items moved to Uncategorized" });
    },
    onError: () => toast({ title: "Error", description: "Failed to delete category", variant: "destructive" }),
  });

  const resetItemForm = () => {
    setFormData({ name: "", description: "", defaultPriceCents: 0, unit: "each", categoryId: null, taskCode: "" });
    setPriceDisplay("");
  };

  const openCreateItemDialog = () => {
    resetItemForm();
    if (typeof activeCategory === "number") {
      setFormData(f => ({ ...f, categoryId: activeCategory }));
    }
    setEditingItem(null);
    setIsItemDialogOpen(true);
  };

  const openEditItemDialog = (item: ServiceCatalogItem) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      description: item.description || "",
      defaultPriceCents: item.defaultPriceCents,
      unit: item.unit,
      categoryId: (item as any).categoryId ?? null,
      taskCode: (item as any).taskCode || "",
    });
    setPriceDisplay((item.defaultPriceCents / 100).toFixed(2));
    setIsItemDialogOpen(true);
  };

  const handleItemSubmit = () => {
    if (!formData.name.trim()) {
      toast({ title: "Validation Error", description: "Name is required", variant: "destructive" });
      return;
    }
    if (editingItem) {
      updateItemMutation.mutate({ id: editingItem.id, data: formData });
    } else {
      createItemMutation.mutate(formData);
    }
  };

  const formatCurrency = (cents: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

  const handlePriceChange = (value: string) => {
    const stripped = value.replace(/,/g, '');
    const cleanValue = stripped.replace(/[^0-9.]/g, '');
    const parts = cleanValue.split('.');
    const sanitized = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : cleanValue;
    const dollars = parseFloat(sanitized) || 0;
    setFormData({ ...formData, defaultPriceCents: Math.round(dollars * 100) });
    if (sanitized === '' || sanitized === '.') { setPriceDisplay(sanitized); return; }
    const decParts = sanitized.split('.');
    const intFormatted = decParts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    setPriceDisplay(decParts.length > 1 ? `${intFormatted}.${decParts[1]}` : intFormatted);
  };

  const handlePriceBlur = () => {
    const dollars = formData.defaultPriceCents / 100;
    if (dollars === 0) { setPriceDisplay(''); return; }
    setPriceDisplay(dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  };

  const handlePriceFocus = () => {
    const dollars = formData.defaultPriceCents / 100;
    if (dollars === 0) { setPriceDisplay(''); return; }
    const formatted = dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    setPriceDisplay(formatted.endsWith('.00') ? formatted.slice(0, -3) : formatted);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
      </div>
    );
  }

  if (!can('customize.manage')) {
    return (
      <div className="container mx-auto px-4 py-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl p-8 text-center shadow-sm border border-slate-200 dark:border-slate-700">
          <Settings2 className="mx-auto h-12 w-12 text-slate-400 mb-4" />
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2">Not Authorized</h2>
          <p className="text-slate-600 dark:text-slate-400">Only Owners can access the price book.</p>
        </div>
      </div>
    );
  }

  const searchFiltered = catalogItems.filter(item =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const filteredItems = searchFiltered.filter(item => {
    if (activeCategory === "all") return true;
    if (activeCategory === "uncategorized") return !(item as any).categoryId;
    return (item as any).categoryId === activeCategory;
  });

  const uncategorizedCount = catalogItems.filter(item => !(item as any).categoryId).length;

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Link href="/customize">
          <button className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
            <ChevronLeft className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          </button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Price Book</h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm">Reusable line items for estimates</p>
        </div>
        <Button onClick={openCreateItemDialog} className="bg-teal-600 hover:bg-teal-700">
          <Plus className="h-4 w-4 mr-2" />
          Add Item
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          type="text"
          placeholder="Search items..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Category tabs */}
      <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setActiveCategory("all")}
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            activeCategory === "all"
              ? "bg-teal-600 text-white"
              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
          }`}
        >
          All ({catalogItems.length})
        </button>
        {categories.map(cat => {
          const count = catalogItems.filter(item => (item as any).categoryId === cat.id).length;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeCategory === cat.id
                  ? "bg-teal-600 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              {cat.name} ({count})
            </button>
          );
        })}
        {uncategorizedCount > 0 && (
          <button
            onClick={() => setActiveCategory("uncategorized")}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeCategory === "uncategorized"
                ? "bg-slate-600 text-white"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            Uncategorized ({uncategorizedCount})
          </button>
        )}
        <button
          onClick={() => setIsCategoryDialogOpen(true)}
          className="flex-shrink-0 ml-1 px-3 py-1.5 rounded-full text-sm font-medium border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-teal-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors flex items-center gap-1"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Manage
        </button>
      </div>

      {/* Items list */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <DollarSign className="mx-auto h-12 w-12 text-slate-300 mb-4" />
            <p className="text-slate-500 dark:text-slate-400">
              {searchQuery
                ? "No items match your search"
                : activeCategory !== "all"
                ? "No items in this category yet."
                : "No items yet. Add your first item to get started."}
            </p>
            {activeCategory !== "all" && !searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-3 text-teal-600 hover:text-teal-700"
                onClick={openCreateItemDialog}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add item here
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-700">
            {filteredItems.map((item) => {
              const catName = categories.find(c => c.id === (item as any).categoryId)?.name;
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{item.name}</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                      <span>{formatCurrency(item.defaultPriceCents)}</span>
                      <span className="text-slate-300 dark:text-slate-600">•</span>
                      <span>per {UNIT_OPTIONS.find(u => u.value === item.unit)?.label.toLowerCase() || item.unit}</span>
                      {catName && (
                        <>
                          <span className="text-slate-300 dark:text-slate-600">•</span>
                          <span className="inline-flex items-center gap-1 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400 text-xs px-2 py-0.5 rounded-full font-medium">
                            {catName}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-4">
                    <Button variant="ghost" size="sm" onClick={() => openEditItemDialog(item)}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="ecologic-alert-dialog">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Item</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete "{item.name}"? This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteItemMutation.mutate(item.id)}
                            className="bg-red-600 hover:bg-red-700"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add/Edit Item Dialog */}
      <Dialog open={isItemDialogOpen} onOpenChange={(open) => {
        setIsItemDialogOpen(open);
        if (!open) { resetItemForm(); setEditingItem(null); }
      }}>
        <DialogContent className="ecologic-dialog w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden" hideCloseButton>
          <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
            <div className="min-w-[44px]" />
            <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {editingItem ? "Edit Item" : "Add Item"}
            </DialogTitle>
            <button
              onClick={() => setIsItemDialogOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="px-4 py-5 space-y-4 bg-white dark:bg-slate-900 overflow-y-auto max-h-[70vh]">
            <div className="space-y-1.5">
              <Label htmlFor="item-name" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="item-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Name"
                className="h-10 rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="item-description" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Description
              </Label>
              <Textarea
                id="item-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Description"
                rows={3}
                className="rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="item-price" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Price <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    id="item-price"
                    type="text"
                    className="pl-9 h-10 rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                    value={priceDisplay}
                    onChange={(e) => handlePriceChange(e.target.value)}
                    onBlur={handlePriceBlur}
                    onFocus={handlePriceFocus}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="item-unit" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Unit
                </Label>
                <Select
                  value={formData.unit}
                  onValueChange={(value) => setFormData({ ...formData, unit: value })}
                >
                  <SelectTrigger className="h-10 rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNIT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="item-category" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Category
                </Label>
                <Select
                  value={formData.categoryId ? String(formData.categoryId) : "none"}
                  onValueChange={(value) => setFormData({ ...formData, categoryId: value === "none" ? null : parseInt(value) })}
                >
                  <SelectTrigger className="h-10 rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {categories.map(cat => (
                      <SelectItem key={cat.id} value={String(cat.id)}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="item-taskcode" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Task Code
                </Label>
                <Input
                  id="item-taskcode"
                  value={formData.taskCode}
                  onChange={(e) => setFormData({ ...formData, taskCode: e.target.value })}
                  placeholder="Task Code"
                  className="h-10 rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
            <button
              onClick={() => setIsItemDialogOpen(false)}
              className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors px-2 py-2"
            >
              Cancel
            </button>
            <Button
              onClick={handleItemSubmit}
              disabled={createItemMutation.isPending || updateItemMutation.isPending}
              className="h-10 rounded-xl bg-teal-600 hover:bg-teal-700 px-6"
            >
              {(createItemMutation.isPending || updateItemMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingItem ? "Save Changes" : "Add Item"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage Categories Dialog */}
      <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
        <DialogContent className="ecologic-dialog w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden" hideCloseButton>
          <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
            <div className="min-w-[44px]" />
            <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Manage Categories
            </DialogTitle>
            <button
              onClick={() => setIsCategoryDialogOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="px-4 py-5 bg-white dark:bg-slate-900 overflow-y-auto max-h-[65vh] space-y-4">
            {/* Create new category */}
            <div>
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
                New Category
              </Label>
              <div className="flex gap-2">
                <Input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Category name"
                  className="h-10 rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newCategoryName.trim()) {
                      createCategoryMutation.mutate(newCategoryName.trim());
                    }
                  }}
                />
                <Button
                  onClick={() => {
                    if (newCategoryName.trim()) createCategoryMutation.mutate(newCategoryName.trim());
                  }}
                  disabled={!newCategoryName.trim() || createCategoryMutation.isPending}
                  className="h-10 bg-teal-600 hover:bg-teal-700 rounded-xl px-4 flex-shrink-0"
                >
                  {createCategoryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Existing categories */}
            {categoriesLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
              </div>
            ) : categories.length === 0 ? (
              <div className="text-center py-6">
                <FolderOpen className="mx-auto h-10 w-10 text-slate-300 mb-2" />
                <p className="text-sm text-slate-500 dark:text-slate-400">No categories yet</p>
              </div>
            ) : (
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                  Existing Categories
                </p>
                <div className="space-y-1.5">
                  {categories.map(cat => {
                    const itemCount = catalogItems.filter(item => (item as any).categoryId === cat.id).length;
                    const isRenaming = renamingCategoryId === cat.id;
                    return (
                      <div key={cat.id} className="flex items-center gap-2 group p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        {isRenaming ? (
                          <>
                            <Input
                              value={renamingCategoryName}
                              onChange={(e) => setRenamingCategoryName(e.target.value)}
                              className="h-9 flex-1 rounded-lg bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && renamingCategoryName.trim()) {
                                  renameCategoryMutation.mutate({ id: cat.id, name: renamingCategoryName.trim() });
                                } else if (e.key === 'Escape') {
                                  setRenamingCategoryId(null);
                                }
                              }}
                            />
                            <Button
                              size="sm"
                              onClick={() => {
                                if (renamingCategoryName.trim()) {
                                  renameCategoryMutation.mutate({ id: cat.id, name: renamingCategoryName.trim() });
                                }
                              }}
                              disabled={renameCategoryMutation.isPending}
                              className="h-9 bg-teal-600 hover:bg-teal-700 rounded-lg px-3"
                            >
                              {renameCategoryMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setRenamingCategoryId(null)}
                              className="h-9 rounded-lg px-2"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{cat.name}</span>
                              <span className="ml-2 text-xs text-slate-400">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
                            </div>
                            <button
                              onClick={() => { setRenamingCategoryId(cat.id); setRenamingCategoryName(cat.name); }}
                              className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-all text-slate-500 dark:text-slate-400"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <button className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-all text-red-500">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="ecologic-alert-dialog">
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Category</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Delete "{cat.name}"? The {itemCount} item{itemCount !== 1 ? 's' : ''} inside will move to Uncategorized — nothing gets deleted.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteCategoryMutation.mutate(cat.id)}
                                    className="bg-red-600 hover:bg-red-700"
                                  >
                                    Delete Category
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
            <Button
              onClick={() => setIsCategoryDialogOpen(false)}
              className="w-full h-10 rounded-xl"
              variant="outline"
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
