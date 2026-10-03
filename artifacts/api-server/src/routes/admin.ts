import { randomBytes } from "node:crypto";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  ilike,
  notInArray,
  or,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import {
  CreateShipmentBody,
  CreateTrackingEventBody,
  CreateTrackingEventParams,
  GetAdminCustomersQueryParams,
  GetAdminDashboardResponse,
  GetAdminQuotesQueryParams,
  GetAdminShipmentParams,
  GetAdminShipmentResponse,
  GetAdminShipmentsQueryParams,
  GetAdminShipmentsResponse,
  SyncShipmentTrackingParams,
  UpdateContactBody,
  UpdateContactParams,
  UpdateQuoteBody,
  UpdateQuoteParams,
  UpdateShipmentBody,
  UpdateShipmentParams,
  UpdateSiteSettingsBody,
  UpdateUserRoleBody,
  UpdateUserRoleParams,
} from "@workspace/api-zod";
import {
  auditLogsTable,
  contactsTable,
  db,
  notificationsTable,
  quotesTable,
  shipmentsTable,
  trackingEventsTable,
  usersTable,
} from "@workspace/db";
import { currentUser, requireAuthenticated, requireRoles } from "../middleware/auth";
import { parseRequest } from "../lib/validation";
import {
  eventDto,
  notificationDto,
  quoteDto,
  shipmentDto,
  userDto,
  writeAudit,
} from "../services/records";
import {
  providerIsConfigured,
  synchronizeTracking,
  TrackingProviderError,
} from "../services/tracking-provider";
import { persistProviderSnapshot } from "../services/records";
import { loadSiteSettings, saveSiteSettings } from "../services/site-settings";

const router: IRouter = Router();
const adminOnly = [
  requireAuthenticated,
  requireRoles("super_admin", "admin", "staff"),
];
const providerSyncLimit = rateLimit({
  windowMs: 1000,
  limit: 2,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Please wait before requesting another provider sync." },
});

function idFromPath(value: string | undefined): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function makeTrackingNumber() {
  const year = new Date().getUTCFullYear();
  const suffix = randomBytes(5).toString("hex").toUpperCase();
  return `FP-${year}-${suffix}`;
}

async function validateCustomer(customerId: number | null | undefined) {
  if (!customerId) return true;
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, customerId),
  });
  return Boolean(user && user.role === "customer" && user.status === "active");
}

router.get("/admin/dashboard", ...adminOnly, async (_req, res, next) => {
  try {
    const [
      [totalShipments],
      [deliveredShipments],
      [activeShipments],
      [pendingQuotes],
      [customerCount],
      statusCounts,
      recentRows,
    ] = await Promise.all([
      db.select({ value: count() }).from(shipmentsTable),
      db
        .select({ value: count() })
        .from(shipmentsTable)
        .where(ilike(shipmentsTable.status, "delivered")),
      db
        .select({ value: count() })
        .from(shipmentsTable)
        .where(
          notInArray(shipmentsTable.status, [
            "Delivered",
            "Cancelled",
            "Canceled",
            "Returned",
          ]),
        ),
      db
        .select({ value: count() })
        .from(quotesTable)
        .where(inArray(quotesTable.status, ["pending", "reviewing"])),
      db
        .select({ value: count() })
        .from(usersTable)
        .where(eq(usersTable.role, "customer")),
      db
        .select({ status: shipmentsTable.status, value: count() })
        .from(shipmentsTable)
        .groupBy(shipmentsTable.status),
      db
        .select({
          trackingNumber: shipmentsTable.trackingNumber,
          status: trackingEventsTable.status,
          description: trackingEventsTable.description,
          eventTimestamp: trackingEventsTable.eventTimestamp,
          source: trackingEventsTable.source,
        })
        .from(trackingEventsTable)
        .innerJoin(
          shipmentsTable,
          eq(trackingEventsTable.shipmentId, shipmentsTable.id),
        )
        .orderBy(desc(trackingEventsTable.eventTimestamp))
        .limit(8),
    ]);

    res.json(
      GetAdminDashboardResponse.parse({
        totalShipments: totalShipments.value,
        activeShipments: activeShipments.value,
        deliveredShipments: deliveredShipments.value,
        pendingQuotes: pendingQuotes.value,
        customerCount: customerCount.value,
        recentEvents: recentRows,
        statusCounts: statusCounts.map((item) => ({
          status: item.status,
          count: item.value,
        })),
        providerConfigured: providerIsConfigured(),
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/admin/shipments", ...adminOnly, async (req, res, next) => {
  try {
    const query = parseRequest(GetAdminShipmentsQueryParams, req.query, res);
    if (!query) return;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const conditions = [
      query.search
        ? or(
            ilike(shipmentsTable.trackingNumber, `%${query.search}%`),
            ilike(shipmentsTable.carrier, `%${query.search}%`),
            ilike(shipmentsTable.origin, `%${query.search}%`),
            ilike(shipmentsTable.destination, `%${query.search}%`),
            ilike(usersTable.name, `%${query.search}%`),
          )
        : undefined,
      query.status ? ilike(shipmentsTable.status, query.status) : undefined,
      query.destination
        ? ilike(shipmentsTable.destination, `%${query.destination}%`)
        : undefined,
    ].filter(Boolean);
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, [totalRow]] = await Promise.all([
      db
        .select({ shipment: shipmentsTable, customerName: usersTable.name })
        .from(shipmentsTable)
        .leftJoin(usersTable, eq(shipmentsTable.customerId, usersTable.id))
        .where(where)
        .orderBy(desc(shipmentsTable.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db
        .select({ value: count() })
        .from(shipmentsTable)
        .leftJoin(usersTable, eq(shipmentsTable.customerId, usersTable.id))
        .where(where),
    ]);
    res.json(
      GetAdminShipmentsResponse.parse({
        items: rows.map((row) =>
          shipmentDto(row.shipment, row.customerName ?? null),
        ),
        total: totalRow.value,
        page,
        pageSize,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/admin/shipments", ...adminOnly, async (req, res, next) => {
  try {
    const input = parseRequest(CreateShipmentBody, req.body, res);
    if (!input) return;
    if (!(await validateCustomer(input.customerId))) {
      res.status(400).json({ error: "Choose an active customer account." });
      return;
    }
    const actor = currentUser(res);
    const shipment = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(shipmentsTable)
        .values({
          ...input,
          trackingNumber: makeTrackingNumber(),
          weight: input.weight == null ? null : String(input.weight),
        })
        .returning();
      await tx.insert(trackingEventsTable).values({
        shipmentId: created.id,
        source: "internal",
        status: created.status,
        description: "Shipment created in operations.",
        eventTimestamp: created.createdAt,
      });
      if (created.customerId) {
        await tx.insert(notificationsTable).values({
          userId: created.customerId,
          type: "shipment_status",
          title: "A shipment has been created",
          message: `Your shipment tracking number is ${created.trackingNumber}.`,
        });
      }
      return created;
    });
    await writeAudit(actor, req, "shipment.created", "shipment", shipment.id, {
      trackingNumber: shipment.trackingNumber,
    });
    const owner = shipment.customerId
      ? await db.query.usersTable.findFirst({
          where: eq(usersTable.id, shipment.customerId),
        })
      : null;
    res.status(201).json(shipmentDto(shipment, owner?.name ?? null));
  } catch (error) {
    next(error);
  }
});

router.get(
  "/admin/shipments/:id",
  ...adminOnly,
  async (req, res, next) => {
    try {
      const params = parseRequest(GetAdminShipmentParams, req.params, res);
      if (!params) return;
      const shipment = await db.query.shipmentsTable.findFirst({
        where: eq(shipmentsTable.id, params.id),
      });
      if (!shipment) {
        res.status(404).json({ error: "Shipment not found." });
        return;
      }
      const [events, owner] = await Promise.all([
        db.query.trackingEventsTable.findMany({
          where: eq(trackingEventsTable.shipmentId, shipment.id),
          orderBy: [desc(trackingEventsTable.eventTimestamp)],
        }),
        shipment.customerId
          ? db.query.usersTable.findFirst({
              where: eq(usersTable.id, shipment.customerId),
            })
          : Promise.resolve(null),
      ]);
      res.json(
        GetAdminShipmentResponse.parse({
          shipment: shipmentDto(shipment, owner?.name ?? null),
          events: events.map(eventDto),
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/admin/shipments/:id",
  ...adminOnly,
  async (req, res, next) => {
    try {
      const params = parseRequest(UpdateShipmentParams, req.params, res);
      const input = parseRequest(UpdateShipmentBody, req.body, res);
      if (!params || !input) return;
      if (input.customerId !== undefined && !(await validateCustomer(input.customerId))) {
        res.status(400).json({ error: "Choose an active customer account." });
        return;
      }
      const existing = await db.query.shipmentsTable.findFirst({
        where: eq(shipmentsTable.id, params.id),
      });
      if (!existing) {
        res.status(404).json({ error: "Shipment not found." });
        return;
      }
      const actor = currentUser(res);
      const shipment = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(shipmentsTable)
          .set({
            ...input,
            ...(input.weight === undefined
              ? {}
              : { weight: input.weight === null ? null : String(input.weight) }),
            updatedAt: new Date(),
          })
          .where(eq(shipmentsTable.id, existing.id))
          .returning();
        if (input.status && input.status !== existing.status) {
          await tx.insert(trackingEventsTable).values({
            shipmentId: existing.id,
            source: "internal",
            status: input.status,
            location: input.currentLocation ?? existing.currentLocation,
            description: "Status updated by operations.",
            eventTimestamp: new Date(),
          });
          if (updated.customerId) {
            await tx.insert(notificationsTable).values({
              userId: updated.customerId,
              type: "shipment_status",
              title: `Shipment ${updated.trackingNumber} updated`,
              message: `Shipment status is now ${updated.status}.`,
            });
          }
        } else if (
          input.currentLocation &&
          input.currentLocation !== existing.currentLocation
        ) {
          await tx.insert(trackingEventsTable).values({
            shipmentId: existing.id,
            source: "internal",
            status: updated.status,
            location: input.currentLocation,
            description: "Shipment location updated by operations.",
            eventTimestamp: new Date(),
          });
        }
        return updated;
      });
      await writeAudit(actor, req, "shipment.updated", "shipment", shipment.id, {
        fields: Object.keys(input),
      });
      const owner = shipment.customerId
        ? await db.query.usersTable.findFirst({
            where: eq(usersTable.id, shipment.customerId),
          })
        : null;
      res.json(shipmentDto(shipment, owner?.name ?? null));
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/admin/shipments/:id/events",
  ...adminOnly,
  async (req, res, next) => {
    try {
      const params = parseRequest(CreateTrackingEventParams, req.params, res);
      const input = parseRequest(CreateTrackingEventBody, req.body, res);
      if (!params || !input) return;
      const shipment = await db.query.shipmentsTable.findFirst({
        where: eq(shipmentsTable.id, params.id),
      });
      if (!shipment) {
        res.status(404).json({ error: "Shipment not found." });
        return;
      }
      const timestamp = new Date(input.eventTimestamp);
      const actor = currentUser(res);
      const event = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(trackingEventsTable)
          .values({
            shipmentId: shipment.id,
            source: "internal",
            status: input.status,
            location: input.location ?? null,
            description: input.description,
            eventTimestamp: timestamp,
          })
          .returning();
        const [updated] = await tx
          .update(shipmentsTable)
          .set({
            status: input.status,
            currentLocation: input.location ?? shipment.currentLocation,
            updatedAt: new Date(),
          })
          .where(eq(shipmentsTable.id, shipment.id))
          .returning();
        if (updated.customerId) {
          await tx.insert(notificationsTable).values({
            userId: updated.customerId,
            type: "shipment_status",
            title: `Shipment ${updated.trackingNumber} updated`,
            message: `${input.status}: ${input.description}`,
          });
        }
        return created;
      });
      await writeAudit(actor, req, "tracking_event.created", "shipment", shipment.id, {
        status: input.status,
      });
      res.status(201).json(eventDto(event));
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/admin/shipments/:id/sync",
  ...adminOnly,
  providerSyncLimit,
  async (req, res, next) => {
    try {
      const params = parseRequest(SyncShipmentTrackingParams, req.params, res);
      if (!params) return;
      const shipment = await db.query.shipmentsTable.findFirst({
        where: eq(shipmentsTable.id, params.id),
      });
      if (!shipment) {
        res.status(404).json({ error: "Shipment not found." });
        return;
      }
      const snapshot = await synchronizeTracking(
        shipment,
        Boolean(shipment.providerRegisteredAt),
      );
      const eventCount = await persistProviderSnapshot(shipment, snapshot);
      if (snapshot.registered && !shipment.providerRegisteredAt) {
        await db
          .update(shipmentsTable)
          .set({ providerRegisteredAt: new Date() })
          .where(eq(shipmentsTable.id, shipment.id));
      }
      await writeAudit(currentUser(res), req, "shipment.tracking_synced", "shipment", shipment.id, {
        eventCount,
      });
      res.json({
        configured: true,
        registered: snapshot.registered,
        eventCount,
        message: snapshot.message,
      });
    } catch (error) {
      if (error instanceof TrackingProviderError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      next(error);
    }
  },
);

router.get("/admin/quotes", ...adminOnly, async (req, res, next) => {
  try {
    const query = parseRequest(GetAdminQuotesQueryParams, req.query, res);
    if (!query) return;
    const validStatuses = [
      "pending",
      "reviewing",
      "quoted",
      "accepted",
      "rejected",
      "completed",
    ] as const;
    if (query.status && !validStatuses.includes(query.status as (typeof validStatuses)[number])) {
      res.status(400).json({ error: "Invalid quote status." });
      return;
    }
    const where = and(
      query.status
        ? eq(
            quotesTable.status,
            query.status as (typeof validStatuses)[number],
          )
        : undefined,
      query.search
        ? or(
            ilike(quotesTable.customerName, `%${query.search}%`),
            ilike(quotesTable.email, `%${query.search}%`),
            ilike(quotesTable.origin, `%${query.search}%`),
            ilike(quotesTable.destination, `%${query.search}%`),
          )
        : undefined,
    );
    const quotes = await db.query.quotesTable.findMany({
      where,
      orderBy: [desc(quotesTable.createdAt)],
      limit: 200,
    });
    res.json(quotes.map(quoteDto));
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/admin/quotes/:id",
  ...adminOnly,
  async (req, res, next) => {
    try {
      const params = parseRequest(UpdateQuoteParams, req.params, res);
      const input = parseRequest(UpdateQuoteBody, req.body, res);
      if (!params || !input) return;
      const [updated] = await db
        .update(quotesTable)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(quotesTable.id, params.id))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Quote request not found." });
        return;
      }
      await writeAudit(currentUser(res), req, "quote.updated", "quote", updated.id, {
        status: updated.status,
      });
      res.json(quoteDto(updated));
    } catch (error) {
      next(error);
    }
  },
);

router.get("/admin/customers", ...adminOnly, async (req, res, next) => {
  try {
    const query = parseRequest(GetAdminCustomersQueryParams, req.query, res);
    if (!query) return;
    const where = and(
      eq(usersTable.role, "customer"),
      eq(usersTable.status, "active"),
      query.search
        ? or(
            ilike(usersTable.name, `%${query.search}%`),
            ilike(usersTable.email, `%${query.search}%`),
            ilike(usersTable.country, `%${query.search}%`),
          )
        : undefined,
    );
    const customers = await db.query.usersTable.findMany({
      where,
      orderBy: [desc(usersTable.createdAt)],
      limit: 200,
    });
    res.json(customers.map(userDto));
  } catch (error) {
    next(error);
  }
});

router.get("/admin/contacts", ...adminOnly, async (_req, res, next) => {
  try {
    const contacts = await db.query.contactsTable.findMany({
      orderBy: [desc(contactsTable.createdAt)],
      limit: 200,
    });
    res.json(contacts);
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/admin/contacts/:id",
  ...adminOnly,
  async (req, res, next) => {
    try {
      const params = parseRequest(UpdateContactParams, req.params, res);
      const input = parseRequest(UpdateContactBody, req.body, res);
      if (!params || !input) return;
      const [updated] = await db
        .update(contactsTable)
        .set(input)
        .where(eq(contactsTable.id, params.id))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Contact request not found." });
        return;
      }
      await writeAudit(currentUser(res), req, "contact.updated", "contact", updated.id, {
        status: updated.status,
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  },
);

router.get("/admin/users", ...adminOnly, async (_req, res, next) => {
  try {
    const users = await db.query.usersTable.findMany({
      orderBy: [desc(usersTable.createdAt)],
      limit: 500,
    });
    res.json(users.map(userDto));
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/admin/users/:id/role",
  requireAuthenticated,
  requireRoles("super_admin"),
  async (req, res, next) => {
    try {
      const params = parseRequest(UpdateUserRoleParams, req.params, res);
      const input = parseRequest(UpdateUserRoleBody, req.body, res);
      if (!params || !input) return;
      const actor = currentUser(res);
      if (actor.id === params.id) {
        res.status(400).json({ error: "You cannot change your own role." });
        return;
      }
      const [updated] = await db
        .update(usersTable)
        .set({ role: input.role, updatedAt: new Date() })
        .where(eq(usersTable.id, params.id))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "User account not found." });
        return;
      }
      await writeAudit(actor, req, "user.role_changed", "user", updated.id, {
        role: updated.role,
      });
      res.json(userDto(updated));
    } catch (error) {
      next(error);
    }
  },
);

router.get("/admin/audit", ...adminOnly, async (_req, res, next) => {
  try {
    const rows = await db
      .select({ audit: auditLogsTable, userName: usersTable.name })
      .from(auditLogsTable)
      .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(200);
    res.json(
      rows.map(({ audit, userName }) => ({
        id: audit.id,
        userName,
        action: audit.action,
        entityType: audit.entityType,
        entityId: audit.entityId,
        metadata: audit.metadata,
        ipAddress: audit.ipAddress,
        createdAt: audit.createdAt,
      })),
    );
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/admin/site",
  requireAuthenticated,
  requireRoles("super_admin", "admin"),
  async (req, res, next) => {
    try {
      const input = parseRequest(UpdateSiteSettingsBody, req.body, res);
      if (!input) return;
      const settings = await saveSiteSettings(input);
      await writeAudit(currentUser(res), req, "site_settings.updated", "site_settings", "public", {
        fields: Object.keys(input),
      });
      res.json(settings);
    } catch (error) {
      next(error);
    }
  },
);

export default router;