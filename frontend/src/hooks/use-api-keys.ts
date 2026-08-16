import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as apiKeysApi from "@/lib/api/api-keys";
import type { ListApiKeysParams } from "@/lib/api/api-keys";
import type { ApiKey, CreateApiKeyRequest, UpdateApiKeyRequest } from "@/lib/api/types";

export const apiKeyKeys = {
  all: ["admin-api-keys"] as const,
  lists: () => [...apiKeyKeys.all, "list"] as const,
  list: (params: Omit<ListApiKeysParams, "cursor">) => [...apiKeyKeys.lists(), params] as const,
};

const API_KEYS_PAGE_SIZE = 20;

/** "Daha fazla yükle" listesi — `use-export-jobs.ts::useExportJobsList` ile AYNI cursor deseni. */
export function useApiKeysList(params: Omit<ListApiKeysParams, "cursor" | "limit"> = {}) {
  return useInfiniteQuery({
    queryKey: apiKeyKeys.list(params),
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      apiKeysApi.listApiKeys({ ...params, cursor: pageParam ?? undefined, limit: API_KEYS_PAGE_SIZE }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor,
  });
}

export function flattenApiKeys(pages: { items: ApiKey[] }[] | undefined): ApiKey[] {
  return pages?.flatMap((page) => page.items) ?? [];
}

/** `plainKey` mutation sonucunda BİR KEZ döner — çağıran yer bunu kalıcı state'e YAZMAMALI. */
export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiKeyRequest) => apiKeysApi.createApiKey(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.lists() });
    },
  });
}

export function useUpdateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ keyId, input }: { keyId: string; input: UpdateApiKeyRequest }) => apiKeysApi.updateApiKey(keyId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.lists() });
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) => apiKeysApi.revokeApiKey(keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.lists() });
    },
  });
}

export function useDeleteApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) => apiKeysApi.deleteApiKey(keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.lists() });
    },
  });
}
