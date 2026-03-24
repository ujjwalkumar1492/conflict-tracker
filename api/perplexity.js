export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const key = process.env.PERPLEXITY_KEY;
  if (!key) return res.status(503).json({ error: 'PERPLEXITY_KEY env var not set in Vercel' });

  const now = new Date().toUTCString();
  const prompt = `You are a real-time conflict intelligence system. The current UTC time is ${now}.

Search the web RIGHT NOW for the very latest breaking news and developments in the last few hours about:
- Iran–US war: any new strikes, missile/drone activity, IRGC operations
- Abu Dhabi / UAE security: any attacks, intercepts, threat level changes
- Ceasefire / peace talks: Islamabad talks, Witkoff, Vance, Kushner status
- Hormuz strait: open/closed, tanker activity
- Oil price: current Brent crude price
- Any breaking escalation or de-escalation signal in the last 1-2 hours

Based on the VERY LATEST information available right now, return ONLY a valid JSON object (no markdown, no explanation, no other text):

{
  "as_of": "<current time and date>",
  "abu_prob": <integer 0-100, RIGHT NOW probability of strike on Abu Dhabi in next 24h>,
  "war_score": <integer 0-100, current conflict intensity: 100=active full war 1=ceasefire signed>,
  "sentiment": <"escalating" or "de-escalating" or "neutral">,
  "headline": "<one sentence: most critical development in the last few hours>",
  "events": [
    { "time": "<HH:MM UTC>", "tag": "<mil|diplo|econ|intel|breaking>", "hl": "<headline>", "det": "<detail>" }
  ],
  "risk_up": ["<current factor raising Abu Dhabi risk>"],
  "risk_down": ["<current factor lowering Abu Dhabi risk>"],
  "oil_price": "<current Brent crude price e.g. $99.50>",
  "hormuz": "<open|restricted|closed>",
  "sources": ["<source 1>", "<source 2>"]
}

CRITICAL: Base abu_prob and war_score on events from the LAST FEW HOURS, not yesterday. Return ONLY the JSON object.`;

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

    // Cache 5 minutes — we want near-real-time scores
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.json({ ok: true, data, updated: new Date().toISOString() });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
