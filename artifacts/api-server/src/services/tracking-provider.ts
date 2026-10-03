import { createHash } from "node:crypto";
import type { Shipment } from "@workspace/db";

const API_ROOT = "https://api.17track.net/track/v2.4";
const REQUEST_SPACING_MS = 400;

type JsonRecord = Record<string, unknown>;

export type NormalizedTrackingEvent = {
  sourceEventId: string;
  status: string;
  location: string | null;
  description: string;
  eventTimestamp: Date;
  rawProviderEvent: string;
};

export type ProviderSnapshot = {
  registered: boolean;
  status: string | null;
  currentLocation: string | null;
  estimatedDelivery: string | null;
  actualDelivery: string | null;
  events: NormalizedTrackingEvent[];
  message: string;
};

export class TrackingProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode = 503,
  ) {
    super(message);
    this.name = "TrackingProviderError";
  }
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

let requestQueue: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

async function providerPost<T>(
  endpoint: string,
  payload: unknown,
): Promise<T> {
  const token = process.env.TRACKING_17TRACK_API_KEY;
  if (!token) {
    throw new TrackingProviderError(
      "17TRACK is not configured. Add TRACKING_17TRACK_API_KEY in Secrets to enable provider synchronization.",
      503,
    );
  }

  const previous = requestQueue;
  let release!: () => void;
  requestQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;

  try {
    const waitMs = Math.max(0, REQUEST_SPACING_MS - (Date.now() - lastRequestAt));
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastRequestAt = Date.now();

    let response: Response;
    try {
      response = await fetch(`${API_ROOT}/${endpoint}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "17token": token,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new TrackingProviderError(
        error instanceof Error && error.name === "TimeoutError"
          ? "17TRACK did not respond before the request timed out."
          : "Could not connect to 17TRACK.",
        502,
      );
    }

    const data = (await response.json().catch(() => null)) as T | null;
    if (!response.ok) {
      throw new TrackingProviderError(
        `17TRACK returned HTTP ${response.status}.`,
        502,
      );
    }
    const envelope = record(data);
    if (envelope && typeof envelope.code === "number" && envelope.code !== 0) {
      throw new TrackingProviderError(
        `17TRACK returned error code ${envelope.code}.`,
        502,
      );
    }
    return data as T;
  } finally {
    release();
  }
}

function providerCarrierCode(shipment: Shipment): number | null {
  const input = shipment.carrier?.trim();
  if (!input || !/^\d+$/.test(input)) return null;
  const code = Number(input);
  return Number.isSafeInteger(code) ? code : null;
}

function normalizeStatus(value: string | null): string | null {
  if (!value) return null;
  const labels: Record<string, string> = {
    InfoReceived: "Information received",
    InTransit: "In transit",
    AvailableForPickup: "Available for pickup",
    OutForDelivery: "Out for delivery",
    DeliveryFailure: "Delivery attempt failed",
    Delivered: "Delivered",
    Exception: "Exception",
    Expired: "Expired",
    NotFound: "Not found",
  };
  return labels[value] ?? value;
}

function parseEvent(
  event: unknown,
  providerKey: string,
): NormalizedTrackingEvent | null {
  const item = record(event);
  if (!item) return null;
  const timestamp =
    stringValue(item.time_utc) ?? stringValue(item.time_iso);
  const eventDate = timestamp ? new Date(timestamp) : null;
  const description =
    stringValue(item.description) ??
    stringValue(record(item.description_translation)?.description);
  if (
    !eventDate ||
    Number.isNaN(eventDate.getTime()) ||
    !description
  ) {
    return null;
  }
  const status = stringValue(item.stage) ?? stringValue(item.sub_status) ?? description;
  const location = stringValue(item.location);
  const sourceKey = [providerKey, timestamp, status, location, description].join("|");
  const sourceEventId = createHash("sha256")
    .update(sourceKey)
    .digest("hex")
    .slice(0, 48);
  return {
    sourceEventId,
    status,
    location,
    description,
    eventTimestamp: eventDate,
    rawProviderEvent: JSON.stringify(item),
  };
}

function snapshotFromTrackInfo(
  trackInfo: unknown,
  registered: boolean,
): ProviderSnapshot {
  const track = record(trackInfo);
  if (!track) {
    return {
      registered,
      status: null,
      currentLocation: null,
      estimatedDelivery: null,
      actualDelivery: null,
      events: [],
      message: "Tracking is registered. Carrier updates are not available yet.",
    };
  }

  const latestStatus = record(track.latest_status);
  const latestEvent = record(track.latest_event);
  const metrics = record(track.time_metrics);
  const eta = record(metrics?.estimated_delivery_date);
  const providers = list(record(track.tracking)?.providers);
  const events: NormalizedTrackingEvent[] = [];

  for (const providerValue of providers) {
    const provider = record(providerValue);
    const providerInfo = record(provider?.provider);
    const providerKey = String(providerInfo?.key ?? "17track");
    for (const eventValue of list(provider?.events)) {
      const normalized = parseEvent(eventValue, providerKey);
      if (normalized) events.push(normalized);
    }
  }

  const uniqueEvents = [
    ...new Map(events.map((event) => [event.sourceEventId, event])).values(),
  ].sort(
    (left, right) =>
      left.eventTimestamp.getTime() - right.eventTimestamp.getTime(),
  );
  const status = normalizeStatus(stringValue(latestStatus?.status));
  const estimatedDelivery =
    stringValue(eta?.to) ?? stringValue(eta?.from);
  const actualDelivery =
    status === "Delivered"
      ? stringValue(latestEvent?.time_utc) ?? stringValue(latestEvent?.time_iso)
      : null;

  return {
    registered,
    status,
    currentLocation: stringValue(latestEvent?.location),
    estimatedDelivery:
      estimatedDelivery && !Number.isNaN(new Date(estimatedDelivery).getTime())
        ? new Date(estimatedDelivery).toISOString().slice(0, 10)
        : null,
    actualDelivery:
      actualDelivery && !Number.isNaN(new Date(actualDelivery).getTime())
        ? new Date(actualDelivery).toISOString().slice(0, 10)
        : null,
    events: uniqueEvents,
    message: status
      ? `17TRACK returned the latest carrier status: ${status}.`
      : "Tracking is registered. Carrier updates are not available yet.",
  };
}

export async function synchronizeTracking(
  shipment: Shipment,
  previouslyRegistered: boolean,
): Promise<ProviderSnapshot> {
  const number = shipment.carrierTrackingNumber || shipment.trackingNumber;
  const carrier = providerCarrierCode(shipment);
  let registered = previouslyRegistered;

  if (!registered) {
    const registration = (await providerPost<unknown>("register", [
      { number, ...(carrier ? { carrier } : {}) },
    ])) as JsonRecord;
    const result = record(registration.data);
    const accepted = list(result?.accepted).some(
      (entry) => record(entry)?.number === number,
    );
    const rejected = list(result?.rejected).find(
      (entry) => record(entry)?.number === number,
    );
    if (!accepted) {
      const rejection = record(rejected);
      const error = record(rejection?.error);
      throw new TrackingProviderError(
        stringValue(error?.message) ?? "17TRACK could not register this number.",
        422,
      );
    }
    registered = true;
  }

  const response = (await providerPost<unknown>("gettrackinfo", [
    { number, ...(carrier ? { carrier } : {}) },
  ])) as JsonRecord;
  const result = record(response.data);
  const accepted = list(result?.accepted).find(
    (entry) => record(entry)?.number === number,
  );
  if (!accepted) {
    const rejected = list(result?.rejected).find(
      (entry) => record(entry)?.number === number,
    );
    const message = stringValue(record(record(rejected)?.error)?.message);
    if (message && !message.toLowerCase().includes("does not register")) {
      throw new TrackingProviderError(message, 422);
    }
    return snapshotFromTrackInfo(null, registered);
  }

  return snapshotFromTrackInfo(record(accepted)?.track_info, registered);
}

export function snapshotFromWebhook(payload: unknown): {
  trackingNumber: string;
  snapshot: ProviderSnapshot;
} | null {
  const envelope = record(payload);
  const data = record(envelope?.data);
  const trackingNumber = stringValue(data?.number);
  if (!trackingNumber) return null;
  return {
    trackingNumber,
    snapshot: snapshotFromTrackInfo(record(data)?.track_info, true),
  };
}

export function providerIsConfigured(): boolean {
  return Boolean(process.env.TRACKING_17TRACK_API_KEY);
}