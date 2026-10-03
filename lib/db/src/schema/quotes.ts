import {
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const quoteStatusEnum = pgEnum("quote_status", [
  "pending",
  "reviewing",
  "quoted",
  "accepted",
  "rejected",
  "completed",
]);

export const quotesTable = pgTable(
  "quotes",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    customerName: text("customer_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    origin: text("origin").notNull(),
    destination: text("destination").notNull(),
    shipmentType: text("shipment_type").notNull(),
    weight: numeric("weight", { precision: 12, scale: 3 }),
    dimensions: text("dimensions"),
    description: text("description"),
    preferredShippingDate: date("preferred_shipping_date", { mode: "string" }),
    additionalInformation: text("additional_information"),
    status: quoteStatusEnum("status").notNull().default("pending"),
    adminNotes: text("admin_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("quotes_customer_id_idx").on(table.customerId),
    index("quotes_status_idx").on(table.status),
    index("quotes_created_at_idx").on(table.createdAt),
  ],
);

export type Quote = typeof quotesTable.$inferSelect;