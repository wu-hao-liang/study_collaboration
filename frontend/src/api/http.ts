import type {
  BootstrapResponse,
  ProductDetails,
  ProductSummary
} from "./types";

export async function fetchBootstrap(signal?: AbortSignal): Promise<BootstrapResponse> {
  const response = await fetch("/api/bootstrap", {
    headers: { Accept: "application/json" },
    signal
  });
  if (!response.ok) {
    throw new Error(`bootstrap failed: ${response.status}`);
  }
  return (await response.json()) as BootstrapResponse;
}

export async function fetchProduct(
  productId: string,
  signal?: AbortSignal
): Promise<ProductDetails> {
  const response = await fetch(`/api/products/${encodeURIComponent(productId)}`, {
    headers: { Accept: "application/json" },
    signal
  });
  if (!response.ok) {
    throw new Error(`product failed: ${response.status}`);
  }
  return (await response.json()) as ProductDetails;
}

export async function searchProducts(
  query: string,
  signal?: AbortSignal
): Promise<ProductSummary[]> {
  const response = await fetch(`/api/products?q=${encodeURIComponent(query)}`, {
    headers: { Accept: "application/json" },
    signal
  });
  if (!response.ok) {
    throw new Error(`search failed: ${response.status}`);
  }
  const body = (await response.json()) as { products: ProductSummary[] };
  return body.products;
}

export async function fetchPairing(): Promise<{ token: string; phone_url: string }> {
  const response = await fetch("/api/control-token", {
    method: "POST",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`pairing failed: ${response.status}`);
  }
  return (await response.json()) as { token: string; phone_url: string };
}

export async function validateControlToken(
  token: string,
  signal?: AbortSignal
): Promise<{ valid: boolean; slot: "available" | "occupied" | "invalid" }> {
  const response = await fetch(`/api/control/validate?token=${encodeURIComponent(token)}`, {
    headers: { Accept: "application/json" },
    signal
  });
  if (!response.ok) {
    throw new Error(`control validation failed: ${response.status}`);
  }
  return (await response.json()) as {
    valid: boolean;
    slot: "available" | "occupied" | "invalid";
  };
}

export function websocketUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}
