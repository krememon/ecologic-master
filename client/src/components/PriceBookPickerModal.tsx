import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Plus, Check, Loader2, Package, X, ChevronLeft, ChevronRight, FolderOpen, ListPlus, Tag } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { ServiceCatalogItem, PricebookCategory } from "@shared/schema";

interface LineItem {
  name: string;
  description: string;
  taskCode: string;
  quantity: string;
  unitPriceCents: number;
  priceDisplay: string;
  unit: string;
  taxable: boolean;
  taxId: number | null;
  taxRatePercentSnapshot: string | null;
  taxNameSnapshot: string | null;
  saveToPriceBook: boolean;
  priceBookItemId?: number | null;
}

interface PriceBookPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddItem: (item: LineItem) => void;
  onRemoveItemByPriceBookId?: (priceBookItemId: number) => void;
  existingItems: LineItem[];
}

const UNIT_OPTIONS = [
  { value: "each", label: "Each" },
  { value: "hour", label: "Hour" },
  { value: "ft", label: "Foot" },
  { value: "sq_ft", label: "Sq Ft" },
  { value: "job", label: "Job" },
  { value: "day", label: "Day" },
];

type PickerTab = "line_items" | "materials";
type InnerView =
  | { type: "list" }
  | { type: "detail"; categoryId: number | "uncategorized"; categoryName: string };

export function PriceBookPickerModal({
  open,
  onOpenChange,
  onAddItem,
  onRemoveItemByPriceBookId,
  existingItems,
}: PriceBookPickerModalProps) {
  const { toast } = useToast();

  // ── Navigation & tab state ──────────────────────────────────────
  const [activeTab, setActiveTab] = useState<PickerTab>("line_items");
  const [innerView, setInnerView] = useState<InnerView>({ type: "list" });
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);

  // ── Selection state ────────────────────────────────────────────
  const [selectedItemIds, setSelectedItemIds] = useState<Set<number>>(new Set());
  const [initialSelectedIds, setInitialSelectedIds] = useState<Set<number>>(new Set());

  // ── Session-only items (created with Save to Price Book OFF) ───
  const [sessionItems, setSessionItems] = useState<ServiceCatalogItem[]>([]);

  // ── Create form state ──────────────────────────────────────────
  const [priceDisplay, setPriceDisplay] = useState("");
  const [saveToBook, setSaveToBook] = useState(false);
  const [newItem, setNewItem] = useState({
    name: "",
    description: "",
    taskCode: "",
    defaultPriceCents: 0,
    unit: "each",
    categoryId: null as number | null,
    taxable: false,
    itemType: "line_item" as "line_item" | "material",
  });

  // ── Queries ────────────────────────────────────────────────────
  const { data: catalogItems = [], isLoading } = useQuery<ServiceCatalogItem[]>({
    queryKey: ['/api/service-catalog'],
    enabled: open,
  });

  const { data: categories = [] } = useQuery<PricebookCategory[]>({
    queryKey: ['/api/service-catalog/categories'],
    enabled: open,
  });

  // ── Sync initial selections from existing items ────────────────
  useEffect(() => {
    if (open && catalogItems.length > 0) {
      const matchingIds = new Set<number>();
      for (const existingItem of existingItems) {
        if (existingItem.priceBookItemId) matchingIds.add(existingItem.priceBookItemId);
      }
      setSelectedItemIds(matchingIds);
      setInitialSelectedIds(matchingIds);
    }
  }, [open, catalogItems, existingItems]);

  // ── Reset when modal closes ────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setActiveTab("line_items");
      setInnerView({ type: "list" });
      setShowCreateForm(false);
      setSelectedItemIds(new Set());
      setInitialSelectedIds(new Set());
      setSessionItems([]);
      resetCreateForm();
    }
  }, [open]);

  // ── Derived: items and categories scoped to active tab ─────────
  const tabItemType: "line_item" | "material" = activeTab === "materials" ? "material" : "line_item";

  // Merge real catalog items with session-only (one-time) items
  const allItems = [...catalogItems, ...sessionItems];

  const tabItems = allItems.filter(
    item => ((item as any).itemType ?? "line_item") === tabItemType
  );

  const tabCategories = categories.filter(
    cat => ((cat as any).categoryType ?? "line_item") === tabItemType
  );

  const uncategorizedTabItems = tabItems.filter(item => !(item as any).categoryId);

  // Items shown in the current detail view
  const detailItems = innerView.type === "detail"
    ? innerView.categoryId === "uncategorized"
      ? uncategorizedTabItems
      : tabItems.filter(item => (item as any).categoryId === innerView.categoryId)
    : [];

  // When searching: flat list across all tab items
  const searchLower = searchQuery.trim().toLowerCase();
  const searchResults = searchLower
    ? tabItems.filter(
        item =>
          item.name.toLowerCase().includes(searchLower) ||
          (item.description && item.description.toLowerCase().includes(searchLower))
      )
    : [];

  const isSearching = searchLower.length > 0;

  // ── Helpers ────────────────────────────────────────────────────
  const formatCurrency = (cents: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

  const handleToggleSelection = (item: ServiceCatalogItem) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      next.has(item.id) ? next.delete(item.id) : next.add(item.id);
      return next;
    });
  };

  const handleDone = () => {
    for (const itemId of selectedItemIds) {
      if (!initialSelectedIds.has(itemId)) {
        // Look in both real catalog items and session-only items
        const foundItem = allItems.find(c => c.id === itemId);
        if (foundItem) {
          const isSessionItem = itemId < 0; // session items have negative IDs
          const lineItem: LineItem = {
            name: foundItem.name,
            description: foundItem.description || "",
            taskCode: (foundItem as any).taskCode || "",
            quantity: "1",
            unitPriceCents: foundItem.defaultPriceCents,
            priceDisplay: (foundItem.defaultPriceCents / 100).toFixed(2),
            unit: foundItem.unit,
            taxable: (foundItem as any).taxable ?? false,
            taxId: null,
            taxRatePercentSnapshot: null,
            taxNameSnapshot: null,
            saveToPriceBook: false,
            priceBookItemId: isSessionItem ? null : foundItem.id,
          };
          onAddItem(lineItem);
        }
      }
    }
    if (onRemoveItemByPriceBookId) {
      for (const itemId of initialSelectedIds) {
        if (!selectedItemIds.has(itemId)) onRemoveItemByPriceBookId(itemId);
      }
    }
    onOpenChange(false);
  };

  const switchTab = (tab: PickerTab) => {
    setActiveTab(tab);
    setInnerView({ type: "list" });
    setSearchQuery("");
  };

  const goToCategory = (categoryId: number | "uncategorized", categoryName: string) => {
    setInnerView({ type: "detail", categoryId, categoryName });
    setSearchQuery("");
  };

  const goBack = () => {
    setInnerView({ type: "list" });
    setSearchQuery("");
  };

  // ── Create form helpers ────────────────────────────────────────
  const resetCreateForm = () => {
    setNewItem({ name: "", description: "", taskCode: "", defaultPriceCents: 0, unit: "each", categoryId: null, taxable: false, itemType: "line_item" });
    setPriceDisplay("");
    setSaveToBook(false);
  };

  const createMutation = useMutation({
    mutationFn: async (data: typeof newItem) => {
      const res = await apiRequest("POST", "/api/service-catalog", data);
      return res.json();
    },
    onSuccess: (createdItem: ServiceCatalogItem) => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-catalog"] });
      const lineItem: LineItem = {
        name: createdItem.name,
        description: createdItem.description || "",
        taskCode: (createdItem as any).taskCode || "",
        quantity: "1",
        unitPriceCents: createdItem.defaultPriceCents,
        priceDisplay: (createdItem.defaultPriceCents / 100).toFixed(2),
        unit: createdItem.unit,
        taxable: (createdItem as any).taxable ?? false,
        taxId: null,
        taxRatePercentSnapshot: null,
        taxNameSnapshot: null,
        saveToPriceBook: false,
        priceBookItemId: createdItem.id,
      };
      onAddItem(lineItem);
      setSelectedItemIds(prev => new Set(prev).add(createdItem.id));
      setInitialSelectedIds(prev => new Set(prev).add(createdItem.id));
      resetCreateForm();
      setShowCreateForm(false);
    },
    onError: () => toast({ title: "Error", description: "Failed to create item", variant: "destructive" }),
  });

  const handleCreateItem = () => {
    if (!newItem.name.trim()) {
      toast({ title: "Error", description: "Name is required", variant: "destructive" });
      return;
    }

    if (saveToBook) {
      // Save to Price Book, then add to job/estimate with the real priceBookItemId
      createMutation.mutate({ ...newItem, itemType: tabItemType });
    } else {
      // One-time item: inject into the session list so the user can see/select it,
      // but never persist to the Price Book catalog.
      // Use a negative timestamp-based ID to avoid any conflict with real DB IDs.
      const fakeId = -Date.now();
      const sessionItem = {
        id: fakeId,
        companyId: 0,
        name: newItem.name.trim(),
        description: newItem.description.trim() || null,
        taskCode: newItem.taskCode.trim() || null,
        defaultPriceCents: newItem.defaultPriceCents,
        unit: newItem.unit,
        taxable: newItem.taxable,
        categoryId: null, // one-time items have no category
        itemType: tabItemType,
        createdAt: new Date().toISOString(),
      } as unknown as ServiceCatalogItem;

      setSessionItems(prev => [...prev, sessionItem]);
      // Pre-select the item so it gets added when the user taps Done
      setSelectedItemIds(prev => new Set([...prev, fakeId]));
      // Navigate the picker to the uncategorized section so the item is immediately visible
      setInnerView({ type: "detail", categoryId: "uncategorized", categoryName: "Uncategorized" });
      resetCreateForm();
      setShowCreateForm(false);
    }
  };

  const handlePriceChange = (value: string) => {
    const stripped = value.replace(/,/g, "");
    const clean = stripped.replace(/[^0-9.]/g, "");
    const parts = clean.split(".");
    const sanitized = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : clean;
    const dollars = parseFloat(sanitized) || 0;
    setNewItem(n => ({ ...n, defaultPriceCents: Math.round(dollars * 100) }));
    if (sanitized === "" || sanitized === ".") { setPriceDisplay(sanitized); return; }
    const dec = sanitized.split(".");
    const intFmt = dec[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    setPriceDisplay(dec.length > 1 ? `${intFmt}.${dec[1]}` : intFmt);
  };

  const handlePriceBlur = () => {
    const d = newItem.defaultPriceCents / 100;
    setPriceDisplay(d === 0 ? "" : d.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  };

  const handlePriceFocus = () => {
    const d = newItem.defaultPriceCents / 100;
    if (d === 0) { setPriceDisplay(""); return; }
    const f = d.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    setPriceDisplay(f.endsWith(".00") ? f.slice(0, -3) : f);
  };

  // ── Create form screen ─────────────────────────────────────────
  if (showCreateForm) {
    const isMat = activeTab === "materials";
    const tabCatsForCreate = tabCategories;
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="ecologic-dialog w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden" hideCloseButton>
          <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
            <button
              onClick={() => { resetCreateForm(); setShowCreateForm(false); }}
              className="text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 min-w-[44px] py-2"
            >
              Cancel
            </button>
            <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {isMat ? "New Material" : "New Line Item"}
            </DialogTitle>
            <div className="min-w-[44px]" />
          </div>

          <div className="space-y-3 px-4 py-4 bg-white dark:bg-slate-900 overflow-y-auto max-h-[65vh]">
            <div className="space-y-1.5">
              <Label htmlFor="ci-name" className="text-sm font-medium text-slate-700 dark:text-slate-300">Name *</Label>
              <Input
                id="ci-name"
                value={newItem.name}
                onChange={(e) => setNewItem(n => ({ ...n, name: e.target.value }))}
                placeholder="Name"
                className="h-10 rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ci-desc" className="text-sm font-medium text-slate-700 dark:text-slate-300">Description</Label>
              <Textarea
                id="ci-desc"
                value={newItem.description}
                onChange={(e) => setNewItem(n => ({ ...n, description: e.target.value }))}
                placeholder="Description"
                rows={2}
                className="rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ci-price" className="text-sm font-medium text-slate-700 dark:text-slate-300">Price *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                  <Input
                    id="ci-price"
                    type="text"
                    className="pl-7 h-10 rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                    value={priceDisplay}
                    onChange={(e) => handlePriceChange(e.target.value)}
                    onBlur={handlePriceBlur}
                    onFocus={handlePriceFocus}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ci-unit" className="text-sm font-medium text-slate-700 dark:text-slate-300">Unit</Label>
                <Select value={newItem.unit} onValueChange={(v) => setNewItem(n => ({ ...n, unit: v }))}>
                  <SelectTrigger id="ci-unit" className="h-10 rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNIT_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ci-taskcode" className="text-sm font-medium text-slate-700 dark:text-slate-300">Task Code</Label>
                <Input
                  id="ci-taskcode"
                  value={newItem.taskCode}
                  onChange={(e) => setNewItem(n => ({ ...n, taskCode: e.target.value }))}
                  placeholder="Task Code"
                  className="h-10 rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                />
              </div>
              {saveToBook && tabCatsForCreate.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="ci-cat" className="text-sm font-medium text-slate-700 dark:text-slate-300">Category</Label>
                  <Select
                    value={newItem.categoryId ? String(newItem.categoryId) : "none"}
                    onValueChange={(v) => setNewItem(n => ({ ...n, categoryId: v === "none" ? null : parseInt(v) }))}
                  >
                    <SelectTrigger id="ci-cat" className="h-10 rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {tabCatsForCreate.map(cat => (
                        <SelectItem key={cat.id} value={String(cat.id)}>{cat.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Save to Price Book toggle */}
            <div className="flex items-center justify-between pt-1 pb-1">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Save to Price Book</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                  {saveToBook ? "Will be saved for future reuse" : "One-time only — won't be saved"}
                </p>
              </div>
              <Switch
                checked={saveToBook}
                onCheckedChange={setSaveToBook}
                className="ml-4 flex-shrink-0"
              />
            </div>
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
            <button
              onClick={() => { resetCreateForm(); setShowCreateForm(false); }}
              className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors px-2 py-2"
            >
              Cancel
            </button>
            <Button
              onClick={handleCreateItem}
              disabled={createMutation.isPending}
              className="h-10 rounded-xl bg-teal-600 hover:bg-teal-700 px-6"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {saveToBook ? "Save & Add" : "Add"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Main picker: category list or category detail ──────────────

  const isMaterials = activeTab === "materials";
  const isDetailView = innerView.type === "detail";
  const selectionCount = selectedItemIds.size;

  // What to render in the scroll area
  const renderContent = () => {
    // ── Search mode: flat filtered list ──────────────────────────
    if (isSearching) {
      if (isLoading) return <LoadingSkeletons />;
      if (searchResults.length === 0) {
        return (
          <div className="flex flex-col items-center justify-center py-14 px-4">
            <Search className="h-10 w-10 text-slate-300 mb-3" />
            <p className="font-medium text-slate-500 dark:text-slate-400 text-center">
              No results for "{searchQuery}"
            </p>
            <p className="text-sm text-slate-400 mt-1">Try a different search term</p>
          </div>
        );
      }
      return (
        <div className="py-1">
          {searchResults.map((item, index) => {
            const isSelected = selectedItemIds.has(item.id);
            const catName = categories.find(c => c.id === (item as any).categoryId)?.name;
            return (
              <ItemRow
                key={item.id}
                item={item}
                isSelected={isSelected}
                isSessionItem={item.id < 0}
                subtitle={`${formatCurrency(item.defaultPriceCents)} per ${UNIT_OPTIONS.find(u => u.value === item.unit)?.label.toLowerCase() || item.unit}${catName ? ` · ${catName}` : ""}`}
                onToggle={() => handleToggleSelection(item)}
                showDivider={index < searchResults.length - 1}
              />
            );
          })}
        </div>
      );
    }

    // ── Category list view ────────────────────────────────────────
    if (!isDetailView) {
      if (isLoading) return <LoadingSkeletons />;
      const hasAnything = tabCategories.length > 0 || uncategorizedTabItems.length > 0;
      if (!hasAnything) {
        return (
          <div className="flex flex-col items-center justify-center py-14 px-4">
            {isMaterials
              ? <Package className="h-10 w-10 text-slate-300 mb-3" />
              : <FolderOpen className="h-10 w-10 text-slate-300 mb-3" />}
            <p className="font-medium text-slate-500 dark:text-slate-400 text-center">
              {isMaterials ? "No materials in your price book" : "No line items in your price book"}
            </p>
            <p className="text-sm text-slate-400 mt-1">Create your first one above</p>
          </div>
        );
      }
      return (
        <div className="py-1">
          {tabCategories.map((cat, index) => {
            const count = tabItems.filter(item => (item as any).categoryId === cat.id).length;
            const selectedInCat = tabItems.filter(item => (item as any).categoryId === cat.id && selectedItemIds.has(item.id)).length;
            return (
              <div key={cat.id}>
                <button
                  onClick={() => goToCategory(cat.id, cat.name)}
                  className="w-full flex items-center justify-between px-4 min-h-[56px] text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{cat.name}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {count} {isMaterials ? "material" : "item"}{count !== 1 ? "s" : ""}
                      {selectedInCat > 0 && (
                        <span className="ml-2 text-teal-600 dark:text-teal-400 font-medium">
                          · {selectedInCat} selected
                        </span>
                      )}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0 ml-3" />
                </button>
                {(index < tabCategories.length - 1 || uncategorizedTabItems.length > 0) && (
                  <div className="h-px bg-slate-100 dark:bg-slate-800 mx-4" />
                )}
              </div>
            );
          })}

          {/* Uncategorized */}
          {uncategorizedTabItems.length > 0 && (
            <button
              onClick={() => goToCategory("uncategorized", "Uncategorized")}
              className="w-full flex items-center justify-between px-4 min-h-[56px] text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-700 dark:text-slate-300">Uncategorized</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {uncategorizedTabItems.length} {isMaterials ? "material" : "item"}{uncategorizedTabItems.length !== 1 ? "s" : ""}
                  {(() => {
                    const sel = uncategorizedTabItems.filter(i => selectedItemIds.has(i.id)).length;
                    return sel > 0 ? <span className="ml-2 text-teal-600 dark:text-teal-400 font-medium">· {sel} selected</span> : null;
                  })()}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0 ml-3" />
            </button>
          )}
        </div>
      );
    }

    // ── Category detail view ──────────────────────────────────────
    if (isLoading) return <LoadingSkeletons />;
    if (detailItems.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-14 px-4">
          {isMaterials
            ? <Package className="h-10 w-10 text-slate-300 mb-3" />
            : <Tag className="h-10 w-10 text-slate-300 mb-3" />}
          <p className="font-medium text-slate-500 dark:text-slate-400 text-center">
            {isMaterials ? "No materials in this category" : "No items in this category"}
          </p>
        </div>
      );
    }
    return (
      <div className="py-1">
        {detailItems.map((item, index) => {
          const isSelected = selectedItemIds.has(item.id);
          return (
            <ItemRow
              key={item.id}
              item={item}
              isSelected={isSelected}
              isSessionItem={item.id < 0}
              subtitle={`${formatCurrency(item.defaultPriceCents)} per ${UNIT_OPTIONS.find(u => u.value === item.unit)?.label.toLowerCase() || item.unit}`}
              onToggle={() => handleToggleSelection(item)}
              showDivider={index < detailItems.length - 1}
            />
          );
        })}
      </div>
    );
  };

  // ── Dynamic header title ───────────────────────────────────────
  const headerTitle = isDetailView
    ? innerView.categoryName
    : isMaterials ? "Add Materials" : "Add Line Items";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="ecologic-dialog w-[95vw] max-w-md p-0 gap-0 max-h-[88vh] flex flex-col rounded-2xl overflow-hidden"
        hideCloseButton
        preventAutoFocus
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex-shrink-0">
          {isDetailView ? (
            <button
              onClick={goBack}
              className="flex items-center gap-1 text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 transition-colors min-w-[44px] py-2"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="text-sm font-medium">Back</span>
            </button>
          ) : (
            <div className="min-w-[44px]" />
          )}
          <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate px-2">
            {headerTitle}
          </DialogTitle>
          <button
            onClick={() => onOpenChange(false)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Tab toggle (only on list view) ── */}
        {!isDetailView && !isSearching && (
          <div className="px-4 pt-3 pb-0 bg-white dark:bg-slate-900 flex-shrink-0">
            <div className="flex bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
              <button
                onClick={() => switchTab("line_items")}
                className={cn(
                  "flex-1 py-1.5 text-sm font-semibold rounded-lg transition-all",
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
                  "flex-1 py-1.5 text-sm font-semibold rounded-lg transition-all",
                  activeTab === "materials"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                )}
              >
                Materials
              </button>
            </div>
          </div>
        )}

        {/* ── Search bar ── */}
        <div className="px-4 pt-3 pb-2 bg-white dark:bg-slate-900 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder={isMaterials ? "Search materials..." : "Search line items..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-10 bg-slate-100 dark:bg-slate-800 border-0 rounded-xl text-sm placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-0"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="h-px bg-slate-100 dark:bg-slate-800 flex-shrink-0" />

        {/* ── Create button (list view only, not when searching) ── */}
        {!isDetailView && !isSearching && (
          <>
            <button
              className="w-full flex items-center gap-3 px-4 min-h-[52px] text-left hover:bg-teal-50 dark:hover:bg-teal-950/30 active:bg-teal-100 transition-colors flex-shrink-0"
              onClick={() => setShowCreateForm(true)}
            >
              <div className="w-8 h-8 rounded-full bg-teal-600 flex items-center justify-center flex-shrink-0">
                <Plus className="h-4 w-4 text-white" />
              </div>
              <span className="font-semibold text-teal-600 dark:text-teal-400 text-sm">
                {isMaterials ? "Create New Material" : "Create New Line Item"}
              </span>
            </button>
            <div className="h-px bg-slate-100 dark:bg-slate-800 flex-shrink-0" />
          </>
        )}

        {/* ── Scroll content ── */}
        <ScrollArea className="flex-1 min-h-0 bg-white dark:bg-slate-900">
          {renderContent()}
        </ScrollArea>

        {/* ── Footer ── */}
        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex-shrink-0">
          <Button
            onClick={handleDone}
            className="w-full h-12 rounded-xl font-semibold bg-teal-600 hover:bg-teal-700"
          >
            Done{selectionCount > 0 ? ` (${selectionCount} selected)` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function ItemRow({
  item,
  isSelected,
  subtitle,
  onToggle,
  showDivider,
  isSessionItem = false,
}: {
  item: ServiceCatalogItem;
  isSelected: boolean;
  subtitle: string;
  onToggle: () => void;
  showDivider: boolean;
  isSessionItem?: boolean;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className={cn(
          "w-full flex items-center justify-between px-4 min-h-[56px] text-left transition-colors",
          isSelected
            ? "bg-teal-50 dark:bg-teal-900/20"
            : "hover:bg-slate-50 dark:hover:bg-slate-800/50 active:bg-slate-100 dark:active:bg-slate-800"
        )}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">{item.name}</p>
            {isSessionItem && (
              <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded">
                One-time
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{subtitle}</p>
        </div>
        {isSelected && <Check className="h-5 w-5 text-teal-500 flex-shrink-0 ml-3" />}
      </button>
      {showDivider && <div className="h-px bg-slate-100 dark:bg-slate-800 mx-4" />}
    </div>
  );
}

function LoadingSkeletons() {
  return (
    <div className="py-2">
      {[1, 2, 3].map(i => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
            <div className="h-3 w-24 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
