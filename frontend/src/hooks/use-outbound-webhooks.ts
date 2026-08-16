import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as webhooksApi from "@/lib/api/outbound-webhooks";
import type { ListWebhookDeliveriesParams, ListWebhooksParams } from "@/lib/api/outbound-webhooks";
import type {
  CreateOutboundWebhookRequest,
  OutboundWebhook,
  UpdateOutboundWebhookRequest,
  WebhookDeliveryStatus,
  WebhookDeliverySummary,
} from "@/lib/api/types";

export const webhookKeys = {
  all: ["admin-outbound-webhooks"] as const,
  events: () => [...webhookKeys.all, "events"] as const,
  lists: () => [...webhookKeys.all, "list"] as const,
  list: (params: Omit<ListWebhooksParams, "cursor">) => [...webhookKeys.lists(), params] as const,
  deliveries: (webhookId: string) => [...webhookKeys.all, webhookId, "deliveries"] as const,
  deliveryList: (webhookId: string, params: Omit<ListWebhookDeliveriesParams, "cursor">) =>
    [...webhookKeys.deliveries(webhookId), "list", params] as const,
  deliveryDetail: (webhookId: string, deliveryId: string) => [...webhookKeys.deliveries(webhookId), "detail", deliveryId] as const,
};

const WEBHOOKS_PAGE_SIZE = 20;
const DELIVERIES_PAGE_SIZE = 20;
const IN_FLIGHT_DELIVERY_STATUSES: WebhookDeliveryStatus[] = ["PENDING", "SENDING", "RETRYING"];

/**
 * `GET /admin/settings/webhooks/events` — statik kod registry'sinden gelir (ARCHITECTURE.md
 * §10.13.10), DB'den DEĞİL. `staleTime: Infinity` — oturum boyunca değişmeyeceği için gereksiz
 * yeniden çekim yapılmaz.
 */
export function useWebhookEvents() {
  return useQuery({
    queryKey: webhookKeys.events(),
    queryFn: () => webhooksApi.listWebhookEvents(),
    staleTime: Infinity,
  });
}

/** "Daha fazla yükle" listesi — `use-export-jobs.ts::useExportJobsList` ile AYNI cursor deseni. */
export function useWebhooksList(params: Omit<ListWebhooksParams, "cursor" | "limit"> = {}) {
  return useInfiniteQuery({
    queryKey: webhookKeys.list(params),
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      webhooksApi.listWebhooks({ ...params, cursor: pageParam ?? undefined, limit: WEBHOOKS_PAGE_SIZE }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor,
  });
}

export function flattenWebhooks(pages: { items: OutboundWebhook[] }[] | undefined): OutboundWebhook[] {
  return pages?.flatMap((page) => page.items) ?? [];
}

/** `plainSecret` mutation sonucunda BİR KEZ döner — çağıran yer bunu kalıcı state'e YAZMAMALI. */
export function useCreateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOutboundWebhookRequest) => webhooksApi.createWebhook(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.lists() });
    },
  });
}

export function useUpdateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ webhookId, input }: { webhookId: string; input: UpdateOutboundWebhookRequest }) =>
      webhooksApi.updateWebhook(webhookId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.lists() });
    },
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (webhookId: string) => webhooksApi.deleteWebhook(webhookId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.lists() });
    },
  });
}

/** Eski secret ANINDA geçersizdir — sonuç `plainSecret`'ı yalnızca bir kez taşır (§10.13.9). */
export function useRotateWebhookSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (webhookId: string) => webhooksApi.rotateWebhookSecret(webhookId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.lists() });
    },
  });
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: (webhookId: string) => webhooksApi.testWebhook(webhookId),
  });
}

/**
 * Delivery log — webhook başına cursor sayfalı liste. Yüklenmiş sayfalarda `PENDING`/`SENDING`/
 * `RETRYING` bir kayıt varsa 4 sn'de bir yeniden çeker (dispatcher sweeper'ı en geç 15 sn'de
 * alır, ARCHITECTURE.md §10.13.8) — `use-export-jobs.ts::useExportJobsList` ile AYNI desen.
 */
export function useWebhookDeliveriesList(
  webhookId: string,
  params: Omit<ListWebhookDeliveriesParams, "cursor" | "limit"> = {},
  options: { enabled?: boolean } = {}
) {
  return useInfiniteQuery({
    queryKey: webhookKeys.deliveryList(webhookId, params),
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      webhooksApi.listWebhookDeliveries(webhookId, { ...params, cursor: pageParam ?? undefined, limit: DELIVERIES_PAGE_SIZE }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor,
    enabled: Boolean(webhookId) && (options.enabled ?? true),
    refetchInterval: (query) => {
      const pages = query.state.data?.pages ?? [];
      const hasInFlight = pages.some((page) => page.items.some((delivery) => IN_FLIGHT_DELIVERY_STATUSES.includes(delivery.status)));
      return hasInFlight ? 4000 : false;
    },
  });
}

export function flattenDeliveries(pages: { items: WebhookDeliverySummary[] }[] | undefined): WebhookDeliverySummary[] {
  return pages?.flatMap((page) => page.items) ?? [];
}

/** `GET .../deliveries/{deliveryId}` — `payload` + `responseBodySnippet` yalnızca burada döner. */
export function useWebhookDelivery(webhookId: string, deliveryId: string | null, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: webhookKeys.deliveryDetail(webhookId, deliveryId ?? "unknown"),
    queryFn: () => webhooksApi.getWebhookDelivery(webhookId, deliveryId!),
    enabled: Boolean(webhookId) && Boolean(deliveryId) && (options.enabled ?? true),
  });
}

/** Kaynak satırın sayaçları DEĞİŞMEZ — YENİ bir delivery satırı üretir (`redeliveryOfId`). */
export function useRedeliverWebhookDelivery(webhookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deliveryId: string) => webhooksApi.redeliverWebhookDelivery(webhookId, deliveryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.deliveries(webhookId) });
    },
  });
}
