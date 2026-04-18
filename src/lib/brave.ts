const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export type BraveResult = {
  title: string;
  url: string;
  description: string;
};

export async function braveSearch(
  query: string,
  count = 20,
): Promise<BraveResult[]> {
  const url = new URL(BRAVE_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY!,
    },
  });
  if (!res.ok) throw new Error(`brave search ${res.status}: ${await res.text()}`);

  const body = (await res.json()) as {
    web?: { results?: Array<{ title: string; url: string; description: string }> };
  };
  return body.web?.results ?? [];
}
