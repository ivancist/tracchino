import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Chain,
  Created,
  DiaryDay,
  DietAnalysis,
  SimulationResult,
  FrequentProduct,
  PastMeal,
  Portion,
  LastPrice,
  MeResponse,
  OffLookup,
  PantryItem,
  ShoppingListItem,
  PriceStats,
  ScanResult,
  SpendingStats,
  TopProduct,
  Product,
  ProductGroup,
  ReceiptDetail,
  ReceiptSummary,
  Store,
} from "../shared/api";
import type { CostMode, Meal } from "../shared/diary";
import type {
  ChainInput,
  DiaryBatchInput,
  DiaryEntryInput,
  GroupInput,
  PortionInput,
  ProductInput,
  ReceiptInput,
  ShoppingItemInput,
  StoreInput,
} from "../shared/schemas";
import { api } from "./api";

export const keys = {
  me: ["me"] as const,
  chains: ["chains"] as const,
  stores: ["stores"] as const,
  groups: ["groups"] as const,
  products: ["products"] as const,
  product: (id: number) => ["products", id] as const,
  receipts: ["receipts"] as const,
  receipt: (id: number) => ["receipts", id] as const,
  lastPrices: (storeId: number) => ["stores", storeId, "last-prices"] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api.get<MeResponse>("/api/me") });
export const useChains = () => useQuery({ queryKey: keys.chains, queryFn: () => api.get<Chain[]>("/api/chains") });
export const useStores = () => useQuery({ queryKey: keys.stores, queryFn: () => api.get<Store[]>("/api/stores") });
export const useGroups = () => useQuery({ queryKey: keys.groups, queryFn: () => api.get<ProductGroup[]>("/api/groups") });
export const useProducts = () => useQuery({ queryKey: keys.products, queryFn: () => api.get<Product[]>("/api/products") });
const RECEIPT_PAGE = 50;

/** Receipts newest first, 50 per page (cursor = last row's date + id). */
export const useReceipts = () =>
  useInfiniteQuery({
    queryKey: keys.receipts,
    initialPageParam: null as { date: string; id: number } | null,
    queryFn: ({ pageParam }) =>
      api.get<ReceiptSummary[]>(
        `/api/receipts?limit=${RECEIPT_PAGE}` + (pageParam ? `&beforeDate=${pageParam.date}&beforeId=${pageParam.id}` : ""),
      ),
    getNextPageParam: (last) => {
      const tail = last.at(-1);
      return last.length === RECEIPT_PAGE && tail ? { date: tail.date, id: tail.id } : undefined;
    },
  });

export const useReceipt = (id: number | null) =>
  useQuery({
    queryKey: keys.receipt(id ?? 0),
    queryFn: () => api.get<ReceiptDetail>(`/api/receipts/${id}`),
    enabled: id != null,
  });

export const useLastPrices = (storeId: number | null, excludeReceipt: number | null) =>
  useQuery({
    queryKey: [...keys.lastPrices(storeId ?? 0), excludeReceipt],
    queryFn: () =>
      api.get<LastPrice[]>(`/api/stores/${storeId}/last-prices` + (excludeReceipt ? `?excludeReceipt=${excludeReceipt}` : "")),
    enabled: storeId != null,
  });

/** Every write invalidates the lists it can affect (small dataset: refetching is cheap and always correct). */
function useWrite<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>, invalidate: readonly (readonly unknown[])[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}

// Stats and the diary (nutrition, costs from receipts) depend on everything: every write refreshes them too.
// A new receipt also takes what was bought off the shopping list.
const catalog = [keys.chains, keys.stores, keys.groups, keys.products, keys.receipts, ["stats"], ["diary"], ["shopping"]] as const;

export const useSaveChain = () =>
  useWrite(({ id, ...input }: ChainInput & { id?: number }) =>
    id ? api.patch<Created>(`/api/chains/${id}`, input) : api.post<Created>("/api/chains", input), catalog);
export const useDeleteChain = () => useWrite((id: number) => api.del(`/api/chains/${id}`), catalog);

export const useSaveStore = () =>
  useWrite(({ id, ...input }: StoreInput & { id?: number }) =>
    id ? api.patch<Created>(`/api/stores/${id}`, input) : api.post<Created>("/api/stores", input), catalog);
export const useDeleteStore = () => useWrite((id: number) => api.del(`/api/stores/${id}`), catalog);

export const useDeleteGroup = () => useWrite((id: number) => api.del(`/api/groups/${id}`), catalog);
export const useSaveGroup = () =>
  useWrite(({ id, ...input }: GroupInput & { id?: number }) =>
    id ? api.patch<Created>(`/api/groups/${id}`, input) : api.post<Created>("/api/groups", input), catalog);

export const useSaveProduct = () =>
  useWrite(({ id, ...input }: ProductInput & { id?: number }) =>
    id ? api.patch<Created>(`/api/products/${id}`, input) : api.post<Created>("/api/products", input), catalog);
export const useDeleteProduct = () => useWrite((id: number) => api.del(`/api/products/${id}`), catalog);
export const useMergeProduct = () =>
  useWrite(({ fromId, intoId }: { fromId: number; intoId: number }) =>
    api.post<Created>(`/api/products/${fromId}/merge`, { intoId }), catalog);

export const useSaveReceipt = () =>
  useWrite(({ id, ...input }: ReceiptInput & { id?: number }) =>
    id ? api.put<Created>(`/api/receipts/${id}`, input) : api.post<Created>("/api/receipts", input), [
    ...catalog,
    ["stores"],
  ]);
export const useDeleteReceipt = () => useWrite((id: number) => api.del(`/api/receipts/${id}`), catalog);

const period = (from?: string, to?: string) =>
  new URLSearchParams(Object.entries({ from, to }).filter((e): e is [string, string] => !!e[1])).toString();

export const useSpending = (from?: string, to?: string, enabled = true) =>
  useQuery({
    queryKey: ["stats", "spending", from, to],
    queryFn: () => api.get<SpendingStats>(`/api/stats/spending?${period(from, to)}`),
    enabled,
  });

export const useTopProducts = (from?: string, to?: string, enabled = true) =>
  useQuery({
    enabled,
    queryKey: ["stats", "top", from, to],
    queryFn: () => api.get<TopProduct[]>(`/api/stats/top-products?limit=10&${period(from, to)}`),
  });

export const usePriceStats = (kind: "products" | "groups", id: number | null) =>
  useQuery({
    queryKey: ["stats", kind, id],
    queryFn: () => api.get<PriceStats>(`/api/stats/${kind}/${id}`),
    enabled: id != null,
  });

export const useDiaryDay = (date: string, costMode: CostMode, windowDays: number) =>
  useQuery({
    queryKey: ["diary", "day", date, costMode, windowDays],
    queryFn: () => api.get<DiaryDay>(`/api/diary?date=${date}&costMode=${costMode}&windowDays=${windowDays}`),
  });
const costParams = (mode: CostMode, windowDays: number) => `costMode=${mode}&windowDays=${windowDays}`;

export const useDietAnalysis = (from: string | undefined, to: string | undefined, mode: CostMode, windowDays: number) =>
  useQuery({
    queryKey: ["diary", "analysis", from, to, mode, windowDays],
    queryFn: () => api.get<DietAnalysis>(`/api/analysis?${period(from, to)}&${costParams(mode, windowDays)}`),
  });

export type SimulationParams = { fromProduct: number; toProduct: number; factor: number };
export const useSimulation = (
  from: string | undefined,
  to: string | undefined,
  mode: CostMode,
  windowDays: number,
  params: SimulationParams | null,
) =>
  useQuery({
    queryKey: ["diary", "simulate", from, to, mode, windowDays, params],
    queryFn: () =>
      api.get<SimulationResult>(
        `/api/analysis/simulate?${period(from, to)}&${costParams(mode, windowDays)}` +
          `&fromProduct=${params!.fromProduct}&toProduct=${params!.toProduct}&factor=${params!.factor}`,
      ),
    enabled: params != null,
  });

export const useFrequentProducts = () =>
  useQuery({ queryKey: ["diary", "frequent"], queryFn: () => api.get<FrequentProduct[]>("/api/diary/frequent") });

export const useSaveDiaryEntry = () =>
  useWrite(({ id, ...input }: DiaryEntryInput & { id?: number }) =>
    id ? api.patch<Created>(`/api/diary/${id}`, input) : api.post<Created>("/api/diary", input), [["diary"]]);
export const useRecentMeals = (meal: Meal, before: string) =>
  useQuery({
    queryKey: ["diary", "meals", meal, before],
    queryFn: () => api.get<PastMeal[]>(`/api/diary/meals?meal=${meal}&before=${before}`),
  });
export const useAddDiaryBatch = () =>
  useWrite((input: DiaryBatchInput) => api.post<{ ids: number[] }>("/api/diary/batch", input), [["diary"]]);
export const useDeleteDiaryEntry = () => useWrite((id: number) => api.del(`/api/diary/${id}`), [["diary"]]);

export const usePortions = (productId: number | null) =>
  useQuery({
    queryKey: ["portions", productId],
    queryFn: () => api.get<Portion[]>(`/api/products/${productId}/portions`),
    enabled: productId != null,
  });
export const useSavePortion = () =>
  useWrite(({ id, productId, ...input }: PortionInput & { id?: number; productId: number }) =>
    id ? api.patch<Created>(`/api/portions/${id}`, input) : api.post<Created>(`/api/products/${productId}/portions`, input), [
    ["portions"],
    ["diary"],
  ]);
export const useDeletePortion = () => useWrite((id: number) => api.del(`/api/portions/${id}`), [["portions"], ["diary"]]);

/** Barcode → product already in the catalog, or a prefill from Open Food Facts (404 when OFF doesn't know it). */
export const lookupBarcode = (code: string) => api.get<OffLookup>(`/api/off/${code}`);

export const scanReceipt = (photo: Blob) => api.post<ScanResult>("/api/receipts/scan", photo);

/** Replaces a saved receipt's photo; the detail query refetches so `hasPhoto` updates. */
export const useUploadReceiptPhoto = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, photo }: { id: number; photo: Blob }) => api.put<void>(`/api/receipts/${id}/photo`, photo),
    onSuccess: (_data, { id }) => qc.invalidateQueries({ queryKey: keys.receipt(id) }),
  });
};

export type PendingScan = { result: ScanResult; photo: Blob; photoUrl: string };

/**
 * The scan result and its photo, handed from the receipts list to the review screen. Kept in memory on purpose:
 * a reload drops it (the photo is only stored once the receipt is saved). Reading doesn't consume it (StrictMode
 * runs state initializers twice); it's cleared once the receipt is saved.
 */
let pendingScan: PendingScan | null = null;
export const setPendingScan = (scan: PendingScan | null) => {
  if (pendingScan && pendingScan.photoUrl !== scan?.photoUrl) URL.revokeObjectURL(pendingScan.photoUrl);
  pendingScan = scan;
};
export const getPendingScan = () => pendingScan;

// Shopping list and pantry (phase 7). The pantry key sits under "diary": every diary or catalog write refreshes it.
export const useShoppingList = () => useQuery({ queryKey: ["shopping"], queryFn: () => api.get<ShoppingListItem[]>("/api/shopping-list") });
export const usePantry = (costMode: CostMode, windowDays: number) =>
  useQuery({
    queryKey: ["diary", "pantry", costMode, windowDays],
    queryFn: () => api.get<PantryItem[]>(`/api/pantry?${new URLSearchParams({ costMode, windowDays: String(windowDays) })}`),
  });
const shopping = [["shopping"], ["diary", "pantry"]] as const;
export const useAddShoppingItem = () => useWrite((input: ShoppingItemInput) => api.post<Created>("/api/shopping-list", input), shopping);
export const useUpdateShoppingItem = () =>
  useWrite(({ id, packages }: { id: number; packages: number | null }) => api.patch<Created>(`/api/shopping-list/${id}`, { packages }), shopping);
export const useDeleteShoppingItem = () => useWrite((id: number) => api.del(`/api/shopping-list/${id}`), shopping);
