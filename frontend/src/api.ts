export interface User {
  id: string;
  email: string;
  name: string;
  role: "CUSTOMER" | "STAFF" | "ADMIN";
}
export interface Seat {
  id: string;
  row_label: string;
  number: number;
  tier: string;
  price: number;
  status: "AVAILABLE" | "HELD" | "BOOKED";
}
export interface Event {
  id: string;
  title: string;
  venue: string;
  city: string;
  description: string;
  starts_at: string;
  available: number;
  seat_count: number;
  min_price: number;
  seats?: Seat[];
  serverTime?: string;
}
export interface Booking {
  id: string;
  event_id: string;
  title: string;
  venue: string;
  starts_at: string;
  state: "HELD" | "CONFIRMED" | "EXPIRED" | "CANCELLED";
  expires_at: string;
  total: number;
  currency: string;
  ticket_token?: string;
  checked_in_at?: string;
  items: { label: string; price: number }[];
  payment: {
    id: string;
    state: string;
    amount: number;
    provider?: string;
  } | null;
  refund: { state: string; amount: number; reason: string } | null;
}
let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch("/api" + path, {
    method,
    credentials: "include",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(method === "GET" ? {} : { "X-CSRF-Token": csrf }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res
    .json()
    .catch(() => ({ message: "Unexpected response" }));
  if (!res.ok)
    throw new ApiError(
      Array.isArray(data.message)
        ? data.message.join(". ")
        : (data.message ?? "Request failed"),
      res.status,
    );
  return data;
}
export const money = (n: number) =>
  new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n / 100);
export const date = (s: string) =>
  new Date(s).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
