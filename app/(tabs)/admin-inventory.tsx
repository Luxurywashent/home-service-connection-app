import React, { useState, useMemo, useCallback } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Modal,
  FlatList, Alert, ActivityIndicator, RefreshControl, StyleSheet,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";

// ─── Types ────────────────────────────────────────────────────────────────────
type Tab = "dashboard" | "inventory" | "locations" | "vans" | "restock" | "reports";
type ActionMode = "add" | "remove" | "adjust" | "transfer" | null;
type LocType = "warehouse" | "location" | "van";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function locLabel(type: LocType, id: string, locations: any[], vans: any[]) {
  if (type === "warehouse") return "🏭 Warehouse";
  if (type === "location") return "🟦 " + (locations.find((l) => l.locationId === id)?.name ?? id);
  return "🚐 " + (vans.find((v) => v.vanId === id)?.name ?? id);
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminInventoryScreen() {
  const colors = useColors();
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [refreshing, setRefreshing] = useState(false);

  // Queries
  const categoriesQ = trpc.inventory.getCategories.useQuery();
  const itemsQ = trpc.inventory.getItems.useQuery();
  const stockQ = trpc.inventory.getStockWithDetails.useQuery();
  const locationsQ = trpc.inventory.getLocations.useQuery();
  const vansQ = trpc.inventory.getVans.useQuery();
  const lowStockQ = trpc.inventory.getLowStock.useQuery();
  const txQ = trpc.inventory.getTransactions.useQuery({ limit: 200 });
  const usageQ = trpc.inventory.getUsageSummary.useQuery({ days: 30 });

  const utils = trpc.useUtils();
  const seedMut = trpc.inventory.seed.useMutation({ onSuccess: () => { utils.inventory.getCategories.invalidate(); utils.inventory.getItems.invalidate(); } });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      utils.inventory.getCategories.invalidate(),
      utils.inventory.getItems.invalidate(),
      utils.inventory.getStockWithDetails.invalidate(),
      utils.inventory.getLocations.invalidate(),
      utils.inventory.getVans.invalidate(),
      utils.inventory.getLowStock.invalidate(),
      utils.inventory.getTransactions.invalidate(),
      utils.inventory.getUsageSummary.invalidate(),
    ]);
    setRefreshing(false);
  }, [utils]);

  const categories = categoriesQ.data ?? [];
  const items = itemsQ.data ?? [];
  const stock = stockQ.data ?? [];
  const locations = locationsQ.data ?? [];
  const vans = vansQ.data ?? [];
  const lowStock = lowStockQ.data ?? [];
  const transactions = txQ.data ?? [];
  const usage = usageQ.data ?? [];

  const isLoading = categoriesQ.isLoading || itemsQ.isLoading || stockQ.isLoading;

  // Auto-seed if empty
  React.useEffect(() => {
    if (!categoriesQ.isLoading && categories.length === 0 && !seedMut.isPending) {
      seedMut.mutate();
    }
  }, [categoriesQ.isLoading, categories.length]);

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "dashboard", label: "Dashboard", icon: "📊" },
    { key: "inventory", label: "Inventory", icon: "📋" },
    { key: "locations", label: "Locations", icon: "🟦" },
    { key: "vans", label: "Vans", icon: "🚐" },
    { key: "restock", label: "Restock", icon: "⚠️" },
    { key: "reports", label: "Reports", icon: "📊" },
  ];

  return (
    <ScreenContainer containerClassName="bg-background" edges={["left", "right"]}>
      {/* Compact Header */}
      <View style={[styles.header, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Inventory</Text>
        {lowStock.length > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{lowStock.length}</Text>
          </View>
        )}
      </View>

      {/* Tab Bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.tabBar, { borderBottomColor: colors.border }]} contentContainerStyle={styles.tabBarContent}>
        {tabs.map((t) => (
          <TouchableOpacity
            key={t.key}
            onPress={() => setActiveTab(t.key)}
            style={[styles.tabBtn, activeTab === t.key && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          >
            <Text style={styles.tabIcon}>{t.icon}</Text>
            <Text style={[styles.tabLabel, { color: activeTab === t.key ? colors.primary : colors.muted }]}>{t.label}</Text>
            {t.key === "restock" && lowStock.length > 0 && (
              <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{lowStock.length}</Text></View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {activeTab === "dashboard" && <DashboardTab stock={stock} lowStock={lowStock} categories={categories} items={items} locations={locations} vans={vans} transactions={transactions} />}
          {activeTab === "inventory" && <InventoryTab categories={categories} items={items} stock={stock} locations={locations} vans={vans} utils={utils} />}
          {activeTab === "locations" && <LocationsTab locations={locations} vans={vans} utils={utils} />}
          {activeTab === "vans" && <VansTab vans={vans} locations={locations} utils={utils} />}
          {activeTab === "restock" && <RestockTab lowStock={lowStock} locations={locations} vans={vans} />}
          {activeTab === "reports" && <ReportsTab stock={stock} transactions={transactions} usage={usage} categories={categories} items={items} locations={locations} vans={vans} />}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

// ─── Inventory Tab ────────────────────────────────────────────────────────────
function InventoryTab({ categories, items, stock, locations, vans, utils }: any) {
  const colors = useColors();
  const [search, setSearch] = useState("");
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [actionItem, setActionItem] = useState<any | null>(null);
  const [actionMode, setActionMode] = useState<ActionMode>(null);
  const [showAddCat, setShowAddCat] = useState(false);
  const [showAddItem, setShowAddItem] = useState<string | null>(null); // categoryId
  const [editCat, setEditCat] = useState<any | null>(null);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<{ type: LocType; id: string; name: string }>({ type: "warehouse", id: "warehouse", name: "Warehouse" });
  const [showAssignPicker, setShowAssignPicker] = useState(false);

  const isWarehouse = selectedLocation.type === "warehouse";

  const createCatMut = trpc.inventory.createCategory.useMutation({ onSuccess: () => utils.inventory.getCategories.invalidate() });
  const updateCatMut = trpc.inventory.updateCategory.useMutation({ onSuccess: () => utils.inventory.getCategories.invalidate() });
  const deleteCatMut = trpc.inventory.deleteCategory.useMutation({ onSuccess: () => { utils.inventory.getCategories.invalidate(); utils.inventory.getItems.invalidate(); utils.inventory.getStockWithDetails.invalidate(); } });
  const createItemMut = trpc.inventory.createItem.useMutation({ onSuccess: () => utils.inventory.getItems.invalidate() });
  const updateItemMut = trpc.inventory.updateItem.useMutation({ onSuccess: () => utils.inventory.getItems.invalidate() });
  const deleteItemMut = trpc.inventory.deleteItem.useMutation({ onSuccess: () => { utils.inventory.getItems.invalidate(); utils.inventory.getStockWithDetails.invalidate(); } });
  const assignMut = trpc.inventory.assignItemToLocation.useMutation({ onSuccess: () => utils.inventory.getStockWithDetails.invalidate() });
  const unassignMut = trpc.inventory.unassignItemFromLocation.useMutation({ onSuccess: () => utils.inventory.getStockWithDetails.invalidate() });

  // For non-warehouse: set of itemIds that have a stock row at this location
  const assignedItemIds = useMemo(() => {
    if (isWarehouse) return null;
    return new Set(
      stock
        .filter((s: any) => s.locationType === selectedLocation.type && s.locationId === selectedLocation.id)
        .map((s: any) => s.itemId)
    );
  }, [stock, selectedLocation, isWarehouse]);

  const getQty = (itemId: string) => {
    const s = stock.find((s: any) => s.itemId === itemId && s.locationType === selectedLocation.type && s.locationId === selectedLocation.id);
    return s?.quantity ?? 0;
  };
  const isLow = (itemId: string) => {
    const s = stock.find((s: any) => s.itemId === itemId && s.locationType === selectedLocation.type && s.locationId === selectedLocation.id);
    return s ? s.isLowStock : false;
  };

  const getVisibleItems = (cat: any) => {
    let catItems = items.filter((i: any) => i.categoryId === cat.categoryId);
    if (!isWarehouse && assignedItemIds) {
      catItems = catItems.filter((i: any) => assignedItemIds.has(i.itemId));
    }
    if (search) {
      const q = search.toLowerCase();
      catItems = catItems.filter((i: any) => i.name.toLowerCase().includes(q) || cat.name.toLowerCase().includes(q));
    }
    return catItems;
  };

  const filteredCats = useMemo(() => {
    const q = search.toLowerCase();
    return categories.filter((c: any) => {
      const visible = getVisibleItems(c);
      if (!isWarehouse && !search && visible.length === 0) return false;
      if (search) return c.name.toLowerCase().includes(q) || visible.length > 0;
      return true;
    });
  }, [categories, items, search, assignedItemIds, isWarehouse]);

  // Items not yet assigned to this location (for the assign picker)
  const unassignedItems = useMemo(() => {
    if (isWarehouse || !assignedItemIds) return [];
    return items.filter((i: any) => !assignedItemIds.has(i.itemId));
  }, [items, assignedItemIds, isWarehouse]);

  const locationOptions: { type: LocType; id: string; name: string }[] = [
    { type: "warehouse", id: "warehouse", name: "🏭 Warehouse" },
    ...locations.map((l: any) => ({ type: "location" as LocType, id: l.locationId, name: `🟦 ${l.name}` })),
    ...vans.map((v: any) => ({ type: "van" as LocType, id: v.vanId, name: `🚐 ${v.name}` })),
  ];

  return (
    <View style={{ padding: 16 }}>
      {/* Location Selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        {locationOptions.map((opt) => (
          <TouchableOpacity
            key={opt.id}
            onPress={() => setSelectedLocation(opt)}
            style={[styles.locChip, { backgroundColor: selectedLocation.id === opt.id ? colors.primary : colors.surface, borderColor: colors.border }]}
          >
            <Text style={[styles.locChipText, { color: selectedLocation.id === opt.id ? "#fff" : colors.foreground }]}>{opt.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Search row with + button */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search items..."
          placeholderTextColor={colors.muted}
          style={[styles.searchInput, { flex: 1, marginBottom: 0, backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]}
        />
        {isWarehouse ? (
          <TouchableOpacity onPress={() => setShowAddCat(true)} style={[styles.plusBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.plusBtnText}>+</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => setShowAssignPicker(true)} style={[styles.plusBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.plusBtnText}>+</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Non-warehouse empty state */}
      {!isWarehouse && filteredCats.length === 0 && !search && (
        <View style={[styles.emptyBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 32, textAlign: "center", marginBottom: 8 }}>🟦</Text>
          <Text style={[styles.emptyText, { color: colors.muted, textAlign: "center" }]}>{"No items assigned to this location yet.\nTap + to add items from the warehouse catalog."}</Text>
        </View>
      )}

      {/* Categories */}
      {filteredCats.map((cat: any) => {
        const catItems = getVisibleItems(cat);
        const isExpanded = expandedCat === cat.categoryId;
        const lowCount = catItems.filter((i: any) => isLow(i.itemId)).length;
        return (
          <View key={cat.categoryId} style={[styles.catCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TouchableOpacity onPress={() => setExpandedCat(isExpanded ? null : cat.categoryId)} style={styles.catHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.catName, { color: colors.foreground }]}>{cat.name}</Text>
                <Text style={[styles.catMeta, { color: colors.muted }]}>{catItems.length} items{lowCount > 0 ? ` · ⚠️ ${lowCount} low` : ""}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                {isWarehouse && (
                  <>
                    <TouchableOpacity onPress={() => setEditCat(cat)} style={styles.iconBtn}>
                      <Text style={{ color: colors.muted, fontSize: 14 }}>✏️</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => Alert.alert("Delete Category", `Delete "${cat.name}" and all its items?`, [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteCatMut.mutate({ categoryId: cat.categoryId }) }])} style={styles.iconBtn}>
                      <Text style={{ color: colors.error, fontSize: 14 }}>🗑️</Text>
                    </TouchableOpacity>
                  </>
                )}
                <Text style={{ color: colors.muted, fontSize: 18 }}>{isExpanded ? "▲" : "▼"}</Text>
              </View>
            </TouchableOpacity>

            {isExpanded && (
              <View style={{ paddingTop: 8 }}>
                {catItems.map((item: any) => {
                  const qty = getQty(item.itemId);
                  const low = isLow(item.itemId);
                  return (
                    <View key={item.itemId} style={[styles.itemRow, { borderTopColor: colors.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.itemName, { color: colors.foreground }]}>{item.name}</Text>
                        <Text style={[styles.itemMeta, { color: low ? colors.warning : colors.muted }]}>
                          {low ? "⚠️ " : ""}Min: {item.minThreshold}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 4 }}>
                        <Text style={[styles.qty, { color: low ? colors.warning : colors.success }]}>{qty}</Text>
                        <View style={{ flexDirection: "row", gap: 6 }}>
                          <TouchableOpacity onPress={() => { setActionItem({ ...item, currentQty: qty }); setActionMode("add"); }} style={[styles.qtyBtn, { backgroundColor: colors.success }]}><Text style={styles.qtyBtnText}>+</Text></TouchableOpacity>
                          <TouchableOpacity onPress={() => { setActionItem({ ...item, currentQty: qty }); setActionMode("remove"); }} style={[styles.qtyBtn, { backgroundColor: colors.error }]}><Text style={styles.qtyBtnText}>−</Text></TouchableOpacity>
                          <TouchableOpacity onPress={() => { setActionItem({ ...item, currentQty: qty }); setActionMode("adjust"); }} style={[styles.qtyBtn, { backgroundColor: colors.primary }]}><Text style={styles.qtyBtnText}>✎</Text></TouchableOpacity>
                          <TouchableOpacity onPress={() => { setActionItem({ ...item, currentQty: qty }); setActionMode("transfer"); }} style={[styles.qtyBtn, { backgroundColor: colors.muted }]}><Text style={styles.qtyBtnText}>⇄</Text></TouchableOpacity>
                          {isWarehouse ? (
                            <>
                              <TouchableOpacity onPress={() => setEditItem(item)} style={[styles.qtyBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}><Text style={{ color: colors.muted, fontSize: 11 }}>✏️</Text></TouchableOpacity>
                              <TouchableOpacity onPress={() => Alert.alert("Delete Item", `Delete "${item.name}"?`, [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteItemMut.mutate({ itemId: item.itemId }) }])} style={[styles.qtyBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}><Text style={{ color: colors.error, fontSize: 11 }}>🗑️</Text></TouchableOpacity>
                            </>
                          ) : (
                            <TouchableOpacity
                              onPress={() => Alert.alert("Remove from Location", `Remove "${item.name}" from this location?\nStock data will be lost.`, [{ text: "Cancel" }, { text: "Remove", style: "destructive", onPress: () => unassignMut.mutate({ itemId: item.itemId, locationType: selectedLocation.type as "location" | "van", locationId: selectedLocation.id }) }])}
                              style={[styles.qtyBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}
                            >
                              <Text style={{ color: colors.error, fontSize: 11 }}>✕</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })}
                {isWarehouse && (
                  <TouchableOpacity onPress={() => setShowAddItem(cat.categoryId)} style={[styles.addItemBtn, { borderColor: colors.border }]}>
                    <Text style={[styles.addItemBtnText, { color: colors.muted }]}>+ Add Item</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        );
      })}

      {/* Modals */}
      <SimpleInputModal
        visible={showAddCat}
        title="New Category"
        placeholder="Category name"
        onClose={() => setShowAddCat(false)}
        onSave={(name: string) => { createCatMut.mutate({ name }); setShowAddCat(false); }}
      />
      <SimpleInputModal
        visible={!!showAddItem}
        title="New Item"
        placeholder="Item name"
        onClose={() => setShowAddItem(null)}
        onSave={(name: string) => { if (showAddItem) createItemMut.mutate({ categoryId: showAddItem, name, minThreshold: 5 }); setShowAddItem(null); }}
      />
      <SimpleInputModal
        visible={!!editCat}
        title="Rename Category"
        placeholder="Category name"
        initialValue={editCat?.name}
        onClose={() => setEditCat(null)}
        onSave={(name: string) => { if (editCat) updateCatMut.mutate({ categoryId: editCat.categoryId, name }); setEditCat(null); }}
      />
      <EditItemModal
        visible={!!editItem}
        item={editItem}
        categories={categories}
        onClose={() => setEditItem(null)}
        onSave={(data: { name: string; minThreshold: number }) => { if (editItem) updateItemMut.mutate({ itemId: editItem.itemId, ...data }); setEditItem(null); }}
      />
      {actionItem && actionMode && (
        <ActionModal
          visible={true}
          mode={actionMode}
          item={actionItem}
          currentQty={actionItem.currentQty}
          selectedLocation={selectedLocation}
          locations={locations}
          vans={vans}
          onClose={() => { setActionItem(null); setActionMode(null); }}
          onDone={() => { setActionItem(null); setActionMode(null); utils.inventory.getStockWithDetails.invalidate(); utils.inventory.getLowStock.invalidate(); utils.inventory.getTransactions.invalidate(); }}
        />
      )}
      <AssignItemsModal
        visible={showAssignPicker}
        locationName={selectedLocation.name}
        unassignedItems={unassignedItems}
        categories={categories}
        onClose={() => setShowAssignPicker(false)}
        onAssign={(itemId: string) => {
          assignMut.mutate({ itemId, locationType: selectedLocation.type as "location" | "van", locationId: selectedLocation.id });
        }}
      />
    </View>
  );
}

// ─── Locations Tab ────────────────────────────────────────────────────────────
function LocationsTab({ locations, vans, utils }: any) {
  const colors = useColors();
  const [showAdd, setShowAdd] = useState(false);
  const [editLoc, setEditLoc] = useState<any | null>(null);
  const createMut = trpc.inventory.createLocation.useMutation({ onSuccess: () => utils.inventory.getLocations.invalidate() });
  const deleteMut = trpc.inventory.deleteLocation.useMutation({ onSuccess: () => { utils.inventory.getLocations.invalidate(); utils.inventory.getVans.invalidate(); utils.inventory.getStockWithDetails.invalidate(); } });
  const updateMut = trpc.inventory.updateLocation.useMutation({ onSuccess: () => utils.inventory.getLocations.invalidate() });

  return (
    <View style={{ padding: 16 }}>
      {/* Header row with + button */}
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
        <Text style={[styles.sectionTitle, { color: colors.foreground, flex: 1, marginBottom: 0 }]}>Blue Box Locations</Text>
        <TouchableOpacity onPress={() => setShowAdd(true)} style={[styles.plusBtn, { backgroundColor: colors.primary }]}>
          <Text style={styles.plusBtnText}>+</Text>
        </TouchableOpacity>
      </View>
      {locations.map((loc: any) => {
        const locVans = vans.filter((v: any) => v.locationId === loc.locationId);
        return (
          <View key={loc.locationId} style={[styles.catCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.catHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.catName, { color: colors.foreground }]}>🟦 {loc.name}</Text>
                {loc.city && <Text style={[styles.catMeta, { color: colors.muted }]}>📍 {loc.city}</Text>}
                {loc.address && <Text style={[styles.catMeta, { color: colors.muted }]}>🏠 {loc.address}</Text>}
                {loc.gateCode && <Text style={[styles.catMeta, { color: colors.muted }]}>🔑 Gate: {loc.gateCode}</Text>}
                {loc.boxCode && <Text style={[styles.catMeta, { color: colors.muted }]}>🔒 Box: {loc.boxCode}</Text>}
                <Text style={[styles.catMeta, { color: colors.muted }]}>{locVans.length} van{locVans.length !== 1 ? "s" : ""}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity onPress={() => setEditLoc(loc)} style={styles.iconBtn}><Text style={{ color: colors.muted }}>✏️</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => Alert.alert("Delete Location", `Delete "${loc.name}"? This will also remove all vans and stock at this location.`, [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteMut.mutate({ locationId: loc.locationId }) }])} style={styles.iconBtn}><Text style={{ color: colors.error }}>🗑️</Text></TouchableOpacity>
              </View>
            </View>
            {locVans.map((v: any) => (
              <View key={v.vanId} style={[styles.itemRow, { borderTopColor: colors.border }]}>
                <Text style={[styles.itemName, { color: colors.foreground }]}>🚐 {v.name}</Text>
                {v.assignedEmployeeId && <Text style={[styles.itemMeta, { color: colors.muted }]}>Assigned: {v.assignedEmployeeId}</Text>}
              </View>
            ))}
          </View>
        );
      })}
      <LocationInputModal visible={showAdd} title="New Blue Box Location" onClose={() => setShowAdd(false)} onSave={(name: string, city?: string, address?: string, gateCode?: string, boxCode?: string) => { createMut.mutate({ name, city, address, gateCode, boxCode }); setShowAdd(false); }} />
      <LocationInputModal visible={!!editLoc} title="Edit Location" initialName={editLoc?.name} initialCity={editLoc?.city} initialAddress={editLoc?.address} initialGateCode={editLoc?.gateCode} initialBoxCode={editLoc?.boxCode} onClose={() => setEditLoc(null)} onSave={(name: string, city?: string, address?: string, gateCode?: string, boxCode?: string) => { if (editLoc) updateMut.mutate({ locationId: editLoc.locationId, name, city, address, gateCode, boxCode }); setEditLoc(null); }} />
    </View>
  );
}

// ─── Vans Tab ─────────────────────────────────────────────────────────────────
function VansTab({ vans, locations, utils }: any) {
  const colors = useColors();
  const [showAdd, setShowAdd] = useState(false);
  const [editVan, setEditVan] = useState<any | null>(null);
  const createMut = trpc.inventory.createVan.useMutation({ onSuccess: () => utils.inventory.getVans.invalidate() });
  const deleteMut = trpc.inventory.deleteVan.useMutation({ onSuccess: () => { utils.inventory.getVans.invalidate(); utils.inventory.getStockWithDetails.invalidate(); } });
  const updateMut = trpc.inventory.updateVan.useMutation({ onSuccess: () => utils.inventory.getVans.invalidate() });

  return (
    <View style={{ padding: 16 }}>
      {/* Header row with + button */}
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
        <Text style={[styles.sectionTitle, { color: colors.foreground, flex: 1, marginBottom: 0 }]}>Vans</Text>
        <TouchableOpacity onPress={() => setShowAdd(true)} style={[styles.plusBtn, { backgroundColor: locations.length === 0 ? colors.muted : colors.primary }]} disabled={locations.length === 0}>
          <Text style={styles.plusBtnText}>+</Text>
        </TouchableOpacity>
      </View>
      {locations.length === 0 && (
        <View style={[styles.emptyBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.emptyText, { color: colors.muted }]}>Add a Blue Box location first before adding vans.</Text>
        </View>
      )}
      {vans.map((van: any) => {
        const loc = locations.find((l: any) => l.locationId === van.locationId);
        return (
          <View key={van.vanId} style={[styles.catCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.catHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.catName, { color: colors.foreground }]}>🚐 {van.name}</Text>
                <Text style={[styles.catMeta, { color: colors.muted }]}>🟦 {loc?.name ?? "Unknown location"}</Text>
                {van.assignedEmployeeId && <Text style={[styles.catMeta, { color: colors.muted }]}>Team Member: {van.assignedEmployeeId}</Text>}
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity onPress={() => setEditVan(van)} style={styles.iconBtn}><Text style={{ color: colors.muted }}>✏️</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => Alert.alert("Delete Van", `Delete "${van.name}"?`, [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteMut.mutate({ vanId: van.vanId }) }])} style={styles.iconBtn}><Text style={{ color: colors.error }}>🗑️</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        );
      })}
      <VanInputModal visible={showAdd} title="New Van" locations={locations} onClose={() => setShowAdd(false)} onSave={(name: string, locationId: string) => { createMut.mutate({ name, locationId }); setShowAdd(false); }} />
      <VanInputModal visible={!!editVan} title="Edit Van" locations={locations} initialName={editVan?.name} initialLocationId={editVan?.locationId} onClose={() => setEditVan(null)} onSave={(name: string, locationId: string) => { if (editVan) updateMut.mutate({ vanId: editVan.vanId, name, locationId }); setEditVan(null); }} />
    </View>
  );
}

// ─── Restock Tab ──────────────────────────────────────────────────────────────
function RestockTab({ lowStock, locations, vans }: any) {
  const colors = useColors();
  const today = new Date();
  const isSaturday = today.getDay() === 6;
  const isMonday = today.getDay() === 1;

  const grouped = useMemo(() => {
    const g: Record<string, any[]> = { warehouse: [], location: [], van: [] };
    for (const s of lowStock) {
      g[s.locationType]?.push(s);
    }
    return g;
  }, [lowStock]);

  if (lowStock.length === 0) {
    return (
      <View style={{ padding: 24, alignItems: "center" }}>
        <Text style={{ fontSize: 48 }}>✅</Text>
        <Text style={[styles.catName, { color: colors.foreground, marginTop: 12 }]}>All Stock Levels OK</Text>
        <Text style={[styles.catMeta, { color: colors.muted, textAlign: "center", marginTop: 4 }]}>No items are below their minimum threshold.</Text>
      </View>
    );
  }

  return (
    <View style={{ padding: 16 }}>
      {(isSaturday || isMonday) && (
        <View style={[styles.workflowBanner, { backgroundColor: isSaturday ? "#FEF3C7" : "#DBEAFE" }]}>
          <Text style={[styles.workflowTitle, { color: isSaturday ? "#92400E" : "#1E40AF" }]}>
            {isSaturday ? "🚐 Saturday: Van Restock & Inspection Day" : "🟦 Monday: Warehouse Ordering Day"}
          </Text>
          <Text style={[styles.workflowSub, { color: isSaturday ? "#78350F" : "#1D4ED8" }]}>
            {isSaturday ? "Review van stock levels and restock from warehouse or order new supplies." : "Review warehouse shortages and place orders for the week."}
          </Text>
        </View>
      )}

      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>⚠️ Restock List ({lowStock.length} items)</Text>

      {(["warehouse", "location", "van"] as LocType[]).map((tier) => {
        const tierItems = grouped[tier];
        if (!tierItems || tierItems.length === 0) return null;
        const tierLabel = tier === "warehouse" ? "🏭 Warehouse" : tier === "location" ? "🟦 Blue Box Locations" : "🚐 Vans";
        return (
          <View key={tier} style={{ marginBottom: 16 }}>
            <Text style={[styles.tierLabel, { color: colors.foreground }]}>{tierLabel}</Text>
            {tierItems.map((s: any) => {
              const locName = tier === "warehouse" ? "Warehouse" : tier === "location" ? (locations.find((l: any) => l.locationId === s.locationId)?.name ?? s.locationId) : (vans.find((v: any) => v.vanId === s.locationId)?.name ?? s.locationId);
              return (
                <View key={s.stockId} style={[styles.restockRow, { backgroundColor: colors.surface, borderColor: "#F59E0B" }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemName, { color: colors.foreground }]}>{s.itemName}</Text>
                    <Text style={[styles.itemMeta, { color: colors.muted }]}>{s.categoryName} · {locName}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[styles.qty, { color: colors.warning }]}>{s.quantity}</Text>
                    <Text style={[styles.itemMeta, { color: colors.muted }]}>min {s.minThreshold}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

// ─── Reports Tab ──────────────────────────────────────────────────────────────
function ReportsTab({ stock, transactions, usage, categories, items, locations, vans }: any) {
  const colors = useColors();
  const [reportView, setReportView] = useState<"overview" | "history" | "usage">("overview");

  // Total by category
  const totalByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of stock) {
      map[s.categoryName] = (map[s.categoryName] ?? 0) + s.quantity;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [stock]);

  // Total by tier
  const totalByTier = useMemo(() => {
    const t = { warehouse: 0, location: 0, van: 0 };
    for (const s of stock) t[s.locationType as LocType] += s.quantity;
    return t;
  }, [stock]);

  // High usage items (last 30 days)
  const highUsage = useMemo(() => {
    const map: Record<string, { name: string; total: number }> = {};
    for (const tx of usage) {
      if (!map[tx.itemId]) map[tx.itemId] = { name: tx.itemName ?? tx.itemId, total: 0 };
      map[tx.itemId].total += tx.quantity;
    }
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [usage]);

  // Loss tracking (manual removes)
  const losses = useMemo(() => transactions.filter((tx: any) => tx.actionType === "remove"), [transactions]);

  const reportTabs = [
    { key: "overview", label: "Overview" },
    { key: "history", label: "History" },
    { key: "usage", label: "Usage" },
  ];

  return (
    <View style={{ padding: 16 }}>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
        {reportTabs.map((rt) => (
          <TouchableOpacity key={rt.key} onPress={() => setReportView(rt.key as any)} style={[styles.reportTab, { backgroundColor: reportView === rt.key ? colors.primary : colors.surface, borderColor: colors.border }]}>
            <Text style={{ color: reportView === rt.key ? "#fff" : colors.foreground, fontSize: 13, fontWeight: "600" }}>{rt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {reportView === "overview" && (
        <View>
          {/* Tier Summary */}
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Inventory by Tier</Text>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
            {([["warehouse", "🏭", "Warehouse"], ["location", "🟦", "Locations"], ["van", "🚐", "Vans"]] as const).map(([tier, icon, label]) => (
              <View key={tier} style={[styles.kpiCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: 24 }}>{icon}</Text>
                <Text style={[styles.kpiValue, { color: colors.primary }]}>{totalByTier[tier]}</Text>
                <Text style={[styles.kpiLabel, { color: colors.muted }]}>{label}</Text>
              </View>
            ))}
          </View>

          {/* By Category */}
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Inventory by Category</Text>
          {totalByCategory.map(([cat, qty]) => (
            <View key={cat} style={[styles.reportRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.itemName, { color: colors.foreground }]}>{cat}</Text>
              <Text style={[styles.qty, { color: colors.primary }]}>{qty}</Text>
            </View>
          ))}
        </View>
      )}

      {reportView === "history" && (
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Transaction History</Text>
          {transactions.slice(0, 100).map((tx: any) => {
            const actionColors: Record<string, string> = { add: "#22C55E", remove: "#EF4444", adjust: "#3B82F6", transfer_out: "#F59E0B", transfer_in: "#8B5CF6" };
            const actionLabels: Record<string, string> = { add: "Added", remove: "Removed", adjust: "Adjusted", transfer_out: "Transferred Out", transfer_in: "Transferred In" };
            return (
              <View key={tx.txId} style={[styles.txRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={[styles.txBadge, { backgroundColor: actionColors[tx.actionType] + "22" }]}>
                  <Text style={[styles.txBadgeText, { color: actionColors[tx.actionType] }]}>{actionLabels[tx.actionType]}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={[styles.itemName, { color: colors.foreground }]}>{tx.itemName}</Text>
                  <Text style={[styles.itemMeta, { color: colors.muted }]}>{tx.locationName ?? tx.locationId} · {new Date(tx.createdAt).toLocaleDateString()}</Text>
                  {tx.note && <Text style={[styles.itemMeta, { color: colors.muted }]}>Note: {tx.note}</Text>}
                </View>
                <Text style={[styles.qty, { color: actionColors[tx.actionType] }]}>{tx.actionType === "remove" || tx.actionType === "transfer_out" ? "-" : "+"}{tx.quantity}</Text>
              </View>
            );
          })}
          {transactions.length === 0 && <Text style={[styles.emptyText, { color: colors.muted }]}>No transactions yet.</Text>}
        </View>
      )}

      {reportView === "usage" && (
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>High-Usage Items (Last 30 Days)</Text>
          {highUsage.map((item, i) => (
            <View key={item.name} style={[styles.reportRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.itemMeta, { color: colors.muted, width: 24 }]}>#{i + 1}</Text>
              <Text style={[styles.itemName, { color: colors.foreground, flex: 1 }]}>{item.name}</Text>
              <Text style={[styles.qty, { color: colors.error }]}>-{item.total}</Text>
            </View>
          ))}
          {highUsage.length === 0 && <Text style={[styles.emptyText, { color: colors.muted }]}>No usage data yet.</Text>}

          <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 20 }]}>Loss Tracking (Manual Removals)</Text>
          {losses.slice(0, 50).map((tx: any) => (
            <View key={tx.txId} style={[styles.txRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, { color: colors.foreground }]}>{tx.itemName}</Text>
                <Text style={[styles.itemMeta, { color: colors.muted }]}>{tx.locationName ?? tx.locationId} · {new Date(tx.createdAt).toLocaleDateString()}</Text>
                {tx.note && <Text style={[styles.itemMeta, { color: colors.muted }]}>Note: {tx.note}</Text>}
              </View>
              <Text style={[styles.qty, { color: colors.error }]}>-{tx.quantity}</Text>
            </View>
          ))}
          {losses.length === 0 && <Text style={[styles.emptyText, { color: colors.muted }]}>No manual removals recorded.</Text>}
        </View>
      )}
    </View>
  );
}

// ─── Action Modal ─────────────────────────────────────────────────────────────
function ActionModal({ visible, mode, item, currentQty, selectedLocation, locations, vans, onClose, onDone }: any) {
  const colors = useColors();
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [toType, setToType] = useState<LocType>("warehouse");
  const [toId, setToId] = useState("warehouse");

  const addMut = trpc.inventory.add.useMutation({ onSuccess: onDone });
  const removeMut = trpc.inventory.remove.useMutation({ onSuccess: onDone });
  const adjustMut = trpc.inventory.adjust.useMutation({ onSuccess: onDone });
  const transferMut = trpc.inventory.transfer.useMutation({ onSuccess: onDone });

  const modeConfig: Record<string, { title: string; btnColor: string; btnLabel: string }> = {
    add: { title: "Add Inventory", btnColor: "#22C55E", btnLabel: "Add" },
    remove: { title: "Remove Inventory", btnColor: "#EF4444", btnLabel: "Remove" },
    adjust: { title: "Adjust Quantity", btnColor: "#3B82F6", btnLabel: "Set Quantity" },
    transfer: { title: "Transfer Inventory", btnColor: "#F59E0B", btnLabel: "Transfer" },
  };
  const cfg = modeConfig[mode] ?? modeConfig.add;

  const destOptions: { type: LocType; id: string; name: string }[] = [
    { type: "warehouse", id: "warehouse", name: "🏭 Warehouse" },
    ...locations.map((l: any) => ({ type: "location" as LocType, id: l.locationId, name: `🟦 ${l.name}` })),
    ...vans.map((v: any) => ({ type: "van" as LocType, id: v.vanId, name: `🚐 ${v.name}` })),
  ].filter((o) => !(o.type === selectedLocation.type && o.id === selectedLocation.id));

  const handleSubmit = () => {
    const n = parseInt(qty, 10);
    if (isNaN(n) || n < 0) { Alert.alert("Invalid quantity"); return; }
    const base = { itemId: item.itemId, itemName: item.name, locationType: selectedLocation.type, locationId: selectedLocation.id, locationName: selectedLocation.name, performedBy: "admin", note: note || undefined };
    if (mode === "add") addMut.mutate({ ...base, quantity: n });
    else if (mode === "remove") removeMut.mutate({ ...base, quantity: n });
    else if (mode === "adjust") adjustMut.mutate({ ...base, newQuantity: n });
    else if (mode === "transfer") {
      const dest = destOptions.find((o) => o.id === toId);
      if (!dest) { Alert.alert("Select destination"); return; }
      transferMut.mutate({ itemId: item.itemId, itemName: item.name, fromType: selectedLocation.type, fromId: selectedLocation.id, fromName: selectedLocation.name, toType: dest.type, toId: dest.id, toName: dest.name, quantity: n, performedBy: "admin", note: note || undefined });
    }
  };

  const isPending = addMut.isPending || removeMut.isPending || adjustMut.isPending || transferMut.isPending;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>{cfg.title}</Text>
          <Text style={[styles.modalSub, { color: colors.muted }]}>{item?.name} · {selectedLocation.name}</Text>
          <Text style={[styles.modalSub, { color: colors.muted }]}>Current: {currentQty}</Text>

          <Text style={[styles.inputLabel, { color: colors.foreground }]}>{mode === "adjust" ? "New Quantity" : "Quantity"}</Text>
          <TextInput
            value={qty}
            onChangeText={setQty}
            keyboardType="number-pad"
            style={[styles.modalInput, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]}
            returnKeyType="done"
          />

          {mode === "transfer" && (
            <>
              <Text style={[styles.inputLabel, { color: colors.foreground }]}>Transfer To</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                {destOptions.map((opt) => (
                  <TouchableOpacity key={opt.id} onPress={() => { setToType(opt.type); setToId(opt.id); }} style={[styles.locChip, { backgroundColor: toId === opt.id ? colors.primary : colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.locChipText, { color: toId === opt.id ? "#fff" : colors.foreground }]}>{opt.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          <Text style={[styles.inputLabel, { color: colors.foreground }]}>Note (optional)</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Reason or note..."
            placeholderTextColor={colors.muted}
            style={[styles.modalInput, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]}
            returnKeyType="done"
          />

          <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
            <TouchableOpacity onPress={onClose} style={[styles.modalCancelBtn, { borderColor: colors.border }]}>
              <Text style={{ color: colors.muted, fontWeight: "600" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSubmit} disabled={isPending} style={[styles.modalConfirmBtn, { backgroundColor: cfg.btnColor }]}>
              {isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: "#fff", fontWeight: "700" }}>{cfg.btnLabel}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Simple Input Modal ───────────────────────────────────────────────────────
function SimpleInputModal({ visible, title, placeholder, initialValue, onClose, onSave }: any) {
  const colors = useColors();
  const [value, setValue] = useState(initialValue ?? "");
  React.useEffect(() => { if (visible) setValue(initialValue ?? ""); }, [visible, initialValue]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>{title}</Text>
          <TextInput value={value} onChangeText={setValue} placeholder={placeholder} placeholderTextColor={colors.muted} style={[styles.modalInput, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]} returnKeyType="done" autoFocus />
          <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
            <TouchableOpacity onPress={onClose} style={[styles.modalCancelBtn, { borderColor: colors.border }]}><Text style={{ color: colors.muted, fontWeight: "600" }}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => { if (value.trim()) onSave(value.trim()); }} style={[styles.modalConfirmBtn, { backgroundColor: colors.primary }]}><Text style={{ color: "#fff", fontWeight: "700" }}>Save</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Edit Item Modal ──────────────────────────────────────────────────────────
function EditItemModal({ visible, item, categories, onClose, onSave }: any) {
  const colors = useColors();
  const [name, setName] = useState(item?.name ?? "");
  const [threshold, setThreshold] = useState(String(item?.minThreshold ?? 0));
  React.useEffect(() => { if (visible && item) { setName(item.name); setThreshold(String(item.minThreshold)); } }, [visible, item]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit Item</Text>
          <Text style={[styles.inputLabel, { color: colors.foreground }]}>Name</Text>
          <TextInput value={name} onChangeText={setName} style={[styles.modalInput, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]} returnKeyType="done" />
          <Text style={[styles.inputLabel, { color: colors.foreground }]}>Min Threshold</Text>
          <TextInput value={threshold} onChangeText={setThreshold} keyboardType="number-pad" style={[styles.modalInput, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]} returnKeyType="done" />
          <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
            <TouchableOpacity onPress={onClose} style={[styles.modalCancelBtn, { borderColor: colors.border }]}><Text style={{ color: colors.muted, fontWeight: "600" }}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => onSave({ name: name.trim(), minThreshold: parseInt(threshold, 10) || 0 })} style={[styles.modalConfirmBtn, { backgroundColor: colors.primary }]}><Text style={{ color: "#fff", fontWeight: "700" }}>Save</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Location Input Modal ─────────────────────────────────────────────────────
function LocationInputModal({ visible, title, initialName, initialCity, initialAddress, initialGateCode, initialBoxCode, onClose, onSave }: any) {
  const colors = useColors();
  const [name, setName] = useState(initialName ?? "");
  const [city, setCity] = useState(initialCity ?? "");
  const [address, setAddress] = useState(initialAddress ?? "");
  const [gateCode, setGateCode] = useState(initialGateCode ?? "");
  const [boxCode, setBoxCode] = useState(initialBoxCode ?? "");
  React.useEffect(() => {
    if (visible) {
      setName(initialName ?? "");
      setCity(initialCity ?? "");
      setAddress(initialAddress ?? "");
      setGateCode(initialGateCode ?? "");
      setBoxCode(initialBoxCode ?? "");
    }
  }, [visible, initialName, initialCity, initialAddress, initialGateCode, initialBoxCode]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <ScrollView style={{ width: "100%" }} contentContainerStyle={{ justifyContent: "flex-end", flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>{title}</Text>
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Location Name</Text>
            <TextInput value={name} onChangeText={setName} placeholder="e.g. Blue Box North" placeholderTextColor={colors.muted} style={[styles.modalInput, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]} returnKeyType="next" autoFocus />
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>City (optional)</Text>
            <TextInput value={city} onChangeText={setCity} placeholder="e.g. Austin" placeholderTextColor={colors.muted} style={[styles.modalInput, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]} returnKeyType="next" />
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Address (optional)</Text>
            <TextInput value={address} onChangeText={setAddress} placeholder="e.g. 123 Main St, Austin TX" placeholderTextColor={colors.muted} style={[styles.modalInput, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]} returnKeyType="next" />
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Gate Code (optional)</Text>
            <TextInput value={gateCode} onChangeText={setGateCode} placeholder="e.g. #1234" placeholderTextColor={colors.muted} style={[styles.modalInput, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]} returnKeyType="next" />
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Box Code (optional)</Text>
            <TextInput value={boxCode} onChangeText={setBoxCode} placeholder="e.g. 5678" placeholderTextColor={colors.muted} style={[styles.modalInput, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]} returnKeyType="done" />
            <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
              <TouchableOpacity onPress={onClose} style={[styles.modalCancelBtn, { borderColor: colors.border }]}><Text style={{ color: colors.muted, fontWeight: "600" }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => { if (name.trim()) onSave(name.trim(), city.trim() || undefined, address.trim() || undefined, gateCode.trim() || undefined, boxCode.trim() || undefined); }} style={[styles.modalConfirmBtn, { backgroundColor: colors.primary }]}><Text style={{ color: "#fff", fontWeight: "700" }}>Save</Text></TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Van Input Modal ──────────────────────────────────────────────────────────
function VanInputModal({ visible, title, locations, initialName, initialLocationId, onClose, onSave }: any) {
  const colors = useColors();
  const [name, setName] = useState(initialName ?? "");
  const [locationId, setLocationId] = useState(initialLocationId ?? locations[0]?.locationId ?? "");
  React.useEffect(() => { if (visible) { setName(initialName ?? ""); setLocationId(initialLocationId ?? locations[0]?.locationId ?? ""); } }, [visible, initialName, initialLocationId]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.inputLabel, { color: colors.foreground }]}>Van Name</Text>
          <TextInput value={name} onChangeText={setName} placeholder="e.g. Van 1" placeholderTextColor={colors.muted} style={[styles.modalInput, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]} returnKeyType="done" autoFocus />
          <Text style={[styles.inputLabel, { color: colors.foreground }]}>Assign to Location</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            {locations.map((loc: any) => (
              <TouchableOpacity key={loc.locationId} onPress={() => setLocationId(loc.locationId)} style={[styles.locChip, { backgroundColor: locationId === loc.locationId ? colors.primary : colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.locChipText, { color: locationId === loc.locationId ? "#fff" : colors.foreground }]}>🟦 {loc.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
            <TouchableOpacity onPress={onClose} style={[styles.modalCancelBtn, { borderColor: colors.border }]}><Text style={{ color: colors.muted, fontWeight: "600" }}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => { if (name.trim() && locationId) onSave(name.trim(), locationId); }} style={[styles.modalConfirmBtn, { backgroundColor: colors.primary }]}><Text style={{ color: "#fff", fontWeight: "700" }}>Save</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Assign Items Modal ────────────────────────────────────────────────────────────────────────────────
function AssignItemsModal({ visible, locationName, unassignedItems, categories, onClose, onAssign }: {
  visible: boolean;
  locationName: string;
  unassignedItems: any[];
  categories: any[];
  onClose: () => void;
  onAssign: (itemId: string) => void;
}) {
  const colors = useColors();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return unassignedItems;
    const q = search.toLowerCase();
    return unassignedItems.filter((i: any) => i.name.toLowerCase().includes(q));
  }, [unassignedItems, search]);

  const getCatName = (categoryId: string) => categories.find((c: any) => c.categoryId === categoryId)?.name ?? "";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40, maxHeight: "80%" }}>
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>Assign Items to {locationName}</Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>Tap an item to add it to this location.</Text>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search items..."
            placeholderTextColor={colors.muted}
            style={{ borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.foreground, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 12 }}
          />
          {filtered.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 24 }}>
              <Text style={{ fontSize: 28, marginBottom: 8 }}>✅</Text>
              <Text style={{ color: colors.muted, fontSize: 14, textAlign: "center" }}>{search ? "No items match your search." : "All warehouse items are already assigned to this location."}</Text>
            </View>
          ) : (
            <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
              data={filtered}
              keyExtractor={(item: any) => item.itemId}
              renderItem={({ item }: { item: any }) => (
                <TouchableOpacity
                  onPress={() => { onAssign(item.itemId); }}
                  style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: colors.border }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{item.name}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{getCatName(item.categoryId)}</Text>
                  </View>
                  <View style={{ backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
                    <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>+ Add</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          )}
          <TouchableOpacity onPress={onClose} style={{ marginTop: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 14, alignItems: "center" }}>
            <Text style={{ color: colors.muted, fontWeight: "600" }}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5 },
  headerTitle: { fontSize: 22, fontWeight: "700", flex: 1 },
  badge: { backgroundColor: "#EF4444", borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  tabBar: { borderBottomWidth: 0.5, height: 44, flexGrow: 0, flexShrink: 0 },
  plusBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  plusBtnText: { color: "#fff", fontSize: 22, fontWeight: "600", lineHeight: 26 },
  tabBarContent: { paddingHorizontal: 8, alignItems: 'center' },
  tabBtn: { paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 4 },
  tabIcon: { fontSize: 14 },
  tabLabel: { fontSize: 13, fontWeight: "600" },
  tabBadge: { backgroundColor: "#EF4444", borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  tabBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  searchInput: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 12 },
  addBtn: { borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, alignItems: "center", marginBottom: 12, borderStyle: "dashed" },
  addBtnText: { fontSize: 14, fontWeight: "600" },
  catCard: { borderRadius: 12, borderWidth: 1, marginBottom: 10, overflow: "hidden" },
  catHeader: { flexDirection: "row", alignItems: "center", padding: 14 },
  catName: { fontSize: 16, fontWeight: "700" },
  catMeta: { fontSize: 12, marginTop: 2 },
  itemRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 0.5 },
  itemName: { fontSize: 14, fontWeight: "600" },
  itemMeta: { fontSize: 11, marginTop: 2 },
  qty: { fontSize: 20, fontWeight: "700" },
  qtyBtn: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  qtyBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  addItemBtn: { borderTopWidth: 0.5, paddingVertical: 10, alignItems: "center" },
  addItemBtnText: { fontSize: 13, fontWeight: "500" },
  iconBtn: { padding: 4 },
  locChip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8 },
  locChipText: { fontSize: 13, fontWeight: "600" },
  sectionTitle: { fontSize: 15, fontWeight: "700", marginBottom: 10, marginTop: 4 },
  tierLabel: { fontSize: 14, fontWeight: "700", marginBottom: 6 },
  restockRow: { borderRadius: 10, borderWidth: 1.5, padding: 12, marginBottom: 8, flexDirection: "row", alignItems: "center" },
  reportRow: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  reportTab: { flex: 1, borderRadius: 8, borderWidth: 1, paddingVertical: 8, alignItems: "center" },
  kpiCard: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 12, alignItems: "center", gap: 4 },
  kpiValue: { fontSize: 22, fontWeight: "800" },
  kpiLabel: { fontSize: 11, fontWeight: "600" },
  txRow: { borderRadius: 10, borderWidth: 1, padding: 10, marginBottom: 6, flexDirection: "row", alignItems: "center" },
  txBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  txBadgeText: { fontSize: 11, fontWeight: "700" },
  workflowBanner: { borderRadius: 12, padding: 14, marginBottom: 16 },
  workflowTitle: { fontSize: 14, fontWeight: "700", marginBottom: 4 },
  workflowSub: { fontSize: 12 },
  emptyBox: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12 },
  emptyText: { fontSize: 13, textAlign: "center" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  modalSub: { fontSize: 13, marginBottom: 4 },
  inputLabel: { fontSize: 13, fontWeight: "600", marginBottom: 6, marginTop: 12 },
  modalInput: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  modalCancelBtn: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  modalConfirmBtn: { flex: 2, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
});

// ─── Dashboard Tab ────────────────────────────────────────────────────────────
function DashboardTab({ stock, lowStock, categories, items, locations, vans, transactions }: {
  stock: any[]; lowStock: any[]; categories: any[]; items: any[]; locations: any[]; vans: any[]; transactions: any[];
}) {
  const colors = useColors();

  // KPI calculations
  const totalItems = items.length;
  const totalCategories = categories.length;
  const totalLocations = locations.length;
  const totalVans = vans.length;
  const lowStockCount = lowStock.length;

  // Stock by tier
  const warehouseStock = stock.filter((s) => s.locationType === "warehouse");
  const locationStock = stock.filter((s) => s.locationType === "location");
  const vanStock = stock.filter((s) => s.locationType === "van");
  const warehouseTotal = warehouseStock.reduce((sum, s) => sum + (s.quantity ?? 0), 0);
  const locationTotal = locationStock.reduce((sum, s) => sum + (s.quantity ?? 0), 0);
  const vanTotal = vanStock.reduce((sum, s) => sum + (s.quantity ?? 0), 0);
  const grandTotal = warehouseTotal + locationTotal + vanTotal;

  // Category breakdown — total qty per category
  const catBreakdown = categories.map((cat) => {
    const catItems = items.filter((i) => i.categoryId === cat.categoryId);
    const catItemIds = catItems.map((i) => i.itemId);
    const qty = stock.filter((s) => catItemIds.includes(s.itemId)).reduce((sum, s) => sum + (s.quantity ?? 0), 0);
    return { name: cat.name, qty };
  }).sort((a, b) => b.qty - a.qty);

  const maxQty = catBreakdown.length > 0 ? Math.max(...catBreakdown.map((c) => c.qty), 1) : 1;

  // Recent transactions
  const recentTx = transactions.slice(0, 5);

  const CAT_COLORS = ["#0a7ea4", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316"];

  return (
    <View style={{ padding: 16, gap: 16 }}>
      {/* KPI Row */}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, alignItems: "center", gap: 4 }}>
          <Text style={{ fontSize: 26, fontWeight: "800", color: colors.primary }}>{totalItems}</Text>
          <Text style={{ fontSize: 11, color: colors.muted, fontWeight: "600", textTransform: "uppercase" }}>Items</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, alignItems: "center", gap: 4 }}>
          <Text style={{ fontSize: 26, fontWeight: "800", color: "#22C55E" }}>{grandTotal}</Text>
          <Text style={{ fontSize: 11, color: colors.muted, fontWeight: "600", textTransform: "uppercase" }}>Total Stock</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: lowStockCount > 0 ? "#2D1B1B" : colors.surface, borderRadius: 14, borderWidth: 1, borderColor: lowStockCount > 0 ? "#EF4444" : colors.border, padding: 14, alignItems: "center", gap: 4 }}>
          <Text style={{ fontSize: 26, fontWeight: "800", color: lowStockCount > 0 ? "#EF4444" : colors.muted }}>{lowStockCount}</Text>
          <Text style={{ fontSize: 11, color: lowStockCount > 0 ? "#EF4444" : colors.muted, fontWeight: "600", textTransform: "uppercase" }}>Low Stock</Text>
        </View>
      </View>

      {/* Stock by Tier */}
      <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16 }}>
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 14 }}>Stock by Tier</Text>
        {[
          { label: "🏭 Warehouse", value: warehouseTotal, color: "#0a7ea4", sub: "Primary storage" },
          { label: "🟦 Blue Boxes", value: locationTotal, color: "#22C55E", sub: `${totalLocations} location${totalLocations !== 1 ? "s" : ""}` },
          { label: "🚐 Vans", value: vanTotal, color: "#F59E0B", sub: `${totalVans} van${totalVans !== 1 ? "s" : ""}` },
        ].map((tier) => (
          <View key={tier.label} style={{ marginBottom: 12 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 5 }}>
              <View>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{tier.label}</Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>{tier.sub}</Text>
              </View>
              <Text style={{ fontSize: 18, fontWeight: "800", color: tier.color }}>{tier.value}</Text>
            </View>
            <View style={{ height: 6, backgroundColor: colors.border, borderRadius: 3 }}>
              <View style={{ height: 6, backgroundColor: tier.color, borderRadius: 3, width: grandTotal > 0 ? `${Math.round((tier.value / grandTotal) * 100)}%` : "0%" }} />
            </View>
          </View>
        ))}
      </View>

      {/* Category Breakdown */}
      {catBreakdown.length > 0 && (
        <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16 }}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 14 }}>Stock by Category</Text>
          {catBreakdown.slice(0, 8).map((cat, i) => (
            <View key={cat.name} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, flex: 1 }} numberOfLines={1}>{cat.name}</Text>
                <Text style={{ fontSize: 13, fontWeight: "700", color: CAT_COLORS[i % CAT_COLORS.length] }}>{cat.qty}</Text>
              </View>
              <View style={{ height: 5, backgroundColor: colors.border, borderRadius: 3 }}>
                <View style={{ height: 5, backgroundColor: CAT_COLORS[i % CAT_COLORS.length], borderRadius: 3, width: `${Math.round((cat.qty / maxQty) * 100)}%` }} />
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Low Stock Alerts */}
      {lowStock.length > 0 && (
        <View style={{ backgroundColor: "#2D1B1B", borderRadius: 14, borderWidth: 1, borderColor: "#EF4444", padding: 16 }}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: "#EF4444", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>⚠️ Low Stock Alerts</Text>
          {lowStock.slice(0, 5).map((s: any) => (
            <View key={s.stockId} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: "#3D2020" }}>
              <Text style={{ fontSize: 13, color: "#ECEDEE", flex: 1 }} numberOfLines={1}>{s.itemName}</Text>
              <Text style={{ fontSize: 13, color: "#EF4444", fontWeight: "700" }}>{s.quantity} / {s.minThreshold}</Text>
            </View>
          ))}
          {lowStock.length > 5 && (
            <Text style={{ fontSize: 12, color: "#EF4444", marginTop: 8, textAlign: "center" }}>+{lowStock.length - 5} more items below threshold</Text>
          )}
        </View>
      )}

      {/* Recent Transactions */}
      {recentTx.length > 0 && (
        <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16 }}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>Recent Activity</Text>
          {recentTx.map((tx: any) => {
            const isAdd = tx.type === "add" || tx.type === "transfer_in";
            const isRemove = tx.type === "remove" || tx.type === "transfer_out";
            const color = isAdd ? "#22C55E" : isRemove ? "#EF4444" : "#F59E0B";
            const icon = isAdd ? "+" : isRemove ? "−" : "↔";
            return (
              <View key={tx.transactionId} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 7, borderBottomWidth: 0.5, borderBottomColor: colors.border, gap: 10 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: color + "22", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 14, color, fontWeight: "700" }}>{icon}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{tx.itemName ?? "Item"}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{tx.type?.replace(/_/g, " ")} · {new Date(tx.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</Text>
                </View>
                <Text style={{ fontSize: 14, fontWeight: "700", color }}>{icon}{tx.quantity}</Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Empty state when no stock yet */}
      {grandTotal === 0 && lowStock.length === 0 && recentTx.length === 0 && (
        <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 32, alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 32 }}>🟦</Text>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>No stock yet</Text>
          <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center" }}>Go to the Inventory tab to add quantities to your items.</Text>
        </View>
      )}
    </View>
  );
}
