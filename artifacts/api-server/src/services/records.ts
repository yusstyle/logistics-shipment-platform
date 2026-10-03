import { and, eq } from "drizzle-orm";
import type {
  AuditLog,
  Notification,
  Quote,
  Shipment,
  TrackingEvent,
  User,
} from "@workspace/db";
import {
  auditLogsTable,
  db,
  notificationsTable,
  shipmentsTable,
  trackingEventsTable,
} from "@workspace/db";
import type { Request } from "express";
import type { NormalizedTrackingEvent, ProviderSnapshot } from "./tracking-provider";

export function shipmentDto(shipment: Shipment, customerName: string | null = null) {
  return {
    ...shipment,
    customerName,
    weight: shipment.weight === null ? null : Number(shipment.weight),
  };
}

export function quoteDto(quote: Quote) {
  return {
    ...quote,
    weight: quote.weight === null ? null : Number(quote.weight),
  };
}

export function eventDto(event: TrackingEvent) {
  return {
    id: event.id,
    source: event.source,
    sourceEventId: event.sourceEventId,
    status: event.status,
    location: event.location,
    description: event.description,
    eventTimestamp: event.eventTimestamp,
  };
}

export function notificationDto(notification: Notification) {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  };
}

export function userDto(user: User) {
  return {
    id: user.id,
    clerkUserId: user.clerkUserId,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    phone: user.phone,
    address: user.address,
    country: user.country,
    createdAt: user.createdAt,
  };
}

export async function addNotification(
  userId: number | null,
  type: string,
  title: string,
  message: string,
) {
  if (!userId) return;
  await db.insert(notificationsTable).values({ userId, type, title, message });
}

export async function writeAudit(
  user: User,
  req: Request,
  action: string,
  entityType: string,
  entityId: number | string | null,
  metadata?: Record<string, unknown>,
) {
  const forwarded = req.headers["x-forwarded-for"];
  const ipAddress = Array.isArray(forwarded)
    ? forwarded[0]?.split(",")[0]?.trim()
    : forwarded?.split(",")[0]?.trim() ?? req.ip;
  await db.insert(auditLogsTable).values({
    userId: user.id,
    action,
    entityType,
    entityId: entityId === null ? null : String(entityId),
    metadata: metadata ?? null,
    ipAddress: ipAddress?.slice(0, 64) ?? null,
  });
}

function latestEventTimestamp(events: NormalizedTrackingEvent[]) {
  if (!events.length) return null;
  return events.reduce((latest, event) =>
    event.eventTimestamp > latest ? event.eventTimestamp : latest,
  events[0]!.eventTimestamp);
}

export async function persistProviderSnapshot(
  shipment: Shipment,
  snapshot: ProviderSnapshot,
): Promise<number> {
  return db.transaction(async (tx) => {
    let insertedCount = 0;
    if (snapshot.events.length) {
      const inserted = await tx
        .insert(trackingEventsTable)
        .values(
          snapshot.events.map((event) => ({
            shipmentId: shipment.id,
            source: "carrier" as const,
            sourceEventId: event.sourceEventId,
            status: event.status,
            location: event.location,
            description: event.description,
            eventTimestamp: event.eventTimestamp,
            rawProviderEvent: event.rawProviderEvent,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: trackingEventsTable.id });
      insertedCount = inserted.length;
    }

    const latestEvent = latestEventTimestamp(snapshot.events);
    const nextStatus = snapshot.status ?? shipment.status;
    const [updated] = await tx
      .update(shipmentsTable)
      .set({
        status: nextStatus,
        currentLocation: snapshot.currentLocation ?? shipment.currentLocation,
        estimatedDelivery:
          snapshot.estimatedDelivery ?? shipment.estimatedDelivery,
        actualDelivery: snapshot.actualDelivery ?? shipment.actualDelivery,
        lastProviderSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(shipmentsTable.id, shipment.id))
      .returning();

    if (updated && shipment.customerId && nextStatus !== shipment.status) {
      await tx.insert(notificationsTable).values({
        userId: shipment.customerId,
        type: "shipment_status",
        title: `Shipment ${shipment.trackingNumber} updated`,
        message: `The carrier reported: ${nextStatus}.`,
      });
    }

    // Keep latest-event-derived state observable even if the event was already
    // stored by a prior webhook delivery.
    if (latestEvent && !updated) {
      const found = await tx.query.trackingEventsTable.findFirst({
        where: and(
          eq(trackingEventsTable.shipmentId, shipment.id),
          eq(trackingEventsTable.eventTimestamp, latestEvent),
        ),
      });
      if (!found) return insertedCount;
    }
    return insertedCount;
  });
}

export type { AuditLog };