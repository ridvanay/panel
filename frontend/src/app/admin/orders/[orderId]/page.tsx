"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useForm, useWatch, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  Copy,
  History,
  NotebookPen,
  Pencil,
  PlayCircle,
  PauseCircle,
  RotateCcw,
  ShieldAlert,
  Truck,
  XCircle,
} from "lucide-react";
import * as ordersApi from "@/lib/api/orders";
import type { AdminOrder, AuditStatus, OrderActivityEntry, OrderAddressSnapshot, OrderStatus, UpdateOrderRequest } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TaxSummaryRows } from "@/components/tax-summary-rows";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";
import { formatPriceFromCents } from "@/lib/format-price";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from "@/lib/order-status";
import { ORDER_ACTIVITY_LABELS, ORDER_UPDATE_FIELD_LABELS } from "@/lib/order-activity";
import { useAuth } from "@/context/auth-context";
import { cn } from "@/lib/utils";

// `UpdateOrderStatusRequest` (openapi) — `status: "SHIPPED"` iken `trackingNumber` ZORUNLU
// (backend eksikse 422 döner, bkz. `lib/api/types.ts`). `shippingCarrier` opsiyonel serbest metin.
const shipFormSchema = z.object({
  trackingNumber: z.string().trim().min(1, "Kargo takip numarası gerekli.").max(100, "En fazla 100 karakter olabilir."),
  shippingCarrier: z.string().trim().max(100, "En fazla 100 karakter olabilir.").optional(),
});

type ShipFormValues = z.infer<typeof shipFormSchema>;

// `.claude/architect-scope-order-management-pro.md` §5.2 — backend `checkout.schemas.ts`'in
// (`CheckoutAddressInputSchema`/fatura kuralları) BİREBİR aynası; `sameAsShipping` bu bağlamda
// YOKTUR, admin iki adresi (teslimat + fatura) her zaman TAM ve AYRI gönderir.
const PHONE_REGEX = /^[0-9+()\-\s]{7,20}$/;
const TR_POSTAL_CODE_REGEX = /^\d{5}$/;
const VKN_REGEX = /^\d{10}$/;
const TCKN_REGEX = /^[1-9]\d{10}$/;

function isValidTcKimlikNo(value: string): boolean {
  if (!TCKN_REGEX.test(value)) return false;
  const d = value.split("").map(Number);
  const oddSum = d[0] + d[2] + d[4] + d[6] + d[8];
  const evenSum = d[1] + d[3] + d[5] + d[7];
  const check10 = (((oddSum * 7 - evenSum) % 10) + 10) % 10;
  if (check10 !== d[9]) return false;
  const sum10 = d.slice(0, 10).reduce((sum, digit) => sum + digit, 0);
  return sum10 % 10 === d[10];
}

const editAddressSchema = z.object({
  fullName: z.string().trim().min(1, "Ad soyad zorunludur.").max(120),
  phone: z.string().trim().regex(PHONE_REGEX, "Geçerli bir telefon numarası giriniz."),
  city: z.string().trim().min(1, "Bu alan zorunludur.").max(100),
  district: z.string().trim().min(1, "Bu alan zorunludur.").max(100),
  neighborhood: z.string().trim().max(100).optional(),
  addressLine1: z.string().trim().min(1, "Adres zorunludur.").max(200),
  addressLine2: z.string().trim().max(200).optional(),
  postalCode: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || TR_POSTAL_CODE_REGEX.test(value), "Posta kodu 5 haneli olmalıdır."),
});

type EditAddressValues = z.infer<typeof editAddressSchema>;

const EMPTY_EDIT_ADDRESS: EditAddressValues = {
  fullName: "",
  phone: "",
  city: "",
  district: "",
  neighborhood: "",
  addressLine1: "",
  addressLine2: "",
  postalCode: "",
};

const editOrderFormSchema = z
  .object({
    customerEmail: z.string().trim().min(1, "E-posta gerekli.").max(254).email("Geçerli bir e-posta adresi girin."),
    customerName: z.string().trim().max(200).optional(),
    shippingAddress: editAddressSchema,
    billing: z.object({
      billingType: z.enum(["INDIVIDUAL", "CORPORATE"]),
      companyName: z.string().trim().max(200).optional(),
      taxOffice: z.string().trim().max(100).optional(),
      taxNumber: z.string().trim().optional(),
      nationalId: z.string().trim().optional(),
      address: editAddressSchema,
    }),
  })
  .superRefine((value, ctx) => {
    const { billing } = value;
    if (billing.billingType === "CORPORATE") {
      if (!billing.companyName) {
        ctx.addIssue({ code: "custom", path: ["billing", "companyName"], message: "Kurumsal fatura için firma unvanı zorunludur." });
      }
      if (!billing.taxNumber || !VKN_REGEX.test(billing.taxNumber)) {
        ctx.addIssue({ code: "custom", path: ["billing", "taxNumber"], message: "Vergi numarası 10 haneli olmalıdır." });
      }
      if (billing.nationalId) {
        ctx.addIssue({ code: "custom", path: ["billing", "nationalId"], message: "Kurumsal faturada T.C. kimlik numarası gönderilemez." });
      }
    } else {
      if (billing.companyName || billing.taxOffice || billing.taxNumber) {
        ctx.addIssue({ code: "custom", path: ["billing", "companyName"], message: "Bireysel faturada firma bilgisi gönderilemez." });
      }
      if (billing.nationalId && !isValidTcKimlikNo(billing.nationalId)) {
        ctx.addIssue({ code: "custom", path: ["billing", "nationalId"], message: "Geçerli bir T.C. kimlik numarası giriniz." });
      }
    }
  });

type EditOrderFormValues = z.infer<typeof editOrderFormSchema>;

const EMPTY_EDIT_FORM_VALUES: EditOrderFormValues = {
  customerEmail: "",
  customerName: "",
  shippingAddress: { ...EMPTY_EDIT_ADDRESS },
  billing: {
    billingType: "INDIVIDUAL",
    companyName: "",
    taxOffice: "",
    taxNumber: "",
    nationalId: "",
    address: { ...EMPTY_EDIT_ADDRESS },
  },
};

function addressToFormValues(address: OrderAddressSnapshot): EditAddressValues {
  return {
    fullName: address.fullName,
    phone: address.phone ?? "",
    city: address.city,
    district: address.district,
    neighborhood: address.neighborhood ?? "",
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2 ?? "",
    postalCode: address.postalCode ?? "",
  };
}

// Backend `OrderAddressInputSchema` = `checkout.schemas.ts::CheckoutAddressInputSchema` (DOĞRUDAN
// import edilir, bkz. `orders.schemas.ts`) — `neighborhood`/`addressLine2`/`postalCode` YALNIZCA
// `.optional()`'dır (`undefined`/anahtar OMİT), `.nullable()` DEĞİL; `null` göndermek 422'e yol
// açar ("Expected string, received null"). Dönüş tipi bilerek `OrderAddressSnapshot` DEĞİL
// (`string | null` alanları GET yanıt snapshot'ı için doğrudur, PATCH gövdesi için değil) — çağıran
// taraf `UpdateOrderRequest`'in ilgili alanına atarken cast eder (bkz. `onEditSubmit()`).
function toAddressSnapshot(values: EditAddressValues): Record<string, unknown> {
  return {
    fullName: values.fullName.trim(),
    phone: values.phone.trim(),
    country: "TR",
    city: values.city.trim(),
    district: values.district.trim(),
    neighborhood: values.neighborhood?.trim() ? values.neighborhood.trim() : undefined,
    addressLine1: values.addressLine1.trim(),
    addressLine2: values.addressLine2?.trim() ? values.addressLine2.trim() : undefined,
    postalCode: values.postalCode?.trim() ? values.postalCode.trim() : undefined,
  };
}

// `.claude/design-notes-order-management-pro.md` §5.1 — `checkout/billing-section.tsx` segmented
// control ile BİREBİR aynı sınıflar.
const SEGMENT_LABEL_CLASSES =
  "relative flex h-[calc(100%-1px)] flex-1 cursor-pointer items-center justify-center rounded-md text-sm font-medium transition-all peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50";

// `.claude/design-notes-order-management-pro.md` §5.3 — `app/admin/logs/page.tsx`'teki
// `STATUS_CONFIG` ile BİREBİR aynı desen (o dosyada export edilmediği için burada tekrarlanır).
const ACTIVITY_STATUS_CONFIG: Record<AuditStatus, { icon: typeof CheckCircle2; className: string }> = {
  SUCCESS: { icon: CheckCircle2, className: "bg-success/10 text-success" },
  FAILURE: { icon: XCircle, className: "bg-danger/10 text-danger" },
  FORBIDDEN: { icon: ShieldAlert, className: "bg-warning/10 text-warning" },
};

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

/** §5.3 metadata satırı — allow-list'teki anahtarlara göre eylem başına farklı gösterim. */
function ActivityMetaLine({ entry }: { entry: OrderActivityEntry }) {
  const meta = entry.metadata;
  if (!meta) return null;

  if (entry.action === "order.status_change" && meta.from && meta.to) {
    const fromLabel = ORDER_STATUS_LABELS[meta.from as OrderStatus] ?? String(meta.from);
    const toLabel = ORDER_STATUS_LABELS[meta.to as OrderStatus] ?? String(meta.to);
    return (
      <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-foreground/50">
        {fromLabel}
        <ArrowRight className="h-3 w-3 shrink-0" />
        {toLabel}
      </p>
    );
  }

  if (entry.action === "order.update" && Array.isArray(meta.fields) && meta.fields.length > 0) {
    const fields = meta.fields as string[];
    return (
      <p className="mt-1 text-xs text-foreground/50">
        Değişen alanlar: {fields.map((field) => ORDER_UPDATE_FIELD_LABELS[field] ?? field).join(", ")}
      </p>
    );
  }

  if (entry.action === "order.refund" && typeof meta.reason === "string" && meta.reason) {
    return <p className="mt-1 text-xs text-foreground/50">{meta.reason}</p>;
  }

  if (entry.action === "order.cancel_email" && typeof meta.emailDelivered === "boolean") {
    return (
      <p className={cn("mt-1 text-xs", meta.emailDelivered ? "text-foreground/50" : "text-danger")}>
        {meta.emailDelivered ? "E-posta gönderildi" : "E-posta gönderilemedi"}
      </p>
    );
  }

  return null;
}

export default function AdminOrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pendingAction, setPendingAction] = useState<null | "ON_HOLD" | "PAID" | "FULFILLED">(null);

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelReasonError, setCancelReasonError] = useState<string | null>(null);
  const [cancelSendEmail, setCancelSendEmail] = useState(true);
  const [cancelConfirmWithoutRefund, setCancelConfirmWithoutRefund] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refunding, setRefunding] = useState(false);

  const [shipDialogOpen, setShipDialogOpen] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  const [activity, setActivity] = useState<OrderActivityEntry[] | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);

  const {
    register: registerShip,
    handleSubmit: handleShipSubmit,
    reset: resetShipForm,
    setError: setShipFieldError,
    formState: { errors: shipErrors, isSubmitting: shipping },
  } = useForm<ShipFormValues>({
    resolver: zodResolver(shipFormSchema),
    defaultValues: { trackingNumber: "", shippingCarrier: "" },
  });

  const {
    register: registerEdit,
    control: editControl,
    handleSubmit: handleEditSubmit,
    reset: resetEditForm,
    setError: setEditFieldError,
    formState: { errors: editErrors },
  } = useForm<EditOrderFormValues>({
    resolver: zodResolver(editOrderFormSchema),
    defaultValues: EMPTY_EDIT_FORM_VALUES,
  });

  const billingType = useWatch({ control: editControl, name: "billing.billingType" });

  const load = useCallback(async () => {
    setError(null);
    try {
      const fetched = await ordersApi.getOrder(orderId);
      setOrder(fetched);
      setNotesDraft(fetched.adminNotes ?? "");
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, [orderId]);

  const loadActivity = useCallback(async () => {
    setActivityError(null);
    setActivity(null);
    try {
      setActivity(await ordersApi.getOrderActivity(orderId));
    } catch (err) {
      setActivityError(friendlyErrorMessage(err));
    }
  }, [orderId]);

  useEffect(() => {
    (async () => {
      await Promise.all([load(), loadActivity()]);
    })();
  }, [load, loadActivity]);

  async function handleStatusChange(status: "ON_HOLD" | "PAID" | "FULFILLED") {
    setPendingAction(status);
    try {
      const updated = await ordersApi.updateOrderStatus(orderId, { status });
      setOrder(updated);
      toast.success("Sipariş durumu güncellendi.");
      void loadActivity();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setPendingAction(null);
    }
  }

  function openCancelDialog() {
    setCancelReason("");
    setCancelReasonError(null);
    setCancelSendEmail(true);
    setCancelConfirmWithoutRefund(false);
    setCancelDialogOpen(true);
  }

  async function handleCancelSubmit() {
    if (!order) return;
    const reason = cancelReason.trim();
    if (!reason) {
      setCancelReasonError("İptal nedeni zorunludur.");
      return;
    }
    if (order.paidAt != null && !cancelConfirmWithoutRefund) return;

    setCancelling(true);
    try {
      const updated = await ordersApi.updateOrderStatus(orderId, {
        status: "CANCELLED",
        cancellationReason: reason,
        sendCustomerEmail: cancelSendEmail,
        confirmWithoutRefund: order.paidAt != null ? cancelConfirmWithoutRefund : undefined,
      });
      setOrder(updated);
      toast.success("Sipariş iptal edildi.");
      setCancelDialogOpen(false);
      void loadActivity();
    } catch (err) {
      const fieldErrors = fieldErrorsFrom(err);
      if (fieldErrors.cancellationReason) {
        setCancelReasonError(fieldErrors.cancellationReason);
      } else {
        toast.error(friendlyErrorMessage(err));
      }
    } finally {
      setCancelling(false);
    }
  }

  function openShipDialog() {
    resetShipForm({ trackingNumber: "", shippingCarrier: "" });
    setShipDialogOpen(true);
  }

  async function onShipSubmit(values: ShipFormValues) {
    try {
      const updated = await ordersApi.updateOrderStatus(orderId, {
        status: "SHIPPED",
        trackingNumber: values.trackingNumber,
        shippingCarrier: values.shippingCarrier || undefined,
      });
      setOrder(updated);
      toast.success("Sipariş kargoya verildi.");
      setShipDialogOpen(false);
      void loadActivity();
    } catch (err) {
      const fieldErrors = fieldErrorsFrom(err);
      if (fieldErrors.trackingNumber) {
        setShipFieldError("trackingNumber", { message: fieldErrors.trackingNumber });
      } else if (fieldErrors.shippingCarrier) {
        setShipFieldError("shippingCarrier", { message: fieldErrors.shippingCarrier });
      } else {
        toast.error(friendlyErrorMessage(err));
      }
    }
  }

  function copyTracking() {
    if (!order?.trackingNumber) return;
    navigator.clipboard.writeText(order.trackingNumber).then(
      () => toast.success("Takip numarası panoya kopyalandı."),
      () => toast.error("Panoya kopyalanamadı.")
    );
  }

  async function handleRefund() {
    setRefunding(true);
    try {
      const updated = await ordersApi.refundOrder(orderId, refundReason.trim() || undefined);
      setOrder(updated);
      toast.success("Sipariş iade edildi.");
      setRefundDialogOpen(false);
      setRefundReason("");
      void loadActivity();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setRefunding(false);
    }
  }

  function openEditMode() {
    if (!order) return;
    resetEditForm({
      customerEmail: order.customerEmail,
      customerName: order.customerName ?? "",
      shippingAddress: order.shippingAddress ? addressToFormValues(order.shippingAddress) : { ...EMPTY_EDIT_ADDRESS },
      billing: order.billing
        ? {
            billingType: order.billing.billingType,
            companyName: order.billing.companyName ?? "",
            taxOffice: order.billing.taxOffice ?? "",
            taxNumber: order.billing.taxNumber ?? "",
            nationalId: order.billing.nationalId ?? "",
            address: addressToFormValues(order.billing.address),
          }
        : { ...EMPTY_EDIT_FORM_VALUES.billing },
    });
    setEditMode(true);
  }

  async function onEditSubmit(values: EditOrderFormValues) {
    setSavingOrder(true);
    try {
      // Backend `OrderBillingInputSchema` (`orders.schemas.ts` — checkout'un
      // `CheckoutBillingInputSchema`'sıyla AYNI desen) uygulanamayan alt-alanları
      // (`companyName`/`taxOffice`/`taxNumber` INDIVIDUAL'de, `nationalId` CORPORATE'te)
      // YALNIZCA `.optional()` kabul eder — anahtar hiç GÖNDERİLMEMELİ (`undefined`), `null`
      // DEĞİL (aksi halde 422 "Expected string, received null"). checkout'un
      // `buildCheckoutRequest`'iyle (bkz. `components/site/checkout/checkout-schema.ts`) AYNI
      // desen: uygulanamayan alanlar objeye hiç eklenmez/`undefined` bırakılır, `JSON.stringify`
      // (bkz. `lib/api/client.ts::doFetch`) bu anahtarları gövdeden zaten düşürür.
      const billingPayload: Record<string, unknown> = {
        billingType: values.billing.billingType,
        address: toAddressSnapshot(values.billing.address),
      };
      if (values.billing.billingType === "CORPORATE") {
        billingPayload.companyName = values.billing.companyName?.trim();
        billingPayload.taxOffice = values.billing.taxOffice?.trim() ? values.billing.taxOffice.trim() : undefined;
        billingPayload.taxNumber = values.billing.taxNumber?.trim();
      } else if (values.billing.nationalId?.trim()) {
        billingPayload.nationalId = values.billing.nationalId.trim();
      }

      const payload: UpdateOrderRequest = {
        customerEmail: values.customerEmail.trim(),
        customerName: values.customerName?.trim() ? values.customerName.trim() : null,
        shippingAddress: toAddressSnapshot(values.shippingAddress) as unknown as UpdateOrderRequest["shippingAddress"],
        billing: billingPayload as unknown as UpdateOrderRequest["billing"],
      };
      const updated = await ordersApi.updateOrder(orderId, payload);
      setOrder(updated);
      setNotesDraft(updated.adminNotes ?? "");
      toast.success("Sipariş güncellendi.");
      setEditMode(false);
      void loadActivity();
    } catch (err) {
      const fieldErrors = fieldErrorsFrom(err);
      for (const [field, message] of Object.entries(fieldErrors)) {
        setEditFieldError(field as FieldPath<EditOrderFormValues>, { message });
      }
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSavingOrder(false);
    }
  }

  async function handleSaveNotes() {
    setSavingNotes(true);
    try {
      const updated = await ordersApi.updateOrder(orderId, { adminNotes: notesDraft.trim() ? notesDraft : null });
      setOrder(updated);
      setNotesDraft(updated.adminNotes ?? "");
      toast.success("Not kaydedildi.");
      void loadActivity();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSavingNotes(false);
    }
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </span>
        </Alert>
        <Button variant="outline" onClick={() => load()}>
          Tekrar Dene
        </Button>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  const canEditOrder = order.status === "PENDING" || order.status === "PAID" || order.status === "ON_HOLD";

  const showCancel = isAdmin && (order.status === "PENDING" || order.status === "ON_HOLD");
  const showHold = isAdmin && order.status === "PAID";
  const showRefund = order.status === "PAID" || order.status === "SHIPPED" || order.status === "FULFILLED" || order.status === "ON_HOLD";
  const showShip = order.status === "PAID";
  const showApprove = isAdmin && order.status === "ON_HOLD";
  const showFulfill = order.status === "PAID" || order.status === "SHIPPED";

  const leftGroupVisible = showCancel || showHold || showRefund;
  const rightGroupVisible = showShip || showApprove || showFulfill;

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-16">
      <div>
        <Link
          href="/admin/orders"
          className="inline-flex items-center gap-1 text-sm text-foreground/60 transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Siparişler
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="admin-h1">Sipariş {order.orderNumber}</h1>
            <p className="mt-1 admin-text-secondary">{dateFormatter.format(new Date(order.createdAt))}</p>
          </div>
          <Badge tone={ORDER_STATUS_TONE[order.status]} size="lg">
            {ORDER_STATUS_LABELS[order.status]}
          </Badge>
        </div>

        {(leftGroupVisible || rightGroupVisible) && (
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
            {showCancel && (
              <Button variant="destructive" onClick={openCancelDialog}>
                <XCircle className="h-4 w-4" />
                İptal Et
              </Button>
            )}
            {showHold && (
              <Button variant="warning" loading={pendingAction === "ON_HOLD"} disabled={pendingAction !== null} onClick={() => handleStatusChange("ON_HOLD")}>
                <PauseCircle className="h-4 w-4" />
                Askıya Al
              </Button>
            )}
            {showRefund && (
              <Button variant="outline" onClick={() => setRefundDialogOpen(true)}>
                <RotateCcw className="h-4 w-4" />
                İade Et
              </Button>
            )}

            {leftGroupVisible && rightGroupVisible && <div className="hidden h-6 w-px shrink-0 bg-border sm:block" />}

            {showShip && (
              <Button variant="outline" onClick={openShipDialog}>
                <Truck className="h-4 w-4" />
                Kargoya Ver
              </Button>
            )}
            {showApprove && (
              <Button variant="success" loading={pendingAction === "PAID"} disabled={pendingAction !== null} onClick={() => handleStatusChange("PAID")}>
                <PlayCircle className="h-4 w-4" />
                Siparişi Onayla
              </Button>
            )}
            {showFulfill && (
              <Button loading={pendingAction === "FULFILLED"} disabled={pendingAction !== null} onClick={() => handleStatusChange("FULFILLED")}>
                <CheckCircle2 className="h-4 w-4" />
                Tamamlandı Olarak İşaretle
              </Button>
            )}
          </div>
        )}
      </div>

      {order.errorSummary && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {order.errorSummary}
          </span>
        </Alert>
      )}

      <Card className="space-y-1">
        <div className="flex items-center justify-between">
          <h2 className="admin-h2">Müşteri</h2>
          {isAdmin &&
            !editMode &&
            (canEditOrder ? (
              <Button variant="outline" size="sm" onClick={openEditMode}>
                <Pencil className="h-4 w-4" />
                Düzenle
              </Button>
            ) : (
              <p className="text-xs text-foreground/50">Kargoya verilmiş veya kapanmış bir siparişin iletişim/adres bilgisi değiştirilemez.</p>
            ))}
        </div>
        {editMode ? (
          <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
            <Field id="customerName" label="Müşteri Adı" error={editErrors.customerName?.message}>
              {(inputProps) => <Input {...inputProps} {...registerEdit("customerName")} />}
            </Field>
            <Field id="customerEmail" label="E-posta" error={editErrors.customerEmail?.message} required>
              {(inputProps) => <Input {...inputProps} type="email" {...registerEdit("customerEmail")} />}
            </Field>
          </div>
        ) : (
          <>
            <p className="text-sm text-foreground">{order.customerName ?? "—"}</p>
            <p className="text-sm text-foreground/60">{order.customerEmail}</p>
          </>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="admin-h2">Teslimat Adresi</h2>
        {editMode ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="shippingAddress.fullName" label="Ad Soyad" error={editErrors.shippingAddress?.fullName?.message} required>
                {(inputProps) => <Input {...inputProps} {...registerEdit("shippingAddress.fullName")} />}
              </Field>
              <Field id="shippingAddress.phone" label="Telefon" error={editErrors.shippingAddress?.phone?.message} required>
                {(inputProps) => <Input {...inputProps} type="tel" {...registerEdit("shippingAddress.phone")} />}
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="shippingAddress.city" label="İl" error={editErrors.shippingAddress?.city?.message} required>
                {(inputProps) => <Input {...inputProps} {...registerEdit("shippingAddress.city")} />}
              </Field>
              <Field id="shippingAddress.district" label="İlçe" error={editErrors.shippingAddress?.district?.message} required>
                {(inputProps) => <Input {...inputProps} {...registerEdit("shippingAddress.district")} />}
              </Field>
            </div>
            <Field id="shippingAddress.neighborhood" label="Mahalle">
              {(inputProps) => <Input {...inputProps} {...registerEdit("shippingAddress.neighborhood")} />}
            </Field>
            <Field id="shippingAddress.addressLine1" label="Adres Satırı" error={editErrors.shippingAddress?.addressLine1?.message} required>
              {(inputProps) => <Input {...inputProps} {...registerEdit("shippingAddress.addressLine1")} />}
            </Field>
            <Field id="shippingAddress.addressLine2" label="Adres Satırı 2" hint="Opsiyonel.">
              {(inputProps) => <Input {...inputProps} {...registerEdit("shippingAddress.addressLine2")} />}
            </Field>
            <div className="sm:max-w-[200px]">
              <Field id="shippingAddress.postalCode" label="Posta Kodu" error={editErrors.shippingAddress?.postalCode?.message}>
                {(inputProps) => <Input {...inputProps} inputMode="numeric" maxLength={5} {...registerEdit("shippingAddress.postalCode")} />}
              </Field>
            </div>
          </div>
        ) : order.shippingAddress ? (
          <div>
            <p className="text-sm font-medium text-foreground">{order.shippingAddress.fullName}</p>
            {order.shippingAddress.phone && <p className="text-sm text-foreground/60">{order.shippingAddress.phone}</p>}
            <p className="mt-1.5 text-sm leading-relaxed text-foreground/70">
              {order.shippingAddress.addressLine1}
              {order.shippingAddress.addressLine2 && `, ${order.shippingAddress.addressLine2}`}
              <br />
              {[order.shippingAddress.neighborhood, order.shippingAddress.district, order.shippingAddress.city].filter(Boolean).join(" / ")}
              {order.shippingAddress.postalCode && ` ${order.shippingAddress.postalCode}`}
            </p>
          </div>
        ) : (
          <p className="text-sm text-foreground/50">Bu sipariş için adres kaydı yok.</p>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="admin-h2">Fatura Bilgisi</h2>
        {editMode ? (
          <div className="space-y-4">
            <div role="radiogroup" aria-label="Fatura Tipi" className="flex h-8 w-full items-center rounded-lg bg-muted p-[3px]">
              <label
                className={cn(
                  SEGMENT_LABEL_CLASSES,
                  billingType === "INDIVIDUAL" ? "bg-background text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground"
                )}
              >
                <input type="radio" value="INDIVIDUAL" className="peer sr-only" {...registerEdit("billing.billingType")} />
                Bireysel
              </label>
              <label
                className={cn(
                  SEGMENT_LABEL_CLASSES,
                  billingType === "CORPORATE" ? "bg-background text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground"
                )}
              >
                <input type="radio" value="CORPORATE" className="peer sr-only" {...registerEdit("billing.billingType")} />
                Kurumsal
              </label>
            </div>

            {billingType === "CORPORATE" && (
              <div className="space-y-4 rounded-lg border border-border/60 bg-surface-muted/50 p-4">
                <Field id="billing.companyName" label="Firma Unvanı" error={editErrors.billing?.companyName?.message} required>
                  {(inputProps) => <Input {...inputProps} {...registerEdit("billing.companyName")} />}
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field id="billing.taxOffice" label="Vergi Dairesi" hint="Opsiyonel.">
                    {(inputProps) => <Input {...inputProps} {...registerEdit("billing.taxOffice")} />}
                  </Field>
                  <Field id="billing.taxNumber" label="Vergi No" error={editErrors.billing?.taxNumber?.message} required>
                    {(inputProps) => <Input {...inputProps} inputMode="numeric" maxLength={10} {...registerEdit("billing.taxNumber")} />}
                  </Field>
                </div>
              </div>
            )}

            {billingType === "INDIVIDUAL" && (
              <Field id="billing.nationalId" label="T.C. Kimlik No" hint="Opsiyonel." error={editErrors.billing?.nationalId?.message}>
                {(inputProps) => <Input {...inputProps} inputMode="numeric" maxLength={11} {...registerEdit("billing.nationalId")} />}
              </Field>
            )}

            <div className="space-y-4 border-t border-border pt-4">
              <p className="text-sm font-medium text-foreground">Fatura Adresi</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="billing.address.fullName" label="Ad Soyad" error={editErrors.billing?.address?.fullName?.message} required>
                  {(inputProps) => <Input {...inputProps} {...registerEdit("billing.address.fullName")} />}
                </Field>
                <Field id="billing.address.phone" label="Telefon" error={editErrors.billing?.address?.phone?.message} required>
                  {(inputProps) => <Input {...inputProps} type="tel" {...registerEdit("billing.address.phone")} />}
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="billing.address.city" label="İl" error={editErrors.billing?.address?.city?.message} required>
                  {(inputProps) => <Input {...inputProps} {...registerEdit("billing.address.city")} />}
                </Field>
                <Field id="billing.address.district" label="İlçe" error={editErrors.billing?.address?.district?.message} required>
                  {(inputProps) => <Input {...inputProps} {...registerEdit("billing.address.district")} />}
                </Field>
              </div>
              <Field id="billing.address.neighborhood" label="Mahalle">
                {(inputProps) => <Input {...inputProps} {...registerEdit("billing.address.neighborhood")} />}
              </Field>
              <Field id="billing.address.addressLine1" label="Adres Satırı" error={editErrors.billing?.address?.addressLine1?.message} required>
                {(inputProps) => <Input {...inputProps} {...registerEdit("billing.address.addressLine1")} />}
              </Field>
              <Field id="billing.address.addressLine2" label="Adres Satırı 2" hint="Opsiyonel.">
                {(inputProps) => <Input {...inputProps} {...registerEdit("billing.address.addressLine2")} />}
              </Field>
              <div className="sm:max-w-[200px]">
                <Field id="billing.address.postalCode" label="Posta Kodu" error={editErrors.billing?.address?.postalCode?.message}>
                  {(inputProps) => <Input {...inputProps} inputMode="numeric" maxLength={5} {...registerEdit("billing.address.postalCode")} />}
                </Field>
              </div>
            </div>
          </div>
        ) : order.billing ? (
          <div className="space-y-2">
            <Badge tone="neutral">{order.billing.billingType === "CORPORATE" ? "Kurumsal" : "Bireysel"}</Badge>
            {order.billing.billingType === "CORPORATE" ? (
              <div className="text-sm text-foreground/70">
                {order.billing.companyName && <p>{order.billing.companyName}</p>}
                {(order.billing.taxOffice || order.billing.taxNumber) && (
                  <p>{[order.billing.taxOffice, order.billing.taxNumber].filter(Boolean).join(" · ")}</p>
                )}
              </div>
            ) : (
              order.billing.nationalId && <p className="text-sm text-foreground/70">TCKN: {order.billing.nationalId}</p>
            )}
            <p className="text-sm leading-relaxed text-foreground/70">
              {order.billing.address.addressLine1}
              {order.billing.address.addressLine2 && `, ${order.billing.address.addressLine2}`}
              <br />
              {[order.billing.address.neighborhood, order.billing.address.district, order.billing.address.city].filter(Boolean).join(" / ")}
              {order.billing.address.postalCode && ` ${order.billing.address.postalCode}`}
            </p>
          </div>
        ) : (
          <p className="text-sm text-foreground/50">Bu sipariş için adres kaydı yok.</p>
        )}
      </Card>

      {editMode && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setEditMode(false)} disabled={savingOrder}>
            Vazgeç
          </Button>
          <Button onClick={handleEditSubmit(onEditSubmit)} loading={savingOrder}>
            Kaydet
          </Button>
        </div>
      )}

      {order.trackingNumber && (
        <Card>
          <div>
            <p className="mb-1.5 text-sm font-medium text-foreground">Kargo Takip Numarası</p>
            <div className="flex items-center gap-2">
              <div className="break-all rounded-lg border border-border bg-surface-muted p-3 font-mono text-sm text-foreground/90">
                {order.trackingNumber}
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={copyTracking}
                aria-label="Takip numarasını kopyala"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            {order.shippingCarrier && (
              <p className="mt-1.5 text-sm text-foreground/60">Taşıyıcı: {order.shippingCarrier}</p>
            )}
            {order.shippedAt && (
              <p className="mt-1.5 text-sm text-foreground/60">
                Kargoya verildi: {dateFormatter.format(new Date(order.shippedAt))}
              </p>
            )}
            {order.deliveredAt && (
              <p className="mt-1.5 text-sm text-foreground/60">
                Teslim edildi: {dateFormatter.format(new Date(order.deliveredAt))}
              </p>
            )}
          </div>
        </Card>
      )}

      <div>
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ürün</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Birim Fiyat</TableHead>
                <TableHead className="text-right">Adet</TableHead>
                <TableHead className="text-right">Toplam</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium text-foreground">
                    {item.productTitle}
                    {item.variantLabel && <p className="text-xs font-normal text-foreground/60">{item.variantLabel}</p>}
                  </TableCell>
                  <TableCell className="text-foreground/60">{item.productSku ?? "—"}</TableCell>
                  <TableCell className="text-right">{formatPriceFromCents(item.unitPriceCents, order.currency)}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{formatPriceFromCents(item.lineTotalCents, order.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <p className="mt-2 text-xs text-foreground/50">
          Sipariş kalemleri mali kayıttır ve düzenlenemez; düzeltme için &quot;İade Et&quot; veya &quot;Askıya Al → İptal Et&quot; akışını kullanın.
        </p>
      </div>

      <Card className="ml-auto max-w-xs space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground/60">Ara Toplam</span>
          <span className="text-foreground">{formatPriceFromCents(order.subtotalCents, order.currency)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground/60">İndirim</span>
          <span className="text-foreground">-{formatPriceFromCents(order.discountCents, order.currency)}</span>
        </div>
        <TaxSummaryRows
          tax={order.tax}
          currency={order.currency}
          className="flex items-center justify-between text-sm"
          labelClassName="text-foreground/60"
          valueClassName="text-foreground"
          subRowClassName="text-xs text-foreground/50"
        />
        <div className="flex items-center justify-between border-t border-border pt-2 text-base font-semibold">
          <span className="text-foreground">Toplam</span>
          <span className="text-foreground">{formatPriceFromCents(order.totalCents, order.currency)}</span>
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <NotebookPen className="h-4 w-4 text-foreground/50" />
          <h2 className="admin-h2">Dahili Not</h2>
        </div>
        {isAdmin ? (
          <>
            <Textarea
              rows={4}
              maxLength={5000}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="Bu sipariş hakkında dahili not…"
              aria-label="Dahili not"
            />
            <div className="flex justify-end">
              <Button size="sm" disabled={notesDraft === (order.adminNotes ?? "")} loading={savingNotes} onClick={handleSaveNotes}>
                Kaydet
              </Button>
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-border bg-surface-muted p-3 text-sm whitespace-pre-wrap text-foreground/80">
            {order.adminNotes || <span className="text-foreground/40">Not girilmemiş.</span>}
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-foreground/50" />
          <h2 className="admin-h2">Aktivite Günlüğü</h2>
        </div>
        {activityError ? (
          <Alert variant="error">
            <span className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {activityError}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadActivity()}>
                Tekrar Dene
              </Button>
            </span>
          </Alert>
        ) : activity === null ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-5 w-5 text-primary" />
          </div>
        ) : activity.length === 0 ? (
          <p className="text-sm text-foreground/50">Henüz bir aktivite kaydı yok.</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {activity.map((entry) => {
              const config = ACTIVITY_STATUS_CONFIG[entry.status];
              const Icon = config.icon;
              return (
                <div key={entry.id} className="flex items-start gap-3 p-3">
                  <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", config.className)}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{ORDER_ACTIVITY_LABELS[entry.action] ?? entry.action}</p>
                      <span className="shrink-0 text-xs text-foreground/50">{dateFormatter.format(new Date(entry.createdAt))}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-foreground/60">{entry.actorEmail ?? "Sistem"}</p>
                    <ActivityMetaLine entry={entry} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Dialog
        open={cancelDialogOpen}
        onOpenChange={(next) => {
          if (cancelling) return;
          setCancelDialogOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Siparişi iptal et</DialogTitle>
            <DialogDescription>
              {`"${order.orderNumber}" numaralı siparişi iptal etmek istediğinize emin misiniz?`}
            </DialogDescription>
          </DialogHeader>

          <Field
            id="cancelReason"
            label="İptal Nedeni"
            required
            hint="Bu metin müşteriye gönderilecek e-postada aynen yer alır."
            error={cancelReasonError ?? undefined}
          >
            {(inputProps) => (
              <Textarea
                {...inputProps}
                rows={3}
                maxLength={500}
                value={cancelReason}
                onChange={(e) => {
                  setCancelReason(e.target.value);
                  if (cancelReasonError) setCancelReasonError(null);
                }}
                placeholder="İptal sebebini yazın…"
              />
            )}
          </Field>

          <label htmlFor="sendCustomerEmail" className="flex items-center gap-2.5 text-sm font-medium text-foreground">
            <Checkbox
              id="sendCustomerEmail"
              checked={cancelSendEmail}
              onCheckedChange={(checked) => setCancelSendEmail(checked === true)}
            />
            Müşteriye e-posta gönderilsin
          </label>

          {order.paidAt != null && (
            <div className="space-y-3 rounded-lg border border-danger/30 bg-danger/10 p-4">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                <p className="text-sm text-danger">
                  Bu siparişin ödemesi alınmış. İptal etmek parayı <strong>otomatik iade etmez</strong> — önce
                  &quot;İade Et&quot; ile Stripe iadesi yapın (durum &quot;İade Edildi&quot; olur) veya iadeyi
                  kendiniz yürüteceğinizi aşağıda onaylayın.
                </p>
              </div>
              <label htmlFor="confirmWithoutRefund" className="flex items-center gap-2.5 pl-6 text-sm font-medium text-danger">
                <Checkbox
                  id="confirmWithoutRefund"
                  checked={cancelConfirmWithoutRefund}
                  onCheckedChange={(checked) => setCancelConfirmWithoutRefund(checked === true)}
                />
                Parayı kendim/başka bir yolla iade edeceğimi onaylıyorum
              </label>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancelDialogOpen(false)} disabled={cancelling}>
              Vazgeç
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={cancelling}
              disabled={!cancelReason.trim() || (order.paidAt != null && !cancelConfirmWithoutRefund)}
              onClick={handleCancelSubmit}
            >
              <XCircle className="h-4 w-4" />
              İptal Et
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={refundDialogOpen}
        onOpenChange={(next) => {
          setRefundDialogOpen(next);
          if (!next) setRefundReason("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Siparişi iade et</DialogTitle>
            <DialogDescription>
              {`"${order.orderNumber}" numaralı siparişi iade etmek istediğinize emin misiniz? Bu işlem geri alınamaz.`}
            </DialogDescription>
          </DialogHeader>

          <Field id="refundReason" label="Sebep" hint="Opsiyonel — yalnızca dahili kayıt amaçlıdır.">
            {(inputProps) => (
              <Textarea
                {...inputProps}
                rows={3}
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="İade sebebini yazın…"
              />
            )}
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRefundDialogOpen(false)}>
              Vazgeç
            </Button>
            <Button type="button" variant="destructive" loading={refunding} onClick={handleRefund}>
              İade Et
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={shipDialogOpen}
        onOpenChange={(next) => {
          if (!shipping) setShipDialogOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Siparişi kargoya ver</DialogTitle>
            <DialogDescription>
              {`"${order.orderNumber}" numaralı sipariş için kargo takip numarasını girin. Sipariş durumu "Kargoda" olarak güncellenir.`}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleShipSubmit(onShipSubmit)} noValidate className="space-y-4">
            <Field id="trackingNumber" label="Kargo Takip Numarası" error={shipErrors.trackingNumber?.message} required>
              {(inputProps) => (
                <Input {...inputProps} maxLength={100} placeholder="ör. TR123456789" {...registerShip("trackingNumber")} />
              )}
            </Field>
            <Field id="shippingCarrier" label="Kargo Firması" error={shipErrors.shippingCarrier?.message} hint="Opsiyonel.">
              {(inputProps) => (
                <Input {...inputProps} maxLength={100} placeholder="ör. Yurtiçi Kargo" {...registerShip("shippingCarrier")} />
              )}
            </Field>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShipDialogOpen(false)} disabled={shipping}>
                Vazgeç
              </Button>
              <Button type="submit" loading={shipping}>
                <Truck className="h-4 w-4" />
                Kargoya Ver
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
