// =================================================--------
// CRYPTOGRAPHIC HASHING ENGINE (GDPR Compliant IP Tracking)
// =================================================--------
async function generateUserHash(request) {
    const rawIP = request.headers.get("cf-connecting-ip") || "anonymous_user";
    const data = new TextEncoder().encode(rawIP + "_suwuyiku_secure_salt_2026");
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    // Universal CORS headers for all routes
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Notion-Version",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // =================================================--------
    // ROUTE 1: THE LIBRARY ENGINE (Manga & Books)
    // =================================================--------
    if (url.pathname.includes("/library")) {
      try {
        const response = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_DATABASE_ID2}/query`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.NOTION_KEY2}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json"
          }
        });

        const data = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(data));

        // Inside your Cloudflare Worker mapping function:
        const books = await Promise.all(data.results.map(async (page) => {
          const props = page.properties;
          
          // THIS LINE targets the exact "Aa Name" column from image_f5a73a.jpg
          // BULLETPROOF TEXT EXTRACTION: Handles Notion rich_text formatting splits flawlessly
          const title = props.Name?.title?.map(t => t.plain_text).join("") || "Unknown";
          
          const series = props.Series?.multi_select?.[0]?.name || "Unknown Series";
          const volumeNumber = props['Volume Number']?.number || 1;
          const author = props.Author?.rich_text?.map(t => t.plain_text).join("") || "";
          const genres = props.Genre?.multi_select?.map(g => g.name) || [];
          const category = props.Category?.multi_select?.map(c => c.name).join(", ") || "";
          const publisher = props['Manga by']?.rich_text?.map(t => t.plain_text).join("") || "";
          
          const dateAcquired = props['Date Acquired']?.date?.start || "";
          const purchaseLink = props['Purchase Link']?.url || "";
          const covers = props.Covers?.files?.map(f => f.file?.url || f.external?.url).filter(Boolean) || [];

          let review = "";
          try {
            const blockRes = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children`, {
              headers: { "Authorization": `Bearer ${env.NOTION_KEY2}`, "Notion-Version": "2022-06-28" }
            });
            const blockData = await blockRes.json();
            review = blockData.results
              .filter(b => b.type === "paragraph" && b.paragraph.rich_text.length > 0)
              .map(b => b.paragraph.rich_text.map(t => t.plain_text).join(""))
              .join("\n\n");
          } catch (e) {
             console.log("No review found.");
          }

          return { id: page.id, title, series, volumeNumber, author, genres, category, publisher, dateAcquired, purchaseLink, covers, review };
        }));

        return new Response(JSON.stringify(books), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }
    }

    // =================================================--------
    // ROUTE 2: THE SPARK ENGINE (Cloudflare KV)
    // =================================================--------
    if (url.pathname === "/sparks") {
        const userHash = await generateUserHash(request);

        if (request.method === "GET") {
            const pageId = url.searchParams.get("id");
            if (!pageId) return new Response("Missing ID", { status: 400, headers: corsHeaders });

            const userKey = `spark_usr_${userHash}_${pageId}`;
            const countKey = `sparks_count_${pageId}`;

            let sparks = await env.SPARKS_KV.get(countKey);
            sparks = sparks ? parseInt(sparks) : 0;
            const userHasSparked = (await env.SPARKS_KV.get(userKey)) === "true";

            return new Response(JSON.stringify({ sparks, hasSparked: userHasSparked }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        if (request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            const pageId = body.id;
            if (!pageId) return new Response("Missing ID", { status: 400, headers: corsHeaders });

            const userKey = `spark_usr_${userHash}_${pageId}`;
            const countKey = `sparks_count_${pageId}`;

            let sparks = await env.SPARKS_KV.get(countKey);
            sparks = sparks ? parseInt(sparks) : 0;
            const userHasSparked = (await env.SPARKS_KV.get(userKey)) === "true";

            let newSparkState = userHasSparked;

            if (body.action === "add" && !userHasSparked) {
                sparks += 1;
                await env.SPARKS_KV.put(userKey, "true"); 
                newSparkState = true;
            } else if (body.action === "remove" && userHasSparked) {
                sparks = Math.max(0, sparks - 1); 
                await env.SPARKS_KV.delete(userKey); 
                newSparkState = false;
            }

            await env.SPARKS_KV.put(countKey, sparks.toString()); 

            return new Response(JSON.stringify({ sparks, hasSparked: newSparkState }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }
    }

    // =================================================--------
    // ROUTE 3: FRAGMENTS POSTS (Fetch Notion Database)
    // =================================================--------
    if (url.pathname === "/posts") {
        try {
            const notionResponse = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_DATABASE_ID}/query`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${env.NOTION_KEY}`,
                    "Notion-Version": "2022-06-28",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    filter: { property: "Status", status: { equals: "Published" } },
                    sorts: [{ property: "Time", direction: "descending" }]
                })
            });
            const data = await notionResponse.json();
            return new Response(JSON.stringify(data), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: "Failed to fetch Notion data" }), { status: 500, headers: corsHeaders });
        }
    }

    // =================================================--------
    // ROUTE 4: FRAGMENTS CONTENT (Fetch Page Blocks/Images)
    // =================================================--------
    if (url.pathname === "/content") {
        const pageId = url.searchParams.get("id");
        if (!pageId) return new Response("Missing ID", { status: 400, headers: corsHeaders });

        try {
            const notionResponse = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${env.NOTION_KEY}`,
                    "Notion-Version": "2022-06-28"
                }
            });
            const data = await notionResponse.json();
            return new Response(JSON.stringify(data), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: "Failed to fetch content" }), { status: 500, headers: corsHeaders });
        }
    }

    // Fallback if someone hits the raw URL
    return new Response("Suwuyiku API Gateway is Live.", { headers: corsHeaders });
  }
};
