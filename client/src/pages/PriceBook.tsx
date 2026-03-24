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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Edit2, Loader2, DollarSign, ChevronLeft, ChevronRight, Search, Settings2, X, FolderOpen, Pencil, Tag, ListPlus, ChevronDown, Package, CheckCircle2, Circle, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCan } from "@/hooks/useCan";
import { cn } from "@/lib/utils";
import type { ServiceCatalogItem, PricebookCategory } from "@shared/schema";

const UNIT_OPTIONS = [
  { value: "each", label: "Each" },
  { value: "hour", label: "Hour" },
  { value: "ft", label: "Foot" },
  { value: "sq_ft", label: "Sq Ft" },
  { value: "job", label: "Job" },
  { value: "day", label: "Day" },
];

type Tab = "line_items" | "materials";

type ActiveView =
  | { type: "list" }
  | { type: "category"; categoryId: number; categoryName: string }
  | { type: "uncategorized" };

export default function PriceBook() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { can } = useCan();

  const [activeTab, setActiveTab] = useState<Tab>("line_items");
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

  // ── Select mode state ──────────────────────────────────────────
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<number>>(new Set());
  const [selectedItemIds, setSelectedItemIds] = useState<Set<number>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedCategoryIds(new Set());
    setSelectedItemIds(new Set());
  };

  const toggleCategorySelection = (id: number) => {
    setSelectedCategoryIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleItemSelection = (id: number) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Queries ────────────────────────────────────────────────────

  const { data: catalogItems = [], isLoading } = useQuery<ServiceCatalogItem[]>({
    queryKey: ['/api/service-catalog'],
    enabled: isAuthenticated && can('customize.manage'),
  });

  const { data: categories = [], isLoading: categoriesLoading } = useQuery<PricebookCategory[]>({
    queryKey: ['/api/service-catalog/categories'],
    enabled: isAuthenticated && can('customize.manage'),
  });

  // ── Derived data: scoped to the active tab ──────────────────────

  const tabItemType: "line_item" | "material" = activeTab === "materials" ? "material" : "line_item";

  const tabCategories = categories.filter(
    cat => ((cat as any).categoryType ?? 'line_item') === tabItemType
  );

  const tabItems = catalogItems.filter(
    item => ((item as any).itemType ?? 'line_item') === tabItemType
  );

  const uncategorizedTabItems = tabItems.filter(item => !(item as any).categoryId);

  const itemsForCurrentView = view.type === "category"
    ? tabItems.filter(item => (item as any).categoryId === view.categoryId)
    : view.type === "uncategorized"
    ? uncategorizedTabItems
    : [];

  const detailFiltered = itemsForCurrentView.filter(item =>
    !detailSearch.trim() ||
    item.name.toLowerCase().includes(detailSearch.toLowerCase()) ||
    (item.description && item.description.toLowerCase().includes(detailSearch.toLowerCase()))
  );

  const listSearchLower = listSearch.trim().toLowerCase();
  const filteredTabCategories = listSearchLower
    ? tabCategories.filter(cat => {
        if (cat.name.toLowerCase().includes(listSearchLower)) return true;
        return tabItems.some(
          item => (item as any).categoryId === cat.id &&
            (item.name.toLowerCase().includes(listSearchLower) ||
             (item.description && item.description.toLowerCase().includes(listSearchLower)))
        );
      })
    : tabCategories;

  const showUncategorized = uncategorizedTabItems.length > 0 &&
    (!listSearchLower || "uncategorized".includes(listSearchLower) ||
      uncategorizedTabItems.some(item =>
        item.name.toLowerCase().includes(listSearchLower) ||
        (item.description && item.description.toLowerCase().includes(listSearchLower))
      ));

  // ── Mutations ──────────────────────────────────────────────────

  const createItemMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest('POST', '/api/service-catalog', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/service-catalog'] });
      toast({ title: activeTab === "materials" ? "Material added" : "Item added" });
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

  const createCategoryMutation = useMutation({
    mutationFn: async ({ name, categoryType }: { name: string; categoryType: string }) => {
      const res = await apiRequest('POST', '/api/service-catalog/categories', { name, categoryType });
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

  // ── Bulk delete ────────────────────────────────────────────────

  const handleBulkDelete = async () => {
    setIsBulkDeleting(true);
    try {
      if (view.type === "list") {
        await Promise.all(
          [...selectedCategoryIds].map(id =>
            apiRequest('DELETE', `/api/service-catalog/categories/${id}`)
          )
        );
        queryClient.invalidateQueries({ queryKey: ['/api/service-catalog/categories'] });
        queryClient.invalidateQueries({ queryKey: ['/api/service-catalog'] });
        const n = selectedCategoryIds.size;
        toast({ title: `${n} categor${n !== 1 ? 'ies' : 'y'} deleted` });
      } else {
        await Promise.all(
          [...selectedItemIds].map(id =>
            apiRequest('DELETE', `/api/service-catalog/${id}`)
          )
        );
        queryClient.invalidateQueries({ queryKey: ['/api/service-catalog'] });
        const n = selectedItemIds.size;
        toast({ title: `${n} ${activeTab === "materials" ? "material" : "item"}${n !== 1 ? 's' : ''} deleted` });
      }
      exitSelectMode();
      if (view.type === "list") {
        setView({ type: "list" });
      }
    } catch {
      toast({ title: "Error", description: "Some items could not be deleted", variant: "destructive" });
    } finally {
      setIsBulkDeleting(false);
      setShowBulkDeleteConfirm(false);
    }
  };

  // Build bulk delete confirmation message
  const bulkDeleteMessage = (() => {
    if (view.type === "list") {
      const n = selectedCategoryIds.size;
      const itemsAffected = [...selectedCategoryIds].reduce((sum, catId) =>
        sum + tabItems.filter(item => (item as any).categoryId === catId).length, 0);
      const catWord = `${n} categor${n !== 1 ? 'ies' : 'y'}`;
      if (itemsAffected === 0) {
        return `Delete ${catWord}? This cannot be undone.`;
      }
      const thingWord = activeTab === "materials" ? "material" : "item";
      return `Delete ${catWord}? The ${itemsAffected} ${thingWord}${itemsAffected !== 1 ? 's' : ''} inside will become Uncategorized — they won't be deleted.`;
    } else {
      const n = selectedItemIds.size;
      const thingWord = activeTab === "materials" ? "material" : "item";
      return `Delete ${n} ${thingWord}${n !== 1 ? 's' : ''}? This cannot be undone.`;
    }
  })();

  const selectedCount = view.type === "list" ? selectedCategoryIds.size : selectedItemIds.size;

  // ── Form helpers ───────────────────────────────────────────────

  const resetItemForm = () => {
    setFormData({ name: "", description: "", defaultPriceCents: 0, unit: "each", categoryId: null, taskCode: "", itemType: "line_item" });
    setPriceDisplay("");
  };

  const openCreateItemDialog = (prefillCategoryId?: number | null) => {
    resetItemForm();
    const catId = prefillCategoryId !== undefined
      ? prefillCategoryId
      : view.type === "category"
      ? view.categoryId
      : null;
    setFormData(f => ({ ...f, categoryId: catId, itemType: tabItemType }));
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

  const switchTab = (tab: Tab) => {
    setActiveTab(tab);
    setView({ type: "list" });
    setListSearch("");
    setDetailSearch("");
    exitSelectMode();
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

  const isMaterials = activeTab === "materials";
  const addItemLabel = isMaterials ? "Material" : "Line Item";
  const addItemIcon = isMaterials ? <Package className="h-4 w-4 text-teal-600" /> : <ListPlus className="h-4 w-4 text-teal-600" />;

  // ── Category detail view ───────────────────────────────────────

  if (view.type === "category" || view.type === "uncategorized") {
    const title = view.type === "category" ? view.categoryName : "Uncategorized";
    const currentCatId = view.type === "category" ? view.categoryId : null;
    const allItemIds = detailFiltered.map(i => i.id);
    const allSelected = allItemIds.length > 0 && allItemIds.every(id => selectedItemIds.has(id));

    const toggleSelectAll = () => {
      if (allSelected) {
        setSelectedItemIds(new Set());
      } else {
        setSelectedItemIds(new Set(allItemIds));
      }
    };

    return (
      <div className="container mx-auto px-4 py-6 max-w-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          {isSelectMode ? (
            <>
              <button
                onClick={exitSelectMode}
                className="text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors px-1 py-2 min-w-[52px]"
              >
                Cancel
              </button>
              <div className="flex-1 min-w-0 text-center">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {selectedCount === 0 ? "Select items" : `${selectedCount} selected`}
                </p>
              </div>
              <Button
                onClick={() => selectedCount > 0 && setShowBulkDeleteConfirm(true)}
                disabled={selectedCount === 0}
                variant="ghost"
                className={cn(
                  "text-sm font-semibold min-w-[52px]",
                  selectedCount > 0
                    ? "text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                    : "text-slate-300 dark:text-slate-600"
                )}
              >
                Delete{selectedCount > 0 ? ` (${selectedCount})` : ""}
              </Button>
            </>
          ) : (
            <>
              <button
                onClick={() => { setView({ type: "list" }); setDetailSearch(""); exitSelectMode(); }}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <ChevronLeft className="h-5 w-5 text-slate-600 dark:text-slate-400" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wide">
                  Price Book · {isMaterials ? "Materials" : "Line Items"}
                </p>
                <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 leading-tight">{title}</h1>
              </div>
              <button
                onClick={() => { setIsSelectMode(true); setSelectedItemIds(new Set()); }}
                className="text-sm font-medium text-teal-600 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300 transition-colors px-2 py-2"
              >
                Select
              </button>
              <Button
                onClick={() => openCreateItemDialog(currentCatId)}
                className="bg-teal-600 hover:bg-teal-700"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Add {addItemLabel}
              </Button>
            </>
          )}
        </div>

        {/* Select-all row when in select mode with items */}
        {isSelectMode && detailFiltered.length > 0 && (
          <button
            onClick={toggleSelectAll}
            className="w-full flex items-center gap-3 px-1 pb-3 text-sm text-teal-600 dark:text-teal-400 font-medium hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
          >
            {allSelected
              ? <CheckCircle2 className="h-4 w-4" />
              : <Circle className="h-4 w-4" />}
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        )}

        {/* Search (hidden in select mode) */}
        {!isSelectMode && (
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
        )}

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
                <p className="text-slate-500 dark:text-slate-400">No results for "{detailSearch}"</p>
              </>
            ) : (
              <>
                {isMaterials
                  ? <Package className="mx-auto h-10 w-10 text-slate-300 mb-3" />
                  : <Tag className="mx-auto h-10 w-10 text-slate-300 mb-3" />}
                <p className="text-slate-600 dark:text-slate-400 font-medium mb-1">
                  {isMaterials ? "No materials here yet" : "No items here yet"}
                </p>
                <p className="text-sm text-slate-400 dark:text-slate-500">
                  {isMaterials
                    ? "Add your first material to this category"
                    : "Add your first item to this category"}
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            {!isSelectMode && detailSearch && (
              <p className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2 px-1">
                {detailFiltered.length} result{detailFiltered.length !== 1 ? 's' : ''}
              </p>
            )}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700">
              {detailFiltered.map((item) => {
                const isSelected = selectedItemIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    onClick={isSelectMode ? () => toggleItemSelection(item.id) : undefined}
                    className={cn(
                      "flex items-center justify-between px-4 py-3.5 transition-colors group",
                      isSelectMode
                        ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40"
                        : "hover:bg-slate-50 dark:hover:bg-slate-700/40",
                      isSelected && "bg-teal-50 dark:bg-teal-900/20"
                    )}
                  >
                    {isSelectMode && (
                      <div className="flex-shrink-0 mr-3">
                        {isSelected
                          ? <CheckCircle2 className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                          : <Circle className="h-5 w-5 text-slate-300 dark:text-slate-600" />}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{item.name}</div>
                      <div className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5">
                        <span>{formatCurrency(item.defaultPriceCents)}</span>
                        <span className="text-slate-300 dark:text-slate-600">·</span>
                        <span>per {UNIT_OPTIONS.find(u => u.value === item.unit)?.label.toLowerCase() || item.unit}</span>
                      </div>
                    </div>
                    {!isSelectMode && (
                      <div className="flex items-center gap-0.5 ml-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEditItemDialog(item)}
                          className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-400 transition-colors"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {itemDialog()}
        {bulkDeleteConfirmDialog()}
      </div>
    );
  }

  // ── Main list view ─────────────────────────────────────────────

  const totalTabItems = tabItems.length;
  const totalTabCategories = tabCategories.length;
  const listIsEmpty = totalTabCategories === 0 && uncategorizedTabItems.length === 0;
  const searchReturnedNothing = !listIsEmpty && filteredTabCategories.length === 0 && !showUncategorized;
  const allCategoryIds = filteredTabCategories.map(c => c.id);
  const allCatsSelected = allCategoryIds.length > 0 && allCategoryIds.every(id => selectedCategoryIds.has(id));

  const toggleSelectAllCategories = () => {
    if (allCatsSelected) {
      setSelectedCategoryIds(new Set());
    } else {
      setSelectedCategoryIds(new Set(allCategoryIds));
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        {isSelectMode ? (
          <>
            <button
              onClick={exitSelectMode}
              className="text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors px-1 py-2 min-w-[52px]"
            >
              Cancel
            </button>
            <div className="flex-1 min-w-0 text-center">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                {selectedCount === 0 ? "Select categories" : `${selectedCount} selected`}
              </p>
            </div>
            <Button
              onClick={() => selectedCount > 0 && setShowBulkDeleteConfirm(true)}
              disabled={selectedCount === 0}
              variant="ghost"
              className={cn(
                "text-sm font-semibold min-w-[52px]",
                selectedCount > 0
                  ? "text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                  : "text-slate-300 dark:text-slate-600"
              )}
            >
              Delete{selectedCount > 0 ? ` (${selectedCount})` : ""}
            </Button>
          </>
        ) : (
          <>
            <Link href="/customize">
              <button className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <ChevronLeft className="h-5 w-5 text-slate-600 dark:text-slate-400" />
              </button>
            </Link>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Price Book</h1>
              <p className="text-slate-500 dark:text-slate-400 text-sm">
                {totalTabCategories} categor{totalTabCategories !== 1 ? 'ies' : 'y'} · {totalTabItems} {isMaterials ? "material" : "item"}{totalTabItems !== 1 ? 's' : ''}
              </p>
            </div>
            {!listIsEmpty && (
              <button
                onClick={() => { setIsSelectMode(true); setSelectedCategoryIds(new Set()); }}
                className="text-sm font-medium text-teal-600 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300 transition-colors px-2 py-2"
              >
                Select
              </button>
            )}
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
                  {addItemIcon}
                  <span className="font-medium">{addItemLabel}</span>
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
          </>
        )}
      </div>

      {/* Tab Toggle — hidden during select mode */}
      {!isSelectMode && (
        <div className="flex bg-slate-100 dark:bg-slate-800 rounded-xl p-1 mb-5">
          <button
            onClick={() => switchTab("line_items")}
            className={cn(
              "flex-1 py-2 text-sm font-semibold rounded-lg transition-all",
              activeTab === "line_items"
                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            )}
          >
            Line Items
          </button>
          <button
            onClick={() => switchTab("materials")}
            className={cn(
              "flex-1 py-2 text-sm font-semibold rounded-lg transition-all",
              activeTab === "materials"
                ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            )}
          >
            Materials
          </button>
        </div>
      )}

      {/* Search — hidden during select mode */}
      {!isSelectMode && (
        <div className="relative mb-5">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            type="text"
            placeholder={isMaterials ? "Search materials or categories..." : "Search items or categories..."}
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
      )}

      {/* Select-all row when in select mode with categories */}
      {isSelectMode && filteredTabCategories.length > 0 && (
        <button
          onClick={toggleSelectAllCategories}
          className="w-full flex items-center gap-3 px-1 pb-3 text-sm text-teal-600 dark:text-teal-400 font-medium hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
        >
          {allCatsSelected
            ? <CheckCircle2 className="h-4 w-4" />
            : <Circle className="h-4 w-4" />}
          {allCatsSelected ? "Deselect all" : "Select all"}
        </button>
      )}

      {/* Loading */}
      {isLoading || categoriesLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
        </div>

      ) : listIsEmpty ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 text-center py-14 px-6">
          {isMaterials
            ? <Package className="mx-auto h-12 w-12 text-slate-300 mb-3" />
            : <FolderOpen className="mx-auto h-12 w-12 text-slate-300 mb-3" />}
          <p className="text-slate-600 dark:text-slate-400 font-medium mb-1">
            {isMaterials ? "No materials yet" : "No line items yet"}
          </p>
          <p className="text-sm text-slate-400 dark:text-slate-500">
            {isMaterials
              ? "Use the Add button above to create a material or category"
              : "Use the Add button above to create an item or category"}
          </p>
        </div>

      ) : searchReturnedNothing ? (
        <div className="text-center py-14">
          <Search className="mx-auto h-10 w-10 text-slate-300 mb-3" />
          <p className="text-slate-500 dark:text-slate-400">No results for "{listSearch}"</p>
        </div>

      ) : (
        <div className="space-y-2">
          {filteredTabCategories.map(cat => {
            const count = tabItems.filter(item => (item as any).categoryId === cat.id).length;
            const isSelected = selectedCategoryIds.has(cat.id);
            return (
              <button
                key={cat.id}
                onClick={() => {
                  if (isSelectMode) {
                    toggleCategorySelection(cat.id);
                  } else {
                    setView({ type: "category", categoryId: cat.id, categoryName: cat.name });
                    setDetailSearch("");
                  }
                }}
                className={cn(
                  "w-full flex items-center gap-4 px-4 py-4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border transition-all text-left group",
                  isSelectMode
                    ? isSelected
                      ? "border-teal-400 dark:border-teal-500 bg-teal-50 dark:bg-teal-900/20"
                      : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                    : "border-slate-200 dark:border-slate-700 hover:border-teal-300 dark:hover:border-teal-600 hover:shadow-md"
                )}
              >
                {isSelectMode && (
                  <div className="flex-shrink-0">
                    {isSelected
                      ? <CheckCircle2 className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                      : <Circle className="h-5 w-5 text-slate-300 dark:text-slate-600" />}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {cat.name}
                  </div>
                  <div className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                    {count === 0
                      ? (isMaterials ? "No materials" : "No items")
                      : `${count} ${isMaterials ? "material" : "item"}${count !== 1 ? 's' : ''}`}
                  </div>
                </div>
                {!isSelectMode && (
                  <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-teal-500 transition-colors flex-shrink-0" />
                )}
              </button>
            );
          })}

          {/* Uncategorized row — not selectable; user enters and selects items individually */}
          {showUncategorized && !isSelectMode && (
            <button
              onClick={() => { setView({ type: "uncategorized" }); setDetailSearch(""); }}
              className="w-full flex items-center gap-4 px-4 py-4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-500 hover:shadow-md transition-all text-left group"
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-700 dark:text-slate-300 truncate">
                  Uncategorized
                </div>
                <div className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {uncategorizedTabItems.length} {isMaterials ? "material" : "item"}{uncategorizedTabItems.length !== 1 ? 's' : ''}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors flex-shrink-0" />
            </button>
          )}
        </div>
      )}

      {itemDialog()}
      {categoryDialog()}
      {bulkDeleteConfirmDialog()}
    </div>
  );

  // ── Dialog renderers ───────────────────────────────────────────

  function bulkDeleteConfirmDialog() {
    const isDetailView = view.type === "category" || view.type === "uncategorized";
    return (
      <AlertDialog open={showBulkDeleteConfirm} onOpenChange={setShowBulkDeleteConfirm}>
        <AlertDialogContent className="ecologic-alert-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isDetailView
                ? `Delete ${selectedCount} ${activeTab === "materials" ? "material" : "item"}${selectedCount !== 1 ? 's' : ''}?`
                : `Delete ${selectedCount} categor${selectedCount !== 1 ? 'ies' : 'y'}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkDeleteMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isBulkDeleting
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting...</>
                : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  function itemDialog() {
    const isMat = formData.itemType === "material";
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
                ? (isMat ? "Edit Material" : "Edit Item")
                : (isMat ? "Add Material" : "Add Item")}
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
                    {tabCategories.map(cat => (
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
              {editingItem ? "Save Changes" : (isMat ? "Add Material" : "Add Item")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  function categoryDialog() {
    const dialogTitle = isMaterials ? "Material Categories" : "Line Item Categories";
    return (
      <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
        <DialogContent className="ecologic-dialog w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden" hideCloseButton>
          <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
            <div className="min-w-[44px]" />
            <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {dialogTitle}
            </DialogTitle>
            <button
              onClick={() => setIsCategoryDialogOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="px-4 py-5 bg-white dark:bg-slate-900 overflow-y-auto max-h-[65vh] space-y-5">
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
                      createCategoryMutation.mutate({ name: newCategoryName.trim(), categoryType: tabItemType });
                    }
                  }}
                />
                <Button
                  onClick={() => {
                    if (newCategoryName.trim()) {
                      createCategoryMutation.mutate({ name: newCategoryName.trim(), categoryType: tabItemType });
                    }
                  }}
                  disabled={!newCategoryName.trim() || createCategoryMutation.isPending}
                  className="h-10 bg-teal-600 hover:bg-teal-700 rounded-xl px-4 flex-shrink-0"
                >
                  {createCategoryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {categoriesLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
              </div>
            ) : tabCategories.length === 0 ? (
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
                  {tabCategories.map(cat => {
                    const itemCount = tabItems.filter(item => (item as any).categoryId === cat.id).length;
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
                              <span className="ml-2 text-xs text-slate-400">
                                {itemCount} {isMaterials ? "material" : "item"}{itemCount !== 1 ? 's' : ''}
                              </span>
                            </div>
                            <button
                              onClick={() => { setRenamingCategoryId(cat.id); setRenamingCategoryName(cat.name); }}
                              className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-all"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
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
