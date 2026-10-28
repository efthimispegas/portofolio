import { providerCardSchema, type ProviderCard } from "@mastoli/core";
import { API_ORIGIN } from "./config";
export async function fetchCard(slug: string): Promise<ProviderCard> {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) throw new Error("Invalid card");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(
      `${API_ORIGIN}/api/cards/${encodeURIComponent(slug)}`,
      { signal: controller.signal },
    );
    if (!response.ok) throw new Error(`Card unavailable (${response.status})`);
    const result = await response.json();
    const card = providerCardSchema.parse(result.data);
    if (card.slug !== slug) throw new Error("Card identity mismatch");
    return card;
  } finally {
    clearTimeout(timeout);
  }
}
