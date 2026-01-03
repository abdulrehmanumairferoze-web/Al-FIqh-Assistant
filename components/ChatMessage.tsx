
import React, { useState, useRef } from 'react';
import { Message, VoiceType } from '../types';
import { User, ShieldCheck, Volume2, BadgeCheck, Book, Copy, Check, Square, Reply, CornerDownRight, Share2, ExternalLink } from 'lucide-react';
import { geminiService, decode, decodeAudioData } from '../services/geminiService';
import { translations } from '../translations';

interface ChatMessageProps {
  message: Message;
  selectedVoice?: VoiceType;
  onReply?: (message: Message) => void;
}

const VOICE_MAPPING = {
  'Ayesha': 'Kore',
  'Ahmed': 'Fenrir'
};

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
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch(e) {}
    });
    activeSourcesRef.current.clear();
    setIsPlaying(false);
  };

  const handlePlay = async () => {
    if (isPlaying) {
      stopAudio();
      return;
    }

    setIsPlaying(true);
    abortControllerRef.current = new AbortController();
    
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    const ctx = audioContextRef.current;

    const segments = answer.split(/([.!?\n]|[\u06d4\u061f\u0621])/g)
      .reduce((acc: string[], curr, idx) => {
        if (idx % 2 === 0) acc.push(curr);
        else acc[acc.length - 1] += curr;
        return acc;
      }, [])
      .filter(s => s.trim().length > 2);

    let nextStartTime = ctx.currentTime;
    const voiceName = VOICE_MAPPING[selectedVoice];

    try {
      for (const segment of segments) {
        if (abortControllerRef.current?.signal.aborted) break;
        await new Promise(r => setTimeout(r, 100));
        const base64 = await geminiService.generateSpeech(segment, voiceName);
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
          if (activeSourcesRef.current.size === 0 && segments.indexOf(segment) === segments.length - 1) {
            setIsPlaying(false);
          }
        };
      }
    } catch (error) {
      console.error("TTS playback error:", error);
      setIsPlaying(false);
    }
  };

  const scrollToMessage = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleCopy = async () => {
    if (!verbatim) return;
    await navigator.clipboard.writeText(verbatim);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleShare = async () => {
    const shareText = `*${t.appTitle}*\n\n*${t.scholarlyChat}*\n${answer.trim()}\n\n*${t.authorizedOnly}*\n${verbatim ? verbatim.trim() : 'N/A'}\n\n_${t.disclaimer}_`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: t.appTitle,
          text: shareText,
        });
      } catch (err) {
        await navigator.clipboard.writeText(shareText);
        setIsShared(true);
        setTimeout(() => setIsShared(false), 2000);
      }
    } else {
      await navigator.clipboard.writeText(shareText);
      setIsShared(true);
      setTimeout(() => setIsShared(false), 2000);
    }
  };

  return (
    <div id={`msg-${message.id}`} className={`flex w-full group ${isAssistant ? 'justify-start' : 'justify-end'}`}>
      <div className={`flex w-full max-w-[98%] lg:max-w-[85%] ${isAssistant ? 'flex-row' : 'flex-row-reverse'}`}>
        <div className={`flex-shrink-0 h-10 w-10 md:h-14 md:w-14 rounded-2xl flex items-center justify-center shadow-xl ${isAssistant ? 'bg-emerald-950 text-white' : 'bg-slate-200 text-slate-600'}`}>
          {isAssistant ? <ShieldCheck className="w-5 h-5 md:w-6 md:h-6" /> : <User className="w-5 h-5 md:w-6 md:h-6" />}
        </div>
        
        <div className={`mx-2 md:mx-4 flex-1 shadow-2xl rounded-[30px] md:rounded-[40px] overflow-hidden ${isAssistant ? 'bg-[#fdfbf7] border border-amber-200/60 rounded-tl-none relative' : 'bg-emerald-900 text-white rounded-tr-none'}`}>
          <div className="p-4 md:p-8 relative z-10">
            <button 
              onClick={() => onReply?.(message)}
              className={`absolute top-4 ${isAssistant ? 'right-4' : 'left-4'} opacity-0 group-hover:opacity-100 p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all text-current z-20`}
              title="Reply to this message"
            >
              <Reply size={16} />
            </button>

            {message.replyTo && (
              <div 
                onClick={() => scrollToMessage(message.replyTo!.id)}
                className={`mb-4 cursor-pointer p-3 md:p-4 rounded-2xl border-l-4 transition-all hover:brightness-95 ${isAssistant ? 'bg-amber-50 border-amber-400' : 'bg-emerald-800/50 border-emerald-400'} ${isUrduText(message.replyTo.content) ? 'text-right' : 'text-left'}`}
              >
                <div className={`flex items-center gap-2 mb-1 opacity-60 ${isUrduText(message.replyTo.content) ? 'flex-row-reverse' : ''}`}>
                  <CornerDownRight size={12} className={isUrduText(message.replyTo.content) ? 'rotate-180' : ''} />
                  <span className="text-[10px] font-black uppercase tracking-widest">
                    {message.replyTo.role === 'assistant' ? 'Scholarly Answer' : 'User Inquiry'}
                  </span>
                </div>
                <p className={`text-[10px] md:text-sm line-clamp-2 ${isUrduText(message.replyTo.content) ? 'font-arabic' : 'font-medium opacity-80'}`} dir={isUrduText(message.replyTo.content) ? 'rtl' : 'ltr'}>
                  {message.replyTo.content}
                </p>
              </div>
            )}

            {isAssistant && (
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-amber-200/40">
                <div className="flex items-center gap-2 md:gap-3">
                  <BadgeCheck size={16} className="text-amber-800 md:w-5 md:h-5" />
                  <div className="flex flex-col">
                    <span className="text-[10px] md:text-[12px] font-black uppercase tracking-widest text-amber-900/80">Darul Ifta Assistant</span>
                    <span className="text-[8px] md:text-[9px] font-bold text-emerald-700/60 uppercase tracking-widest -mt-1">Authorized Data</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={handleShare} 
                    className={`flex items-center gap-2 px-3 py-2 rounded-full transition-all shadow-md active:scale-95 ${isShared ? 'bg-emerald-600 text-white' : 'bg-white text-emerald-950 border border-emerald-100 hover:bg-emerald-50'}`}
                  >
                    {isShared ? <Check size={12} /> : <Share2 size={12} />}
                    <span className="text-[10px] font-black uppercase tracking-tighter">{isShared ? t.copied : t.share}</span>
                  </button>
                  <button 
                    onClick={handlePlay} 
                    className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all shadow-md active:scale-95 ${isPlaying ? 'bg-red-600 text-white' : 'bg-emerald-950 text-white'}`}
                  >
                    {isPlaying ? <Square size={12} fill="currentColor" /> : <Volume2 size={12} />}
                    <span className="text-[10px] font-black uppercase tracking-tighter">{isPlaying ? 'Stop' : 'Read'}</span>
                  </button>
                </div>
              </div>
            )}

            {!isAssistant && message.image && (
              <div className="mb-6 rounded-3xl overflow-hidden border-4 border-emerald-800 shadow-lg">
                <img src={`data:${message.image.mimeType};base64,${message.image.data}`} alt="Uploaded content" className="w-full max-h-[300px] object-cover" />
              </div>
            )}

            <div className="space-y-4">
              {answer.split('\n').filter(l => l.trim()).map((line, i) => (
                <p key={i} dir={isUrduText(line) ? 'rtl' : 'ltr'} className={`${isUrduText(line) ? 'font-arabic text-lg md:text-2xl leading-[1.8]' : 'text-xs md:text-base font-semibold'} ${isAssistant ? 'text-slate-900' : 'text-white'}`}>
                  {line}
                </p>
              ))}
            </div>

            {isAssistant && verbatim && (
              <div className="mt-8 group">
                <div className="flex items-center gap-4 mb-4">
                  <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-amber-300 to-transparent" />
                  <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 rounded-xl border border-amber-100">
                    <Book size={14} className="text-amber-700" />
                    <span className="text-[10px] font-black text-amber-900 uppercase tracking-widest">Verbatim Record</span>
                  </div>
                  <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-amber-300 to-transparent" />
                </div>
                <div className="bg-[#f9f7f0] border border-dashed border-amber-200 p-6 rounded-[30px] shadow-inner relative">
                  <button onClick={handleCopy} className="absolute top-4 right-4 p-2 bg-white border border-amber-100 rounded-lg hover:bg-amber-50 transition-colors">
                    {isCopied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} className="text-amber-800" />}
                  </button>
                  <div className="prose prose-slate max-w-none">
                    {verbatim.split('\n').filter(l => l.trim()).map((line, i) => (
                      <p key={i} dir={isUrduText(line) ? 'rtl' : 'ltr'} className={isUrduText(line) ? 'font-arabic text-base md:text-xl leading-[2] text-amber-950 font-medium' : 'text-[10px] md:text-xs italic text-slate-600'}>
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className={`flex items-center justify-between mt-8 pt-4 border-t border-slate-200/20 ${isUrduText(answer) ? 'flex-row-reverse' : ''}`}>
              <span className="text-[9px] font-bold text-slate-400 uppercase">
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <div className={`text-[8px] md:text-[9px] font-black uppercase px-4 py-1.5 rounded-full border ${isAssistant ? 'bg-amber-100/40 text-amber-900 border-amber-200' : 'bg-emerald-800 text-emerald-50 border-emerald-700'}`}>
                {isAssistant ? 'Evidence Found' : 'Inquiry'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
