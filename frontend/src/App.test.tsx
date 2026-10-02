import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import App from "./App";
import { setCsrf } from "./api";
const event = {
  id: "event-1",
  title: "Dhaka Developer Summit",
  city: "Dhaka",
  venue: "Innovation Hall",
  starts_at: "2026-12-01T12:00:00Z",
  available: 2,
  seat_count: 3,
  min_price: 75000,
  description: "Demo event",
  seats: [
    {
      id: "s1",
      row_label: "A",
      number: 1,
      tier: "PREMIUM",
      price: 100000,
      status: "AVAILABLE",
    },
    {
      id: "s2",
      row_label: "A",
      number: 2,
      tier: "PREMIUM",
      price: 100000,
      status: "BOOKED",
    },
    {
      id: "s3",
      row_label: "A",
      number: 3,
      tier: "PREMIUM",
      price: 100000,
      status: "AVAILABLE",
    },
  ],
};
let loggedIn = false;
let providers = false;
let boundProvider: string | null = null;
const customer = {
  id: "u1",
  name: "Imran",
  email: "customer@example.com",
  role: "CUSTOMER",
};
beforeEach(() => {
  loggedIn = false;
  providers = false;
  boundProvider = null;
  setCsrf("");
  sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options: any = {}) => {
      let data: any = {},
        status = 200;
      if (path === "/api/payment-checkout/methods")
        data = {
          sandbox: true,
          sslcommerz: providers,
          bkash: providers,
          environment: "sandbox",
        };
      else if (path === "/api/auth/me") {
        data = loggedIn
          ? { user: customer, csrf: "csrf-test" }
          : { message: "Please sign in" };
        status = loggedIn ? 200 : 401;
      } else if (path.startsWith("/api/events?")) data = [event];
      else if (path === "/api/events/event-1") data = event;
      else if (path === "/api/auth/login") {
        data = { user: customer, csrf: "csrf-test" };
        loggedIn = true;
      } else if (path === "/api/bookings/holds")
        data = {
          id: "b1",
          title: event.title,
          venue: event.venue,
          starts_at: event.starts_at,
          state: "HELD",
          total: 100000,
          expires_at: new Date(Date.now() + 300000).toISOString(),
          items: [{ label: "A1", price: 100000 }],
          payment: boundProvider
            ? {
                id: "p1",
                provider: boundProvider,
                state: "CREATED",
                amount: 100000,
              }
            : null,
          refund: null,
        };
      else if (path.endsWith("/audit")) data = [];
      return { ok: status < 400, status, json: async () => data };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("renders event discovery and opens accessible seat map", async () => {
  render(<App />);
  await userEvent.click(
    await screen.findByRole("button", { name: /Pick seats/i }),
  );
  expect(
    await screen.findByRole("group", { name: "Choose seats" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Seat A2, BOOKED/ }),
  ).toBeDisabled();
});
it("anonymous reservation opens sign-in instead of creating a hold", async () => {
  render(<App />);
  await userEvent.click(
    await screen.findByRole("button", { name: /Pick seats/i }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: /Seat A1, AVAILABLE/ }),
  );
  await userEvent.click(screen.getByRole("button", { name: /Reserve seats/ }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(
    (fetch as any).mock.calls.some((c: any) => c[0] === "/api/bookings/holds"),
  ).toBe(false);
});
it("signed-in customer reserves with CSRF and idempotency headers", async () => {
  loggedIn = true;
  render(<App />);
  await screen.findByText("Imran");
  await userEvent.click(
    await screen.findByRole("button", { name: /Pick seats/i }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: /Seat A1, AVAILABLE/ }),
  );
  await userEvent.click(screen.getByRole("button", { name: /Reserve seats/ }));
  expect(
    await screen.findByRole("button", { name: /Simulate successful payment/ }),
  ).toBeInTheDocument();
  const call = (fetch as any).mock.calls.find(
    (c: any) => c[0] === "/api/bookings/holds",
  );
  expect(call[1].headers["X-CSRF-Token"]).toBe("csrf-test");
  expect(call[1].headers["Idempotency-Key"]).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Operations" }),
  ).not.toBeInTheDocument();
});
it("search sends encoded user input", async () => {
  render(<App />);
  await userEvent.type(
    screen.getByRole("textbox", { name: "Search events" }),
    "Dhaka & music",
  );
  await userEvent.click(screen.getByRole("button", { name: /Explore/ }));
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      "/api/events?search=Dhaka%20%26%20music",
      expect.anything(),
    ),
  );
});

async function held() {
  loggedIn = true;
  render(<App />);
  await screen.findByText("Imran");
  await userEvent.click(
    await screen.findByRole("button", { name: /Pick seats/i }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: /Seat A1, AVAILABLE/ }),
  );
  await userEvent.click(screen.getByRole("button", { name: /Reserve seats/ }));
}
it("configured providers show checkout methods and reject invalid phone before API", async () => {
  providers = true;
  await held();
  await userEvent.click(
    await screen.findByRole("button", { name: "Pay with bKash" }),
  );
  expect(
    await screen.findByText(/Enter a valid Bangladesh mobile number/),
  ).toBeInTheDocument();
  expect(
    (fetch as any).mock.calls.some((c: any) =>
      c[0].startsWith("/api/payment-checkout/bookings/"),
    ),
  ).toBe(false);
});
it("bound external payment hides simulation and disables switching provider", async () => {
  providers = true;
  boundProvider = "bkash";
  await held();
  expect(
    await screen.findByRole("button", { name: "Pay with bKash" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Pay via SSLCOMMERZ" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: /Simulate successful payment/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Refresh provider payment status" }),
  ).toBeInTheDocument();
});
