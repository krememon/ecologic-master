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
import { Plus, Edit2, Trash2, Loader2, DollarSign, ChevronLeft, ChevronRight, Search, Settings2, X, FolderOpen, Pencil, Tag, ListPlus, ChevronDown, Package } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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

type ActiveView =
  | { type: "list" }
  | { type: "category"; categoryId: number; categoryName: string }
  | { type: "uncategorized" }
  | { type: "materials" };

export default function PriceBook() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { can } = useCan();

  const [view, setView] = useState<ActiveView>({ type: "list" });
  const [listSearch, setListSearch] = useState("");
  const [detailSearch, setDetailSearch] = useState("");
  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ServiceCatalogItem | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [renamingCategoryId, setRenamingCategoryId] = useState<number | null>(null);
  const [renamingCategoryName, setRenamingCategoryName] = useState("");
  const [priceDisplay, setPriceDisplay] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    defaultPriceCents: 0,
    unit: "each",
    categoryId: null as number | null,
    taskCode: "",
    itemType: "line_item" as "line_item" | "material",
  });

  const { data: catalogItems = [], isLoading } = useQuery<ServiceCatalogItem[]>({
    queryKey: ['/api/service-catalog'],
    enabled: isAuthenticated && can('customize.manage'),
  });

  const { data: categories = [], isLoading: categoriesLoading } = useQuery<PricebookCategory[]>({
    queryKey: ['/api/service-catalog/categories'],
    enabled: isAuthenticated && can('customize.manage'),
  });

  // ── Mutations ──────────────────────────────────────────────────

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
      toast({ title: `"${cat.name}" created` });
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
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['/api/service-catalog/categories'] });
      queryClient.invalidateQueries({ queryKey: ['/api/service-catalog'] });
      if (view.type === "category" && view.categoryId === deletedId) {
        setView({ type: "list" });
      }
      toast({ title: "Category deleted", description: "Items moved to Uncategorized" });
    },
    onError: () => toast({ title: "Error", description: "Failed to delete category", variant: "destructive" }),
  });

  // ── Form helpers ───────────────────────────────────────────────

  const resetItemForm = () => {
    setFormData({ name: "", description: "", defaultPriceCents: 0, unit: "each", categoryId: null, taskCode: "", itemType: "line_item" });
    setPriceDisplay("");
  };

  const openCreateItemDialog = (prefillCategoryId?: number | null, prefillItemType?: "line_item" | "material") => {
    resetItemForm();
    const type = prefillItemType ?? (view.type === "materials" ? "material" : "line_item");
    if (prefillCategoryId !== undefined) {
      setFormData(f => ({ ...f, categoryId: prefillCategoryId, itemType: type }));
    } else if (view.type === "category") {
      setFormData(f => ({ ...f, categoryId: view.categoryId, itemType: type }));
    } else {
      setFormData(f => ({ ...f, itemType: type }));
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
      itemType: ((item as any).itemType as "line_item" | "material") || "line_item",
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

  // ── Auth guard ─────────────────────────────────────────────────

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

  // ── Derived data ───────────────────────────────────────────────

  const uncategorizedItems = catalogItems.filter(item => !(item as any).categoryId && (item as any).itemType !== 'material');
  const materialItems = catalogItems.filter(item => (item as any).itemType === 'material');

  const itemsForCurrentCategory = view.type === "category"
    ? catalogItems.filter(item => (item as any).categoryId === view.categoryId && (item as any).itemType !== 'material')
    : view.type === "uncategorized"
    ? uncategorizedItems
    : view.type === "materials"
    ? materialItems
    : [];

  const detailFiltered = itemsForCurrentCategory.filter(item =>
    !detailSearch.trim() ||
    item.name.toLowerCase().includes(detailSearch.toLowerCase()) ||
    (item.description && item.description.toLowerCase().includes(detailSearch.toLowerCase()))
  );

  // List-level search: matches categories by name OR items by name (shows category rows that match)
  const listSearchLower = listSearch.trim().toLowerCase();
  const filteredCategories = listSearchLower
    ? categories.filter(cat => {
        if (cat.name.toLowerCase().includes(listSearchLower)) return true;
        return catalogItems.some(
          item => (item as any).categoryId === cat.id &&
            (item.name.toLowerCase().includes(listSearchLower) ||
             (item.description && item.description.toLowerCase().includes(listSearchLower)))
        );
      })
    : categories;

  const showUncategorized = uncategorizedItems.length > 0 &&
    (!listSearchLower || "uncategorized".includes(listSearchLower) ||
      uncategorizedItems.some(item =>
        item.name.toLowerCase().includes(listSearchLower) ||
        (item.description && item.description.toLowerCase().includes(listSearchLower))
      ));

  // ── Category detail view ───────────────────────────────────────

  if (view.type === "category" || view.type === "uncategorized" || view.type === "materials") {
    const title = view.type === "category" ? view.categoryName : view.type === "materials" ? "Materials" : "Uncategorized";
    const currentCatId = view.type === "category" ? view.categoryId : null;
    const isMaterialsView = view.type === "materials";

    return (
      <div className="container mx-auto px-4 py-6 max-w-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={() => { setView({ type: "list" }); setDetailSearch(""); }}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <ChevronLeft className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wide">Price Book</p>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 leading-tight">{title}</h1>
          </div>
          <Button
            onClick={() => openCreateItemDialog(currentCatId, isMaterialsView ? "material" : undefined)}
            className="bg-teal-600 hover:bg-teal-700"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            {isMaterialsView ? "Add Material" : "Add Item"}
          </Button>
        </div>

        {/* Search */}
        <div className="relative mb-5">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            type="text"
            placeholder={`Search in ${title}...`}
            value={detailSearch}
            onChange={(e) => setDetailSearch(e.target.value)}
            className="pl-10"
          />
          {detailSearch && (
            <button
              onClick={() => setDetailSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Items */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
          </div>
        ) : detailFiltered.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 text-center py-14">
            {detailSearch ? (
              <>
                <Search className="mx-auto h-10 w-10 text-slate-300 mb-3" />
                <p className="text-slate-500 dark:text-slate-400">No items match "{detailSearch}"</p>
              </>
            ) : (
              <>
                {isMaterialsView
                  ? <Package className="mx-auto h-10 w-10 text-slate-300 mb-3" />
                  : <Tag className="mx-auto h-10 w-10 text-slate-300 mb-3" />}
                <p className="text-slate-600 dark:text-slate-400 font-medium mb-1">
                  {isMaterialsView ? "No materials yet" : "No items here yet"}
                </p>
                <p className="text-sm text-slate-400 dark:text-slate-500 mb-5">
                  {isMaterialsView ? "Add your first material to the catalog" : "Add your first item to this category"}
                </p>
                <Button
                  onClick={() => openCreateItemDialog(currentCatId, isMaterialsView ? "material" : undefined)}
                  className="bg-teal-600 hover:bg-teal-700"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {isMaterialsView ? "Add Material" : "Add Item"}
                </Button>
              </>
            )}
          </div>
        ) : (
          <>
            {detailSearch && (
              <p className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2 px-1">
                {detailFiltered.length} result{detailFiltered.length !== 1 ? 's' : ''}
              </p>
            )}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700">
              {detailFiltered.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{item.name}</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5">
                      <span>{formatCurrency(item.defaultPriceCents)}</span>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <span>per {UNIT_OPTIONS.find(u => u.value === item.unit)?.label.toLowerCase() || item.unit}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 ml-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openEditItemDialog(item)}
                      className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-400 transition-colors"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
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
              ))}
            </div>
          </>
        )}

        {/* Shared dialogs */}
        {itemDialog()}
      </div>
    );
  }

  // ── Category list view (main) ──────────────────────────────────

  const totalItems = catalogItems.length;

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Link href="/customize">
          <button className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
            <ChevronLeft className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          </button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Price Book</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            {categories.length} categor{categories.length !== 1 ? 'ies' : 'y'} · {totalItems} item{totalItems !== 1 ? 's' : ''}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="bg-teal-600 hover:bg-teal-700">
              <Plus className="h-4 w-4 mr-1.5" />
              Add
              <ChevronDown className="h-3.5 w-3.5 ml-1 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              className="flex items-center gap-2.5 cursor-pointer py-2.5"
              onSelect={() => openCreateItemDialog()}
            >
              <ListPlus className="h-4 w-4 text-teal-600" />
              <span className="font-medium">Line Item</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center gap-2.5 cursor-pointer py-2.5"
              onSelect={() => openCreateItemDialog(undefined, "material")}
            >
              <Package className="h-4 w-4 text-teal-600" />
              <span className="font-medium">Material</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center gap-2.5 cursor-pointer py-2.5"
              onSelect={() => setIsCategoryDialogOpen(true)}
            >
              <FolderOpen className="h-4 w-4 text-teal-600" />
              <span className="font-medium">Category</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          type="text"
          placeholder="Search categories or items..."
          value={listSearch}
          onChange={(e) => setListSearch(e.target.value)}
          className="pl-10"
        />
        {listSearch && (
          <button
            onClick={() => setListSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Loading */}
      {isLoading || categoriesLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
        </div>

      /* Empty — no categories at all */
      ) : categories.length === 0 && uncategorizedItems.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 text-center py-14 px-6">
          <FolderOpen className="mx-auto h-12 w-12 text-slate-300 mb-3" />
          <p className="text-slate-600 dark:text-slate-400 font-medium mb-1">No categories yet</p>
          <p className="text-sm text-slate-400 dark:text-slate-500 mb-5">
            Create a category to start organizing your price book
          </p>
          <Button onClick={() => setIsCategoryDialogOpen(true)} className="bg-teal-600 hover:bg-teal-700">
            <Plus className="h-4 w-4 mr-2" />
            Create Category
          </Button>
        </div>

      /* Search returned nothing */
      ) : filteredCategories.length === 0 && !showUncategorized ? (
        <div className="text-center py-14">
          <Search className="mx-auto h-10 w-10 text-slate-300 mb-3" />
          <p className="text-slate-500 dark:text-slate-400">No results for "{listSearch}"</p>
        </div>

      /* Category list */
      ) : (
        <div className="space-y-2">
          {filteredCategories.map(cat => {
            const count = catalogItems.filter(item => (item as any).categoryId === cat.id).length;
            return (
              <button
                key={cat.id}
                onClick={() => { setView({ type: "category", categoryId: cat.id, categoryName: cat.name }); setDetailSearch(""); }}
                className="w-full flex items-center gap-4 px-4 py-4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-teal-300 dark:hover:border-teal-600 hover:shadow-md transition-all text-left group"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {cat.name}
                  </div>
                  <div className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                    {count === 0 ? "No items" : `${count} item${count !== 1 ? 's' : ''}`}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-teal-500 transition-colors flex-shrink-0" />
              </button>
            );
          })}

          {/* Materials row */}
          {(() => {
            const matCount = catalogItems.filter(item => (item as any).itemType === 'material').length;
            const showMaterials = matCount > 0 || (!listSearchLower) || "materials".includes(listSearchLower);
            if (!showMaterials && matCount === 0) return null;
            if (listSearchLower && !("materials".includes(listSearchLower)) && matCount === 0) return null;
            if (listSearchLower && !("materials".includes(listSearchLower)) &&
              !catalogItems.some(item =>
                (item as any).itemType === 'material' && (
                  item.name.toLowerCase().includes(listSearchLower) ||
                  (item.description && item.description.toLowerCase().includes(listSearchLower))
                )
              )
            ) return null;
            return (
              <button
                onClick={() => { setView({ type: "materials" }); setDetailSearch(""); }}
                className="w-full flex items-center gap-4 px-4 py-4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-teal-300 dark:hover:border-teal-600 hover:shadow-md transition-all text-left group"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-slate-100 truncate flex items-center gap-2">
                    Materials
                    <span className="text-xs font-normal bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 px-1.5 py-0.5 rounded">
                      catalog
                    </span>
                  </div>
                  <div className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                    {matCount === 0 ? "No materials" : `${matCount} material${matCount !== 1 ? 's' : ''}`}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-teal-500 transition-colors flex-shrink-0" />
              </button>
            );
          })()}

          {/* Uncategorized row */}
          {showUncategorized && (
            <button
              onClick={() => { setView({ type: "uncategorized" }); setDetailSearch(""); }}
              className="w-full flex items-center gap-4 px-4 py-4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-500 hover:shadow-md transition-all text-left group"
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-700 dark:text-slate-300 truncate">
                  Uncategorized
                </div>
                <div className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {uncategorizedItems.length} item{uncategorizedItems.length !== 1 ? 's' : ''}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors flex-shrink-0" />
            </button>
          )}
        </div>
      )}

      {/* Shared dialogs */}
      {itemDialog()}
      {categoryDialog()}
    </div>
  );

  // ── Dialog renderers (shared between both views) ───────────────

  function itemDialog() {
    return (
      <Dialog open={isItemDialogOpen} onOpenChange={(open) => {
        setIsItemDialogOpen(open);
        if (!open) { resetItemForm(); setEditingItem(null); }
      }}>
        <DialogContent className="ecologic-dialog w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden" hideCloseButton>
          <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
            <div className="min-w-[44px]" />
            <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {editingItem
                ? (formData.itemType === "material" ? "Edit Material" : "Edit Item")
                : (formData.itemType === "material" ? "Add Material" : "Add Item")}
            </DialogTitle>
            <button
              onClick={() => setIsItemDialogOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="px-4 py-5 space-y-4 bg-white dark:bg-slate-900 overflow-y-auto max-h-[70vh]">
            {/* Name */}
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

            {/* Description */}
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

            {/* Price + Unit */}
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
                <Select value={formData.unit} onValueChange={(value) => setFormData({ ...formData, unit: value })}>
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

            {/* Category + Task Code */}
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
              {editingItem
                ? "Save Changes"
                : (formData.itemType === "material" ? "Add Material" : "Add Item")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  function categoryDialog() {
    return (
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

          <div className="px-4 py-5 bg-white dark:bg-slate-900 overflow-y-auto max-h-[65vh] space-y-5">
            {/* Create new */}
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
                  onClick={() => { if (newCategoryName.trim()) createCategoryMutation.mutate(newCategoryName.trim()); }}
                  disabled={!newCategoryName.trim() || createCategoryMutation.isPending}
                  className="h-10 bg-teal-600 hover:bg-teal-700 rounded-xl px-4 flex-shrink-0"
                >
                  {createCategoryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Existing */}
            {categoriesLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
              </div>
            ) : categories.length === 0 ? (
              <div className="text-center py-6">
                <FolderOpen className="mx-auto h-10 w-10 text-slate-300 mb-2" />
                <p className="text-sm text-slate-500 dark:text-slate-400">No categories yet</p>
              </div>
            ) : (
              <div>
                <p className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">
                  Categories
                </p>
                <div className="space-y-1">
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
                              className="h-9 flex-1 rounded-lg"
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
                              onClick={() => { if (renamingCategoryName.trim()) renameCategoryMutation.mutate({ id: cat.id, name: renamingCategoryName.trim() }); }}
                              disabled={renameCategoryMutation.isPending}
                              className="h-9 bg-teal-600 hover:bg-teal-700 rounded-lg px-3"
                            >
                              {renameCategoryMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRenamingCategoryId(null)} className="h-9 rounded-lg px-2">
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
                              className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-all"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <button className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-all">
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
            <Button onClick={() => setIsCategoryDialogOpen(false)} className="w-full h-10 rounded-xl" variant="outline">
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
}
