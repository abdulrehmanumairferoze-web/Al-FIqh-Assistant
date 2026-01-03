
import React, { useState, useRef, useEffect } from 'react';
import { Send, BookOpen, AlertCircle, Menu, X, Trash2, Plus, MessageSquare, Brain, Zap, History, Loader2, Mic, MicOff, Image as ImageIcon, CornerDownRight, Languages, Database, Copy, Check, CloudOff, Cloud, ShieldCheck } from 'lucide-react';
import { Message, ChatSession, VoiceType, Source, Language } from './types';
import { geminiService } from './services/geminiService';
import { ChatMessage } from './components/ChatMessage';
import { translations } from './translations';
import { supabase } from './supabase';

const VOICE_STORAGE_KEY = 'al_fiqh_selected_voice';
const LANG_STORAGE_KEY = 'al_fiqh_selected_lang';
const ACTIVE_SESSION_KEY = 'al_fiqh_active_session_id';
const LOCAL_SESSIONS_KEY = 'al_fiqh_local_sessions';

const App: React.FC = () => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [language, setLanguage] = useState<Language>('en');
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<VoiceType>('Ayesha');
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [selectedImage, setSelectedImage] = useState<{ data: string; mimeType: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isThinkingMode, setIsThinkingMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [dbStatus, setDbStatus] = useState<'loading' | 'connected' | 'offline' | 'missing_table'>('loading');
  const [error, setError] = useState<{ message: string; type: 'general' | 'quota' } | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showDbGuide, setShowDbGuide] = useState(false);

  const t = translations[language];
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper: Load from LocalStorage
  const loadLocalSessions = () => {
    const local = localStorage.getItem(LOCAL_SESSIONS_KEY);
    if (!local) return [];
    try {
      const parsed = JSON.parse(local);
      return parsed.map((s: any) => ({
        ...s,
        createdAt: new Date(s.createdAt),
        messages: s.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
      })) as ChatSession[];
    } catch (e) {
      return [];
    }
  };

  // 1. Initial Data Fetch & DB Handshake
  useEffect(() => {
    const initApp = async () => {
      let localData = loadLocalSessions();
      
      try {
        const { data: cloudData, error: sbError } = await supabase
          .from('chat_sessions')
          .select('*')
          .order('created_at', { ascending: false });

        if (sbError) {
          console.warn("DB Connection Note:", sbError.message);
          setDbStatus(sbError.message.includes('chat_sessions') ? 'missing_table' : 'offline');
          setSessions(localData);
        } else {
          setDbStatus('connected');
          const cloudSessions = (cloudData || []).map((s: any) => ({
            ...s,
            createdAt: new Date(s.created_at),
            messages: s.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
          }));
          
          // Merge: Cloud is source of truth, but keep unique locals
          const cloudIds = new Set(cloudSessions.map(s => s.id));
          const merged = [...cloudSessions, ...localData.filter(s => !cloudIds.has(s.id))];
          setSessions(merged);
        }
      } catch (err) {
        setDbStatus('offline');
        setSessions(localData);
      }

      // Restore active session
      const savedActiveId = localStorage.getItem(ACTIVE_SESSION_KEY);
      const active = sessions.find(s => s.id === savedActiveId) || localData.find(s => s.id === savedActiveId);
      
      if (active) {
        setActiveSessionId(active.id);
        setMessages(active.messages);
      } else {
        setMessages([{ id: 'welcome', role: 'assistant', content: t.introMessage, timestamp: new Date() } as Message]);
      }
    };

    const savedVoice = localStorage.getItem(VOICE_STORAGE_KEY) as VoiceType;
    const savedLang = localStorage.getItem(LANG_STORAGE_KEY) as Language;
    if (savedVoice) setSelectedVoice(savedVoice);
    if (savedLang) setLanguage(savedLang);

    initApp();
  }, [t.introMessage]);

  // 2. State Persistence
  useEffect(() => {
    localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
    localStorage.setItem(VOICE_STORAGE_KEY, selectedVoice);
    localStorage.setItem(LANG_STORAGE_KEY, language);
    if (sessions.length > 0) {
      localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(sessions));
    }
  }, [activeSessionId, selectedVoice, language, sessions]);

  // 3. Real-time Message Sync
  useEffect(() => {
    if (!activeSessionId || messages.length <= 1) return;

    // Update local state first
    setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages } : s));

    // Update cloud if connected
    if (dbStatus === 'connected') {
      supabase.from('chat_sessions').update({ messages }).eq('id', activeSessionId).then(({ error }) => {
        if (error) {
          console.error("Sync Interrupted:", error.message);
          setDbStatus('offline');
        }
      });
    }
  }, [messages, activeSessionId, dbStatus]);

  // Speech Recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.lang = language === 'ur' ? 'ur-PK' : 'en-US';
      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(prev => prev + (prev ? ' ' : '') + transcript);
        setIsListening(false);
      };
      recognitionRef.current.onerror = () => setIsListening(false);
    }
  }, [language]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (isListening) recognitionRef.current.stop();
    else { try { recognitionRef.current.start(); setIsListening(true); } catch (e) {} }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage({ data: (reader.result as string).split(',')[1], mimeType: file.type });
      };
      reader.readAsDataURL(file);
    }
  };

  const startNewChat = () => {
    setActiveSessionId('');
    setMessages([{ id: 'welcome', role: 'assistant', content: t.introMessage, timestamp: new Date() }]);
    setInput('');
    setReplyTo(null);
    setSelectedImage(null);
    setError(null);
    setIsSidebarOpen(false);
  };

  const switchSession = (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      setActiveSessionId(sessionId);
      setMessages(session.messages);
      setIsSidebarOpen(false);
      setReplyTo(null);
      setError(null);
    }
  };

  const deleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    if (dbStatus === 'connected') {
      await supabase.from('chat_sessions').delete().eq('id', sessionId);
    }
    if (activeSessionId === sessionId) startNewChat();
  };

  const handleSend = async (textInput: string = input) => {
    const finalPrompt = textInput.trim();
    if ((!finalPrompt && !selectedImage) || isLoading) return;

    let currentSessionId = activeSessionId;
    
    // Auto-create session if none active
    if (!currentSessionId) {
      const sessionTitle = finalPrompt ? (finalPrompt.substring(0, 40) + '...') : 'New Inquiry';
      const initialMessages: Message[] = [{ id: 'welcome', role: 'assistant', content: t.introMessage, timestamp: new Date() }];
      currentSessionId = crypto.randomUUID();
      
      const newSession: ChatSession = { id: currentSessionId, title: sessionTitle, messages: initialMessages, createdAt: new Date() };
      setSessions(prev => [newSession, ...prev]);
      setActiveSessionId(currentSessionId);

      if (dbStatus === 'connected') {
        supabase.from('chat_sessions').insert([{ id: currentSessionId, title: sessionTitle, messages: initialMessages }]).catch(() => setDbStatus('offline'));
      }
    }

    const userMsg: Message = { 
      id: Date.now().toString(), 
      role: 'user', 
      content: finalPrompt || "(Analyzed Archive Image)", 
      timestamp: new Date(),
      image: selectedImage || undefined,
      replyTo: replyTo ? { id: replyTo.id, content: replyTo.content, role: replyTo.role } : undefined
    };

    const assistantMsgId = (Date.now() + 1).toString();
    const assistantMsg: Message = { id: assistantMsgId, role: 'assistant', content: '', timestamp: new Date(), sources: [] };
    
    const updatedHistory = [...messages, userMsg];
    setMessages([...updatedHistory, assistantMsg]);
    setInput('');
    setReplyTo(null);
    const imageToSend = selectedImage;
    setSelectedImage(null);
    setIsLoading(true);
    setError(null);

    try {
      const languageInstruction = `Please respond in ${language === 'ur' ? 'Urdu' : 'English'}.`;
      const promptWithContext = userMsg.replyTo 
        ? `${languageInstruction}\nCONTEXT: Referring to previous message: "${userMsg.replyTo.content.substring(0, 100)}..." \n\n QUERY: ${finalPrompt}`
        : `${languageInstruction}\n${finalPrompt}`;

      const stream = geminiService.sendMessageStream(promptWithContext, updatedHistory, isThinkingMode, imageToSend || undefined);
      let fullContent = '';
      let allSources: Source[] = [];
      
      for await (const chunk of stream) {
        if (chunk.text) fullContent += chunk.text;
        if (chunk.sources) allSources = [...allSources, ...chunk.sources];
        setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: fullContent, sources: allSources.length > 0 ? allSources : m.sources } : m));
      }
    } catch (err: any) {
      setError({ message: "Knowledge retrieval interrupted.", type: 'general' });
      setMessages(prev => prev.filter(m => m.id !== assistantMsgId));
    } finally { 
      setIsLoading(false); 
    }
  };

  return (
    <div className={`flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden ${language === 'ur' ? 'rtl font-arabic' : 'ltr'}`}>
      {/* Sidebar */}
      <div className={`fixed inset-y-0 ${language === 'ur' ? 'right-0' : 'left-0'} z-50 w-80 bg-emerald-950 text-white transform ${isSidebarOpen ? 'translate-x-0' : (language === 'ur' ? 'translate-x-full' : '-translate-x-full')} transition-transform duration-500 lg:relative lg:translate-x-0 border-r border-emerald-900/50 shadow-2xl`}>
        <div className="flex flex-col h-full">
          <div className="p-8 border-b border-emerald-900/50">
            <div className="flex items-center gap-4">
              <div className="bg-emerald-100 p-2.5 rounded-2xl shadow-lg text-emerald-950 transition-transform hover:scale-105"><BookOpen size={26} /></div>
              <h1 className="text-xl font-black tracking-tight">{t.appTitle}</h1>
            </div>
            <p className="text-emerald-400 text-[9px] mt-2 font-black uppercase tracking-[0.2em]">{t.tagline}</p>
          </div>
          
          <div className="p-5 flex-1 overflow-y-auto space-y-8 scrollbar-hide">
            <button onClick={startNewChat} className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-emerald-500 text-emerald-950 font-black text-xs uppercase transition-all shadow-lg hover:bg-emerald-400 active:scale-95">
              <Plus size={18} />
              <span>{t.newSession}</span>
            </button>

            <section>
              <h2 className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-4 opacity-70 px-1 flex items-center gap-2"><Languages size={12} /> {t.language}</h2>
              <div className="grid grid-cols-2 gap-2">
                {(['en', 'ur'] as Language[]).map(l => (
                  <button key={l} onClick={() => setLanguage(l)} className={`py-3 rounded-xl border transition-all ${language === l ? 'bg-emerald-500 border-emerald-400 text-emerald-950 font-black' : 'bg-emerald-900/40 border-emerald-800 text-emerald-100/60 hover:bg-emerald-900'}`}>
                    {l === 'en' ? 'English' : 'اردو'}
                  </button>
                ))}
              </div>
            </section>

            <section>
               <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-500/50 flex items-center gap-2"><History size={12} /> {t.history}</h3>
               <div className="mt-4 space-y-2">
                {sessions.map(session => (
                  <div key={session.id} onClick={() => switchSession(session.id)} className={`group flex items-center justify-between p-4 rounded-2xl cursor-pointer transition-all ${activeSessionId === session.id ? 'bg-emerald-900' : 'hover:bg-emerald-900/50'}`}>
                    <div className="flex items-center gap-3 overflow-hidden">
                      <MessageSquare size={16} className={activeSessionId === session.id ? 'text-emerald-400' : 'text-emerald-700'} />
                      <span className="text-xs font-bold truncate">{session.title}</span>
                    </div>
                    <button onClick={(e) => deleteSession(e, session.id)} className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 rounded-lg transition-all text-red-400"><Trash2 size={14} /></button>
                  </div>
                ))}
                {sessions.length === 0 && <div className="p-8 text-center border border-dashed border-emerald-800/20 rounded-3xl opacity-30 text-[9px] font-bold uppercase tracking-widest">Archive Empty</div>}
               </div>
            </section>
          </div>
          
          <div className="mt-auto p-6 bg-emerald-950/50 border-t border-emerald-900/50 space-y-4">
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500/50">Sync Status</span>
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-bold uppercase transition-all ${dbStatus === 'connected' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                {dbStatus === 'connected' ? <ShieldCheck size={14} /> : <CloudOff size={14} />}
                {dbStatus === 'connected' ? 'Cloud Protected' : 'Local Only'}
              </div>
            </div>
            <div className="flex flex-col gap-3">
               <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500/50">{t.voiceSynthesis}</span>
               <div className="flex gap-2 bg-emerald-900/50 p-1 rounded-xl">
                 {(['Ayesha', 'Ahmed'] as VoiceType[]).map(v => (
                   <button key={v} onClick={() => setSelectedVoice(v)} className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${selectedVoice === v ? 'bg-emerald-500 text-emerald-950' : 'text-emerald-500 hover:bg-emerald-800'}`}>{v === 'Ayesha' ? t.female : t.male}</button>
                 ))}
               </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col h-full relative">
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-8 z-30 shadow-sm">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-2.5 rounded-xl hover:bg-slate-100 text-slate-600 transition-all"><Menu size={20} /></button>
            <div className="flex flex-col">
              <h2 className="text-sm md:text-base font-black text-emerald-950 uppercase tracking-tighter">{t.scholarlyChat}</h2>
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${isLoading ? 'bg-emerald-500 animate-pulse' : 'bg-emerald-500'}`} />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t.liveArchive}</span>
              </div>
            </div>
          </div>
          <button onClick={() => setIsThinkingMode(!isThinkingMode)} className={`flex items-center gap-2 px-4 py-2 rounded-2xl transition-all shadow-md ${isThinkingMode ? 'bg-amber-100 text-amber-900 border border-amber-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {isThinkingMode ? <Brain size={16} className="text-amber-600 animate-pulse" /> : <Zap size={16} />}
            <span className="text-[10px] font-black uppercase tracking-tighter">{isThinkingMode ? t.thinkingOn : t.standard}</span>
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 bg-[#faf9f6] scrollbar-hide">
          {messages.map((m) => <ChatMessage key={m.id} message={m} selectedVoice={selectedVoice} onReply={setReplyTo} />)}
          {isLoading && (
            <div className={`flex ${language === 'ur' ? 'justify-end' : 'justify-start'}`}>
              <div className="bg-white p-6 rounded-[30px] rounded-tl-none shadow-xl border border-amber-100 flex items-center gap-4">
                <div className="w-10 h-10 rounded-2xl bg-emerald-950 flex items-center justify-center"><Loader2 className="w-5 h-5 text-emerald-400 animate-spin" /></div>
                <div className="flex flex-col">
                   <span className="text-[10px] font-black text-amber-900 uppercase tracking-widest animate-pulse">{t.consulting}</span>
                   <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">{t.authorizedOnly}</span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} className="h-4" />
        </main>

        <footer className="p-4 md:p-8 bg-[#faf9f6]">
          <div className="max-w-4xl mx-auto">
            {error && (
              <div className="mb-4 flex items-center gap-3 p-4 bg-red-50 text-red-700 rounded-2xl border border-red-100">
                <AlertCircle size={18} />
                <span className="text-xs font-bold">{error.message}</span>
                <button onClick={() => setError(null)} className="ml-auto p-1 hover:bg-red-200/50 rounded-lg"><X size={14} /></button>
              </div>
            )}
            {replyTo && (
              <div className={`mb-4 flex items-center justify-between p-3 bg-white/80 backdrop-blur-sm border border-emerald-100 rounded-2xl shadow-sm ${language === 'ur' ? 'flex-row-reverse' : ''}`}>
                <div className={`flex items-center gap-3 ${language === 'ur' ? 'flex-row-reverse' : ''}`}>
                  <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600"><CornerDownRight size={14} /></div>
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black uppercase text-emerald-800/40">{t.replyingTo} {replyTo.role}</span>
                    <span className="text-xs font-medium truncate max-w-[200px] md:max-w-md">{replyTo.content}</span>
                  </div>
                </div>
                <button onClick={() => setReplyTo(null)} className="p-1.5 hover:bg-slate-100 rounded-full transition-colors"><X size={14} /></button>
              </div>
            )}
            <div className="relative group">
              {selectedImage && (
                <div className={`absolute -top-24 ${language === 'ur' ? 'right-6' : 'left-6'} bg-white p-2 rounded-2xl shadow-2xl border border-slate-200 flex items-center gap-3 animate-in slide-in-from-bottom-4`}>
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-slate-50 border border-slate-100"><img src={`data:${selectedImage.mimeType};base64,${selectedImage.data}`} className="w-full h-full object-cover" /></div>
                  <button onClick={() => setSelectedImage(null)} className="p-1.5 bg-red-50 text-red-500 rounded-full hover:bg-red-100 transition-colors"><X size={14} /></button>
                </div>
              )}
              <div className={`flex items-center gap-2 p-2.5 bg-white border border-slate-200 rounded-[32px] shadow-lg focus-within:border-emerald-500/30 transition-all ${language === 'ur' ? 'flex-row-reverse' : ''}`}>
                <div className="flex items-center gap-1 px-1">
                  <button onClick={() => fileInputRef.current?.click()} className={`p-3 rounded-full transition-all ${selectedImage ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400 hover:bg-slate-50 hover:text-emerald-600'}`}><ImageIcon size={20} /></button>
                  <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
                  <button onClick={toggleListening} className={`p-3 rounded-full transition-all ${isListening ? 'bg-red-50 text-red-600 animate-pulse' : 'text-slate-400 hover:bg-slate-50 hover:text-emerald-600'}`}><Mic size={20} /></button>
                </div>
                <textarea
                  value={input}
                  onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`; }}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                  placeholder={t.placeholder}
                  dir={language === 'ur' ? 'rtl' : 'ltr'}
                  className="flex-1 bg-transparent border-none focus:ring-0 text-sm md:text-base font-medium resize-none py-3 px-3 placeholder:text-slate-400 max-h-40 overflow-y-auto scrollbar-hide"
                  rows={1}
                />
                <button onClick={() => handleSend()} disabled={isLoading || (!input.trim() && !selectedImage)} className="flex-shrink-0 w-12 h-12 bg-emerald-950 text-white rounded-full shadow-lg hover:bg-emerald-900 active:scale-95 disabled:opacity-20 transition-all flex items-center justify-center">
                  <Send size={20} className={language === 'ur' ? 'rotate-180' : ''} />
                </button>
              </div>
            </div>
            <p className="mt-4 text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-relaxed">{t.disclaimer}</p>
          </div>
        </footer>
      </div>
      {isSidebarOpen && <div className="fixed inset-0 bg-emerald-950/40 backdrop-blur-sm z-40 lg:hidden" onClick={() => setIsSidebarOpen(false)} />}
    </div>
  );
};

export default App;
