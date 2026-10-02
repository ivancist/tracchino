import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Chain,
  Created,
  LastPrice,
  MeResponse,
  Product,
  ProductGroup,
  ReceiptDetail,
  ReceiptSummary,
  Store,
} from "../shared/api";
import type { ChainInput, GroupInput, ProductInput, ReceiptInput, StoreInput } from "../shared/schemas";
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

const catalog = [keys.chains, keys.stores, keys.groups, keys.products, keys.receipts] as const;

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
