
import React, { useState, useRef } from 'react';
import { Message, VoiceType } from '../types';
import { User, ShieldCheck, Volume2, BadgeCheck, Book, Copy, Check, Square, Reply, CornerDownRight, Share2, ExternalLink, Link2 } from 'lucide-react';
import { geminiService, decode, decodeAudioData } from '../services/geminiService';
import { translations } from '../translations';

interface ChatMessageProps {
  message: Message;
  selectedVoice?: VoiceType;
  onReply?: (message: Message) => void;
}

const VOICE_MAPPING = { 'Ayesha': 'Kore', 'Ahmed': 'Fenrir' };

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, selectedVoice = 'Ayesha', onReply }) => {
  const isAssistant = message.role === 'assistant';
  const [isPlaying, setIsPlaying] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isShared, setIsShared] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);

  const isUrduText = (text: string) => /[\u0600-\u06FF]/.test(text);
  const lang = isUrduText(message.content) ? 'ur' : 'en';
  const t = translations[lang];

  const splitContent = (content: string) => {
    const verbatimKeyword = "OFFICIAL VERBATIM RECORD";
    if (content.includes(verbatimKeyword)) {
      const parts = content.split(verbatimKeyword);
      return { answer: parts[0], verbatim: parts[1].replace(/^[:\s-]+/, '') };
    }
    return { answer: content, verbatim: null };
  };

  const { answer, verbatim } = splitContent(message.content);

  const stopAudio = () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    activeSourcesRef.current.forEach(source => { try { source.stop(); } catch(e) {} });
    activeSourcesRef.current.clear();
    setIsPlaying(false);
  };

  const handlePlay = async () => {
    if (isPlaying) { stopAudio(); return; }
    setIsPlaying(true);
    abortControllerRef.current = new AbortController();
    if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const ctx = audioContextRef.current;
    const segments = answer.split(/([.!?\n]|[\u06d4\u061f\u0621])/g).reduce((acc: string[], curr, idx) => {
      if (idx % 2 === 0) acc.push(curr); else acc[acc.length - 1] += curr;
      return acc;
    }, []).filter(s => s.trim().length > 2);

    let nextStartTime = ctx.currentTime;
    try {
      for (const segment of segments) {
        if (abortControllerRef.current?.signal.aborted) break;
        const base64 = await geminiService.generateSpeech(segment, VOICE_MAPPING[selectedVoice]);
        if (!base64) continue;
        const audioBuffer = await decodeAudioData(decode(base64), ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        const startTime = Math.max(nextStartTime, ctx.currentTime);
        source.start(startTime);
        nextStartTime = startTime + audioBuffer.duration;
        activeSourcesRef.current.add(source);
        source.onended = () => {
          activeSourcesRef.current.delete(source);
          if (activeSourcesRef.current.size === 0 && segments.indexOf(segment) === segments.length - 1) setIsPlaying(false);
        };
      }
    } catch { setIsPlaying(false); }
  };

  const handleShare = async () => {
    const shareText = `*${t.appTitle}*\n\n${answer.trim()}\n\nVerified Reference:\n${verbatim || 'N/A'}`;
    if (navigator.share) try { await navigator.share({ text: shareText }); } catch { }
    else { await navigator.clipboard.writeText(shareText); setIsShared(true); setTimeout(() => setIsShared(false), 2000); }
  };

  return (
    <div className={`flex w-full group ${isAssistant ? 'justify-start' : 'justify-end'}`}>
      <div className={`flex w-full max-w-[98%] lg:max-w-[85%] ${isAssistant ? 'flex-row' : 'flex-row-reverse'}`}>
        <div className={`flex-shrink-0 h-10 w-10 md:h-14 md:w-14 rounded-2xl flex items-center justify-center shadow-lg transition-transform hover:scale-105 ${isAssistant ? 'bg-emerald-950 text-white' : 'bg-slate-200 text-slate-600'}`}>
          {isAssistant ? <ShieldCheck className="w-5 h-5 md:w-6 md:h-6" /> : <User className="w-5 h-5 md:w-6 md:h-6" />}
        </div>
        
        <div className={`mx-2 md:mx-4 flex-1 shadow-xl rounded-[30px] md:rounded-[40px] overflow-hidden ${isAssistant ? 'bg-white border border-emerald-100 rounded-tl-none' : 'bg-emerald-900 text-white rounded-tr-none'}`}>
          <div className="p-4 md:p-8 relative">
            <button onClick={() => onReply?.(message)} className={`absolute top-4 ${isAssistant ? 'right-4' : 'left-4'} opacity-0 group-hover:opacity-100 p-2 rounded-xl bg-slate-100 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700 transition-all z-20`}><Reply size={16} /></button>

            {message.replyTo && (
              <div className={`mb-6 p-4 rounded-2xl border-l-4 bg-slate-50 border-emerald-400 ${isUrduText(message.replyTo.content) ? 'text-right' : 'text-left'}`}>
                <div className={`flex items-center gap-2 mb-1 opacity-50 ${isUrduText(message.replyTo.content) ? 'flex-row-reverse' : ''}`}><CornerDownRight size={12} /><span className="text-[10px] font-black uppercase tracking-widest">Inquiry Context</span></div>
                <p className={`text-xs md:text-sm line-clamp-2 ${isUrduText(message.replyTo.content) ? 'font-arabic' : 'font-medium opacity-70'}`} dir={isUrduText(message.replyTo.content) ? 'rtl' : 'ltr'}>{message.replyTo.content}</p>
              </div>
            )}

            {isAssistant && (
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-emerald-50">
                <div className="flex items-center gap-3">
                  <BadgeCheck size={18} className="text-emerald-700" />
                  <div className="flex flex-col"><span className="text-[10px] font-black uppercase tracking-widest text-emerald-950">Official Scholarly Response</span><span className="text-[8px] font-bold text-emerald-600/60 uppercase">Verified Archives Only</span></div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleShare} className="p-2 hover:bg-emerald-50 rounded-full transition-colors text-emerald-950">{isShared ? <Check size={16} /> : <Share2 size={16} />}</button>
                  <button onClick={handlePlay} className={`flex items-center gap-2 px-4 py-1.5 rounded-full transition-all text-white ${isPlaying ? 'bg-red-600' : 'bg-emerald-950'}`}>{isPlaying ? <Square size={12} fill="currentColor" /> : <Volume2 size={12} />}<span className="text-[10px] font-black uppercase tracking-tighter">{isPlaying ? 'Stop' : 'Read'}</span></button>
                </div>
              </div>
            )}

            {!isAssistant && message.image && (
              <div className="mb-6 rounded-3xl overflow-hidden border-2 border-emerald-800 shadow-md">
                <img src={`data:${message.image.mimeType};base64,${message.image.data}`} className="w-full max-h-[300px] object-cover" />
              </div>
            )}

            <div className="space-y-4">
              {answer.split('\n').filter(l => l.trim()).map((line, i) => (
                <p key={i} dir={isUrduText(line) ? 'rtl' : 'ltr'} className={`${isUrduText(line) ? 'font-arabic text-lg md:text-2xl leading-[1.8]' : 'text-sm md:text-base font-medium'} ${isAssistant ? 'text-slate-900' : 'text-white'}`}>{line}</p>
              ))}
            </div>

            {isAssistant && verbatim && (
              <div className="mt-10">
                <div className="flex items-center gap-4 mb-4"><div className="h-[1px] flex-1 bg-emerald-100" /><div className="flex items-center gap-2 px-4 py-1.5 bg-emerald-50 rounded-full border border-emerald-100"><Book size={12} className="text-emerald-700" /><span className="text-[10px] font-black text-emerald-900 uppercase tracking-widest">Verbatim Record</span></div><div className="h-[1px] flex-1 bg-emerald-100" /></div>
                <div className="bg-emerald-50/30 border border-dashed border-emerald-200 p-6 rounded-[30px] relative">
                  <button onClick={async () => { await navigator.clipboard.writeText(verbatim); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); }} className="absolute top-4 right-4 p-2 hover:bg-emerald-100 rounded-lg transition-colors">{isCopied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} className="text-emerald-800" />}</button>
                  {verbatim.split('\n').filter(l => l.trim()).map((line, i) => (
                    <p key={i} dir={isUrduText(line) ? 'rtl' : 'ltr'} className={isUrduText(line) ? 'font-arabic text-base md:text-xl leading-[2] text-emerald-950 mb-2' : 'text-[10px] md:text-xs text-slate-500 font-bold uppercase tracking-tight'}>{line}</p>
                  ))}
                </div>
              </div>
            )}

            {isAssistant && message.sources && message.sources.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {message.sources.map((src, i) => (
                  <a key={i} href={src.uri} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-1.5 bg-white border border-emerald-100 rounded-xl hover:bg-emerald-50 transition-all shadow-sm group">
                    <Link2 size={12} className="text-emerald-600 group-hover:rotate-12 transition-transform" />
                    <span className="text-[10px] font-bold text-emerald-950 truncate max-w-[140px]">{src.title}</span>
                    <ExternalLink size={10} className="text-slate-300" />
                  </a>
                ))}
              </div>
            )}

            <div className={`flex items-center justify-between mt-8 pt-4 border-t border-slate-100 ${isUrduText(answer) ? 'flex-row-reverse' : ''}`}>
              <span className="text-[9px] font-bold text-slate-300 uppercase">{message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <div className={`text-[8px] md:text-[9px] font-black uppercase px-3 py-1 rounded-full ${isAssistant ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-800 text-emerald-50'}`}>{isAssistant ? 'Archive Evidence' : 'User Query'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
