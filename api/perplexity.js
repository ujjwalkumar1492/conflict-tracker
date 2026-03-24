export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const key = process.env.PERPLEXITY_KEY;
  if (!key) return res.status(503).json({ error: 'PERPLEXITY_KEY env var not set in Vercel' });

  const prompt = `You are an intelligence analyst. Search the web for news from TODAY about:
- Iran–US war, ceasefire talks, Islamabad negotiations
- Iran attacks on UAE, Abu Dhabi, Al Dhafra Air Base
- Trump Iran deal, Witkoff, Vance, Kushner talks
- Iran missile/drone activity, IRGC operations
- Hormuz strait status, oil prices

Based on what you find, return ONLY a valid JSON object with NO other text, no markdown, no explanation:

{
  "date": "<today's date e.g. Mar 24, 2026>",
  "abu_prob": <integer 0-100, today's probability of a confirmed strike on Abu Dhabi>,
  "war_score": <integer 0-100, conflict intensity where 100=full war 1=imminent ceasefire>,
  "sentiment": <"escalating" or "de-escalating" or "neutral">,
  "headline": "<one sentence: the single most important development today>",
  "events": [
    { "time": "<HH:MM>", "tag": "<mil|diplo|econ|intel|breaking>", "hl": "<headline>", "det": "<1-2 sentence detail>" }
  ],
  "risk_up": ["<factor increasing Abu Dhabi strike probability>"],
  "risk_down": ["<factor decreasing Abu Dhabi strike probability>"],
  "sources": ["<source name 1>", "<source name 2>"]
}

Tag guide: mil=military/strike, diplo=diplomatic/talks, econ=economic/oil/sanctions, intel=intelligence, breaking=urgent breaking news.
Include 3-6 events sorted newest-first. Return ONLY the JSON object.`;

  try {
    const r = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1400,
        temperature: 0.1
      })
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(502).json({ error: `Perplexity ${r.status}`, detail: err.slice(0, 200) });
    }

    const raw = await r.json();
    const content = raw.choices?.[0]?.message?.content || '';

    // Strip any markdown fences and extract JSON
    const cleaned = content.replace(/```json?/gi, '').replace(/```/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return res.status(502).json({ error: 'No JSON in Perplexity response', raw: content.slice(0, 300) });

    const data = JSON.parse(match[0]);

    // Cache 20 minutes on Vercel edge, serve stale up to 5 min while revalidating
    res.setHeader('Cache-Control', 's-maxage=1200, stale-while-revalidate=300');
    res.json({ ok: true, data, updated: new Date().toISOString() });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
