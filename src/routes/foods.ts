import { Hono } from "hono";
import type { AppEnv } from "../env";

/**
 * Food lookup routes — proxy to Open Food Facts (openfoodfacts.org).
 *
 * GET /v1/foods/barcode/:code  — single product by barcode (EAN/UPC/GTIN)
 * GET /v1/foods/search?q=...   — full-text product search, up to 50 results
 *
 * Response shape mirrors RemoteFoodDto / FoodLookupResponse / FoodSearchResponse
 * in the Android/iOS clients (camelCase, per-100g nutriments).
 */
export const foods = new Hono<AppEnv>();

const OFF_BASE = "https://world.openfoodfacts.org";
const USER_AGENT = "KomorebiNourish/1.0 (personal@onecolin.dev)";

type FoodItem = {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

// ---------------------------------------------------------------------------
// Barcode lookup
// ---------------------------------------------------------------------------

foods.get("/barcode/:code", async (c) => {
  const code = c.req.param("code");
  if (!/^\d{6,14}$/.test(code)) {
    return c.json({ message: "Invalid barcode" }, 400);
  }

  const fields = "code,product_name,brands,nutriments";
  const res = await fetch(
    `${OFF_BASE}/api/v3/product/${code}.json?fields=${fields}`,
    { headers: { "User-Agent": USER_AGENT } },
  ).catch(() => null);

  if (!res) return c.json({ message: "Upstream unavailable" }, 502);
  if (res.status === 404) return c.json({ food: null }, 200);
  if (!res.ok) return c.json({ message: "Upstream error" }, 502);

  const data: unknown = await res.json().catch(() => null);
  if (!data) return c.json({ message: "Upstream parse error" }, 502);

  const food = parseOffV3Product(data, code);
  return c.json({ food });
});

// ---------------------------------------------------------------------------
// Full-text search
// ---------------------------------------------------------------------------

foods.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ message: "Missing query parameter q" }, 400);
  if (q.length > 200) return c.json({ message: "Query too long" }, 400);

  const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
  const pageSize = Math.min(50, Math.max(1, Number(c.req.query("page_size") ?? "20") || 20));

  const params = new URLSearchParams({
    search_terms: q,
    json: "1",
    page: String(page),
    page_size: String(pageSize),
    fields: "code,product_name,brands,nutriments",
  });

  const res = await fetch(`${OFF_BASE}/cgi/search.pl?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  }).catch(() => null);

  if (!res) return c.json({ message: "Upstream unavailable" }, 502);
  if (!res.ok) return c.json({ message: "Upstream error" }, 502);

  const data: unknown = await res.json().catch(() => null);
  if (!data) return c.json({ message: "Upstream parse error" }, 502);

  const foods = parseOffSearchResults(data);
  return c.json({ foods });
});

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseOffV3Product(data: unknown, code: string): FoodItem | null {
  if (data === null || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  // OFF v3: product is under `product` key; status 0 = not found
  if (d["status"] === 0) return null;
  const product = d["product"];
  if (product === null || typeof product !== "object") return null;

  return productToFood(product as Record<string, unknown>, code);
}

function parseOffSearchResults(data: unknown): FoodItem[] {
  if (data === null || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const products = d["products"];
  if (!Array.isArray(products)) return [];

  return products
    .map((p: unknown) => {
      if (p === null || typeof p !== "object") return null;
      return productToFood(p as Record<string, unknown>, null);
    })
    .filter((f): f is FoodItem => f !== null);
}

function productToFood(
  p: Record<string, unknown>,
  fallbackCode: string | null,
): FoodItem | null {
  const name = strOf(p["product_name"]);
  if (!name) return null; // skip products with no name

  const code = strOf(p["code"]) ?? fallbackCode ?? "";
  const brand = strOf(p["brands"]);
  const n = p["nutriments"];
  const nm: Record<string, unknown> =
    n !== null && typeof n === "object" && !Array.isArray(n)
      ? (n as Record<string, unknown>)
      : {};

  const calories = numOf(nm["energy-kcal_100g"]) ?? numOf(nm["energy_100g"]) ?? 0;
  const proteinG = numOf(nm["proteins_100g"]) ?? 0;
  const carbsG = numOf(nm["carbohydrates_100g"]) ?? 0;
  const fatG = numOf(nm["fat_100g"]) ?? 0;

  return {
    id: code,
    name,
    brand: brand ?? null,
    barcode: code || null,
    calories,
    proteinG,
    carbsG,
    fatG,
  };
}

function strOf(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function numOf(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 10) / 10;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.round(n * 10) / 10 : undefined;
  }
  return undefined;
}
