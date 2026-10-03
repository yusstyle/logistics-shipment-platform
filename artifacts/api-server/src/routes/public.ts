import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import {
  CreateContactBody,
  CreateQuoteBody,
  GetPublicTrackingParams,
  GetPublicTrackingResponse,
  GetSiteSettingsResponse,
  UpdateCurrentUserBody,
} from "@workspace/api-zod";
import {
  contactsTable,
  db,
  notificationsTable,
  quotesTable,
  shipmentsTable,
  trackingEventsTable,
  usersTable,
} from "@workspace/db";
import { parseRequest } from "../lib/validation";
import {
  eventDto,
  notificationDto,
  quoteDto,
  shipmentDto,
} from "../services/records";
import { loadSiteSettings } from "../services/site-settings";
import {
  currentUser,
  optionalLocalUser,
  requireAuthenticated,
} from "../middleware/auth";

const router: IRouter = Router();
const publicFormLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many submissions. Please try again later." },
});
const trackingLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many tracking lookups. Please try again shortly." },
});

router.get("/site", async (_req, res, next) => {
  try {
    const content = await loadSiteSettings();
    res.json(GetSiteSettingsResponse.parse(content));
  } catch (error) {
    next(error);
  }
});

router.get("/tracking/:trackingNumber", trackingLimit, async (req, res, next) => {
  try {
    const params = parseRequest(
      GetPublicTrackingParams,
      req.params,
      res,
    );
    if (!params) return;
    const shipment = await db.query.shipmentsTable.findFirst({
      where: eq(shipmentsTable.trackingNumber, params.trackingNumber),
    });
    if (!shipment) {
      res.status(404).json({ error: "No shipment was found for that tracking number." });
      return;
    }
    const events = await db.query.trackingEventsTable.findMany({
      where: eq(trackingEventsTable.shipmentId, shipment.id),
      orderBy: [desc(trackingEventsTable.eventTimestamp)],
    });
    const response = GetPublicTrackingResponse.parse({
      shipment: {
        ...shipmentDto(shipment),
        customerId: null,
        customerName: null,
      },
      events: events.map(eventDto),
    });
    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post("/quotes", publicFormLimit, async (req, res, next) => {
  try {
    const input = parseRequest(CreateQuoteBody, req.body, res);
    if (!input) return;
    const customer = await optionalLocalUser(req);
    const [quote] = await db
      .insert(quotesTable)
      .values({
        ...input,
        customerId: customer?.id ?? null,
        weight: input.weight == null ? null : String(input.weight),
      })
      .returning();
    res.status(201).json(quoteDto(quote));
  } catch (error) {
    next(error);
  }
});

router.post("/contacts", publicFormLimit, async (req, res, next) => {
  try {
    const input = parseRequest(CreateContactBody, req.body, res);
    if (!input) return;
    const [contact] = await db.insert(contactsTable).values(input).returning();
    res.status(201).json(contact);
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuthenticated, (_req, res) => {
  const user = currentUser(res);
  res.json({
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
  });
});

router.patch("/me", requireAuthenticated, async (req, res, next) => {
  try {
    const input = parseRequest(UpdateCurrentUserBody, req.body, res);
    if (!input) return;
    const user = currentUser(res);
    const [updated] = await db
      .update(usersTable)
      .set(input)
      .where(eq(usersTable.id, user.id))
      .returning();
    res.json({
      id: updated.id,
      clerkUserId: updated.clerkUserId,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      status: updated.status,
      phone: updated.phone,
      address: updated.address,
      country: updated.country,
      createdAt: updated.createdAt,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/customer/shipments", requireAuthenticated, async (_req, res, next) => {
  try {
    const user = currentUser(res);
    const shipments = await db.query.shipmentsTable.findMany({
      where: eq(shipmentsTable.customerId, user.id),
      orderBy: [desc(shipmentsTable.createdAt)],
    });
    res.json(shipments.map((shipment) => shipmentDto(shipment)));
  } catch (error) {
    next(error);
  }
});

router.get("/customer/quotes", requireAuthenticated, async (_req, res, next) => {
  try {
    const user = currentUser(res);
    const quotes = await db.query.quotesTable.findMany({
      where: eq(quotesTable.customerId, user.id),
      orderBy: [desc(quotesTable.createdAt)],
    });
    res.json(quotes.map(quoteDto));
  } catch (error) {
    next(error);
  }
});

router.get(
  "/customer/notifications",
  requireAuthenticated,
  async (_req, res, next) => {
    try {
      const user = currentUser(res);
      const notifications = await db.query.notificationsTable.findMany({
        where: eq(notificationsTable.userId, user.id),
        orderBy: [desc(notificationsTable.createdAt)],
        limit: 100,
      });
      res.json(notifications.map(notificationDto));
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/customer/notifications/:id/read",
  requireAuthenticated,
  async (req, res, next) => {
    try {
      const user = currentUser(res);
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) {
        res.status(400).json({ error: "Invalid notification id." });
        return;
      }
      const [updated] = await db
        .update(notificationsTable)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notificationsTable.id, id),
            eq(notificationsTable.userId, user.id),
          ),
        )
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Notification not found." });
        return;
      }
      res.json(notificationDto(updated));
    } catch (error) {
      next(error);
    }
  },
);

export default router;