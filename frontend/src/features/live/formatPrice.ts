export function formatPrice(cents: number | null): string {
  if (cents === null) {
    return "价格待定";
  }
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY"
  }).format(cents / 100);
}
