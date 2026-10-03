import { createHash, timingSafeEqual } from "node:crypto";
import { eq, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { db, shipmentsTable } from "@workspace/db";
import { persistProviderSnapshot } from "../services/records";
import {
  providerIsConfigured,
  snapshotFromWebhook,
} from "../services/tracking-provider";

const router: IRouter = Router();
const webhookLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

router.post("/webhooks/17track", webhookLimit, async (req, res, next) => {
  try {
    const key = process.env.TRACKING_17TRACK_API_KEY;
    const rawBody = req.rawBody;
    const signature = req.get("sign")?.trim().toLowerCase();
    if (!key || !providerIsConfigured()) {
      res.status(503).json({ error: "17TRACK is not configured." });
      return;
    }
    if (
      !rawBody ||
      !signature ||
      !/^[a-f0-9]{64}$/.test(signature)
    ) {
      res.status(401).json({ error: "Invalid provider signature." });
      return;
    }

    const expected = createHash("sha256")
      .update(rawBody.toString("utf8"))
      .update(`/${key}`)
      .digest();
    const supplied = Buffer.from(signature, "hex");
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      res.status(401).json({ error: "Invalid provider signature." });
      return;
    }

    const eventName =
      req.body && typeof req.body === "object" ? req.body.event : null;
    if (eventName !== "TRACKING_UPDATED") {
      res.status(200).json({ received: true });
      return;
    }
    const normalized = snapshotFromWebhook(req.body);
    if (!normalized) {
      res.status(400).json({ error: "Provider update is missing a tracking number." });
      return;
    }
    const shipment = await db.query.shipmentsTable.findFirst({
      where: or(
        eq(shipmentsTable.carrierTrackingNumber, normalized.trackingNumber),
        eq(shipmentsTable.trackingNumber, normalized.trackingNumber),
      ),
    });
    if (!shipment) {
      // Do not retain or disclose provider events for unknown tracking numbers.
      res.status(202).json({ received: true, matched: false });
      return;
    }
    await persistProviderSnapshot(shipment, normalized.snapshot);
    if (!shipment.providerRegisteredAt) {
      await db
        .update(shipmentsTable)
        .set({ providerRegisteredAt: new Date() })
        .where(eq(shipmentsTable.id, shipment.id));
    }
    res.status(200).json({ received: true, matched: true });
  } catch (error) {
    next(error);
  }
});

export default router;