import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const eventSourceEnum = pgEnum("tracking_event_source", [
  "internal",
  "carrier",
]);

export const shipmentsTable = pgTable(
  "shipments",
  {
    id: serial("id").primaryKey(),
    trackingNumber: text("tracking_number").notNull(),
    customerId: integer("customer_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    carrier: text("carrier"),
    carrierTrackingNumber: text("carrier_tracking_number"),
    serviceType: text("service_type").notNull(),
    origin: text("origin").notNull(),
    destination: text("destination").notNull(),
    currentLocation: text("current_location"),
    status: text("status").notNull().default("Shipment created"),
    weight: numeric("weight", { precision: 12, scale: 3 }),
    dimensions: text("dimensions"),
    packageDescription: text("package_description"),
    estimatedDelivery: date("estimated_delivery", { mode: "string" }),
    actualDelivery: date("actual_delivery", { mode: "string" }),
    isDemo: boolean("is_demo").notNull().default(false),
    providerRegisteredAt: timestamp("provider_registered_at", {
      withTimezone: true,
    }),
    lastProviderSyncAt: timestamp("last_provider_sync_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("shipments_tracking_number_idx").on(table.trackingNumber),
    index("shipments_customer_id_idx").on(table.customerId),
    index("shipments_status_idx").on(table.status),
    index("shipments_created_at_idx").on(table.createdAt),
  ],
);

export const trackingEventsTable = pgTable(
  "tracking_events",
  {
    id: serial("id").primaryKey(),
    shipmentId: integer("shipment_id")
      .notNull()
      .references(() => shipmentsTable.id, { onDelete: "cascade" }),
    source: eventSourceEnum("source").notNull(),
    sourceEventId: text("source_event_id"),
    status: text("status").notNull(),
    location: text("location"),
    description: text("description").notNull(),
    eventTimestamp: timestamp("event_timestamp", {
      withTimezone: true,
    }).notNull(),
    rawProviderEvent: text("raw_provider_event"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("tracking_events_shipment_time_idx").on(
      table.shipmentId,
      table.eventTimestamp,
    ),
    uniqueIndex("tracking_events_shipment_source_event_idx")
      .on(table.shipmentId, table.sourceEventId)
      .where(sql`${table.sourceEventId} IS NOT NULL`),
  ],
);

export type Shipment = typeof shipmentsTable.$inferSelect;
export type TrackingEvent = typeof trackingEventsTable.$inferSelect;