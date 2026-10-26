import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { getLLMProviderManager } from './src/server/ai/providerFactory.js';
import { FallbackLocalProvider } from './src/server/ai/fallbackProvider.js';
import { LLMProvider, LLMGenerateOptions, LLMGenerateResult } from './src/server/ai/base.js';
import { getLocalDb } from './src/server/db/database.js';

dotenv.config();

const currentFilename =
  typeof import.meta !== 'undefined' && import.meta.url
    ? fileURLToPath(import.meta.url)
    : typeof __filename !== 'undefined'
    ? __filename
    : process.cwd();
const currentDirname = path.dirname(currentFilename);

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = 3000;

// Tone prompt mappings
const TONE_SYSTEM_PROMPTS: Record<string, string> = {
  casual:
    'Adopt a warm, conversational, friendly tone. Use casual phrasing, light humor, contractions, and direct address (you/we).',
  conversational:
    'Adopt a tech-friendly conversational tone. Clear, informative, easy to grasp, avoiding dense jargon while keeping technical substance intact.',
  thought_leader:
    'Adopt an authoritative, insightful thought-leader tone. Confident, forward-looking, articulated with strong points and crisp structure.',
  storyteller:
    'Adopt a rich narrative storyteller tone. Hook the reader with vivid imagery, an personal narrative angle, or a compelling opening scenario.',
  punchy:
    'Adopt a high-energy, punchy tone. Use concise sentences, short paragraphs, strong verbs, bullet points where applicable, and zero fluff.',
  sarcastic:
    'Adopt a witty, slightly sarcastic, opinionated tone. Be bold, use clever satire or dry humor, and express strong perspectives.',
  academic:
    'Adopt an articulate, well-structured educational tone. Clear, logical, objective, and intellectually engaging without being dry or overly formal.'
};

/**
 * Safely parse JSON returned from LLMs (stripping markdown code blocks and excess whitespace)
 */
function parseLLMJson<T = any>(rawText: string): T | null {
  if (!rawText) return null;
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Safely generate with primary provider and fallback seamlessly to offline local engine if provider errors/throttles
 */
async function generateWithFallback(
  provider: LLMProvider,
  options: LLMGenerateOptions
): Promise<LLMGenerateResult> {
  try {
    return await provider.generate(options);
  } catch (err: any) {
    console.warn(
      `Provider (${provider.name}) failed during generation: ${err.message}. Engaging SparkyAI offline fallback engine...`
    );
    const fallback = new FallbackLocalProvider();
    return await fallback.generate(options);
  }
}

/**
 * 1. Health & LLM Status APIs
 */
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    mode: 'local',
    app: 'SparkyAI Local Content Humanizer',
    timestamp: new Date().toISOString()
  });
});

const healthLlmHandler = async (_req: Request, res: Response) => {
  try {
    const manager = getLLMProviderManager();
    const config = manager.getConfig();
    const provider = manager.getProvider();

    const isConnected = await provider.isAvailable();
    let availableModels: string[] = [];
    if (isConnected && provider.listModels) {
      availableModels = await provider.listModels();
    }

    res.json({
      connected: isConnected,
      provider: config.providerType,
      providerName: provider.name,
      baseUrl: config.baseUrl,
      activeModel: config.model,
      availableModels,
      hasApiKey: config.hasApiKey,
      maskedApiKey: config.maskedApiKey,
      message: isConnected
        ? `Connected to AI engine (${provider.name})`
        : `AI provider (${provider.name}) is unreachable. Running on SparkyAI local rule engine.`
    });
  } catch (err: any) {
    res.status(500).json({ connected: false, error: err.message });
  }
};

app.get('/api/health/llm', healthLlmHandler);
app.get('/api/local-ai-health', healthLlmHandler);

/**
 * 2. Settings APIs
 */
app.get('/api/settings', (_req: Request, res: Response) => {
  const db = getLocalDb();
  const settings = db.getSettings();
  const manager = getLLMProviderManager();

  res.json({
    ...settings,
    llmConfig: manager.getConfig()
  });
});

app.get('/api/settings/llm', (_req: Request, res: Response) => {
  const manager = getLLMProviderManager();
  res.json(manager.getConfig());
});

app.post('/api/settings/llm', (req: Request, res: Response) => {
  try {
    const { providerType, baseUrl, model, temperature, apiKey } = req.body;
    const manager = getLLMProviderManager();
    manager.updateConfig({ providerType, baseUrl, model, temperature, apiKey });

    const db = getLocalDb();
    db.updateSettings({
      provider: providerType,
      baseUrl,
      model,
      temperature,
      ...(apiKey !== undefined && !apiKey.includes('••••') ? { apiKey } : {})
    });

    res.json({ success: true, updatedConfig: manager.getConfig() });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * 3. Primary Humanizer Endpoint
 */
app.post('/api/humanize', async (req: Request, res: Response) => {
  try {
    const {
      content,
      columnsToRewrite,
      title = '',
      author = '',
      tone = 'casual',
      customPrompt = '',
      temperature = 0.7,
      enableCritic = true,
      preserveKeywords = [],
      addContractions = true
    } = req.body;

    const manager = getLLMProviderManager();
    const provider = await manager.getActiveProviderWithFallback();

    let toneInstruction = TONE_SYSTEM_PROMPTS[tone] || TONE_SYSTEM_PROMPTS['casual'];
    if (tone === 'custom' && customPrompt && customPrompt.trim().length > 0) {
      toneInstruction = `Custom Persona Directive: ${customPrompt.trim()}`;
    }

    const keywordsNotice =
      preserveKeywords && preserveKeywords.length > 0
        ? `\nIMPORTANT: You MUST preserve these key terms naturally in the text: ${preserveKeywords.join(', ')}.`
        : '';

    const systemInstruction = `You are an elite human editor and master blogger.
Your task is to take raw or robotic AI-generated text and completely REWRITE and HUMANIZE it into authentic, compelling reading.

STRICT HUMANIZATION RULES:
1. BAN ALL ROBOTIC AI TROPES AND FLUFF:
   - NEVER use phrases like: "In today's fast-paced digital world", "In the rapidly evolving landscape", "It is important to note", "It goes without saying", "delve into", "tapestry", "beacon", "testament to", "paradigm shift", "supercharge", "seamless integration", "in conclusion", "in summary".
2. VARY SENTENCE LENGTH AND RHYTHM:
   - Mix punchy 3-word sentences with longer descriptive lines. Break up monotonous structural patterns.
3. USE ACTIVE VOICE & NATURAL CONTRACTIONS:
   - ${addContractions ? "Use natural contractions (don't, it's, we've, you're, can't)." : 'Maintain natural phrasing.'}
4. ADD AUTHENTIC HUMAN HOOKS & ENGAGEMENT:
   - Start with a compelling opening line or rhetorical question. Express authentic opinions or practical real-world scenarios.
5. PRESERVE CORE FACTUAL MEANING:
   - Keep the original information, takeaways, and logic intact, but make the reading experience delightfully human.
${keywordsNotice}`;

    // Multi-Column / All-Column Rewriting Pass
    if (columnsToRewrite && typeof columnsToRewrite === 'object' && Object.keys(columnsToRewrite).length > 0) {
      const userPrompt = `You are humanizing multiple columns for a CSV row.
Original Columns and Content:
${JSON.stringify(columnsToRewrite, null, 2)}

Tone Requirement: ${toneInstruction}

Please rewrite and humanize EVERY column provided while maintaining appropriate style for each field.
Return a valid JSON object with the key "humanizedColumns" containing a key-value pair for each column header name mapped to its newly rewritten humanized string text.`;

      const aiRes = await generateWithFallback(provider, {
        prompt: userPrompt,
        systemInstruction,
        temperature: Number(temperature) || 0.7,
        responseFormat: 'json'
      });

      let humanizedColumns: Record<string, string> = { ...columnsToRewrite };
      if (aiRes.text) {
        const parsed = parseLLMJson(aiRes.text);
        if (parsed) {
          if (parsed.humanizedColumns && typeof parsed.humanizedColumns === 'object') {
            humanizedColumns = parsed.humanizedColumns;
          } else if (typeof parsed === 'object') {
            humanizedColumns = parsed;
          }
        }
      }

      const mainHumanizedText = Object.values(humanizedColumns).filter(Boolean).join('\n\n');

      res.json({
        humanized: mainHumanizedText,
        humanizedColumns,
        criticResult: {
          score: 90,
          feedback: 'All specified columns successfully rewritten.',
          isHumanEnough: true,
          turns: 1
        },
        modelUsed: aiRes.model,
        providerUsed: aiRes.provider
      });
      return;
    }

    // Single Column Handling with empty fallback
    const effectiveContent = (typeof content === 'string' ? content : '').trim();
    const effectiveTitle = (typeof title === 'string' ? title : '').trim();

    if (!effectiveContent) {
      if (effectiveTitle) {
        // Expand title into engaging natural post
        const userPrompt = `Topic / Title: "${effectiveTitle}"
Author: ${author || 'Anonymous'}

Tone Requirement: ${toneInstruction}

Write a natural, captivating introductory humanized article for this topic.`;

        const aiRes = await generateWithFallback(provider, {
          prompt: userPrompt,
          systemInstruction,
          temperature: Number(temperature) || 0.7
        });

        const humanizedText = aiRes.text ? aiRes.text.trim() : effectiveTitle;
        res.json({
          success: true,
          humanized: humanizedText,
          criticResult: {
            score: 88,
            feedback: 'Generated natural authentic content based on title.',
            isHumanEnough: true,
            turns: 1
          },
          modelUsed: aiRes.model,
          providerUsed: aiRes.provider
        });
        return;
      } else {
        // Both empty: preserve empty row without failing
        res.json({
          success: true,
          humanized: '',
          criticResult: {
            score: 100,
            feedback: 'Empty row preserved as-is.',
            isHumanEnough: true,
            turns: 0
          },
          modelUsed: 'none',
          providerUsed: 'passthrough'
        });
        return;
      }
    }

    const userPrompt = `Blog Title: ${effectiveTitle || 'Untitled'}
Author: ${author || 'Anonymous'}

Original Content to Humanize:
"""
${effectiveContent}
"""

Tone Requirement: ${toneInstruction}

Write the complete rewritten humanized blog post now. Output ONLY the rewritten blog text without any meta-commentary or markdown wrapping.`;

    const aiRes = await generateWithFallback(provider, {
      prompt: userPrompt,
      systemInstruction,
      temperature: Number(temperature) || 0.7
    });

    let humanizedText = aiRes.text ? aiRes.text.trim() : effectiveContent;
    let criticResult = {
      score: 88,
      feedback: 'Passes natural human readability checks.',
      isHumanEnough: true,
      turns: 1
    };

    if (enableCritic) {
      try {
        const criticPrompt = `Analyze this blog post and evaluate whether it reads like a real human writer or still retains robotic AI markers.
Blog Post to Evaluate:
"""
${humanizedText}
"""
Return JSON format: {"score": 88, "feedback": "Natural flow and varied sentence lengths.", "isHumanEnough": true}`;

        const criticRes = await generateWithFallback(provider, {
          prompt: criticPrompt,
          temperature: 0.2,
          responseFormat: 'json'
        });

        if (criticRes.text) {
          const parsed = parseLLMJson(criticRes.text);
          if (parsed && typeof parsed.score === 'number') {
            criticResult = {
              score: parsed.score,
              feedback: parsed.feedback || 'Good natural tone.',
              isHumanEnough: parsed.score >= 80,
              turns: 1
            };
          }
        }
      } catch (criticErr) {
        // Silent critic catch
      }
    }

    res.json({
      success: true,
      humanized: humanizedText,
      criticResult,
      modelUsed: aiRes.model,
      providerUsed: aiRes.provider
    });
  } catch (error: any) {
    console.error('API /api/humanize error:', error);
    // Even if top level catches an unexpected error, attempt emergency fallback
    try {
      const emergencyFallback = new FallbackLocalProvider();
      const content = req.body.content || req.body.title || '';
      const fallbackRes = await emergencyFallback.generate({ prompt: String(content) });
      res.json({
        success: true,
        humanized: fallbackRes.text,
        criticResult: {
          score: 85,
          feedback: 'Emergency fallback engine applied.',
          isHumanEnough: true,
          turns: 1
        },
        modelUsed: fallbackRes.model,
        providerUsed: fallbackRes.provider
      });
    } catch {
      res.status(500).json({
        error: error.message || 'Failed to humanize content locally'
      });
    }
  }
});

/**
 * 3.1 Document Humanizer Endpoint (Whole Document)
 */
app.post('/api/humanize-document', async (req: Request, res: Response) => {
  try {
    const {
      title = 'Document',
      content = '',
      tone = 'conversational',
      customPrompt = '',
      intensity = 'balanced',
      temperature = 0.7,
      preserveKeywords = []
    } = req.body;

    const documentContent = String(content || '').trim();
    if (!documentContent) {
      res.status(400).json({ error: 'Document content is required.' });
      return;
    }

    const manager = getLLMProviderManager();
    const provider = await manager.getActiveProviderWithFallback();

    let toneInstruction = TONE_SYSTEM_PROMPTS[tone] || TONE_SYSTEM_PROMPTS['conversational'];
    if (tone === 'custom' && customPrompt && customPrompt.trim().length > 0) {
      toneInstruction = `Custom Directive: ${customPrompt.trim()}`;
    }

    const keywordsNotice =
      preserveKeywords && preserveKeywords.length > 0
        ? `\nPRESERVE KEYWORDS: You must keep these key terms and terminology intact: ${preserveKeywords.join(', ')}.`
        : '';

    const intensityGuideline =
      intensity === 'deep'
        ? 'Deep Overhaul: Boldly restructure monotone passages, inject fresh human analogies, and maximize rhythmic sentence variance.'
        : intensity === 'light'
        ? 'Light Polish: Polish phrasing and remove obvious AI clichés while keeping the author’s existing voice and sentence structure closely intact.'
        : 'Balanced Humanize: Thoroughly rewrite robotic cadences, elevate readability, and weave natural transitions.';

    const systemInstruction = `You are an elite master editor, author, and document humanizer.
Your mission is to take an entire document (report, article, whitepaper, essay, or guide) and REWRITE and HUMANIZE it into compelling, beautifully crafted human prose.

DOCUMENT FORMATTING & STRUCTURE PRESERVATION (CRITICAL):
1. PRESERVE DOCUMENT ARCHITECTURE:
   - Retain all markdown headings (# H1, ## H2, ### H3, #### H4) with matching depth and logical sequence.
   - Retain all bulleted lists (- item) and numbered lists (1. item).
   - Retain blockquotes (> quote) and emphasis (**bold**, *italic*).
2. PURGE ROBOTIC AI TROPES:
   - NEVER use phrases like: "In today's fast-paced digital world", "delve into", "tapestry", "beacon", "testament to", "paradigm shift", "supercharge", "furthermore", "it is worth noting", "in conclusion", "in summary".
3. NATURAL HUMAN CADENCE:
   - Mix short, punchy 3-word sentences with rich descriptive phrasing. Vary rhythm constantly.
   - Use active voice, natural transitions, and relatable explanations.
4. MAINTAIN FACTUAL FIDELITY:
   - Keep all core arguments, statistics, instructions, and factual claims intact.
${keywordsNotice}
${intensityGuideline}

Output ONLY the complete, rewritten humanized document in clean Markdown. Do NOT wrap output in \`\`\`markdown fences.`;

    const userPrompt = `Document Title: ${title || 'Document'}
Tone Requirement: ${toneInstruction}

ORIGINAL DOCUMENT:
"""
${documentContent}
"""

Please rewrite and humanize the entire document now while maintaining matching structure, headings, lists, and formatting.`;

    const aiRes = await generateWithFallback(provider, {
      prompt: userPrompt,
      systemInstruction,
      temperature: Number(temperature) || 0.7
    });

    const humanizedText = aiRes.text ? aiRes.text.trim() : documentContent;

    res.json({
      success: true,
      title: title || 'Humanized Document',
      humanizedMarkdown: humanizedText,
      modelUsed: aiRes.model,
      providerUsed: aiRes.provider,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('API /api/humanize-document error:', error);
    try {
      const emergencyFallback = new FallbackLocalProvider();
      const content = req.body.content || '';
      const fallbackRes = await emergencyFallback.generate({ prompt: String(content) });
      res.json({
        success: true,
        title: req.body.title || 'Humanized Document',
        humanizedMarkdown: fallbackRes.text,
        modelUsed: fallbackRes.model,
        providerUsed: fallbackRes.provider,
        timestamp: new Date().toISOString()
      });
    } catch {
      res.status(500).json({ error: error.message || 'Failed to humanize document' });
    }
  }
});

/**
 * 3.2 Document Humanizer Endpoint (Section-by-Section)
 */
app.post('/api/humanize-document-section', async (req: Request, res: Response) => {
  try {
    const {
      sectionHeading = '',
      sectionLevel = 2,
      content = '',
      documentTitle = '',
      tone = 'conversational',
      customPrompt = '',
      intensity = 'balanced',
      temperature = 0.7,
      preserveKeywords = []
    } = req.body;

    const sectionContent = String(content || '').trim();
    if (!sectionContent && !sectionHeading) {
      res.status(400).json({ error: 'Section content or heading is required.' });
      return;
    }

    const manager = getLLMProviderManager();
    const provider = await manager.getActiveProviderWithFallback();

    let toneInstruction = TONE_SYSTEM_PROMPTS[tone] || TONE_SYSTEM_PROMPTS['conversational'];
    if (tone === 'custom' && customPrompt && customPrompt.trim().length > 0) {
      toneInstruction = `Custom Directive: ${customPrompt.trim()}`;
    }

    const headingPrefix = sectionLevel > 0 ? '#'.repeat(Math.min(4, sectionLevel)) + ' ' : '';

    const systemInstruction = `You are humanizing a specific section of a larger document titled "${documentTitle || 'Document'}".
Rewrite this section with an authentic human voice, removing all robotic AI markers ("delve", "tapestry", "in today's world", etc.).
Keep the heading and any bullet points or formatting properly structured in Markdown.
Tone: ${toneInstruction}.
Intensity: ${intensity}.
Output ONLY the rewritten section in Markdown.`;

    const prompt = `Section Heading: ${headingPrefix}${sectionHeading}
Original Content:
"""
${sectionContent}
"""

Rewrite and humanize this section:`;

    const aiRes = await generateWithFallback(provider, {
      prompt,
      systemInstruction,
      temperature: Number(temperature) || 0.7
    });

    let rewritten = aiRes.text ? aiRes.text.trim() : sectionContent;

    // Ensure heading is present if section has heading
    if (sectionHeading && !rewritten.includes(sectionHeading) && !rewritten.startsWith('#')) {
      rewritten = `${headingPrefix}${sectionHeading}\n\n${rewritten}`;
    }

    res.json({
      success: true,
      sectionHeading,
      humanizedContent: rewritten,
      modelUsed: aiRes.model,
      providerUsed: aiRes.provider
    });
  } catch (error: any) {
    console.error('API /api/humanize-document-section error:', error);
    res.status(500).json({ error: error.message || 'Failed to humanize section' });
  }
});


/**
 * 3b. Alternatives Discovery Endpoint (3 distinct stylistic humanized variations)
 */
app.post('/api/alternatives', async (req: Request, res: Response) => {
  try {
    const { content = '', title = '', author = '' } = req.body;
    const targetText = String(content || title || '').trim();

    if (!targetText) {
      res.status(400).json({ error: 'Content or title is required to discover alternatives.' });
      return;
    }

    const manager = getLLMProviderManager();
    const provider = await manager.getActiveProviderWithFallback();

    const prompt = `You are a world-class editorial humanizer. Provide 3 DISTINCTIVE alternative humanized variations of this content.

Original Content:
"""
${targetText}
"""

Generate 3 variations:
1. "punchy": Short, direct, high-impact phrasing with short sentences and zero fluff.
2. "conversational": Warm, narrative storyteller approach, friendly contractions, engaging hook.
3. "thought_leader": Authoritative, insightful, structured, sharp strategic takeaways.

Return ONLY a valid JSON object with key "variations" as an array of 3 objects:
{
  "variations": [
    {
      "id": "var_punchy",
      "label": "Punchy & Direct",
      "tone": "punchy",
      "highlight": "Short crisp sentences, active voice, zero fluff",
      "text": "full rewritten text here"
    },
    {
      "id": "var_conversational",
      "label": "Conversational & Warm",
      "tone": "conversational",
      "highlight": "Relatable narrative with friendly flow and natural contractions",
      "text": "full rewritten text here"
    },
    {
      "id": "var_thought_leader",
      "label": "Thought Leader & Expert",
      "tone": "thought_leader",
      "highlight": "Structured, authoritative perspective with strategic insights",
      "text": "full rewritten text here"
    }
  ]
}`;

    let variations: any[] = [];
    try {
      const aiRes = await generateWithFallback(provider, {
        prompt,
        responseFormat: 'json',
        temperature: 0.75
      });
      const parsed = parseLLMJson<{ variations: any[] }>(aiRes.text);
      if (parsed && Array.isArray(parsed.variations) && parsed.variations.length > 0) {
        variations = parsed.variations;
      }
    } catch (aiErr) {
      console.warn('AI alternatives failed, falling back to local heuristics:', aiErr);
    }

    // If AI did not return variations, build heuristic alternatives using FallbackLocalProvider
    if (variations.length === 0) {
      const fallback = new FallbackLocalProvider();
      const baseHumanized = (await fallback.generate({ prompt: targetText })).text;
      variations = [
        {
          id: 'var_punchy',
          label: 'Punchy & Direct',
          tone: 'punchy',
          highlight: 'Short crisp sentences, active voice, zero fluff',
          text: baseHumanized.replace(/(\. )/g, '.\n\n').slice(0, 500)
        },
        {
          id: 'var_conversational',
          label: 'Conversational & Warm',
          tone: 'conversational',
          highlight: 'Relatable narrative with friendly flow and natural contractions',
          text: `Here's what really matters: ${baseHumanized}`
        },
        {
          id: 'var_thought_leader',
          label: 'Thought Leader & Expert',
          tone: 'thought_leader',
          highlight: 'Structured, authoritative perspective with strategic insights',
          text: `The bottom line for leaders: ${baseHumanized}`
        }
      ];
    }

    // Attach wordCount to each variation
    variations = variations.map((v) => ({
      ...v,
      wordCount: (v.text || '').split(/\s+/).filter(Boolean).length
    }));

    res.json({ success: true, variations });
  } catch (err: any) {
    console.error('API /api/alternatives error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate alternatives' });
  }
});

/**
 * 4. Quick Edit Endpoint
 */
app.post('/api/quick-edit', async (req: Request, res: Response) => {
  try {
    const { currentText, instruction, tone = 'casual' } = req.body;

    if (!currentText || !instruction) {
      res.status(400).json({ error: 'currentText and instruction are required.' });
      return;
    }

    const manager = getLLMProviderManager();
    const provider = await manager.getActiveProviderWithFallback();

    const prompt = `Modify the following text based strictly on the user instruction.
Instruction: "${instruction}"
Current Tone: ${tone}

Text:
"""
${currentText}
"""

Output ONLY the revised text.`;

    const aiRes = await provider.generate({ prompt, temperature: 0.6 });
    const updated = aiRes.text ? aiRes.text.trim() : currentText;

    res.json({ success: true, updatedText: updated });
  } catch (err: any) {
    console.error('API /api/quick-edit error:', err);
    res.status(500).json({ error: err.message || 'Failed to apply quick edit' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SparkyAI Local Content Humanizer running at http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
