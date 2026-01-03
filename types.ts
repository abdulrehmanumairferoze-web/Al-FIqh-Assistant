
export type Language = 'en' | 'ur';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  sources?: Source[];
  image?: {
    data: string;
    mimeType: string;
  };
  replyTo?: {
    id: string;
    content: string;
    role: 'user' | 'assistant';
  };
}

export interface Source {
  title: string;
  uri: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
}

export type VoiceType = 'Ayesha' | 'Ahmed';
