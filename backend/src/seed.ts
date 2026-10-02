import { Database } from "./db";
import { BookingService } from "./booking";
import { passwordHash } from "./crypto";
import { config } from "./config";
export async function seed(db: Database, password: string) {
  if (password.length < 12 || password.length > 128)
    throw new Error("DEMO_PASSWORD must be 12–128 characters");
  const hashed = await passwordHash(password);
  await db.tx(async (c) => {
    if ((await c.query("SELECT 1 FROM users LIMIT 1")).rowCount)
      throw new Error(
        "Database is not empty. Seed refuses to overwrite users.",
      );
    for (const [name, email, role] of [
      ["Imran Demo", "customer@seatflow.example", "CUSTOMER"],
      ["Venue Staff", "staff@seatflow.example", "STAFF"],
      ["Operations Admin", "admin@seatflow.example", "ADMIN"],
    ])
      await c.query(
        "INSERT INTO users(id,name,email,password_hash,role) VALUES(gen_random_uuid(),$1,$2,$3,$4)",
        [name, email, hashed, role],
      );
  });
  const booking = new BookingService(db);
  for (const [title, venue, city, days] of [
    ["Dhaka Developer Summit", "Innovation Hall", "Dhaka", 7],
    ["Acoustic Night", "Riverside Arena", "Dhaka", 10],
    ["Design & Technology Forum", "Convention Centre", "Chattogram", 14],
  ] as const) {
    const e = await booking.createEvent({
      title,
      venue,
      city,
      description:
        "A demo event for testing seat reservations, checkout and venue operations.",
      startsAt: new Date(Date.now() + days * 86400000).toISOString(),
      rows: 6,
      seatsPerRow: 10,
      price: 75000,
    });
    await db.query(
      "INSERT INTO event_staff(event_id,user_id) SELECT $1,id FROM users WHERE role='STAFF'",
      [e.id],
    );
  }
  console.log(
    "Demo ready: customer / staff / admin @seatflow.example. Password is your DEMO_PASSWORD.",
  );
}
if (require.main === module) {
  if (process.env.ALLOW_DEMO_SEED !== "true")
    throw new Error("Set ALLOW_DEMO_SEED=true for demo data");
  const db = new Database();
  seed(db, process.env.DEMO_PASSWORD ?? "")
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => db.onModuleDestroy());
}
