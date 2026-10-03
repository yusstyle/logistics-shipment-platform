import { eq } from "drizzle-orm";
import { db, siteSettingsTable } from "@workspace/db";

export const defaultSiteSettings = {
  companyName: process.env.COMPANY_NAME ?? "Logistics Company",
  companyDescription: process.env.COMPANY_DESCRIPTION ?? "",
  companyEmail: process.env.COMPANY_EMAIL ?? "",
  companyPhone: process.env.COMPANY_PHONE ?? "",
  address: process.env.COMPANY_ADDRESS ?? "",
  primaryColor: "#14324b",
  website: "",
  socialLinks: {},
  statistics: [],
  services: [
    {
      slug: "air-freight",
      title: "Air freight",
      description: "Air freight options for time-sensitive cargo.",
    },
    {
      slug: "ocean-freight",
      title: "Ocean freight",
      description: "Ocean freight options for international cargo.",
    },
    {
      slug: "road-freight",
      title: "Road freight",
      description: "Road transport options for regional shipments.",
    },
    {
      slug: "warehousing",
      title: "Warehousing",
      description: "Storage and handling options for your goods.",
    },
    {
      slug: "packaging",
      title: "Packaging",
      description: "Packaging support for shipments of different sizes.",
    },
    {
      slug: "supply-chain",
      title: "Supply chain",
      description: "Planning and coordination for freight movements.",
    },
  ],
  testimonials: [],
};

type Settings = typeof defaultSiteSettings & Record<string, unknown>;

export async function loadSiteSettings(): Promise<Settings> {
  const setting = await db.query.siteSettingsTable.findFirst({
    where: eq(siteSettingsTable.key, "public"),
  });
  const saved =
    setting && setting.value && typeof setting.value === "object"
      ? (setting.value as Record<string, unknown>)
      : {};
  return { ...defaultSiteSettings, ...saved };
}

export async function saveSiteSettings(
  update: Record<string, unknown>,
): Promise<Settings> {
  const current = await loadSiteSettings();
  const value = { ...current, ...update };
  await db
    .insert(siteSettingsTable)
    .values({ key: "public", value })
    .onConflictDoUpdate({
      target: siteSettingsTable.key,
      set: { value, updatedAt: new Date() },
    });
  return value;
}