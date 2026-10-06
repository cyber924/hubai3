import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, getDocs, query, orderBy } from 'firebase/firestore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '50mb' }));

// Initialize Gemini SDK on server
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Initialize Firebase server-side for image fetching and validation with robust hardcoded fallbacks
const firebaseConfig = {
  apiKey: process.env.IMAGE_HUB_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyDEpFAsf1fI65xXklKYsukAWFYw5bzaHyc",
  authDomain: `${process.env.IMAGE_HUB_PROJECT_ID || "studio-9240700230-1dd9a"}.firebaseapp.com`,
  projectId: process.env.IMAGE_HUB_PROJECT_ID || "studio-9240700230-1dd9a",
  storageBucket: `${process.env.IMAGE_HUB_PROJECT_ID || "studio-9240700230-1dd9a"}.appspot.com`,
};

const firebaseApp = initializeApp(firebaseConfig, 'serverApp');
const serverDb = getFirestore(firebaseApp);

// 6.3 Public image endpoint to return binary data from base64
app.get('/api/images/:id/public', async (req, res) => {
  try {
    const imageId = req.params.id;
    if (!imageId) {
      res.status(400).json({ error: 'Missing image ID' });
      return;
    }

    const imageRef = doc(serverDb, process.env.IMAGE_HUB_COLLECTION || 'images', imageId);
    const snapshot = await getDoc(imageRef);

    if (!snapshot.exists()) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    const data = snapshot.data();
    
    // Check if visibility is public (strictly obey visibility rules)
    if (data.visibility !== 'public') {
      res.status(403).json({ error: 'Access denied: This image is private' });
      return;
    }

    // Serve base64 or absolute URL
    if (data.dataUrl && data.dataUrl.startsWith('data:')) {
      const matches = data.dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const contentType = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
        res.send(buffer);
        return;
      }
    }

    // If it's a URL already, redirect or stream it
    if (data.imageUrl || data.url) {
      res.redirect(data.imageUrl || data.url);
      return;
    }

    res.status(415).json({ error: 'Unsupported image format or missing dataUrl' });
  } catch (error: any) {
    console.error('Error fetching image public binary:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Helper to fetch image base64 if it exists for multimodal Gemini calls
async function fetchImageBase64(imageId: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const imageRef = doc(serverDb, process.env.IMAGE_HUB_COLLECTION || 'images', imageId);
    const snapshot = await getDoc(imageRef);
    if (snapshot.exists()) {
      const data = snapshot.data();
      if (data.dataUrl && data.dataUrl.startsWith('data:')) {
        const matches = data.dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          return { mimeType: matches[1], base64: matches[2] };
        }
      }
    }
  } catch (err) {
    console.error(`Failed to fetch base64 for image ${imageId}:`, err);
  }
  return null;
}

// Helper to call Gemini model with automatic fallback to gemini-3.8-flash to ensure ZERO errors
async function callModelWithFallback(preferredModel: string, contents: any, config: any) {
  const modelMap: Record<string, string> = {
    'gemini-3.8-flash': 'gemini-3.8-flash',
    'gemini-3.5-flash': 'gemini-3.5-flash',
    'gemini-2.5-flash': 'gemini-2.5-flash-preview-12-2025'
  };

  const targetModel = modelMap[preferredModel] || preferredModel || 'gemini-3.8-flash';
  
  try {
    console.log(`[Gemini SDK] Attempting generation with model: ${targetModel}`);
    const response = await ai.models.generateContent({
      model: targetModel,
      contents,
      config
    });
    return response;
  } catch (err: any) {
    console.warn(`[Gemini SDK] Failed with model ${targetModel} due to: ${err.message}. Retrying with gemini-3.8-flash.`);
    if (targetModel !== 'gemini-3.8-flash') {
      const fallbackResponse = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents,
        config
      });
      return fallbackResponse;
    }
    throw err;
  }
}

// 10.1 AI Planning Recommendation Endpoint
app.post('/api/ai/plan', async (req, res) => {
  try {
    const { images, prompt, siteBrand } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      res.status(400).json({ error: 'At least one image is required for planning' });
      return;
    }

    const imageContextList = images.map((img: any, idx: number) => {
      return `Image #${idx + 1}: ID="${img.id}", Title="${img.title || 'Untitled'}", Tags="${(img.tags || []).join(', ')}"`;
    }).join('\n');

    const { 
      seoTargetPlatform, 
      keywords, 
      locationFocus, 
      googleOptions, 
      naverOptions, 
      selectedModel,
      keywordDensity,
      outlineTemplate,
      googleEeatClimateText,
      naverSmartEditorEmoji
    } = req.body;

    const systemInstruction = `You are an elite Search Engine Optimization (SEO) specialist and digital content director.
Your task is to propose an optimized blog plan based on a collection of selected photos.
Analyze the provided images' titles and tags to craft a highly compelling blog concept.

블로그 구조 템플릿 최적화 지침:
${outlineTemplate === 'comparison' ? `
- [비교 분석 보고서 템플릿]: 각 선택 이미지의 질감, 무드, 특징을 심층 비교하고 장단점을 대조하는 분석적 구조를 잡으십시오.
` : outlineTemplate === 'guide' ? `
- [정보성 가이드 템플릿]: 독자에게 유용한 꿀팁, 장소 방문 수칙, 제품 스펙 등을 정보성 단락(H3)으로 깔끔하게 정리해 노출하십시오.
` : `
- [스토리텔링 흐름 템플릿]: 시간 순서 흐름에 따른 감성적 탐방기 및 에디토리얼 무드의 시간 서열 구조를 설계하십시오.
`}

키워드 밀도 지침:
${keywordDensity === 'optimized' ? `
- [키워드 적극 노출]: 검색 봇의 크롤링 가치 극대화를 위해 문맥의 자연스러움을 훼손하지 않는 선에서 핵심 키워드 "${keywords || ''}" 및 연관 태그들을 헤더(H2/H3) 및 매 구절마다 적극 활용하도록 기획을 상세화하십시오.
` : `
- [자연스러운 흐름]: 구글 랭크브레인(RankBrain) 지침에 대응하여 기계적인 키워드 복사 붙여넣기를 방지하고, 의미적 유사어(LSI Keywords)를 통해 인위적이지 않은 흐름을 유지하십시오.
`}

SEO 플랫폼 최적화 지침:
${seoTargetPlatform === 'google' ? `
- [구글 SEO 최적화 타겟]: 구글 검색 엔진이 극도로 선호하는 계층적 헤더 구조(H2/H3 서열)를 설계하십시오.
- E-E-A-T (경험, 전문성, 권위성, 신뢰성) 기준에 따라, 필자가 '직접 체험하고 목격한 듯한 생생한 1인칭 현장 서사' 및 '관찰기' 중심의 문단 구도를 설계하십시오.
${googleEeatClimateText ? `- 사진 촬영 당시의 실제 기후(날씨), 조도, 카메라 렌즈 및 사물 질감 등의 서술 지침을 문단 계획에 필수 주입하십시오.` : ''}
` : `
- [네이버 최적화 타겟]: 네이버 뷰(VIEW)/블로그 영역 노출 점수를 극대화하기 위해 친근한 리뷰 대화체 어조 및 소통형 문단 구도를 설계하십시오.
- 네이버 스마트에디터 레이아웃에 맞춰 각 사진 하단에 '사진을 구체적으로 설명하는 캡션 가이드라인'과 정보 전달형 캡션 지침을 포함하십시오.
${naverSmartEditorEmoji ? `- 네이버 고유 블로그 특성을 살려, 적절한 소통형 이모지(e.g. ✨, 👍, 🌿, ☕️) 활용 지침을 포함하십시오.` : ''}
`}

Your output must be structured JSON matching the provided schema.
Generate:
- A catchy and professional blog title.
- A list of SEO keywords.
- Target audience profile.
- Mapped sections: Every section MUST be assigned a unique image from the selected collection. Map them intelligently so the narrative flows seamlessly.`;

    const modelInput = `Selected Images Context:
${imageContextList}

타겟 플랫폼: "${seoTargetPlatform || 'google'}"
핵심 키워드 목록: "${keywords || 'N/A'}"
로컬 플레이스 위치: "${locationFocus || 'N/A'}"
사용자 요구사항: "${prompt || 'Suggest a trending topic appropriate for these photos.'}"
Brand Context: "${siteBrand || 'HubStudio Visual Magazine'}"
키워드 강도 스타일: "${keywordDensity || 'natural'}"
블로그 구조 형식: "${outlineTemplate || 'story'}"

Create a compelling structured blog post plan tailored specifically to the ${seoTargetPlatform === 'google' ? 'Google SEO' : 'Naver DIA+'} guidelines. Assign each of the ${images.length} selected images to exactly one section of the table of contents.`;

    const response = await callModelWithFallback(selectedModel, modelInput, {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "Main blog title optimized for search engines" },
          keywords: { type: Type.ARRAY, items: { type: Type.STRING }, description: "SEO Keywords (including user keywords)" },
          targetAudience: { type: Type.STRING, description: "Primary target audience" },
          tone: { type: Type.STRING, description: "Tone of the writing (e.g. Storytelling, Elegant, Informative)" },
          sections: {
            type: Type.ARRAY,
            description: "Structured table of contents",
            items: {
              type: Type.OBJECT,
              properties: {
                sectionTitle: { type: Type.STRING, description: "Title of this section (use H2/H3 keyword hierarchy)" },
                imageId: { type: Type.STRING, description: "The ID of the image assigned to this section" },
                imageDescription: { type: Type.STRING, description: "Brief visual description of what this image shows based on tags/title" },
                contentDescription: { type: Type.STRING, description: "Detailed directive on what content should be generated for this section (e.g. E-E-A-T experience narrative or Naver blog review instruction)" }
              },
              required: ["sectionTitle", "imageId", "contentDescription"]
            }
          }
        },
        required: ["title", "keywords", "targetAudience", "sections"]
      }
    });

    const resultText = response.text || '{}';
    res.json(JSON.parse(resultText));
  } catch (error: any) {
    console.error('Error generating plan:', error);
    res.status(500).json({ error: 'Failed to generate blog plan', details: error.message });
  }
});

// 10.2 Multimodal Blog Post Generation Endpoint
app.post('/api/ai/generate', async (req, res) => {
  try {
    const { 
      plan, 
      customDirections, 
      seoTargetPlatform, 
      keywords, 
      locationFocus, 
      googleOptions, 
      naverOptions, 
      selectedModel,
      keywordDensity,
      outlineTemplate,
      googleEeatClimateText,
      naverSmartEditorEmoji
    } = req.body;

    if (!plan || !plan.title || !plan.sections) {
      res.status(400).json({ error: 'Valid plan is required for generating blog content' });
      return;
    }

    // Build the parts array for multimodal request. We will fetch base64 data for assigned images
    const parts: any[] = [];
    const imageDetails: string[] = [];

    for (let i = 0; i < plan.sections.length; i++) {
      const sec = plan.sections[i];
      const imgData = await fetchImageBase64(sec.imageId);
      if (imgData) {
        parts.push({
          inlineData: {
            mimeType: imgData.mimeType,
            data: imgData.base64
          }
        });
        imageDetails.push(`Image Part corresponds to Image ID "${sec.imageId}" assigned to section: "${sec.sectionTitle}"`);
      } else {
        imageDetails.push(`Image ID "${sec.imageId}" (No base64 found, fallback to metadata: "${sec.imageDescription || 'Visual element'}") assigned to section: "${sec.sectionTitle}"`);
      }
    }

    const systemInstruction = `You are a world-class professional copywriter, digital editor, and Search Engine Optimization (SEO) expert.
Your task is to write a highly engaging, informative, and structurally rich blog post based on the provided design plan, selected images, and targeted search engines.

Instructions:
- Write in Korean (한국어) with a polished, highly professional, and natural style.
- Each section MUST correspond to the mapped image. Integrate references to the images naturally into the text (e.g. describing details in the photo).
- Keep sections substantial and detailed (at least 200-300 words per section).
- Do not make up fake factual claims. Speak generally and beautifully about the locations, products, or ideas.
- Provide a clear SEO-optimized summary, meta-description, and seoTags.

키워드 노출 스타일:
${keywordDensity === 'optimized' ? `
- 제공된 타겟 핵심 키워드 "${keywords || ''}" 및 이와 관련된 유관 구절들을 문단 내용 및 소제목에 적극적이고 명시적으로 삽입하여 노출 지수를 극대화하십시오.
` : `
- 키워드 매칭을 인위적으로 하지 않고 문장의 서사적 맥락에 녹아들 수 있도록 자연스럽고 조화롭게 배치하십시오.
`}

플랫폼별 맞춤 가이드라인:
${seoTargetPlatform === 'google' ? `
- [Google SEO 타겟팅]:
  1. H2와 H3 태그 구조를 철저히 이행하십시오. 핵심 키워드를 헤더에 자연스럽게 배치하십시오.
  2. E-E-A-T 원칙에 부합하도록 필자가 실제 직접 보고 체험한 생생한 인용 및 서사 방식을 사용하십시오.
  3. 객관적이고 신뢰할 수 있는 어조로 논리적인 전개를 진행하십시오.
  ${googleEeatClimateText ? `4. 각 사진 속 기후(날씨), 현장의 오감 묘사, 조도 변화 및 피사체의 물리적 거동을 전문적으로 설명하는 문장을 각 단락마다 필수로 추가하십시오.` : ''}
` : `
- [Naver Search 타겟팅]:
  1. 네이버 스마트에디터 분위기에 맞춰 친근하고 다정한 존댓말 어조("안녕하세요 여러분", "~해볼게요", "~같아요")와 이모티콘 기호를 문단 중간에 조화롭게 삽입하십시오.
  2. 각 문단 하단에 지정될 사진 캡션(imageCaption)을 네이버 포맷에 맞춰 구체적이고 호기심을 유발하도록 설계하십시오.
  3. 로컬 플레이스 정보가 연동될 수 있도록 지역 명칭을 부드럽게 강조하십시오.
  ${naverSmartEditorEmoji ? `4. 문장 속 곳곳에 맛집 블로거 등 네이버 친화적인 귀여운 이모티콘(✨, 👍, 🌿, ☕️, 📸)을 배치하여 생동감을 키우십시오.` : ''}
`}`;

    const promptText = `
Design Plan:
Title: "${plan.title}"
Tone: "${plan.tone || 'Friendly and Inspiring'}"
Target Audience: "${plan.targetAudience}"
Additional User Input: "${customDirections || 'Write the blog post according to the plan.'}"

SEO Meta Context:
타겟 플랫폼: "${seoTargetPlatform || 'google'}"
핵심 타겟 키워드: "${keywords || 'N/A'}"
위치 정보 포커스: "${locationFocus || 'N/A'}"

Sections Blueprint:
${plan.sections.map((sec: any, idx: number) => `
Section ${idx + 1}:
- Title: "${sec.sectionTitle}"
- Assigned Image: ID="${sec.imageId}"
- Content Directive: "${sec.contentDescription}"
- Image description: "${sec.imageDescription || 'N/A'}"
`).join('\n')}

Images Mapping Context:
${imageDetails.join('\n')}

Generate the full blog post content. Return it as valid JSON conforming strictly to the requested schema.`;

    parts.push({ text: promptText });

    const response = await callModelWithFallback(selectedModel, { parts }, {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          summary: { type: Type.STRING, description: "A catchy 2-3 sentence overview" },
          sections: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: "Section header" },
                content: { type: Type.STRING, description: "Full section text in Markdown" },
                imageId: { type: Type.STRING, description: "Must match the original assigned image ID" },
                imageCaption: { type: Type.STRING, description: "Beautiful caption explaining the photo in context of this section" }
              },
              required: ["title", "content", "imageId", "imageCaption"]
            }
          },
          seoTags: { type: Type.ARRAY, items: { type: Type.STRING } },
          metaDescription: { type: Type.STRING, description: "150-160 character description for search engines" }
        },
        required: ["title", "summary", "sections", "seoTags", "metaDescription"]
      }
    });

    const generatedText = response.text || '{}';
    res.json(JSON.parse(generatedText));
  } catch (error: any) {
    console.error('Error generating blog content:', error);
    res.status(500).json({ error: 'Failed to generate blog content', details: error.message });
  }
});

// 11. Multimodal Review & Image Cross-matching (검수) Endpoint
app.post('/api/ai/review', async (req, res) => {
  try {
    const { blogPost, selectedModel } = req.body;

    if (!blogPost || !blogPost.sections) {
      res.status(400).json({ error: 'Valid blog post is required for review' });
      return;
    }

    const parts: any[] = [];
    const mappingMetadata: string[] = [];
    let realImagesCount = 0;

    for (let i = 0; i < blogPost.sections.length; i++) {
      const sec = blogPost.sections[i];
      const imgData = await fetchImageBase64(sec.imageId);
      if (imgData) {
        realImagesCount++;
        parts.push({
          inlineData: {
            mimeType: imgData.mimeType,
            data: imgData.base64
          }
        });
        mappingMetadata.push(`Image Part #${realImagesCount} represents Image ID "${sec.imageId}" assigned to Section #${i + 1} ("${sec.title}")`);
      } else {
        mappingMetadata.push(`No physical image found for ID "${sec.imageId}" (Section #${i + 1} "${sec.title}"). Reviewer must evaluate using text and caption context only.`);
      }
    }

    const systemInstruction = `You are a meticulous content reviewer and brand quality inspector.
Your goal is to cross-examine a generated blog post against its selected visuals to ensure total alignment.

Evaluate:
1. "Visual Relevance": Does the section text actually align with what is shown in the image? For sections with physical image inputs, evaluate the ACTUAL visual content (e.g. colors, objects, locations) vs the text.
2. "Text Quality": Grammar, readability, flow, SEO richness.
3. "Discrepancy Check": Flag any mismatch (e.g. text mentions winter snow but photo is a sun-drenched beach). Specify if real image bytes were successfully analyzed.

Your output must be structured JSON following the exact schema.`;

    const promptText = `
Review Request:
Blog Title: "${blogPost.title}"
Blog Summary: "${blogPost.summary}"

Sections under Review:
${blogPost.sections.map((sec: any, idx: number) => `
Section #${idx + 1}:
- Title: "${sec.title}"
- Content Sample: "${sec.content.substring(0, 400)}..."
- Mapped Image ID: "${sec.imageId}"
- Caption: "${sec.imageCaption}"
`).join('\n')}

Image Analysis Mapping Status:
${mappingMetadata.join('\n')}

Perform a strict quality check. Score overall blog out of 100, and grade each section out of 10.`;

    parts.push({ text: promptText });

    const response = await callModelWithFallback(selectedModel, { parts }, {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          overallScore: { type: Type.NUMBER, description: "Blog quality rating from 0 to 100" },
          generalFeedback: { type: Type.STRING, description: "Detailed review summary and actionable advice" },
          sections: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                sectionIndex: { type: Type.NUMBER, description: "1-based section index" },
                relevanceScore: { type: Type.NUMBER, description: "Image-text alignment score from 1 to 10" },
                textQualityScore: { type: Type.NUMBER, description: "Writing quality rating from 1 to 10" },
                feedback: { type: Type.STRING, description: "Actionable notes for this section" },
                discrepancyDetected: { type: Type.BOOLEAN, description: "True if any visual-text mismatch is found" },
                discrepancyDetails: { type: Type.STRING, description: "Explanation of the mismatch (if any)" },
                realImageAnalyzed: { type: Type.BOOLEAN, description: "MUST set to True only if corresponding physical image part was present" }
              },
              required: ["sectionIndex", "relevanceScore", "textQualityScore", "feedback", "discrepancyDetected", "realImageAnalyzed"]
            }
          }
        },
        required: ["overallScore", "generalFeedback", "sections"]
      }
    });

    const reviewedText = response.text || '{}';
    res.json(JSON.parse(reviewedText));
  } catch (error: any) {
    console.error('Error reviewing blog content:', error);
    res.status(500).json({ error: 'Failed to review content', details: error.message });
  }
});

// Serve frontend client
const PORT = process.env.PORT || 3000;

async function startServer() {
  // ────────────────────────────
  // Dynamic robots.txt Route
  // ────────────────────────────
  app.get('/robots.txt', (req, res) => {
    const host = req.headers.host || 'localhost:3000';
    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const origin = `${protocol}://${host}`;
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(`User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml`);
  });

  // ────────────────────────────
  // Dynamic sitemap.xml Route
  // ────────────────────────────
  app.get('/sitemap.xml', async (req, res) => {
    try {
      const host = req.headers.host || 'localhost:3000';
      const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const origin = `${protocol}://${host}`;

      const pubCol = collection(serverDb, 'publishedContents');
      const snapshot = await getDocs(pubCol);
      const articles = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

      const now = new Date();
      const publicList = articles.filter((b: any) => {
        if (!b.title || !b.id) return false;
        if (b.status !== 'published') return false;
        const pubDate = new Date(b.updatedAt || b.createdAt || Date.now());
        if (pubDate > now) return false;
        return true;
      });

      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
      xml += `  <url>\n    <loc>${origin}/</loc>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;

      for (const b of publicList) {
        const postUrl = `${origin}/blog/${b.id}`;
        const lastmodDate = new Date(b.updatedAt || b.modifiedAt || b.publishedAt || b.createdAt || Date.now()).toISOString();
        xml += `  <url>\n    <loc>${postUrl}</loc>\n    <lastmod>${lastmodDate}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
      }
      xml += `</urlset>`;

      res.setHeader('Content-Type', 'application/xml');
      res.status(200).send(xml);
    } catch (err: any) {
      console.error("Sitemap error:", err);
      res.status(500).send("Error generating sitemap");
    }
  });

  // ────────────────────────────
  // Dynamic /blog/:id Router (Server Side BlogPosting SEO & 404 Status Handler)
  // ────────────────────────────
  app.get('/blog/:id', async (req, res, next) => {
    try {
      const postId = req.params.id;
      const host = req.headers.host || 'localhost:3000';
      const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const origin = `${protocol}://${host}`;
      const canonicalUrl = `${origin}/blog/${postId}`;

      const projectRef = doc(serverDb, 'contentProjects', postId);
      const projectSnap = await getDoc(projectRef);

      let blogData: any = null;
      let isPublished = false;

      if (projectSnap.exists()) {
        blogData = projectSnap.data();
        if (blogData.status === 'published') {
          isPublished = true;
        }
      }

      if (!blogData || !isPublished) {
        let template = "";
        const templatePath = process.env.NODE_ENV === 'production' || process.env.DISABLE_HMR === 'true'
          ? path.resolve(__dirname, './dist/index.html')
          : path.resolve(__dirname, 'index.html');

        if (fs.existsSync(templatePath)) {
          template = fs.readFileSync(templatePath, 'utf-8');
        } else {
          template = `<!DOCTYPE html><html><head><title>글을 찾을 수 없습니다 | AURA Webzine</title></head><body>요청한 글을 찾을 수 없습니다.</body></html>`;
        }

        const meta404 = `
          <title>글을 찾을 수 없습니다 | AURA Webzine</title>
          <meta name="robots" content="noindex, follow">
        `;
        template = template.replace(/<title>[^<]*<\/title>/g, '');
        template = template.replace(/<meta name="robots"[^>]*>/g, '');
        template = template.replace('<head>', `<head>${meta404}`);
        template = template.replace('<body>', `<body><script>window.__NOT_FOUND__ = true;</script>`);

        res.status(404).set({ 'Content-Type': 'text/html' }).end(template);
        return;
      }

      let template = "";
      const templatePath = process.env.NODE_ENV === 'production' || process.env.DISABLE_HMR === 'true'
        ? path.resolve(__dirname, './dist/index.html')
        : path.resolve(__dirname, 'index.html');

      if (fs.existsSync(templatePath)) {
        template = fs.readFileSync(templatePath, 'utf-8');
      } else {
        template = `<!DOCTYPE html><html><head></head><body></body></html>`;
      }

      const postTitle = blogData.title || "Untitled Article";
      const postSummary = blogData.summary || "Bespoke Editorial Article";
      const coverImageId = blogData.sections?.[0]?.imageId || "";
      const postImageUrl = coverImageId ? `${origin}/api/images/${coverImageId}/public` : 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800';
      const publishedDateIso = new Date(blogData.createdAt || Date.now()).toISOString();
      const modifiedDateIso = new Date(blogData.updatedAt || Date.now()).toISOString();
      const authorName = blogData.authorName || 'Official Editor';

      const schemaJson = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": postTitle,
        "description": postSummary,
        "image": postImageUrl,
        "datePublished": publishedDateIso,
        "dateModified": modifiedDateIso,
        "mainEntityOfPage": {
          "@type": "WebPage",
          "@id": canonicalUrl
        },
        "author": {
          "@type": "Person",
          "name": authorName
        },
        "publisher": {
          "@type": "Organization",
          "name": "AURA Webzine",
          "url": origin
        }
      };

      const richSeoMeta = `
        <title>${postTitle} | AURA Webzine</title>
        <meta name="description" content="${postSummary}">
        <link rel="canonical" href="${canonicalUrl}">
        <meta property="og:type" content="article">
        <meta property="og:title" content="${postTitle}">
        <meta property="og:description" content="${postSummary}">
        <meta property="og:image" content="${postImageUrl}">
        <meta property="og:url" content="${canonicalUrl}">
        <meta property="article:published_time" content="${publishedDateIso}">
        <meta property="article:modified_time" content="${modifiedDateIso}">
        <script type="application/ld+json">${JSON.stringify(schemaJson, null, 2)}</script>
      `;

      template = template.replace(/<title>[^<]*<\/title>/g, '');
      template = template.replace(/<meta name="description"[^>]*>/g, '');
      template = template.replace(/<link rel="canonical"[^>]*>/g, '');
      template = template.replace(/<meta property="og:[^>]*>/g, '');
      template = template.replace(/<meta property="article:[^>]*>/g, '');
      template = template.replace('<head>', `<head>${richSeoMeta}`);
      template = template.replace('<body>', `<body><script>window.__PRELOADED_BLOG__ = ${JSON.stringify(blogData)};</script>`);

      res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
    } catch (err: any) {
      console.error("Dynamic blog error:", err);
      next(err);
    }
  });

  if (process.env.NODE_ENV === 'production' || process.env.DISABLE_HMR === 'true') {
    // In production/sandbox, serve static compiled assets
    const distPath = path.resolve(__dirname, './dist');
    app.use(express.static(distPath));
    
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  } else {
    // In dev mode, mount Vite middlewares
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    
    app.use(vite.middlewares);
    
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  }

  app.listen(PORT, () => {
    console.log(`Full-stack server listening on http://localhost:${PORT}`);
  });
}

startServer();
