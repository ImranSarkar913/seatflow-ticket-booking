import { useState, useEffect, useCallback } from "react";
import {
  Ticket,
  ArrowUpRight,
  MapPin,
  CalendarDays,
  Search,
  ChevronLeft,
  ShieldCheck,
  Clock,
  CheckCircle2,
  LogOut,
  ScanLine,
  RefreshCw,
  X,
  Plus,
  Layers,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  api,
  setCsrf,
  money,
  date,
  User,
  Event,
  Booking,
  ApiError,
} from "./api";
type Tab = "discover" | "bookings" | "operations";
type Summary = {
  total_bookings: number;
  confirmed: number;
  checked_in: number;
  confirmed_value: string;
  jobs: { id: string; type: string; attempts: number; last_error: string }[];
  refunds: { id: string; title: string; state: string; amount: number }[];
};
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [tab, setTab] = useState<Tab>("discover"),
    [events, setEvents] = useState<Event[]>([]),
    [event, setEvent] = useState<Event | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [booking, setBooking] = useState<Booking | null>(null),
    [bookings, setBookings] = useState<Booking[]>([]),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [login, setLogin] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [holdKey, setHoldKey] = useState(crypto.randomUUID()),
    [summary, setSummary] = useState<Summary | null>(null),
    [scan, setScan] = useState(""),
    [now, setNow] = useState(Date.now()),
    [serverOffset, setServerOffset] = useState(0);
  const [methods, setMethods] = useState({
    sandbox: false,
    sslcommerz: false,
    bkash: false,
    environment: "sandbox",
  });
  const [phone, setPhone] = useState("");
  useEffect(() => {
    api<typeof methods>("/payment-checkout/methods")
      .then(setMethods)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!user) return;
    const url = new URL(window.location.href);
    const id =
      url.searchParams.get("booking") ??
      sessionStorage.getItem("seatflow_pending_booking");
    if (
      !url.searchParams.has("payment_return") &&
      !sessionStorage.getItem("seatflow_pending_booking")
    )
      return;
    if (id && /^[a-f0-9-]{36}$/.test(id))
      api<Booking>("/bookings/" + id)
        .then((b) => {
          setBooking(b);
          setTab("discover");
          setNotice(
            "Returned from checkout. The booking status below is verified by the server.",
          );
          sessionStorage.removeItem("seatflow_pending_booking");
        })
        .catch(reportReturn);
    function reportReturn() {
      setNotice(
        "Open My bookings to check your payment. Do not pay again while verification is pending.",
      );
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [user?.id]);
  async function checkout(provider: "sslcommerz" | "bkash") {
    await action(async () => {
      if (!/^01[3-9][0-9]{8}$/.test(phone))
        throw new Error(
          "Enter a valid Bangladesh mobile number (01XXXXXXXXX).",
        );
      const r = await api<{ checkoutUrl: string }>(
        "/payment-checkout/bookings/" + booking!.id,
        "POST",
        { provider, phone },
      );
      sessionStorage.setItem("seatflow_pending_booking", booking!.id);
      window.location.assign(r.checkoutUrl);
    });
  }
  async function refreshPayment() {
    await action(async () => {
      if (booking?.payment && booking.payment.provider !== "sandbox")
        await api(
          "/payment-checkout/" + booking.payment.id + "/refresh",
          "POST",
        );
      setBooking(await api<Booking>("/bookings/" + booking!.id));
      setNotice("Payment status refreshed from the provider.");
    });
  }
  const report = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : "Something went wrong");
    if (e instanceof ApiError && e.status === 401) {
      setUser(null);
      setLogin(true);
    }
  }, []);
  useEffect(() => {
    api<{ user: User; csrf: string }>("/auth/me")
      .then((v) => {
        setUser(v.user);
        setCsrf(v.csrf);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    let live = true;
    api<Event[]>("/events?search=" + encodeURIComponent(query))
      .then((v) => {
        if (live) setEvents(v);
      })
      .catch(report);
    return () => {
      live = false;
    };
  }, [query, report]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!event || booking) return;
    let live = true;
    const timer = setInterval(
      () =>
        api<Event>("/events/" + event.id)
          .then((v) => {
            if (live) {
              setEvent(v);
              if (v.serverTime)
                setServerOffset(new Date(v.serverTime).getTime() - Date.now());
            }
          })
          .catch(report),
      5000,
    );
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [event?.id, booking?.id, report]);
  useEffect(() => {
    if (!booking || (booking.state !== "HELD" && !booking.refund)) return;
    let live = true;
    const timer = setInterval(
      () =>
        api<Booking>("/bookings/" + booking.id)
          .then((v) => {
            if (live) setBooking(v);
          })
          .catch(report),
      3000,
    );
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [booking?.id, booking?.state, booking?.refund?.state, report]);
  useEffect(() => {
    if (tab === "bookings" && user)
      api<Booking[]>("/bookings?page=" + page)
        .then(setBookings)
        .catch(report);
    if (tab === "operations" && user?.role === "ADMIN")
      api<Summary>("/admin/summary").then(setSummary).catch(report);
  }, [tab, user?.id, page, report]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function openEvent(id: string) {
    await action(async () => {
      const v = await api<Event>("/events/" + id);
      setEvent(v);
      setSelected([]);
      setBooking(null);
      setHoldKey(crypto.randomUUID());
      if (v.serverTime)
        setServerOffset(new Date(v.serverTime).getTime() - Date.now());
    });
  }
  function navigate(t: Tab) {
    setTab(t);
    setEvent(null);
    setBooking(null);
    setSelected([]);
    setError("");
    setNotice("");
  }
  async function reserve() {
    if (!user) {
      setLogin(true);
      return;
    }
    await action(async () => {
      const b = await api<Booking>(
        "/bookings/holds",
        "POST",
        { eventId: event!.id, seatIds: selected },
        { "Idempotency-Key": holdKey },
      );
      setBooking(b);
      setNotice(
        "Your seats are held. Complete checkout before the timer ends.",
      );
    });
  }
  async function settle(outcome: "SUCCEEDED" | "FAILED") {
    await action(async () => {
      const p = await api<{ id: string }>(
        "/bookings/" + booking!.id + "/payment-intent",
        "POST",
      );
      await api("/payments/" + p.id + "/sandbox-settle", "POST", { outcome });
      setBooking(await api<Booking>("/bookings/" + booking!.id));
      setNotice(
        outcome === "SUCCEEDED"
          ? "Payment processed. Check the booking status below."
          : "Payment declined in sandbox. You can retry before the hold expires.",
      );
    });
  }
  const remaining = booking
    ? Math.max(
        0,
        Math.ceil(
          (new Date(booking.expires_at).getTime() - now - serverOffset) / 1000,
        ),
      )
    : 0;
  const total =
    event?.seats
      ?.filter((s) => selected.includes(s.id))
      .reduce((n, s) => n + s.price, 0) ?? 0;
  return (
    <div className="app">
      <header className="header">
        <button className="brand" onClick={() => navigate("discover")}>
          <span className="brand-icon">
            <Ticket size={22} />
          </span>
          seatflow<span className="brand-dot">.</span>
        </button>
        <nav aria-label="Main navigation">
          <button
            className={tab === "discover" ? "active" : ""}
            onClick={() => navigate("discover")}
          >
            Discover
          </button>
          <button
            className={tab === "bookings" ? "active" : ""}
            onClick={() => (user ? navigate("bookings") : setLogin(true))}
          >
            My bookings
          </button>
          {user && user.role !== "CUSTOMER" && (
            <button
              className={tab === "operations" ? "active" : ""}
              onClick={() => navigate("operations")}
            >
              Operations
            </button>
          )}
        </nav>
        <div className="account">
          <span className="sandbox">
            {methods.environment === "live" ? "LIVE PAYMENTS" : "SANDBOX"}
          </span>
          {user ? (
            <>
              <span className="user-name">{user.name}</span>
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={() =>
                  action(async () => {
                    await api("/auth/logout", "POST");
                    setCsrf("");
                    setUser(null);
                    navigate("discover");
                  })
                }
              >
                <LogOut size={18} />
              </button>
            </>
          ) : (
            <button
              className="button small dark"
              onClick={() => setLogin(true)}
            >
              Sign in <ArrowUpRight size={16} />
            </button>
          )}
        </div>
      </header>
      <main>
        {error && (
          <div className="banner error" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="banner notice" role="status">
            {notice}
            <button aria-label="Dismiss notice" onClick={() => setNotice("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {booking ? (
          <>
            <button
              className="back"
              onClick={() => {
                setBooking(null);
                navigate("bookings");
              }}
            >
              <ChevronLeft size={16} /> All bookings
            </button>
            <div className="booking-layout">
              <section className="panel booking-panel">
                <span className="eyebrow">YOUR BOOKING</span>
                <h1>{booking.title}</h1>
                <p className="muted">
                  <MapPin size={16} /> {booking.venue} <span>·</span>{" "}
                  {date(booking.starts_at)}
                </p>
                <div className="booking-top">
                  <span className={"status " + booking.state.toLowerCase()}>
                    {booking.state}
                  </span>
                  <code>#{booking.id.slice(0, 8).toUpperCase()}</code>
                </div>
                <div className="seat-tags">
                  {booking.items.map((i) => (
                    <span key={i.label}>Seat {i.label}</span>
                  ))}
                </div>
                <div className="receipt-row">
                  <span>Total · {booking.items.length} seats</span>
                  <strong>{money(booking.total)}</strong>
                </div>
                {booking.state === "HELD" && (
                  <>
                    <div className="hold-timer">
                      <Clock size={22} />
                      <div>
                        <strong>
                          {Math.floor(remaining / 60)}:
                          {String(remaining % 60).padStart(2, "0")}
                        </strong>
                        <span> remaining to complete payment</span>
                      </div>
                    </div>
                    <p className="muted">
                      {methods.environment === "live"
                        ? "Provider checkout charges real money."
                        : "Test environment: provider sandbox and local simulation use no real money."}{" "}
                      Never enter wallet PIN, OTP or card details here; use the
                      provider checkout page.
                    </p>
                    {(methods.sslcommerz || methods.bkash) && (
                      <div className="provider-checkout">
                        <label htmlFor="checkout-phone">Mobile number</label>
                        <input
                          id="checkout-phone"
                          type="tel"
                          autoComplete="tel"
                          placeholder="01XXXXXXXXX"
                          maxLength={11}
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                        />
                        {methods.sslcommerz && (
                          <button
                            className="button primary full"
                            disabled={
                              busy ||
                              remaining === 0 ||
                              !!(
                                booking.payment &&
                                booking.payment.provider !== "sslcommerz"
                              )
                            }
                            onClick={() => checkout("sslcommerz")}
                          >
                            Pay via SSLCOMMERZ
                          </button>
                        )}
                        {methods.bkash && (
                          <button
                            className="button primary full"
                            disabled={
                              busy ||
                              remaining === 0 ||
                              !!(
                                booking.payment &&
                                booking.payment.provider !== "bkash"
                              )
                            }
                            onClick={() => checkout("bkash")}
                          >
                            Pay with bKash
                          </button>
                        )}
                        <p className="muted">
                          A reservation is bound to one payment method after
                          checkout starts. Verification may continue after you
                          return.
                        </p>
                      </div>
                    )}
                    {booking.payment &&
                      booking.payment.provider !== "sandbox" && (
                        <button
                          className="button secondary full"
                          disabled={busy}
                          onClick={refreshPayment}
                        >
                          Refresh provider payment status
                        </button>
                      )}
                    {methods.sandbox &&
                      (!booking.payment ||
                        booking.payment.provider === "sandbox") && (
                        <>
                          <button
                            className="button primary full"
                            disabled={busy || remaining === 0}
                            onClick={() => settle("SUCCEEDED")}
                          >
                            Simulate successful payment{" "}
                            <ArrowUpRight size={18} />
                          </button>
                          <button
                            className="button secondary full"
                            disabled={busy || remaining === 0}
                            onClick={() => settle("FAILED")}
                          >
                            Test declined payment
                          </button>
                        </>
                      )}
                    {!methods.sandbox &&
                      !methods.sslcommerz &&
                      !methods.bkash && (
                        <p>
                          No payment provider is configured. Contact the
                          operator.
                        </p>
                      )}
                  </>
                )}
                {booking.state === "CONFIRMED" && (
                  <div className="ticket">
                    <CheckCircle2 className="success" />
                    <h2>Your ticket is ready</h2>
                    {booking.ticket_token && (
                      <>
                        <QRCodeSVG
                          value={booking.ticket_token}
                          size={160}
                          marginSize={2}
                        />
                        <p className="muted">
                          Present this QR code at the venue.
                        </p>
                        <button
                          className="button secondary"
                          onClick={() =>
                            navigator.clipboard
                              .writeText(booking.ticket_token!)
                              .then(() => setNotice("Ticket token copied."))
                              .catch(report)
                          }
                        >
                          Copy ticket token
                        </button>
                      </>
                    )}
                    {booking.checked_in_at && (
                      <p className="success">
                        Checked in · {date(booking.checked_in_at)}
                      </p>
                    )}
                  </div>
                )}
                {["EXPIRED", "CANCELLED"].includes(booking.state) && (
                  <p className="muted">
                    This reservation is no longer active. Released seats may be
                    booked by another customer.
                  </p>
                )}
                {booking.payment && (
                  <div className="receipt-row">
                    <span>Payment</span>
                    <span>{booking.payment.state}</span>
                  </div>
                )}
                {booking.state !== "HELD" &&
                  booking.payment &&
                  booking.payment.provider !== "sandbox" &&
                  booking.payment.state === "CREATED" && (
                    <button
                      className="button secondary full"
                      disabled={busy}
                      onClick={refreshPayment}
                    >
                      Refresh provider payment status
                    </button>
                  )}
                {booking.refund && booking.payment?.provider !== "sandbox" && (
                  <p className="muted">
                    External refund is pending merchant action. A refund request
                    does not mean money has been returned.
                  </p>
                )}
                {booking.refund && (
                  <div className="receipt-row">
                    <span>Refund · {money(booking.refund.amount)}</span>
                    <span>{booking.refund.state}</span>
                  </div>
                )}
                {["HELD", "CONFIRMED"].includes(booking.state) &&
                  !booking.checked_in_at && (
                    <button
                      className="text-button danger"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Cancel this booking? Confirmed tickets can be cancelled until one hour before the event.",
                          )
                        )
                          action(async () => {
                            setBooking(
                              await api<Booking>(
                                "/bookings/" + booking.id + "/cancel",
                                "POST",
                              ),
                            );
                          });
                      }}
                    >
                      Cancel booking
                    </button>
                  )}
              </section>
              <aside className="panel">
                <h3>
                  <ShieldCheck size={20} /> Booking timeline
                </h3>
                <Timeline
                  id={booking.id}
                  state={booking.state}
                  onError={report}
                />
                <div className="info-box">
                  Seat reservations and payments are checked on the server.
                  Repeated requests cannot create duplicate bookings.
                </div>
              </aside>
            </div>
          </>
        ) : tab === "discover" && !event ? (
          <>
            <section className="hero">
              <div>
                <span className="eyebrow">GOOD PLANS START WITH A SEAT</span>
                <h1>
                  Make room for
                  <br />
                  something <em>great.</em>
                </h1>
                <p>
                  Discover your next experience. Pick your perfect seat.
                  <br />
                  We’ll take care of the reservation.
                </p>
                <form
                  className="search-box"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setQuery(search);
                  }}
                >
                  <Search size={20} />
                  <input
                    aria-label="Search events"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search events or cities"
                  />
                  <button className="button dark small">
                    Explore <ArrowUpRight size={16} />
                  </button>
                </form>
              </div>
              <div className="hero-art" aria-hidden="true">
                <div className="orbit orbit-one" />
                <div className="orbit orbit-two" />
                <div className="art-ticket">
                  <div className="ticket-small">SEATFLOW PRESENTS</div>
                  <div className="ticket-title">
                    A moment
                    <br />
                    worth being
                    <br />
                    there for.
                  </div>
                  <div className="ticket-divider" />
                  <div className="ticket-bottom">
                    <span>
                      YOUR SEAT
                      <br />
                      <strong>A · 08</strong>
                    </span>
                    <Ticket size={40} />
                  </div>
                </div>
                <span className="art-caption">RESERVE THE EXPERIENCE ↗</span>
              </div>
            </section>
            <section className="trust-strip">
              <span>
                <ShieldCheck size={18} /> Secure reservations
              </span>
              <span>
                <Layers size={18} /> Live seat availability
              </span>
              <span>
                <Ticket size={18} /> Instant digital tickets
              </span>
            </section>
            <div className="section-heading">
              <div>
                <span className="eyebrow">WHAT’S HAPPENING</span>
                <h2>Find your next experience</h2>
              </div>
              <span className="muted">{events.length} upcoming events</span>
            </div>
            <div className="event-grid">
              {events.map((e, i) => (
                <article className="event-card" key={e.id}>
                  <button
                    className={"event-cover cover-" + (i % 3)}
                    aria-label={"View " + e.title}
                    onClick={() => openEvent(e.id)}
                  >
                    <span className="event-category">
                      {i % 3 === 0
                        ? "CONFERENCE"
                        : i % 3 === 1
                          ? "LIVE EXPERIENCE"
                          : "COMMUNITY"}
                    </span>
                    <span className="event-art-title">
                      {i % 3 === 0
                        ? "Ideas.\nPeople.\nPossibilities."
                        : i % 3 === 1
                          ? "Feel the\nmoment."
                          : "Create\nwhat’s next."}
                    </span>
                    <span className="cover-number">0{i + 1}</span>
                    <span className="cover-arrow">
                      <ArrowUpRight />
                    </span>
                  </button>
                  <div className="event-info">
                    <p className="event-meta">
                      <CalendarDays size={14} />
                      {date(e.starts_at)}
                    </p>
                    <h3>{e.title}</h3>
                    <p className="muted">
                      <MapPin size={14} />
                      {e.venue} · {e.city}
                    </p>
                    <div className="event-footer">
                      <div>
                        <span className="muted tiny">FROM</span>
                        <strong>{money(e.min_price)}</strong>
                      </div>
                      <button
                        className="button secondary small"
                        disabled={busy}
                        onClick={() => openEvent(e.id)}
                      >
                        Pick seats <ArrowUpRight size={16} />
                      </button>
                    </div>
                    <span className="availability">
                      {e.available} / {e.seat_count} seats available
                    </span>
                  </div>
                </article>
              ))}
            </div>
            {events.length === 0 && (
              <div className="empty">
                No events found. Try another search, or seed the demo database.
              </div>
            )}
          </>
        ) : tab === "discover" && event ? (
          <>
            <button className="back" onClick={() => setEvent(null)}>
              <ChevronLeft size={16} /> Discover events
            </button>
            <div className="detail-title">
              <span className="eyebrow">CHOOSE YOUR VIEW</span>
              <h1>{event.title}</h1>
              <p className="muted">
                <MapPin size={16} />
                {event.venue} · {event.city} <span>·</span>
                <CalendarDays size={16} />
                {date(event.starts_at)}
              </p>
            </div>
            <div className="seat-layout">
              <section className="panel seat-panel">
                <div className="stage">STAGE / FRONT</div>
                <div
                  className="seat-map"
                  role="group"
                  aria-label="Choose seats"
                >
                  {[...new Set(event.seats?.map((s) => s.row_label))].map(
                    (row) => (
                      <div className="seat-row" key={row}>
                        <span className="row-label">{row}</span>
                        <div className="seat-row-buttons">
                          {event
                            .seats!.filter((s) => s.row_label === row)
                            .map((s) => (
                              <button
                                key={s.id}
                                className={
                                  "seat " +
                                  (selected.includes(s.id)
                                    ? "selected"
                                    : s.status.toLowerCase()) +
                                  (s.tier === "PREMIUM" ? " premium" : "")
                                }
                                aria-label={`Seat ${s.row_label}${s.number}, ${s.status}, ${money(s.price)}`}
                                aria-pressed={selected.includes(s.id)}
                                disabled={s.status !== "AVAILABLE" || busy}
                                onClick={() => {
                                  setSelected((prev) =>
                                    prev.includes(s.id)
                                      ? prev.filter((x) => x !== s.id)
                                      : prev.length < 6
                                        ? [...prev, s.id]
                                        : prev,
                                  );
                                  setHoldKey(crypto.randomUUID());
                                }}
                              >
                                {s.number}
                              </button>
                            ))}
                        </div>
                        <span className="row-label">{row}</span>
                      </div>
                    ),
                  )}
                </div>
                <div className="legend">
                  <span>
                    <i className="available" />
                    Available
                  </span>
                  <span>
                    <i className="selected" />
                    Selected
                  </span>
                  <span>
                    <i className="held" />
                    Held
                  </span>
                  <span>
                    <i className="booked" />
                    Booked
                  </span>
                </div>
                <p className="tiny muted center">
                  Premium seats are in the first two rows. Availability
                  refreshes every 5 seconds.
                </p>
              </section>
              <aside className="panel selection-panel">
                <span className="eyebrow">YOUR EXPERIENCE</span>
                <h2>Reservation summary</h2>
                <p className="muted">
                  Select up to 6 seats. Seats are reserved only after the server
                  confirms your hold.
                </p>
                <div className="seat-tags">
                  {event.seats
                    ?.filter((s) => selected.includes(s.id))
                    .map((s) => (
                      <span key={s.id}>
                        {s.row_label}
                        {s.number} · {money(s.price)}
                      </span>
                    ))}
                </div>
                <div className="receipt-row">
                  <span>{selected.length} seats selected</span>
                  <strong>{money(total)}</strong>
                </div>
                <button
                  className="button primary full"
                  disabled={!selected.length || busy}
                  onClick={reserve}
                >
                  {busy ? "Reserving…" : "Reserve seats"}
                  <ArrowUpRight size={18} />
                </button>
                <div className="info-box">
                  <Clock size={18} /> Holds expire after 5 minutes with the
                  default configuration.
                </div>
              </aside>
            </div>
          </>
        ) : tab === "bookings" ? (
          <>
            <div className="section-heading">
              <div>
                <span className="eyebrow">YOUR PLANS</span>
                <h1>My bookings</h1>
              </div>
              <button
                className="button secondary small"
                onClick={() =>
                  action(async () =>
                    setBookings(await api<Booking[]>("/bookings?page=" + page)),
                  )
                }
              >
                <RefreshCw size={16} />
                Refresh
              </button>
            </div>
            <div className="booking-list">
              {bookings.map((b) => (
                <button
                  className="panel booking-list-item"
                  key={b.id}
                  onClick={() =>
                    action(async () =>
                      setBooking(await api<Booking>("/bookings/" + b.id)),
                    )
                  }
                >
                  <span className="booking-icon">
                    <Ticket />
                  </span>
                  <span>
                    <strong>{b.title}</strong>
                    <span className="muted">
                      {date(b.starts_at)} · #{b.id.slice(0, 8)}
                    </span>
                  </span>
                  <span className={"status " + b.state.toLowerCase()}>
                    {b.state}
                  </span>
                  <strong>{money(b.total)}</strong>
                  <ArrowUpRight size={20} />
                </button>
              ))}
            </div>
            {!bookings.length && (
              <div className="empty">
                No bookings on this page. Your next experience is waiting.
              </div>
            )}
            <div className="pagination">
              <button
                className="button secondary"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span>Page {page}</span>
              <button
                className="button secondary"
                disabled={bookings.length < 20}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="section-heading">
              <div>
                <span className="eyebrow">VENUE OPERATIONS</span>
                <h1>Control room</h1>
              </div>
              {user?.role === "ADMIN" && (
                <button
                  className="button secondary small"
                  onClick={() =>
                    action(async () =>
                      setSummary(await api<Summary>("/admin/summary")),
                    )
                  }
                >
                  <RefreshCw size={16} />
                  Refresh
                </button>
              )}
            </div>
            <section className="panel scan-panel">
              <h2>
                <ScanLine />
                Ticket check-in
              </h2>
              <p className="muted">
                Paste the ticket token from a customer’s QR code. Staff can
                admit customers only for assigned events.
              </p>
              <form
                className="scan-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  action(async () => {
                    const result = await api<{ alreadyCheckedIn: boolean }>(
                      "/check-in",
                      "POST",
                      { token: scan.trim() },
                    );
                    setNotice(
                      result.alreadyCheckedIn
                        ? "This ticket was already checked in."
                        : "Admission confirmed. Welcome!",
                    );
                    setScan("");
                  });
                }}
              >
                <input
                  aria-label="Ticket token"
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  placeholder="64-character ticket token"
                  required
                />
                <button className="button primary" disabled={busy}>
                  Validate ticket
                </button>
              </form>
            </section>
            {user?.role === "ADMIN" && (
              <>
                {summary && (
                  <>
                    <div className="stats-grid">
                      {[
                        ["Confirmed bookings", summary.confirmed],
                        [
                          "Confirmed booking value",
                          money(Number(summary.confirmed_value)),
                        ],
                        ["Guests checked in", summary.checked_in],
                        ["Pending jobs", summary.jobs.length],
                      ].map(([label, value]) => (
                        <div className="panel stat" key={label}>
                          <span className="muted">{label}</span>
                          <strong>{value}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="ops-grid">
                      <section className="panel">
                        <h3>Background jobs</h3>
                        {summary.jobs.length === 0 ? (
                          <p className="muted">All jobs processed.</p>
                        ) : (
                          summary.jobs.map((j) => (
                            <div className="job" key={j.id}>
                              <strong>{j.type}</strong>
                              <span className="muted">
                                {j.attempts} failed attempts ·{" "}
                                {j.last_error ?? "Queued"}
                              </span>
                              <button
                                className="button secondary small"
                                disabled={busy}
                                onClick={() =>
                                  action(async () => {
                                    await api(
                                      "/admin/jobs/" + j.id + "/retry",
                                      "POST",
                                    );
                                    setSummary(
                                      await api<Summary>("/admin/summary"),
                                    );
                                  })
                                }
                              >
                                Retry
                              </button>
                            </div>
                          ))
                        )}
                      </section>
                      <section className="panel">
                        <h3>Recent refunds</h3>
                        {summary.refunds.length === 0 ? (
                          <p className="muted">No refunds yet.</p>
                        ) : (
                          summary.refunds.map((r) => (
                            <div className="receipt-row" key={r.id}>
                              <span>
                                {r.title}
                                <small>{r.state}</small>
                              </span>
                              <strong>{money(r.amount)}</strong>
                            </div>
                          ))
                        )}
                      </section>
                    </div>
                  </>
                )}
                <StaffAssignment
                  events={events}
                  onError={report}
                  onDone={() => setNotice("Staff assigned to the event.")}
                />
                <EventForm
                  onDone={async () => {
                    setNotice(
                      "Event created. It is now available in Discover.",
                    );
                    setEvents(await api<Event[]>("/events"));
                  }}
                  onError={report}
                />
              </>
            )}
          </>
        )}
      </main>
      <footer>
        <span className="footer-brand">seatflow.</span>
        <span>Built for experiences. Engineered for reliability.</span>
        <span>Payment status is verified by the server</span>
      </footer>
      {login && (
        <Login
          onClose={() => setLogin(false)}
          onLogin={(v) => {
            setUser(v.user);
            setCsrf(v.csrf);
            setLogin(false);
            setError("");
          }}
        />
      )}
    </div>
  );
}
function Timeline({
  id,
  state,
  onError,
}: {
  id: string;
  state: string;
  onError: (e: unknown) => void;
}) {
  const [items, setItems] = useState<{ action: string; created_at: string }[]>(
    [],
  );
  useEffect(() => {
    api<typeof items>("/bookings/" + id + "/audit")
      .then(setItems)
      .catch(onError);
  }, [id, state, onError]);
  return (
    <ol className="timeline">
      {items.map((i, n) => (
        <li key={n}>
          <span>{i.action.toLowerCase().replaceAll("_", " ")}</span>
          <small>{date(i.created_at)}</small>
        </li>
      ))}
    </ol>
  );
}
function Login({
  onClose,
  onLogin,
}: {
  onClose: () => void;
  onLogin: (v: { user: User; csrf: string }) => void;
}) {
  const [register, setRegister] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop">
      <section
        className="modal panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
      >
        <button
          className="modal-close icon-button"
          aria-label="Close sign-in"
          onClick={onClose}
        >
          <X />
        </button>
        <span className="brand-icon">
          <Ticket />
        </span>
        <h2 id="login-title">
          {register ? "Your next chapter starts here." : "Welcome back."}
        </h2>
        <p className="muted">
          {register
            ? "Create an account to reserve your seats."
            : "Sign in to book your next experience."}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              if (register)
                await api("/auth/register", "POST", { email, password, name });
              onLogin(await api("/auth/login", "POST", { email, password }));
            } catch (e) {
              setError(e instanceof Error ? e.message : "Sign-in failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {register && (
            <label>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={80}
                autoComplete="name"
              />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={12}
              maxLength={128}
              autoComplete={register ? "new-password" : "current-password"}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
            <ArrowUpRight size={18} />
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setRegister(!register);
            setError("");
          }}
        >
          {register
            ? "Already have an account? Sign in"
            : "New here? Create an account"}
        </button>
        <div className="info-box">
          Demo accounts: customer, staff or admin @seatflow.example. Use the
          DEMO_PASSWORD configured on your server.
        </div>
      </section>
    </div>
  );
}
function EventForm({
  onDone,
  onError,
}: {
  onDone: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel create-panel">
      <h2>
        <Plus />
        Create an event
      </h2>
      <form
        className="event-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget,
            d = new FormData(form);
          setBusy(true);
          try {
            await api("/events", "POST", {
              title: d.get("title"),
              venue: d.get("venue"),
              city: d.get("city"),
              description: d.get("description"),
              startsAt: new Date(String(d.get("startsAt"))).toISOString(),
              rows: Number(d.get("rows")),
              seatsPerRow: Number(d.get("seatsPerRow")),
              price: Math.round(Number(d.get("price")) * 100),
            });
            form.reset();
            await onDone();
          } catch (err) {
            onError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Title
          <input name="title" required minLength={3} maxLength={100} />
        </label>
        <label>
          Venue
          <input name="venue" required minLength={3} maxLength={120} />
        </label>
        <label>
          City
          <input name="city" required minLength={2} maxLength={60} />
        </label>
        <label>
          Starts at
          <input type="datetime-local" name="startsAt" required />
        </label>
        <label>
          Rows
          <input
            type="number"
            name="rows"
            defaultValue={6}
            min={1}
            max={12}
            required
          />
        </label>
        <label>
          Seats per row
          <input
            type="number"
            name="seatsPerRow"
            defaultValue={10}
            min={4}
            max={20}
            required
          />
        </label>
        <label>
          Standard price (BDT)
          <input
            type="number"
            name="price"
            defaultValue={750}
            min={1}
            max={10000}
            step="0.01"
            required
          />
        </label>
        <label className="wide">
          Description
          <textarea
            name="description"
            required
            minLength={10}
            maxLength={1000}
          />
        </label>
        <button className="button primary" disabled={busy}>
          Publish event <ArrowUpRight size={18} />
        </button>
      </form>
    </section>
  );
}

function StaffAssignment({
  events,
  onError,
  onDone,
}: {
  events: Event[];
  onError: (e: unknown) => void;
  onDone: () => void;
}) {
  const [staff, setStaff] = useState<
      { id: string; name: string; email: string }[]
    >([]),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<typeof staff>("/admin/staff").then(setStaff).catch(onError);
  }, [onError]);
  return (
    <section className="panel create-panel staff-assignment">
      <h2>Assign venue staff</h2>
      <form
        className="event-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await api("/admin/events/" + d.get("event") + "/staff", "POST", {
              userId: d.get("staff"),
            });
            onDone();
          } catch (err) {
            onError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Event
          <select name="event" required>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Staff account
          <select name="staff" required>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.email}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button primary"
          disabled={busy || !staff.length || !events.length}
        >
          Assign staff
        </button>
      </form>
    </section>
  );
}
