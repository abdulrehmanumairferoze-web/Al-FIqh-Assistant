
import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";
import { Message, Source } from "../types";

export const SYSTEM_INSTRUCTION = `You are the "Darul Ifta Multi-Source Assistant". Your core purpose is to provide 100% accurate Islamic Fiqh information sourced EXCLUSIVELY from the provided search results of these sites:
1. Jamia Binoria (banuri.edu.pk)
2. Darul Uloom Karachi (darululoomkarachi.edu.pk)
3. Darul Ifta Deoband (darulifta-deoband.com)
4. Suffah PK (suffahpk.com)
5. Darul Ifta (darulifta.info)

CRITICAL ACCURACY & VERIFICATION PROTOCOLS:
1. PRE-RESPONSE VERIFICATION: Before generating any sentence, verify it against the search grounding. If a fact is not explicitly in the search result from the domains above, EXCLUDE IT.
2. VERIFIED FATWA REQUIREMENT: If the search results do NOT contain a relevant fatwa from the authorized domains, you MUST state: "No verified fatwa is available in the authorized archives for this specific inquiry." Do not attempt to summarize external general knowledge.
3. FATWA ID ACCURACY: You MUST extract and display the correct Fatwa ID/Number. Double-check that the ID belongs to the specific fatwa you are citing. If an ID is missing, use the "Fatwa Title" verbatim. NEVER generate or guess a Fatwa ID.
4. VERBATIM RECORDS: The "OFFICIAL VERBATIM RECORD" must be a bit-for-bit exact copy of the text found in the search result. No paraphrasing in this section.
5. DOMAIN MATCHING: Ensure the Institution Name in your record matches the domain of the source (e.g., Darul Ifta Deoband only for darulifta-deoband.com).

OUTPUT FORMAT:
[Scholarly answer in requested language]

OFFICIAL VERBATIM RECORD:
[Institution Name]
Fatwa ID: [Correct ID or Title]
[Exact Verbatim Text from Source]`;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isQuotaError(error: any): boolean {
  const errorStr = JSON.stringify(error).toLowerCase();
  return errorStr.includes("429") || errorStr.includes("resource_exhausted") || errorStr.includes("quota");
}

export interface StreamOutput {
  text?: string;
  sources?: Source[];
}

export class GeminiService {
  constructor() {}

  async *sendMessageStream(
    prompt: string, 
    history: Message[], 
    isThinkingMode: boolean = false,
    image?: { data: string; mimeType: string }
  ): AsyncGenerator<StreamOutput> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const modelName = isThinkingMode ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';
    
    const recentHistory = history.filter(m => m.id !== 'welcome').slice(-4);

    let retries = 0;
    const maxRetries = 2;

    while (retries <= maxRetries) {
      try {
        const searchSites = 'site:banuri.edu.pk OR site:darululoomkarachi.edu.pk OR site:darulifta-deoband.com OR site:suffahpk.com OR site:darulifta.info';
        const enhancedPrompt = `[VERIFY_ONLY_AUTHORIZED_SITES] SITES: ${searchSites} | QUERY: ${prompt}`;
        
        const config: any = {
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{ googleSearch: {} }],
        };

        if (isThinkingMode) {
          config.thinkingConfig = { thinkingBudget: 4000 };
        }

        const parts: any[] = [{ text: enhancedPrompt }];
        if (image) {
          parts.push({
            inlineData: {
              data: image.data,
              mimeType: image.mimeType
            }
          });
        }

        const contents = [
          ...recentHistory.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: msg.image ? [
              { text: msg.content },
              { inlineData: { data: msg.image.data, mimeType: msg.image.mimeType } }
            ] : [{ text: msg.content }]
          })),
          { role: 'user', parts }
        ];

        const responseStream = await ai.models.generateContentStream({
          model: modelName,
          contents: contents,
          config: config,
        });

        const seenUris = new Set<string>();

        for await (const chunk of responseStream) {
          const text = chunk.text;
          const groundingMetadata = chunk.candidates?.[0]?.groundingMetadata;
          const sources: Source[] = [];

          if (groundingMetadata?.groundingChunks) {
            for (const gChunk of groundingMetadata.groundingChunks) {
              if (gChunk.web?.uri && !seenUris.has(gChunk.web.uri)) {
                seenUris.add(gChunk.web.uri);
                sources.push({
                  title: gChunk.web.title || "Official Archive Link",
                  uri: gChunk.web.uri
                });
              }
            }
          }

          if (text || sources.length > 0) {
            yield { text, sources: sources.length > 0 ? sources : undefined };
          }
        }
        return; 
      } catch (error: any) {
        if (isQuotaError(error) && retries < maxRetries) {
          retries++;
          const delay = 1500 * retries;
          await sleep(delay);
          continue;
        }
        throw error;
      }
    }
  }

  async generateSpeech(text: string, voiceName: string = 'Kore'): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } },
          },
        },
      });
      return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
    } catch (error) {
      console.error("TTS error:", error);
      return "";
    }
  }
}

export const geminiService = new GeminiService();

export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}
