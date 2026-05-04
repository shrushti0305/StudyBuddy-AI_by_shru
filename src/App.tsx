import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  LayoutDashboard, 
  MessageSquare, 
  Brain, 
  BookOpen, 
  Timer, 
  Settings, 
  Play, 
  Pause, 
  RotateCcw, 
  ChevronRight, 
  Send, 
  User, 
  Bot,
  Plus,
  Trash2,
  CheckCircle2,
  Clock,
  Bell,
  Volume2,
  History,
  Menu,
  X,
  LogOut,
  TrendingUp,
  Award,
  Calendar,
  ChevronLeft,
  Camera,
  Star,
  Cpu,
  Sparkles,
  RefreshCw,
  HelpCircle,
  Book,
  Zap,
  Info,
  Compass,
  Flame
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { 
  LineChart, 
  Line, 
  AreaChart,
  Area,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { View, UserProfile, Flashcard, StudySession, Message, TimerSettings, Quiz, AcademicProfile } from './types';

import { auth, db } from './firebase';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';

// --- Constants & Persistence ---

const STORAGE_KEYS = {
  USER: 'sb_user',
  CARDS: 'sb_flashcards',
  SESSIONS: 'sb_sessions',
  USERS_DB: 'sb_users_db', // Simulated DB for auth
  PLAN: 'sb_study_plan'
};

const getStorage = <T,>(key: string, defaultValue: T): T => {
  const stored = localStorage.getItem(key);
  try {
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
};

const setStorage = <T,>(key: string, value: T) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const callGemini = async (contents: string | any[], modelId: string = "gemini-2.0-flash", isJson: boolean = true, systemInstruction?: string, responseSchema?: any): Promise<any> => {
  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, modelId, isJson, systemInstruction, responseSchema })
    });

    if (response.status === 401) {
      const errorData = await response.json();
      throw new Error(`API_KEY_ERROR: ${errorData.details || 'Invalid API Key'}`);
    }

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const text = data.text;

    if (isJson) {
      try {
        const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleaned);
      } catch (e) {
        console.error('Failed to parse AI JSON response:', text);
        const jsonMatch = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            return JSON.parse(jsonMatch[0]);
          } catch (innerE) {
            throw new Error('Invalid JSON structure in AI response');
          }
        }
        throw new Error('Could not extract JSON from AI response');
      }
    }
    return text;
  } catch (error: any) {
    console.error("AI Proxy Error:", error);
    let message = error.message || "An unexpected AI error occurred.";
    if (message.includes("quota") || message.includes("429") || message.toLowerCase().includes("ai quota exceeded")) {
      message = "AI Quota Exceeded: The free tier limit has been reached. Please wait about 60 seconds, or use your own API key in Settings -> Secrets (USER_GEMINI_API_KEY).";
    } else if (message.includes("Forbidden") || message.includes("403") || message.toLowerCase().includes("ai access forbidden")) {
      message = "AI Access Restricted: This request was forbidden. This usually happens if the service is unavailable in your region or if your API key lacks permissions. Try a different key in Settings -> Secrets.";
    } else if (message.includes("GEMINI_API_KEY") || message.includes("API_KEY_ERROR") || message.toLowerCase().includes("invalid api key")) {
      message = "AI Configuration Error: Your API key is missing or invalid. Please add a secret named 'USER_GEMINI_API_KEY' in Settings -> Secrets with a valid key from aistudio.google.com.";
    }
    throw new Error(message);
  }
};

// --- Components ---

const AuthView = ({ onLogin }: { onLogin: (user: UserProfile) => void }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    const users = getStorage<any[]>(STORAGE_KEYS.USERS_DB, []);
    
    if (isLogin) {
      const user = users.find(u => u.email === email && u.password === password);
      if (user) {
        onLogin(user);
      } else {
        setError('Invalid email or password');
      }
    } else {
      if (users.find(u => u.email === email)) {
        setError('User already exists');
        return;
      }
      const newUser: UserProfile = {
        uid: Date.now().toString(),
        username: username || email.split('@')[0],
        email,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`,
        joinedAt: Date.now()
      };
      setStorage(STORAGE_KEYS.USERS_DB, [...users, { ...newUser, password }]);
      onLogin(newUser);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      let profile: UserProfile;

      try {
        // Attempt to check if user exists in Firestore
        const userDoc = await getDoc(doc(db, 'users', user.uid)).catch(e => {
          console.warn("Firestore access delayed or blocked, using local profile", e);
          return null;
        });

        if (userDoc && userDoc.exists()) {
          profile = userDoc.data() as UserProfile;
        } else {
          profile = {
            uid: user.uid,
            username: user.displayName || user.email?.split('@')[0] || 'User',
            email: user.email || '',
            avatar: user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`,
            joinedAt: Date.now(),
            academicProfile: undefined
          };
          
          // Try to persist but don't block if it fails
          if (userDoc) {
            await setDoc(doc(db, 'users', user.uid), profile).catch(e => {
              console.warn("Could not persist profile to Firestore", e);
            });
          }
        }
      } catch (innerErr) {
        // Absolute fallback if Firestore logic crashes
        profile = {
          uid: user.uid,
          username: user.displayName || user.email?.split('@')[0] || 'User',
          email: user.email || '',
          avatar: user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`,
          joinedAt: Date.now(),
          academicProfile: undefined
        };
      }

      onLogin(profile);
    } catch (err: any) {
      console.error("Google Login Error:", err);
      let errorMessage = err.message;
      if (err.code === 'auth/popup-blocked') {
        errorMessage = "Sign-in popup was blocked. Please allow popups for this site.";
      } else if (err.code === 'auth/unauthorized-domain') {
        const domain = window.location.hostname;
        errorMessage = `Domain "${domain}" is not authorized for Google Sign-in. Please add it to your Firebase Console -> Authentication -> Settings -> Authorized Domains.`;
      } else if (err.code === 'auth/cancelled-popup-request') {
        errorMessage = "A previous login attempt is still pending. Please wait or refresh the page.";
      } else if (err.code === 'auth/popup-closed-by-user') {
        errorMessage = "The login popup was closed before completion. Please try again.";
      }
      setError(errorMessage);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] w-full px-4 sm:px-6">
      <div className="w-full max-w-md bg-white p-6 sm:p-10 rounded-[32px] sm:rounded-[40px] shadow-sm border border-[#D9D9C3]">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-[#5A5A40] rounded-2xl flex items-center justify-center mb-4 shadow-lg">
            <Brain className="text-white w-8 h-8" />
          </div>
          <h2 className="text-3xl font-serif italic text-[#424231]">{isLogin ? 'Welcome Back' : 'Join the Collective'}</h2>
          <p className="text-[#8C8C73] text-sm mt-2 font-medium">{isLogin ? 'Sign in to continue your journey' : 'Start your smarter learning path today'}</p>
        </div>

        <button
          onClick={handleGoogleLogin}
          type="button"
          className="w-full flex items-center justify-center gap-3 py-4 bg-[#F5F5F0] border border-[#D9D9C3] text-[#424231] rounded-2xl font-bold hover:bg-[#EBEBE0] transition-all mb-6"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Google Academic ID
        </button>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-[#EBEBE0]"></span>
          </div>
          <div className="relative flex justify-center text-[10px] uppercase tracking-widest font-black text-[#8C8C73]">
            <span className="bg-white px-2">Or local credentials</span>
          </div>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          {!isLogin && (
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-widest ml-4">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="How should we call you?"
                required={!isLogin}
                className="w-full p-4 rounded-full bg-[#F5F5F0] border border-[#D9D9C3] focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/30 text-sm"
              />
            </div>
          )}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-widest ml-4">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="scholar@studybuddy.ai"
              required
              className="w-full p-4 rounded-full bg-[#F5F5F0] border border-[#D9D9C3] focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/30 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-widest ml-4">Secret Phrase</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full p-4 rounded-full bg-[#F5F5F0] border border-[#D9D9C3] focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/30 text-sm"
            />
          </div>

          {error && <p className="text-red-500 text-[10px] font-bold text-center uppercase tracking-wider">{error}</p>}

          <button className="w-full py-4 bg-[#5A5A40] text-white rounded-full font-bold hover:bg-[#424231] transition-all shadow-md mt-4 text-xs uppercase tracking-widest">
            {isLogin ? 'Authorize Entry' : 'Create Account'}
          </button>
        </form>

        <p className="text-center mt-6 text-xs text-[#8C8C73] font-medium">
          {isLogin ? "Don't have an account?" : "Already a member?"} {' '}
          <button 
            onClick={() => setIsLogin(!isLogin)}
            className="text-[#BC6C25] font-bold hover:underline"
          >
            {isLogin ? 'Register Now' : 'Sign In'}
          </button>
        </p>
      </div>
    </div>
  );
};

const ProfileView = ({ user, onUpdate, onLogout }: { user: UserProfile, onUpdate: (user: UserProfile) => void, onLogout: () => void }) => {
  const [username, setUsername] = useState(user.username);
  const [avatarSeed, setAvatarSeed] = useState(user.uid);
  const [showSaved, setShowSaved] = useState(false);

  const handleSave = () => {
    const updated = { ...user, username, avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${avatarSeed}` };
    onUpdate(updated);
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 3000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 sm:space-y-8">
      <div className="bg-white p-6 sm:p-10 rounded-[32px] sm:rounded-[40px] shadow-sm border border-[#D9D9C3]">
        <h2 className="text-2xl sm:text-3xl font-serif italic text-[#424231] mb-6 sm:mb-10 text-center">Scholar Profile</h2>
        
        <div className="flex flex-col items-center gap-6 sm:gap-8 mb-8 sm:mb-12">
          <div className="relative group">
            <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-[32px] sm:rounded-[40px] bg-[#F5F5F0] border-2 border-[#D9D9C3] overflow-hidden flex items-center justify-center p-2">
              <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${avatarSeed}`} alt="Avatar" className="w-full h-full object-cover" />
            </div>
            <button 
              onClick={() => setAvatarSeed(Math.random().toString())}
              className="absolute -bottom-2 -right-2 p-3 bg-[#5A5A40] text-white rounded-2xl shadow-lg hover:scale-110 transition-transform"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          <div className="w-full max-w-sm space-y-6">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-widest ml-4">Full Identity</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full p-4 rounded-full bg-[#F5F5F0] border border-[#D9D9C3] focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/30 text-sm font-semibold"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-widest ml-4">Email Channel</label>
              <input
                type="text"
                value={user.email}
                disabled
                className="w-full p-4 rounded-full bg-[#EBEBE0] border border-[#D9D9C3] text-sm opacity-60 cursor-not-allowed font-medium"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <button 
            onClick={handleSave}
            className="w-full sm:flex-1 py-4 bg-[#5A5A40] text-white rounded-full font-bold hover:bg-[#424231] transition-all flex items-center justify-center gap-2 text-[10px] sm:text-xs uppercase tracking-widest"
          >
            {showSaved ? <><CheckCircle2 className="w-4 h-4" /> Changes Applied</> : 'Sync Profile'}
          </button>
          <button 
            onClick={onLogout}
            className="w-full sm:w-auto px-8 py-4 bg-red-50 text-red-600 rounded-full font-bold hover:bg-red-100 transition-all flex items-center justify-center gap-2 text-[10px] sm:text-xs uppercase tracking-widest border border-red-100"
          >
            <LogOut className="w-4 h-4" /> Terminate
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-[#FEFAE0] p-8 rounded-[40px] border border-[#E9EDC9]">
          <h3 className="text-lg font-serif italic text-[#BC6C25] mb-4">Academic Journey</h3>
          {user.academicProfile ? (
            <div className="space-y-4 mb-6">
              <div>
                <p className="text-[10px] font-bold text-[#B08968] uppercase tracking-widest mb-1">Current Focus</p>
                <div className="flex flex-wrap gap-2">
                  {user.academicProfile.subjects.map((s, i) => (
                    <span key={i} className="px-3 py-1 bg-white/60 text-[#8C8C73] text-[9px] font-bold uppercase tracking-widest rounded-full border border-white">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <div className="p-4 bg-white/40 rounded-2xl border border-white">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-3.5 h-3.5 text-[#BC6C25]" />
                  <p className="text-[10px] font-bold text-[#BC6C25] uppercase tracking-widest">Optimal Window</p>
                </div>
                <p className="text-sm font-bold text-[#5A5A40]">{user.academicProfile.optimalTimeSuggestion}</p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-[#8C8C73] font-medium leading-relaxed italic mb-6">Intelligence profile incomplete. Personalized rhythms have not been mapped yet.</p>
          )}
          
          <div className="flex items-center gap-4 p-4 bg-white/40 rounded-2xl border border-white mb-4">
            <Award className="w-8 h-8 text-[#BC6C25]" />
            <div>
              <p className="text-sm font-bold text-[#424231] uppercase tracking-[0.1em]">Prodigy Scholar</p>
              <p className="text-[10px] text-[#B08968] font-bold">Level 4 Achievement</p>
            </div>
          </div>

          <div className="flex items-center gap-4 p-4 bg-white/40 rounded-2xl border border-white">
            <Calendar className="w-5 h-5 text-[#BC6C25]" />
            <div>
              <p className="text-xs font-bold text-[#424231] uppercase tracking-wide">Discovery Date</p>
              <p className="text-[10px] text-[#B08968] font-bold">{new Date(user.joinedAt).toLocaleDateString()}</p>
            </div>
          </div>
        </div>
        <div className="bg-[#E9EDC9] p-8 rounded-[40px] border border-[#D9D9C3]">
          <h3 className="text-lg font-serif italic text-[#5A5A40] mb-4">Tech Stack & Ecosystem</h3>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[
              { label: 'Brain', value: 'Gemini 3.0 AI' },
              { label: 'Storage', value: 'Firestore Cloud' },
              { label: 'Identity', value: 'Google OAuth' },
              { label: 'Logic', value: 'TypeScript 5.x' },
              { label: 'Design', value: 'Tailwind 4.0' },
              { label: 'Physics', value: 'Framer Motion' }
            ].map((tech, i) => (
              <div key={i} className="p-3 bg-white/40 rounded-xl border border-white">
                <p className="text-[8px] font-bold text-[#8C8C73] uppercase tracking-tighter">{tech.label}</p>
                <p className="text-[10px] font-black text-[#424231] uppercase">{tech.value}</p>
              </div>
            ))}
          </div>
          <div className="p-4 bg-white/20 rounded-2xl border border-white space-y-2">
            <h4 className="text-[10px] font-bold text-[#5A5A40] uppercase tracking-widest">Network Optimization</h4>
            <p className="text-[10px] text-[#8C8C73] font-medium leading-relaxed italic">
              Long-polling active for resilient performance on slower connections. Automatic background sync enabled.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const AITutor = ({ user }: { user: UserProfile }) => {
  const [messages, setMessages] = useState<Message[]>([
    { 
      role: 'bot', 
      text: user.academicProfile 
        ? `Welcome back, ${user.username}! I'm ready to dive into ${user.academicProfile.subjects.join(', ')} or any other subject you're curious about. How shall we begin our neural journey today?`
        : "Hi! I'm your StudyBuddy AI Tutor. How can I help you today?", 
      timestamp: new Date() 
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const models = [
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
    { id: 'gemini-flash-latest', label: 'Gemini Flash' },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
    { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Lite' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }
  ];
  
  const [selectedModel, setSelectedModel] = useState('gemini-3-flash-preview');

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (customText?: string) => {
    const textToSend = customText || input;
    if (!textToSend.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', text: textToSend, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const history = messages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      }));
      
      const systemInstruction = `You are an encouraging and knowledgeable AI study tutor for ${user.username}. 
      The user is focusing on: ${user.academicProfile?.subjects.join(', ') || 'General studies'}.
      Their study strategy is: ${user.academicProfile?.studyStrategy || 'Standard active learning'}.
      Help students understand complex concepts, explain topics clearly, and offer study tips tailored to their subjects.
      
      INTERACTIVITY REQUIREMENT:
      You MUST return your response as a strict JSON object with this structure: { "text": "...", "suggestions": [{ "label": "...", "type": "question" | "topic" | "practical" }] }.
      
      Suggestions Guidelines:
      1. "Follow-up Question": A specific question that probes deeper into the current concept.
      2. "Related Topic": A lateral connection to a sibling concept or advanced prerequisite.
      3. "Practical Challenge": A quick "test yourself" task or real-world application.
      
      Provide 3 distinct, high-quality suggestions. Avoid generic "Tell me more". Make the user curious!`;

      const schema = {
        type: 'object',
        properties: {
          text: { type: 'string' },
          suggestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                type: { type: 'string', enum: ['question', 'topic', 'practical'] }
              },
              required: ['label', 'type']
            }
          }
        },
        required: ['text', 'suggestions']
      };

      const data = await callGemini(
        [...history, { role: 'user', parts: [{ text: textToSend }] }], 
        selectedModel, 
        true, 
        systemInstruction,
        schema
      );

      const botMessage: Message = { 
        role: 'bot', 
        text: data.text || "I processed your request, but couldn't generate a clear explanation. Let's try rephrasing!", 
        suggestions: data.suggestions || [],
        timestamp: new Date() 
      };
      setMessages(prev => [...prev, botMessage]);
    } catch (error: any) {
      console.error("AI Tutor Error:", error);
      let errorMessage = "I'm having a bit of trouble connecting to my brain right now. Can we try again in a moment?";
      
      if (error.message?.includes('API_KEY_ERROR')) {
        errorMessage = "Security Error: Your API key is invalid or restricted. Please go to Settings -> Secrets and add a NEW secret named USER_GEMINI_API_KEY with a fresh key from aistudio.google.com/app/apikey";
      } else if (error.message?.includes('AI Proxy Error')) {
        errorMessage = "Connection Error: Failed to reach the AI engine. Check your internet or try again later.";
      }
        
      setMessages(prev => [...prev, { 
        role: 'bot', 
        text: errorMessage, 
        timestamp: new Date() 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const getSuggestionIcon = (type: string) => {
    switch(type) {
      case 'question': return <HelpCircle className="w-3 h-3" />;
      case 'topic': return <Book className="w-3 h-3" />;
      case 'practical': return <Zap className="w-3 h-3" />;
      default: return <Sparkles className="w-3 h-3" />;
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] sm:h-[calc(100vh-160px)] bg-white rounded-[24px] sm:rounded-[48px] shadow-sm overflow-hidden border border-[#D9D9C3]">
      <div className="p-4 sm:p-6 border-b border-[#D9D9C3] bg-[#EBEBE0] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 sm:p-2.5 bg-[#5A5A40] rounded-xl">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-[#424231] tracking-tight text-base sm:text-lg">AI Tutor Chat</h2>
            <p className="text-[9px] sm:text-[10px] font-bold text-[#8C8C73] uppercase tracking-widest mt-0.5">Interactive Session</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 bg-white/50 px-3 py-1.5 rounded-full border border-[#D9D9C3] w-full sm:w-auto overflow-hidden">
          <Cpu className="w-3.5 h-3.5 text-[#5A5A40] shrink-0" />
          <select 
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="text-[9px] font-bold uppercase tracking-widest text-[#5A5A40] bg-transparent border-none focus:ring-0 cursor-pointer p-0 pr-6 flex-1 sm:flex-none"
          >
            {models.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>
      
      <div ref={scrollRef} className="flex-1 p-4 sm:p-10 overflow-y-auto space-y-6 bg-[#F5F5F0]/50 no-scrollbar">
        {messages.map((msg, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, x: msg.role === 'user' ? 20 : -20 }}
            animate={{ opacity: 1, x: 0 }}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-[90%] sm:max-w-[85%] space-y-3 ${msg.role === 'user' ? 'flex flex-col items-end' : 'flex flex-col items-start'}`}>
              <div className={`p-4 sm:p-6 rounded-[24px] sm:rounded-[32px] ${
                msg.role === 'user' 
                  ? 'bg-[#5A5A40] text-white rounded-tr-none shadow-lg' 
                  : 'bg-white text-[#2D2D2A] shadow-sm border border-[#D9D9C3] rounded-tl-none'
              }`}>
                <div className="prose prose-sm prose-stone max-w-none text-[#2D2D2A] leading-relaxed">
                  <Markdown>{msg.text}</Markdown>
                </div>
                <span className="text-[8px] sm:text-[9px] opacity-50 mt-3 block font-bold uppercase tracking-widest">
                  {new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric' }).format(msg.timestamp)}
                </span>
              </div>
              
              {msg.suggestions && msg.suggestions.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2 justify-start sm:justify-start">
                  {msg.suggestions.map((suggestion, sIdx) => (
                    <motion.button
                      key={sIdx}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: sIdx * 0.1 }}
                      onClick={() => handleSend(suggestion.label)}
                      className="px-3 sm:px-4 py-1.5 sm:py-2 bg-white hover:bg-[#F5F5F0] text-[#BC6C25] text-[9px] sm:text-[10px] font-bold rounded-full border border-[#D9D9C3] hover:border-[#BC6C25] transition-all shadow-sm flex items-center gap-2"
                    >
                      {getSuggestionIcon(suggestion.type)}
                      {suggestion.label}
                    </motion.button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white p-3 sm:p-4 rounded-2xl shadow-sm border border-[#D9D9C3] flex gap-2">
              <div className="w-2 h-2 bg-[#5A5A40] rounded-full animate-bounce" />
              <div className="w-2 h-2 bg-[#5A5A40] rounded-full animate-bounce [animation-delay:0.2s]" />
              <div className="w-2 h-2 bg-[#5A5A40] rounded-full animate-bounce [animation-delay:0.4s]" />
            </div>
          </div>
        )}
      </div>

      <div className="p-4 sm:p-6 bg-white border-t border-[#D9D9C3]">
        <div className="relative flex items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask your tutor..."
            className="w-full p-4 pr-14 rounded-full bg-[#F5F5F0] border border-[#D9D9C3] focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/30 transition-all text-sm sm:text-base"
          />
          <button
            onClick={() => handleSend()}
            disabled={isLoading}
            className="absolute right-2 p-3 bg-[#5A5A40] text-white rounded-full hover:bg-[#424231] disabled:opacity-50 transition-colors shadow-sm"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

interface SessionHistoryEntry {
  type: 'work' | 'break';
  duration: number;
  timestamp: number;
}

const StudyTimer = ({ onSessionComplete }: { onSessionComplete: (duration: number, type: 'work' | 'break') => void }) => {
  const [settings, setSettings] = useState<TimerSettings>({
    work: 25,
    shortBreak: 5,
    longBreak: 15
  });
  const [mode, setMode] = useState<'work' | 'shortBreak' | 'longBreak'>('work');
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [isActive, setIsActive] = useState(false);
  const [sessionsCompleted, setSessionsCompleted] = useState(0);
  const [workSound, setWorkSound] = useState(localStorage.getItem('studybuddy_work_sound') || "https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3");
  const [breakSound, setBreakSound] = useState(localStorage.getItem('studybuddy_break_sound') || "https://assets.mixkit.co/active_storage/sfx/598/598-preview.mp3");
  const [showSoundSettings, setShowSoundSettings] = useState(false);
  const [sessionHistory, setSessionHistory] = useState<SessionHistoryEntry[]>(() => {
    const saved = localStorage.getItem('studybuddy_session_history');
    return saved ? JSON.parse(saved) : [];
  });
  const [showHistory, setShowHistory] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const soundPresets = {
    minimal: {
      work: "https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3",
      break: "https://assets.mixkit.co/active_storage/sfx/598/598-preview.mp3"
    },
    digital: {
      work: "https://assets.mixkit.co/active_storage/sfx/995/995-preview.mp3",
      break: "https://assets.mixkit.co/active_storage/sfx/1003/1003-preview.mp3"
    },
    zen: {
      work: "https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3",
      break: "https://assets.mixkit.co/active_storage/sfx/2569/2569-preview.mp3"
    }
  };

  // Request notification permission
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const playNotificationSound = (type: 'work' | 'break') => {
    const url = type === 'work' ? workSound : breakSound;
    const audio = new Audio(url);
    audio.play().catch(e => console.log("Audio play blocked by browser policy"));
  };

  const sendNotification = (title: string, body: string, type: 'work' | 'break') => {
    playNotificationSound(type);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, {
        body,
        icon: "https://api.dicebear.com/7.x/avataaars/svg?seed=studybuddy"
      });
    }
  };

  const testNotification = () => {
    if ("Notification" in window) {
      Notification.requestPermission().then(permission => {
        if (permission === "granted") {
          sendNotification("Test Notification", "Awesome! StudyBuddy notifications are now active.", 'work');
        } else {
          alert("Please enable notifications in your browser settings to use this feature.");
        }
      });
    }
  };

  useEffect(() => {
    if (isActive && timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => prev - 1);
      }, 1000);
    } else if (timeLeft === 0) {
      handleTimerComplete();
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isActive, timeLeft]);

  useEffect(() => {
    localStorage.setItem('studybuddy_session_history', JSON.stringify(sessionHistory));
  }, [sessionHistory]);

  const handleTimerComplete = () => {
    setIsActive(false);
    if (timerRef.current) clearInterval(timerRef.current);
    
    const sessionType = mode === 'work' ? 'work' : 'break';
    const sessionDuration = settings[mode] * 60;

    // Add to history
    const historyEntry: SessionHistoryEntry = {
      type: sessionType,
      duration: sessionDuration,
      timestamp: Date.now()
    };
    setSessionHistory(prev => [historyEntry, ...prev].slice(0, 50)); // Keep last 50 entries

    // Call global log for both work and break
    onSessionComplete(sessionDuration, sessionType);

    if (mode === 'work') {
      const newCount = sessionsCompleted + 1;
      setSessionsCompleted(newCount);
      if (newCount % 4 === 0) {
        setMode('longBreak');
        setTimeLeft(settings.longBreak * 60);
        sendNotification("Work Session Complete!", "Drafting time for a long rest. Take 15 minutes.", 'work');
      } else {
        setMode('shortBreak');
        setTimeLeft(settings.shortBreak * 60);
        sendNotification("Focus Session Ended", "Time for a 5-minute breather.", 'work');
      }
    } else {
      setMode('work');
      setTimeLeft(settings.work * 60);
      sendNotification("Break Concluded", "Ready for your next cognitive sprint? Let's dive back in.", 'break');
    }
  };

  const toggleTimer = () => setIsActive(!isActive);
  
  const resetTimer = () => {
    setIsActive(false);
    setTimeLeft(settings[mode] * 60);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const [showPresets, setShowPresets] = useState(false);

  const presets = {
    classic: { work: 25, shortBreak: 5, longBreak: 15, label: "Classic Pomodoro" },
    focus: { work: 50, shortBreak: 10, longBreak: 30, label: "Deep Focus (50/10)" },
    flow: { work: 90, shortBreak: 15, longBreak: 45, label: "Extended Flow" },
    quick: { work: 15, shortBreak: 3, longBreak: 10, label: "Quick Sprint" }
  };

  const applyPreset = (p: keyof typeof presets) => {
    const preset = presets[p];
    setSettings({
      work: preset.work,
      shortBreak: preset.shortBreak,
      longBreak: preset.longBreak
    });
    if (!isActive) {
      setTimeLeft(preset[mode === 'work' ? 'work' : mode === 'shortBreak' ? 'shortBreak' : 'longBreak'] * 60);
    }
  };

  const currentModeLabel = useMemo(() => {
    switch(mode) {
      case 'work': return 'Deep Focus';
      case 'shortBreak': return 'Quick Rest';
      case 'longBreak': return 'Extended Break';
    }
  }, [mode]);

  const progress = useMemo(() => {
    const total = settings[mode] * 60;
    return ((total - timeLeft) / total) * 100;
  }, [timeLeft, mode, settings]);

  return (
    <div className="flex flex-col items-center p-6 sm:p-10 bg-white rounded-[32px] shadow-sm border border-[#D9D9C3] max-w-lg mx-auto w-full relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-[#F5F5F0] rounded-bl-full opacity-50 -z-0"></div>
      
      <div className="flex gap-2 mb-8 sm:mb-10 bg-[#EBEBE0] p-1.5 rounded-full relative z-10 w-full sm:w-auto">
        {(['work', 'shortBreak', 'longBreak'] as const).map(m => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setTimeLeft(settings[m] * 60);
              setIsActive(false);
            }}
            className={`flex-1 sm:flex-none px-4 sm:px-6 py-2 rounded-full text-[10px] sm:text-xs font-bold transition-all ${
              mode === m ? 'bg-white text-[#5A5A40] shadow-sm' : 'text-[#8C8C73] hover:text-[#5A5A40]'
            }`}
          >
            {m === 'work' ? 'Work' : m === 'shortBreak' ? 'Break' : 'Rest'}
          </button>
        ))}
      </div>

      <div className="relative w-64 h-64 sm:w-72 sm:h-72 mb-8 sm:mb-10">
        <svg className="w-full h-full transform -rotate-90">
          <circle
            cx="50%"
            cy="50%"
            r="45%"
            stroke="currentColor"
            strokeWidth="4"
            fill="transparent"
            className="text-[#F5F5F0]"
          />
          <motion.circle
            cx="50%"
            cy="50%"
            r="45%"
            stroke="currentColor"
            strokeWidth="8"
            strokeDasharray="283 283"
            animate={{ strokeDashoffset: 283 - (283 * progress) / 100 }}
            transition={{ duration: 0.5, ease: "linear" }}
            fill="transparent"
            strokeLinecap="round"
            className="text-[#5A5A40]"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-5xl sm:text-7xl font-serif font-bold text-[#5A5A40] tracking-tight">{formatTime(timeLeft)}</span>
          <span className="text-[9px] sm:text-[10px] text-[#8C8C73] font-bold uppercase tracking-widest mt-2 sm:mt-4">{currentModeLabel}</span>
        </div>
      </div>

      <div className="flex flex-col items-center gap-4 mb-10 w-full">
        <div className="flex items-center gap-6">
          <button
            onClick={toggleTimer}
            className="w-16 h-16 flex items-center justify-center bg-[#5A5A40] text-white rounded-full hover:bg-[#424231] transition-all shadow-md hover:scale-105 active:scale-95"
          >
            {isActive ? <Pause className="w-6 h-6" fill="currentColor" /> : <Play className="w-6 h-6 translate-x-0.5" fill="currentColor" />}
          </button>
          <button
            onClick={resetTimer}
            className="w-12 h-12 flex items-center justify-center border border-[#D9D9C3] text-[#5A5A40] rounded-full hover:bg-[#F5F5F0] transition-all"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
        </div>
        
        <button
          onClick={testNotification}
          className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-widest hover:text-[#5A5A40] transition-colors flex items-center gap-2"
        >
          <Bell className="w-3 h-3" /> Test Notifications
        </button>

        <button
          onClick={() => setShowSoundSettings(!showSoundSettings)}
          className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-widest hover:text-[#5A5A40] transition-colors flex items-center gap-2"
        >
          <Settings className="w-3 h-3" /> Audio Settings
        </button>

        <button
          onClick={() => setShowHistory(!showHistory)}
          className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-widest hover:text-[#5A5A40] transition-colors flex items-center gap-2"
        >
          <History className="w-3 h-3" /> Session History
        </button>

        {showHistory && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full mt-6 p-6 bg-[#F5F5F0] rounded-[24px] border border-[#D9D9C3] space-y-4 max-h-64 overflow-y-auto scrollbar-hide"
          >
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-[10px] font-black text-[#5A5A40] uppercase tracking-widest">Recent Logs</h4>
              <button 
                onClick={() => setSessionHistory([])}
                className="text-[8px] font-bold text-red-500 uppercase tracking-widest hover:text-red-600"
              >
                Clear History
              </button>
            </div>

            {sessionHistory.length === 0 ? (
              <p className="text-[10px] text-[#8C8C73] italic text-center py-4">No sessions documented yet.</p>
            ) : (
              <div className="space-y-3">
                {sessionHistory.map((entry, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-white p-3 rounded-xl border border-[#D9D9C3]/50">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${entry.type === 'work' ? 'bg-[#5A5A40]' : 'bg-[#BC6C25]'}`} />
                      <div>
                        <p className="text-[10px] font-black text-[#5A5A40] uppercase">{entry.type === 'work' ? 'Deep focus' : 'Cognitive Break'}</p>
                        <p className="text-[8px] text-[#8C8C73] uppercase tracking-tight">{new Date(entry.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                    </div>
                    <span className="text-[11px] font-serif font-bold text-[#5A5A40]">{Math.floor(entry.duration / 60)}m</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {showSoundSettings && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full mt-6 p-6 bg-[#F5F5F0] rounded-[24px] border border-[#D9D9C3] space-y-4"
          >
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-[10px] font-black text-[#5A5A40] uppercase tracking-widest">Audio Profile</h4>
              <div className="flex gap-2">
                {(['minimal', 'digital', 'zen'] as const).map(p => (
                  <button 
                    key={p}
                    onClick={() => {
                      setWorkSound(soundPresets[p].work);
                      setBreakSound(soundPresets[p].break);
                      localStorage.setItem('studybuddy_work_sound', soundPresets[p].work);
                      localStorage.setItem('studybuddy_break_sound', soundPresets[p].break);
                    }}
                    className="px-2 py-1 bg-white border border-[#D9D9C3] rounded-md text-[8px] font-bold uppercase tracking-tighter hover:bg-[#EBEBE0]"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[9px] font-bold text-[#8C8C73] uppercase tracking-widest block mb-1">Work End Sound</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={workSound} 
                    onChange={(e) => {
                      setWorkSound(e.target.value);
                      localStorage.setItem('studybuddy_work_sound', e.target.value);
                    }}
                    className="flex-1 text-[10px] p-2 rounded-lg border border-[#D9D9C3] bg-white outline-none"
                  />
                  <button onClick={() => playNotificationSound('work')} className="p-2 bg-white rounded-lg border border-[#D9D9C3] hover:bg-[#EBEBE0]">
                    <Volume2 className="w-3 h-3 text-[#5A5A40]" />
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[9px] font-bold text-[#8C8C73] uppercase tracking-widest block mb-1">Break End Sound</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={breakSound} 
                    onChange={(e) => {
                      setBreakSound(e.target.value);
                      localStorage.setItem('studybuddy_break_sound', e.target.value);
                    }}
                    className="flex-1 text-[10px] p-2 rounded-lg border border-[#D9D9C3] bg-white outline-none"
                  />
                  <button onClick={() => playNotificationSound('break')} className="p-2 bg-white rounded-lg border border-[#D9D9C3] hover:bg-[#EBEBE0]">
                    <Volume2 className="w-3 h-3 text-[#5A5A40]" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>

        <div className="flex flex-wrap justify-center gap-3 mb-10 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
          <button
            onClick={() => setShowPresets(!showPresets)}
            className="flex items-center gap-2 px-4 py-2 bg-[#F5F5F0] hover:bg-[#EBEBE0] text-[#5A5A40] text-[10px] font-bold rounded-full border border-[#D9D9C3] transition-all"
          >
            <Sparkles className="w-3 h-3" /> {showPresets ? "Hide Presets" : "Pomodoro Presets"}
          </button>
          
          {showPresets && (
            <div className="flex flex-wrap justify-center gap-2 w-full mt-2">
              {(Object.keys(presets) as Array<keyof typeof presets>).map(p => (
                <button
                  key={p}
                  onClick={() => applyPreset(p)}
                  className="px-3 py-1.5 bg-white border border-[#D9D9C3] hover:border-[#BC6C25] text-[#8C8C73] hover:text-[#BC6C25] text-[9px] font-bold rounded-full transition-all"
                >
                  {presets[p].label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-6 w-full mb-10">
          <div className="p-5 bg-[#E9EDC9] rounded-[24px] text-center border border-[#D9D9C3]/50 hover:shadow-md transition-shadow">
            <p className="text-[10px] uppercase text-[#5A5A40] font-bold mb-1 opacity-70">Focus Blocks</p>
            <div className="flex justify-center gap-1 mb-1">
              {[1, 2, 3, 4].map(i => (
                <div 
                  key={i} 
                  className={`w-2 h-2 rounded-full ${i <= (sessionsCompleted % 4 || (sessionsCompleted > 0 ? 4 : 0)) ? 'bg-[#5A5A40]' : 'bg-[#D9D9C3]'}`} 
                />
              ))}
            </div>
            <p className="text-3xl font-serif italic text-[#424231]">{sessionsCompleted}</p>
          </div>
          <div className="p-5 bg-[#FEFAE0] rounded-[24px] text-center border border-[#E9EDC9] hover:shadow-md transition-shadow">
            <p className="text-[10px] uppercase text-[#B08968] font-bold mb-1 opacity-70">Day Progress</p>
            <p className="text-3xl font-serif italic text-[#BC6C25]">{Math.min(100, (sessionsCompleted / 8) * 100).toFixed(0)}%</p>
          </div>
        </div>

        <div className="w-full bg-[#F5F5F0] p-8 rounded-[32px] border border-[#D9D9C3] shadow-inner">
          <h3 className="text-[10px] font-black text-[#5A5A40] mb-8 flex items-center gap-2 uppercase tracking-[0.2em]">
            <Settings className="w-4 h-4" /> Strategy Customization
          </h3>
          <div className="space-y-8">
            {(['work', 'shortBreak', 'longBreak'] as const).map((key) => (
              <div key={key} className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-[#8C8C73] uppercase tracking-widest">{key.replace('Break', ' Break')} Interval</span>
                  <span className="px-3 py-1 bg-white border border-[#D9D9C3] text-[11px] font-black text-[#5A5A40] rounded-lg min-w-[3rem] text-center">{settings[key]}m</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="90"
                  value={settings[key]}
                  onChange={(e) => {
                    const newVal = parseInt(e.target.value);
                    setSettings(prev => ({ ...prev, [key]: newVal }));
                    if (!isActive && mode === key) setTimeLeft(newVal * 60);
                  }}
                  className="w-full h-1.5 bg-[#D9D9C3] rounded-lg appearance-none cursor-pointer accent-[#5A5A40]"
                />
              </div>
            ))}
          </div>
          <p className="text-[9px] text-[#8C8C73] font-medium italic mt-8 text-center opacity-60 leading-relaxed">
            Note: Advanced Pomodoro logic applies—a 15-30 minute long break is automatically triggered every 4 work sessions.
          </p>
        </div>
    </div>
  );
};

const FlashcardsView = ({ cards, setCards, onReviewComplete }: { cards: Flashcard[], setCards: React.Dispatch<React.SetStateAction<Flashcard[]>>, onReviewComplete: (cardsCount: number) => void }) => {
  const [newFront, setNewFront] = useState('');
  const [newBack, setNewBack] = useState('');
  const [isStudying, setIsStudying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showHistoryFor, setShowHistoryFor] = useState<string | null>(null);

  const addCard = () => {
    if (!newFront.trim() || !newBack.trim()) return;
    setCards([...cards, { id: Date.now().toString(), front: newFront, back: newBack, confidence: 0, history: [] }]);
    setNewFront('');
    setNewBack('');
  };

  const deleteCard = (id: string) => {
    setCards(cards.filter(c => c.id !== id));
  };

  const updateConfidence = (id: string, level: number) => {
    setCards(prev => prev.map(c => {
      if (c.id === id) {
        const history = [...(c.history || []), { timestamp: Date.now(), confidence: level }];
        return { ...c, confidence: level, lastReviewed: Date.now(), history };
      }
      return c;
    }));
    if (currentIndex < cards.length - 1) {
      setFlipped(false);
      setCurrentIndex(prev => prev + 1);
    } else {
      setIsStudying(false);
      onReviewComplete(cards.length);
    }
  };

  if (isStudying && cards.length > 0) {
    const card = cards[currentIndex];
    return (
      <div className="flex flex-col items-center max-w-2xl mx-auto w-full space-y-8">
        <div className="flex items-center justify-between w-full">
          <h2 className="text-2xl font-serif italic text-[#424231]">Study Session</h2>
          <span className="text-xs font-bold text-[#8C8C73] uppercase tracking-widest">{currentIndex + 1} of {cards.length}</span>
          <button onClick={() => setIsStudying(false)} className="text-[10px] font-bold text-[#BC6C25] uppercase tracking-widest hover:underline">End Session</button>
        </div>
        
        <div 
          onClick={() => setFlipped(!flipped)}
          className="relative w-full aspect-[16/10] cursor-pointer group perspective-1000"
        >
          <motion.div
            animate={{ rotateY: flipped ? 180 : 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 25 }}
            className="w-full h-full relative preserve-3d"
          >
            <div className={`absolute inset-0 bg-white shadow-sm rounded-[32px] flex items-center justify-center p-12 border border-[#D9D9C3] ${flipped ? 'hidden' : 'flex'} backface-hidden`}>
              <p className="text-3xl font-serif text-center text-[#424231] leading-snug">{card.front}</p>
              <div className="absolute bottom-6 text-[10px] text-[#8C8C73] font-bold uppercase tracking-widest opacity-50">Tap to reveal</div>
            </div>
            <div className={`absolute inset-0 bg-[#5A5A40] shadow-xl rounded-[32px] flex items-center justify-center p-12 border border-[#424231] ${!flipped ? 'hidden' : 'flex'} backface-hidden [transform:rotateY(180deg)]`}>
              <div className="flex flex-col items-center">
                <p className="text-2xl font-serif text-center text-white leading-relaxed mb-12">{card.back}</p>
                <div className="flex gap-4">
                  {[
                    { label: 'Forgot', level: 1, color: 'bg-red-500' },
                    { label: 'Hesitant', level: 3, color: 'bg-amber-500' },
                    { label: 'Mastered', level: 5, color: 'bg-emerald-500' }
                  ].map(btn => (
                    <button
                      key={btn.level}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateConfidence(card.id, btn.level);
                      }}
                      className={`px-6 py-3 ${btn.color} text-white rounded-full text-[10px] font-bold uppercase tracking-widest shadow-lg hover:scale-105 transition-transform`}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="absolute bottom-6 text-[10px] text-white/50 font-bold uppercase tracking-widest">Rate your knowledge to continue</div>
            </div>
          </motion.div>
        </div>

        <div className="flex gap-4">
          <button
            onClick={() => {
              setFlipped(false);
              setCurrentIndex((currentIndex - 1 + cards.length) % cards.length);
            }}
            className="w-14 h-14 flex items-center justify-center bg-[#EBEBE0] text-[#5A5A40] rounded-full hover:bg-[#D9D9C3] transition-colors shadow-sm"
          >
            <RotateCcw className="w-5 h-5 -scale-x-100" />
          </button>
          <div className="px-10 py-4 bg-white/50 rounded-full font-bold text-[10px] text-[#8C8C73] uppercase tracking-widest border border-[#D9D9C3] flex items-center gap-2">
            Confidence: {card.confidence > 0 ? card.confidence : 'New'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end bg-[#F0EDE4] p-6 sm:p-8 rounded-[32px] border border-[#D9D9C3] gap-6">
        <div>
          <h2 className="text-2xl sm:text-3xl font-serif italic text-[#424231]">Flashcards Library</h2>
          <p className="text-[#8C8C73] mt-1 font-medium text-sm">{cards.length} active concepts in your deck</p>
        </div>
        <button 
          disabled={cards.length === 0}
          onClick={() => {
            setCurrentIndex(0);
            setIsStudying(true);
          }} 
          className="w-full sm:w-auto px-8 py-3 bg-[#5A5A40] text-white rounded-full hover:bg-[#424231] transition-all disabled:opacity-50 flex items-center justify-center gap-2 font-bold shadow-sm text-sm"
        >
          <Play className="w-4 h-4 fill-white" /> Review Now
        </button>
      </div>

      <div className="bg-white p-6 sm:p-8 rounded-[32px] shadow-sm border border-[#D9D9C3]">
        <h3 className="text-xs font-bold text-[#5A5A40] mb-6 uppercase tracking-widest">Create New Deck Element</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-6">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-widest ml-1">Front of card</label>
            <input
              placeholder="Enter term or question..."
              value={newFront}
              onChange={(e) => setNewFront(e.target.value)}
              className="w-full p-4 rounded-2xl bg-[#F5F5F0] border border-[#D9D9C3] focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/30 text-sm font-medium"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-widest ml-1">Back of card</label>
            <input
              placeholder="Enter definition or answer..."
              value={newBack}
              onChange={(e) => setNewBack(e.target.value)}
              className="w-full p-4 rounded-2xl bg-[#F5F5F0] border border-[#D9D9C3] focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/30 text-sm font-medium"
            />
          </div>
        </div>
        <button onClick={addCard} className="w-full py-4 bg-[#EBEBE0] text-[#5A5A40] rounded-2xl hover:bg-[#D9D9C3] font-bold transition-all flex items-center justify-center gap-2">
          <Plus className="w-5 h-5" /> Add to Library
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {cards.map(card => (
          <div key={card.id} className="group relative bg-white p-6 sm:p-8 rounded-[32px] shadow-sm border border-[#D9D9C3] hover:border-[#5A5A40]/50 transition-all">
            <div className="mb-6">
              <span className="text-[9px] font-bold text-[#8C8C73] uppercase tracking-[0.2em] mb-2 block">Front Face</span>
              <p className="text-[#424231] font-serif text-lg italic leading-snug">{card.front}</p>
            </div>
            <div className="pt-6 border-t border-[#F5F5F0]">
              <span className="text-[9px] font-bold text-[#8C8C73] uppercase tracking-[0.2em] mb-2 block">Back Face</span>
              <p className="text-[#8C8C73] text-sm leading-relaxed line-clamp-3 mb-6">{card.back}</p>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${card.confidence >= 4 ? 'bg-emerald-500' : card.confidence >= 2 ? 'bg-amber-500' : 'bg-red-500'}`} />
                  <span className="text-[9px] font-bold text-[#8C8C73] uppercase tracking-widest">{card.confidence > 0 ? `Level ${card.confidence}` : 'Unranked'}</span>
                </div>
                {(card.history?.length ?? 0) > 0 && (
                  <button 
                    onClick={() => setShowHistoryFor(card.id)}
                    className="text-[9px] font-bold text-[#BC6C25] uppercase tracking-widest flex items-center gap-1.5 hover:underline"
                  >
                    <History className="w-3.5 h-3.5" /> History
                  </button>
                )}
              </div>
            </div>
            <button 
              onClick={() => deleteCard(card.id)}
              className="absolute top-6 right-6 p-2 text-[#D9D9C3] hover:text-[#BC6C25] opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {showHistoryFor && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-[#424231]/40 backdrop-blur-sm"
            onClick={() => setShowHistoryFor(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-lg rounded-[40px] shadow-2xl border border-[#D9D9C3] overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-8 border-b border-[#F5F5F0] bg-[#F5F5F0]/50 flex justify-between items-center">
                <div>
                   <h3 className="text-xl font-serif italic text-[#424231]">Learning Progression</h3>
                   <p className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-widest mt-1">
                     {cards.find(c => c.id === showHistoryFor)?.front}
                   </p>
                </div>
                <button onClick={() => setShowHistoryFor(null)} className="p-2 hover:bg-white rounded-full text-[#8C8C73] transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-8 max-h-[60vh] overflow-y-auto space-y-4">
                {cards.find(c => c.id === showHistoryFor)?.history?.slice().reverse().map((entry, idx) => (
                  <div key={idx} className="flex items-center justify-between p-4 bg-[#F5F5F0] rounded-2xl border border-[#D9D9C3]">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-[10px] font-bold ${
                        entry.confidence >= 4 ? 'bg-emerald-100 text-emerald-600' : 
                        entry.confidence >= 2 ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'
                      }`}>
                        +{entry.confidence}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-[#424231] uppercase tracking-wide">
                          {entry.confidence >= 4 ? 'Strong Recall' : entry.confidence >= 2 ? 'Developing' : 'Neural Gap'}
                        </p>
                        <p className="text-[10px] text-[#8C8C73] font-medium">
                          {new Date(entry.timestamp).toLocaleDateString()} @ {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const QuizView = ({ sessions, flashcards, onComplete, onNavigate }: { 
  sessions: StudySession[], 
  flashcards: Flashcard[], 
  onComplete: (score: number, total: number, topic: string) => void,
  onNavigate?: (view: any) => void
}) => {
  const [step, setStep] = useState<'config' | 'generating' | 'active' | 'results'>('config');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<(string | boolean | null)[]>([]);
  const [timeLeft, setTimeLeft] = useState(30);

  // Timer logic for active quiz
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (step === 'active' && quiz && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft(prev => prev - 1);
      }, 1000);
    } else if (step === 'active' && quiz && timeLeft === 0) {
      // Auto-submit null for unanswered on timeout
      handleAnswer(null);
    }
    return () => clearInterval(timer);
  }, [step, quiz, timeLeft]);

  // Reset timer on index change
  useEffect(() => {
    if (step === 'active') {
      setTimeLeft(30);
    }
  }, [currentIdx, step]);
  const [loadingMsg, setLoadingMsg] = useState('Architecting your assessment...');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [isGeneratingFollowUps, setIsGeneratingFollowUps] = useState(false);

  useEffect(() => {
    if (step === 'config' && suggestions.length === 0 && (sessions.length > 0 || flashcards.length > 0)) {
      getSmartSuggestions();
    }
  }, [step]);

  const getSmartSuggestions = async () => {
    setIsSuggesting(true);
    try {
      // Analyze history for deeper context
      const lowConfidenceCards = flashcards.filter(c => c.confidence > 0 && c.confidence < 3).map(c => c.front).slice(0, 5);
      const newCards = flashcards.filter(c => c.confidence === 0).map(c => c.front).slice(0, 5);
      const quizHistory = sessions.filter(s => s.type === 'quiz').slice(0, 5).map(s => `Score: ${s.data?.score}/${s.data?.total}`).join(', ');
      
      const prompt = `Act as an Educational Strategist. Based on this student's data, suggest 5 diverse quiz topics that would bridge their knowledge gaps or reinforce recent learning.
      - Low Confidence Topics: ${lowConfidenceCards.join(', ') || 'None'}
      - New Topics: ${newCards.join(', ') || 'None'}
      - Recent Quiz Performance: ${quizHistory || 'No previous quizzes'}
      - Study Sessions Activity: ${sessions.slice(0, 5).map(s => s.type).join(', ')}

      Guidelines:
      1. One suggestion should be a "Review" of a low-confidence topic.
      2. One should be a "Challenge" based on their highest activity area.
      3. One should be an "Interdisciplinary" topic connecting two of their subjects.
      4. Two should be general but contextually relevant.
      
      Return 5 specific topic strings in a JSON array: ["Topic 1", "Topic 2", "Topic 3", "Topic 4", "Topic 5"]`;

      const schema = {
        type: 'array',
        items: { type: 'string' }
      };

      const data = await callGemini(prompt, 'gemini-3-flash-preview', true, undefined, schema);
      setSuggestions(data);
    } catch (error) {
      console.error('Failed to get suggestions:', error);
    } finally {
      setIsSuggesting(false);
    }
  };

  const generateQuiz = async () => {
    if (!topic.trim()) return;
    setStep('generating');
    try {
      const prompt = `Generate a quiz about "${topic}" with difficulty level "${difficulty}".
      The response MUST be a JSON object strictly following this structure:
      {
        "topic": "${topic}",
        "difficulty": "${difficulty}",
        "questions": [
          {
            "id": "1",
            "type": "multiple-choice",
            "question": "Question text here?",
            "options": ["Option A", "Option B", "Option C", "Option D"],
            "answer": "Correct option exactly as in options list",
            "explanation": "Why it is correct"
          },
          {
            "id": "2",
            "type": "true-false",
            "question": "Statement here?",
            "answer": true,
            "explanation": "Why it is true"
          }
        ]
      }
      Provide exactly 5 high-quality questions. Ensure correct JSON syntax.`;

      const schema = {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          difficulty: { type: 'string' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                type: { type: 'string', enum: ['multiple-choice', 'true-false'] },
                question: { type: 'string' },
                options: { type: 'array', items: { type: 'string' } },
                answer: { type: 'string' },
                explanation: { type: 'string' }
              },
              required: ['id', 'type', 'question', 'answer', 'explanation']
            }
          }
        },
        required: ['topic', 'difficulty', 'questions']
      };

      const data = await callGemini(prompt, 'gemini-3-flash-preview', true, undefined, schema);
      setQuiz(data);
      setStep('active');
    } catch (error: any) {
      console.error(error);
      let msg = "Failed to generate quiz. Please try a different topic.";
      if (error.message?.includes('API_KEY_ERROR')) {
        msg = "Critical error identifying your API Key. Please add USER_GEMINI_API_KEY in your project Secrets.";
      }
      alert(msg);
      setStep('config');
    }
  };

  const generateFollowUpQuestions = async (currentQuiz: Quiz, userAnswers: (string | boolean)[]) => {
    setIsGeneratingFollowUps(true);
    try {
      const performanceSummary = currentQuiz.questions.map((q, i) => ({
        question: q.question,
        isCorrect: userAnswers[i] === q.answer
      }));

      const prompt = `Based on the student's performance on this quiz about "${currentQuiz.topic}", generate 3-5 thought-provoking follow-up questions or discussion points to deepen their conceptual understanding.
      These must be DIFFERENT from the original quiz questions and specifically target areas where they might need more clarity or curiosity.
      
      Quiz Performance: ${JSON.stringify(performanceSummary)}
      
      Return as a JSON array of strings: ["question 1", "question 2", ...]`;

      const schema = {
        type: 'array',
        items: { type: 'string' }
      };

      const data = await callGemini(prompt, 'gemini-3-flash-preview', true, undefined, schema);
      setFollowUpQuestions(data);
    } catch (error) {
      console.error('Failed to generate follow-up questions:', error);
    } finally {
      setIsGeneratingFollowUps(false);
    }
  };

  const handleAnswer = (ans: string | boolean) => {
    const newAnswers = [...answers, ans];
    setAnswers(newAnswers);
    if (currentIdx < (quiz?.questions.length || 0) - 1) {
      setCurrentIdx(currentIdx + 1);
    } else {
      const score = newAnswers.reduce((acc, a, idx) => a === quiz?.questions[idx].answer ? acc + 1 : acc, 0);
      onComplete(score, quiz?.questions.length || 0, topic);
      setStep('results');
      if (quiz) {
        generateFollowUpQuestions(quiz, newAnswers);
      }
    }
  };

  if (step === 'config') {
    return (
      <div className="max-w-2xl mx-auto w-full px-4">
        <div className="bg-white p-6 sm:p-12 rounded-[32px] sm:rounded-[40px] shadow-sm border border-[#D9D9C3]">
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-[#FEFAE0] rounded-2xl sm:rounded-[24px] flex items-center justify-center mb-6 sm:mb-8 border border-[#E9EDC9]">
            <BookOpen className="w-8 h-8 sm:w-10 sm:h-10 text-[#BC6C25]" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-serif italic text-[#424231] mb-2">Quiz Architect</h2>
          <p className="text-[#8C8C73] mb-8 sm:mb-10 font-medium text-sm sm:text-base">Define your boundaries. I will draft the challenge.</p>
          
          <div className="space-y-8">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-widest ml-1">Subject Matter</label>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Quantum Physics, French Revolution..."
                className="w-full p-5 rounded-3xl bg-[#F5F5F0] border border-[#D9D9C3] focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/30 text-sm font-semibold"
              />
              
              {/* Smart Suggestions */}
              {(isSuggesting || suggestions.length > 0) && (
                <div className="mt-4 flex flex-wrap gap-2 animate-in fade-in slide-in-from-top-2">
                  <span className="text-[9px] font-bold text-[#BC6C25] uppercase tracking-widest block w-full mb-1 opacity-70">Focus Recommendations</span>
                  {isSuggesting ? (
                    <div className="flex gap-2">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="h-8 w-24 bg-[#F5F5F0] rounded-full animate-pulse border border-[#D9D9C3]" />
                      ))}
                    </div>
                  ) : (
                    suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => setTopic(s)}
                        className={`px-4 py-1.5 rounded-full border text-[10px] font-bold transition-all ${
                          topic === s 
                            ? 'bg-[#E9EDC9] text-[#5A5A40] border-[#5A5A40]' 
                            : 'bg-white text-[#8C8C73] border-[#D9D9C3] hover:border-[#5A5A40] hover:text-[#5A5A40]'
                        }`}
                      >
                        {s}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <label className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-widest ml-1">Complexity Depth</label>
              <div className="grid grid-cols-3 gap-4">
                {(['easy', 'medium', 'hard'] as const).map(d => (
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    className={`py-4 rounded-2xl border transition-all text-[10px] font-bold uppercase tracking-widest ${
                      difficulty === d 
                        ? 'bg-[#5A5A40] text-white border-[#5A5A40] shadow-md' 
                        : 'bg-white text-[#8C8C73] border-[#D9D9C3] hover:bg-[#F5F5F0]'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={generateQuiz}
              disabled={!topic.trim()}
              className="w-full py-5 bg-[#5A5A40] text-white rounded-full font-bold hover:bg-[#424231] transition-all shadow-lg flex items-center justify-center gap-3 text-xs uppercase tracking-widest disabled:opacity-50"
            >
              Initialize Assessment <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'generating') {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center">
        <div className="relative mb-12">
          <div className="w-32 h-32 border-4 border-[#D9D9C3] rounded-full border-t-[#5A5A40] animate-spin" />
          <Brain className="absolute inset-0 m-auto w-10 h-10 text-[#5A5A40] animate-pulse" />
        </div>
        <h2 className="text-3xl font-serif italic text-[#424231] mb-4">Neural Formatting...</h2>
        <p className="text-[#8C8C73] font-medium tracking-wide animate-pulse">Sourcing data shards for {topic}</p>
      </div>
    );
  }

  if (step === 'active' && quiz) {
    const q = quiz.questions[currentIdx];
    return (
      <div className="max-w-3xl mx-auto space-y-8 sm:space-y-12 px-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-4 mb-4">
              <span className="text-[9px] sm:text-[10px] font-bold text-[#BC6C25] uppercase tracking-widest bg-[#FEFAE0] px-4 py-1.5 rounded-full border border-[#E9EDC9]">Question {currentIdx + 1} of {quiz.questions.length}</span>
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${timeLeft < 10 ? 'bg-red-50 border-red-200 text-red-600' : 'bg-[#F5F5F0] border-[#D9D9C3] text-[#5A5A40]'}`}>
                <Timer className={`w-3.5 h-3.5 ${timeLeft < 10 ? 'animate-pulse' : ''}`} />
                <span className="text-[10px] font-black tracking-widest">{timeLeft}S</span>
              </div>
            </div>
            <h2 className="text-2xl sm:text-3xl font-serif italic text-[#424231] leading-snug">{q.question}</h2>
          </div>
          <div className="hidden md:block w-32 h-1.5 bg-[#F5F5F0] rounded-full overflow-hidden border border-[#D9D9C3] mb-2">
             <motion.div 
               initial={{ width: 0 }}
               animate={{ width: `${((currentIdx + 1) / quiz.questions.length) * 100}%` }}
               className="h-full bg-[#5A5A40]"
             />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {q.type === 'multiple-choice' ? (
            q.options?.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleAnswer(opt)}
                className="w-full p-6 text-left bg-white border border-[#D9D9C3] rounded-3xl hover:border-[#5A5A40] hover:bg-[#F5F5F0] transition-all group flex items-center gap-6"
              >
                <div className="w-10 h-10 rounded-2xl bg-[#EBEBE0] flex items-center justify-center text-[#5A5A40] font-bold text-xs group-hover:bg-[#5A5A40] group-hover:text-white transition-colors">
                  {String.fromCharCode(65 + i)}
                </div>
                <span className="text-sm font-bold text-[#424231]">{opt}</span>
              </button>
            ))
          ) : (
            <div className="flex gap-4">
              {[true, false].map(val => (
                <button
                  key={val.toString()}
                  onClick={() => handleAnswer(val)}
                  className="flex-1 p-10 bg-white border border-[#D9D9C3] rounded-[40px] hover:border-[#5A5A40] hover:bg-[#F5F5F0] transition-all flex flex-col items-center gap-4 group"
                >
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center ${val ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'} transition-transform group-hover:scale-110`}>
                    {val ? <CheckCircle2 className="w-8 h-8" /> : <X className="w-8 h-8" />}
                  </div>
                  <span className="text-xs font-black uppercase tracking-widest text-[#424231]">{val.toString()}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (step === 'results' && quiz) {
    const score = answers.reduce((acc, a, idx) => a === quiz.questions[idx].answer ? acc + 1 : acc, 0);
    const percentage = Math.round((score / quiz.questions.length) * 100);

    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-[#EBEBE0] p-12 rounded-[56px] border border-[#D9D9C3] text-center mb-12 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 left-0 w-64 h-64 bg-white/30 rounded-full blur-[80px] -ml-32 -mt-32" />
          <div className="relative z-10">
            <h2 className="text-5xl font-serif italic text-[#424231] mb-6">Assessment Concluded</h2>
            <div className="flex justify-center gap-12 items-center my-12">
              <div className="text-center">
                <p className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-[0.2em] mb-2">Net Accuracy</p>
                <p className="text-6xl font-bold text-[#5A5A40]">{percentage}%</p>
              </div>
              <div className="w-px h-20 bg-[#D9D9C3]" />
              <div className="text-center">
                <p className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-[0.2em] mb-2">Neural Score</p>
                <p className="text-6xl font-bold text-[#BC6C25]">{score}/{quiz.questions.length}</p>
              </div>
            </div>
            <button
              onClick={() => {
                setStep('config');
                setTopic('');
                setAnswers([]);
                setCurrentIdx(0);
              }}
              className="px-12 py-4 bg-[#5A5A40] text-white rounded-full font-bold hover:bg-[#424231] transition-all shadow-lg text-[10px] uppercase tracking-widest"
            >
              Draft New Session
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <h3 className="text-xs font-bold text-[#8C8C73] uppercase tracking-[0.3em] ml-6">Analytical Review</h3>
          {quiz.questions.map((q, idx) => {
            const isCorrect = answers[idx] === q.answer;
            return (
              <div key={idx} className="bg-white p-8 rounded-[32px] border border-[#D9D9C3] shadow-[0_2px_10px_rgba(0,0,0,0.02)] flex gap-8 items-start">
                 <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${isCorrect ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                    {isCorrect ? <CheckCircle2 className="w-6 h-6" /> : <X className="w-6 h-6" />}
                 </div>
                 <div>
                   <p className="text-lg font-serif italic text-[#424231] mb-3 leading-tight">{q.question}</p>
                   {!isCorrect && (
                     <p className="text-xs font-bold text-red-600/80 mb-2">Your Answer: <span className="uppercase text-[10px]">{answers[idx].toString()}</span></p>
                   )}
                   <p className="text-xs font-bold text-[#BC6C25] mb-4">Correct: <span className="uppercase text-[10px]">{q.answer.toString()}</span></p>
                   <div className="p-4 bg-[#F5F5F0] rounded-2xl border border-[#D9D9C3] text-xs text-[#5A5A40] font-medium leading-relaxed">
                     <span className="font-bold uppercase text-[9px] tracking-widest text-[#8C8C73] block mb-1">Reasoning</span>
                     {q.explanation}
                   </div>
                 </div>
              </div>
            );
          })}
        </div>

        {/* AI Tutor Follow-up Questions */}
        <div className="mt-16 space-y-6">
          <h3 className="text-xs font-bold text-[#8C8C73] uppercase tracking-[0.3em] ml-6">Synthetic Inquiry</h3>
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#FEFAE0] p-10 rounded-[48px] border border-[#E9EDC9] shadow-sm mb-12"
          >
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm border border-[#E9EDC9]">
                <Brain className="w-6 h-6 text-[#BC6C25]" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-[#BC6C25] uppercase tracking-widest leading-none mb-1">AI Tutor Insight</p>
                <h4 className="text-xl font-serif italic text-[#424231]">Deeper Exploration</h4>
              </div>
            </div>

            {isGeneratingFollowUps ? (
              <div className="flex flex-col items-center py-10 gap-4">
                <div className="w-8 h-8 border-2 border-[#D9D9C3] border-t-[#BC6C25] rounded-full animate-spin" />
                <p className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-[0.2em] animate-pulse">Drafting follow-up inquiries...</p>
              </div>
            ) : followUpQuestions.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {followUpQuestions.map((q, i) => (
                  <motion.button 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.1 }}
                    key={i} 
                    onClick={() => onNavigate?.('tutor')}
                    className="p-6 bg-white/60 rounded-3xl border border-white text-sm text-[#5A5A40] font-bold leading-relaxed text-left hover:bg-white hover:border-[#BC6C25] hover:shadow-md transition-all group relative overflow-hidden"
                  >
                    <div className="relative z-10 flex items-start gap-4">
                      <div className="w-8 h-8 shrink-0 flex items-center justify-center text-[10px] font-black text-[#BC6C25] bg-[#FEFAE0] rounded-xl border border-[#E9EDC9] group-hover:bg-[#BC6C25] group-hover:text-white transition-colors">
                        {i + 1}
                      </div>
                      <span className="mt-1">{q}</span>
                    </div>
                    <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Sparkles className="w-4 h-4 text-[#BC6C25]" />
                    </div>
                  </motion.button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[#8C8C73] italic text-center py-6">No specific follow-ups generated for this session.</p>
            )}
          </motion.div>
        </div>
      </div>
    );
  }

  return null;
};

const AboutView = ({ user }: { user: UserProfile | null }) => {
  const features = [
    { title: 'AI Personalized Tutoring', icon: <Cpu className="w-5 h-5" />, desc: 'A custom-trained tutor that understands your academic profile and learning style.' },
    { title: 'Weekly Strategic Planning', icon: <Calendar className="w-5 h-5" />, desc: 'AI-synthesized weekly schedules that adapt to your quiz performance and mastery.' },
    { title: 'Smart Recommendations', icon: <Sparkles className="w-5 h-5" />, desc: 'Real-time analysis of your study habits to suggest optimal topics and techniques.' },
    { title: 'Cognitive Flashcards', icon: <Brain className="w-5 h-5" />, desc: 'Active recall system with confidence tracking to ensure long-term retention.' },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-8 sm:space-y-12 pb-10 sm:pb-20">
      <header className="text-center space-y-4 px-4">
        <div className="w-16 h-16 sm:w-20 sm:h-20 bg-[#5A5A40] rounded-[24px] sm:rounded-3xl mx-auto flex items-center justify-center shadow-lg transform -rotate-6">
          <BookOpen className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
        </div>
        <h1 className="text-3xl sm:text-5xl font-serif italic text-[#424231] tracking-tight">Cognitive Study Companion</h1>
        <p className="text-[#8C8C73] font-medium text-base sm:text-lg italic">The ultimate AI-powered environment for elite learners.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8 px-4">
        {features.map((f, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white p-6 sm:p-8 rounded-[32px] sm:rounded-[40px] border border-[#D9D9C3] shadow-sm hover:shadow-md transition-all group"
          >
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-[#F5F5F0] rounded-xl sm:rounded-2xl flex items-center justify-center mb-6 text-[#5A5A40] group-hover:bg-[#5A5A40] group-hover:text-white transition-colors">
              {f.icon}
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-[#424231] mb-3">{f.title}</h3>
            <p className="text-[#8C8C73] leading-relaxed text-sm font-medium">{f.desc}</p>
          </motion.div>
        ))}
      </div>

      <div className="mx-4 bg-[#5A5A40] rounded-[40px] sm:rounded-[56px] p-8 sm:p-12 text-center text-white space-y-6 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mt-32 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-black/10 rounded-full -ml-32 -mb-32 blur-3xl" />
        
        <h2 className="text-2xl sm:text-3xl font-serif italic relative z-10">Our Mission</h2>
        <p className="max-w-2xl mx-auto text-white/80 font-medium leading-loose relative z-10 text-sm sm:text-base">
          This application was built to bridge the gap between static study tools and personalized learning. 
          By leveraging advanced AI models, we provide every student with a world-class education strategist, 
          tutor, and planner—available 24/7.
        </p>
        <div className="pt-6 relative z-10">
          <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.4em] text-white/40">Built with Precision by</p>
          <div className="mt-4 inline-flex items-center gap-3 sm:gap-4 bg-white/10 px-6 sm:px-8 py-3 rounded-full backdrop-blur-sm border border-white/10">
            {user ? (
              <>
                <div className="w-6 h-6 sm:w-8 sm:h-8 bg-white rounded-full flex items-center justify-center font-serif italic text-[#5A5A40] font-black text-xs sm:text-sm">
                  {user.username.charAt(0).toUpperCase()}
                </div>
                <span className="text-base sm:text-lg font-bold tracking-tight">{user.username}</span>
              </>
            ) : (
              <span className="text-base sm:text-lg font-bold tracking-tight">AI Study Buddy</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const WeeklyPlanView = ({ 
  user, 
  sessions, 
  flashcards, 
  studyPlan, 
  setStudyPlan 
}: { 
  user: UserProfile, 
  sessions: StudySession[], 
  flashcards: Flashcard[], 
  studyPlan: { day: string, goals: string[], focus?: string }[] | null,
  setStudyPlan: (plan: { day: string, goals: string[], focus?: string }[] | null) => void
}) => {
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);

  const masteryData = useMemo(() => {
    return [
      { name: 'New', value: flashcards.filter(c => c.confidence === 0).length, fill: '#D9D9C3' },
      { name: 'Forgot', value: flashcards.filter(c => c.confidence === 1).length, fill: '#EF4444' },
      { name: 'Hesitant', value: flashcards.filter(c => c.confidence === 3).length, fill: '#F59E0B' },
      { name: 'Mastered', value: flashcards.filter(c => c.confidence === 5).length, fill: '#10B981' },
    ];
  }, [flashcards]);

  const generateWeeklyPlan = async () => {
    setIsGeneratingPlan(true);
    try {
      const quizPerformance = sessions
        .filter(s => s.type === 'quiz' && s.data)
        .map(s => ({ topic: s.data.topic, score: s.data.score, total: s.data.total }));
      
      const avgSessionDuration = sessions.length > 0 
        ? Math.round(sessions.reduce((acc, s) => acc + s.duration, 0) / sessions.length / 60)
        : 0;

      const aiPrompt = `As an elite AI study strategist, generate a highly personalized 7-day study plan for ${user.username}.
      
      User Profile & Context:
      - Primary Subjects: ${user.academicProfile?.subjects.join(', ') || 'General Studies'}
      - Optimal Study Window: ${user.academicProfile?.optimalTimeSuggestion || 'Anytime'}
      - Daily Routine Constraints: ${user.academicProfile?.dailyRoutine || 'No specific routine'}
      - Preferred Learning Strategy: ${user.academicProfile?.studyStrategy || 'Balanced'}
      
      Recent Activity Analytics:
      - Total Sessions Completed: ${sessions.length}
      - Average Session Length: ${avgSessionDuration} minutes
      - Flashcard Mastery Distribution: ${JSON.stringify(masteryData.map(m => ({ label: m.name, count: m.value })))}
      - Recent Quiz Performance: ${JSON.stringify(quizPerformance.slice(0, 5))}
      
      Strategic Requirements:
      1. Intelligence-Led Scheduling: Prioritize subjects where quiz performance is lower or flashcards are in 'Forgot' state.
      2. Routine Alignment: Map session times to the user's optimal study window and daily routine constraints.
      3. Balanced Pedagogy: Include segments for 'Deep Work' (new concepts), 'Active Recall' (flashcards), and 'Stress Testing' (quizzes).
      4. Incremental Load: Ensure the plan is realistic—max 3 actionable, high-impact goals per day.
      5. Actionable Language: Goals should be specific (e.g., "Active Recall: 15m on Cell Biology" instead of "Study Bio").
      
      Format the output as a strict JSON array of objects:
      [
        { "day": "Monday", "goals": ["Goal 1 (e.g. Active Recall: Bio)", "Goal 2", "Goal 3"], "focus": "Reason for focus this day" },
        ...
      ]`;

      const schema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            day: { type: 'string' },
            goals: { type: 'array', items: { type: 'string' } },
            focus: { type: 'string' }
          },
          required: ['day', 'goals']
        }
      };

      const data = await callGemini(aiPrompt, 'gemini-3-flash-preview', true, undefined, schema);
      setStudyPlan(data);
    } catch (error: any) {
      console.error('Failed to generate study plan:', error);
      if (error.message?.includes('API_KEY_ERROR')) {
        alert("Strategy synthesis (Weekly) failed: Invalid API Key. Please update your settings in AI Studio.");
      }
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  return (
    <div className="space-y-10 pb-20">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h2 className="text-3xl sm:text-4xl font-serif italic text-[#424231] tracking-tight">Weekly Strategy</h2>
          <p className="text-[#8C8C73] mt-2 font-medium text-sm sm:text-base">Your personalized cognitive roadmap for the next 7 days.</p>
        </div>
        <button
          onClick={generateWeeklyPlan}
          disabled={isGeneratingPlan}
          className="w-full md:w-auto px-8 sm:px-10 py-3 sm:py-4 bg-[#5A5A40] text-white rounded-full font-bold hover:bg-[#424231] transition-all shadow-lg text-[10px] uppercase tracking-widest flex items-center justify-center gap-3 disabled:opacity-50"
        >
          {isGeneratingPlan ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Synthesizing...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Synthesize New Plan
            </>
          )}
        </button>
      </header>

      {studyPlan ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {studyPlan.map((day, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-white p-8 rounded-[40px] border border-[#D9D9C3] shadow-[0_4px_20px_rgba(0,0,0,0.02)] flex flex-col h-full hover:border-[#BC6C25] transition-colors group"
            >
              <div className="mb-6 flex justify-between items-start">
                <div>
                  <h4 className="text-sm font-black text-[#BC6C25] uppercase tracking-[0.2em]">{day.day}</h4>
                  <div className="h-1 w-8 bg-[#BC6C25] mt-2 rounded-full opacity-30 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="p-2 bg-[#F5F5F0] rounded-xl">
                  <Calendar className="w-4 h-4 text-[#8C8C73]" />
                </div>
              </div>
              
              {day.focus && (
                <div className="mb-6 p-4 bg-[#F5F5F0] rounded-2xl border border-[#D9D9C3]/50">
                  <p className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-widest opacity-60 mb-1">Daily Focus</p>
                  <p className="text-xs font-bold text-[#5A5A40] leading-snug">{day.focus}</p>
                </div>
              )}
              
              <div className="space-y-4 flex-1">
                {day.goals.map((goal, j) => (
                  <div key={j} className="flex gap-4 items-start group/goal">
                    <div className="mt-1 w-5 h-5 rounded-lg border border-[#D9D9C3] bg-[#F5F5F0] flex items-center justify-center shrink-0 group-hover/goal:border-[#BC6C25] transition-colors">
                      <div className="w-1.5 h-1.5 bg-[#BC6C25] rounded-sm opacity-0 group-hover/goal:opacity-100 transition-opacity" />
                    </div>
                    <p className="text-[13px] font-medium text-[#424231] leading-snug">{goal}</p>
                  </div>
                ))}
              </div>
              
              <div className="mt-8 pt-6 border-t border-[#D9D9C3] flex justify-between items-center opacity-40 group-hover:opacity-100 transition-opacity">
                <span className="text-[9px] font-bold text-[#8C8C73] uppercase tracking-widest">Day {i + 1} of 7</span>
                <CheckCircle2 className="w-4 h-4 text-[#BC6C25]" />
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="min-h-[400px] flex flex-col items-center justify-center bg-white rounded-[56px] border-2 border-dashed border-[#D9D9C3] p-12 text-center">
          <div className="w-20 h-20 bg-[#F5F5F0] rounded-full flex items-center justify-center mb-8">
            <Calendar className="w-10 h-10 text-[#D9D9C3]" />
          </div>
          <h3 className="text-2xl font-serif italic text-[#424231] mb-4">No Strategic Plan Detected</h3>
          <p className="text-[#8C8C73] max-w-sm mx-auto mb-10 font-medium italic">Our AI needs to synthesize your recent activity into a structured cognitive roadmap.</p>
          <button
            onClick={generateWeeklyPlan}
            className="px-12 py-5 bg-[#5A5A40] text-white rounded-full font-bold hover:bg-[#424231] transition-all shadow-xl shadow-[#5A5A40]/20 text-[10px] uppercase tracking-[0.3em] flex items-center gap-3"
          >
            <Sparkles className="w-4 h-4" />
            Synthesize Blueprint
          </button>
        </div>
      )}
    </div>
  );
};

const DashboardView = ({ 
  user,
  stats, 
  sessions, 
  flashcards,
  studyPlan,
  setStudyPlan,
  onNavigate,
  recommendations,
  setRecommendations,
  isGeneratingRecs,
  setIsGeneratingRecs
}: { 
  user: UserProfile,
  stats: any[], 
  sessions: StudySession[], 
  flashcards: Flashcard[],
  studyPlan: { day: string, goals: string[], focus?: string }[] | null,
  setStudyPlan: (plan: { day: string, goals: string[], focus?: string }[] | null) => void,
  onNavigate: (view: View) => void,
  recommendations: { title: string, content: string, type: 'topic' | 'technique', priority: 'high' | 'medium' }[],
  setRecommendations: (recs: any) => void,
  isGeneratingRecs: boolean,
  setIsGeneratingRecs: (v: boolean) => void
}) => {
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return 'Night owl energy';
    if (hour < 12) return 'Morning focus';
    if (hour < 17) return 'Afternoon momentum';
    if (hour < 21) return 'Evening reflection';
    return 'Closing the day';
  }, []);

  const masteryData = useMemo(() => {
    return [
      { name: 'New', value: flashcards.filter(c => c.confidence === 0).length, fill: '#D9D9C3' },
      { name: 'Forgot', value: flashcards.filter(c => c.confidence === 1).length, fill: '#EF4444' },
      { name: 'Hesitant', value: flashcards.filter(c => c.confidence === 3).length, fill: '#F59E0B' },
      { name: 'Mastered', value: flashcards.filter(c => c.confidence === 5).length, fill: '#10B981' },
    ];
  }, [flashcards]);

  const generateWeeklyPlan = async () => {
    setIsGeneratingPlan(true);
    try {
      const quizPerformance = sessions
        .filter(s => s.type === 'quiz' && s.data)
        .map(s => ({ topic: s.data.topic, score: s.data.score, total: s.data.total }));
      
      const avgSessionDuration = sessions.length > 0 
        ? Math.round(sessions.reduce((acc, s) => acc + s.duration, 0) / sessions.length / 60)
        : 0;

      const aiPrompt = `As an elite AI study strategist, generate a highly personalized 7-day study plan for ${user.username}.
      
      User Profile & Context:
      - Primary Subjects: ${user.academicProfile?.subjects.join(', ') || 'General Studies'}
      - Optimal Study Window: ${user.academicProfile?.optimalTimeSuggestion || 'Anytime'}
      - Daily Routine Constraints: ${user.academicProfile?.dailyRoutine || 'No specific routine'}
      - Preferred Learning Strategy: ${user.academicProfile?.studyStrategy || 'Balanced'}
      
      Recent Activity Analytics:
      - Total Sessions Completed: ${sessions.length}
      - Average Session Length: ${avgSessionDuration} minutes
      - Flashcard Mastery Distribution: ${JSON.stringify(masteryData.map(m => ({ label: m.name, count: m.value })))}
      - Recent Quiz Performance: ${JSON.stringify(quizPerformance.slice(0, 5))}
      
      Strategic Requirements:
      1. Intelligence-Led Scheduling: Prioritize subjects where quiz performance is lower or flashcards are in 'Forgot' state.
      2. Routine Alignment: Map session times to the user's optimal study window and daily routine constraints.
      3. Balanced Pedagogy: Include segments for 'Deep Work' (new concepts), 'Active Recall' (flashcards), and 'Stress Testing' (quizzes).
      4. Incremental Load: Ensure the plan is realistic—max 3 actionable, high-impact goals per day.
      5. Actionable Language: Goals should be specific (e.g., "Active Recall: 15m on Cell Biology" instead of "Study Bio").
      
      Format the output as a strict JSON array of objects:
      [
        { "day": "Monday", "goals": ["Goal 1 (e.g. Active Recall: Bio)", "Goal 2", "Goal 3"], "focus": "Reason for focus this day" },
        ...
      ]`;

      const schema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            day: { type: 'string' },
            goals: { type: 'array', items: { type: 'string' } },
            focus: { type: 'string' }
          },
          required: ['day', 'goals']
        }
      };

      const data = await callGemini(aiPrompt, 'gemini-3-flash-preview', true, undefined, schema);
      setStudyPlan(data);
    } catch (error: any) {
      console.error('Failed to generate study plan:', error);
      if (error.message?.includes('API_KEY_ERROR')) {
        alert("Strategy synthesis (Dashboard) failed: API Key issue detected.");
      }
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  const [errorRecs, setErrorRecs] = useState<string | null>(null);

  const generateRecommendations = async () => {
    if (isGeneratingRecs) return;
    setIsGeneratingRecs(true);
    setErrorRecs(null);
    try {
      const quizPerformance = sessions
        .filter(s => s.type === 'quiz' && s.data)
        .map(s => ({ topic: s.data.topic, score: s.data.score, total: s.data.total }));

      const aiPrompt = `Based on the following data for ${user.username}, provide 3 highly specific study recommendations.\n      \n      Context:\n      - Mastery: ${JSON.stringify(masteryData.map(m => ({ label: m.name, count: m.value })))}\n      - Quiz Performance (Recent): ${JSON.stringify(quizPerformance.slice(0, 3))}\n      - Subjects: ${user.academicProfile?.subjects.join(', ')}\n      - Strategy: ${user.academicProfile?.studyStrategy}\n\n      Recommendations should be split between 'topic' (what to study) and 'technique' (how to study).\n      \n      Return format (strict JSON array):\n      [ \n        { \"title\": \"...\", \"content\": \"...\", \"type\": \"topic\" | \"technique\", \"priority\": \"high\" | \"medium\" }\n      ]`;

      const schema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            type: { type: 'string', enum: ['topic', 'technique'] },
            priority: { type: 'string', enum: ['high', 'medium'] }
          },
          required: ['title', 'content', 'type', 'priority']
        }
      };

      const data = await callGemini(aiPrompt, 'gemini-3-flash-preview', true, undefined, schema);
      if (Array.isArray(data)) {
        setRecommendations(data);
      } else {
        throw new Error("Invalid response format for recommendations");
      }
    } catch (error: any) {
      console.error('Rec generation failed:', error);
      setErrorRecs(error.message?.includes('API_KEY_ERROR') ? "Security Error: Your API key is invalid or missing. Check AI Studio settings." : (error.message || "Failed to generate recommendations. Please try again."));
    } finally {
      setIsGeneratingRecs(false);
    }
  };

  useEffect(() => {
    if (recommendations.length === 0) {
      generateRecommendations();
    }
  }, []);

  const chartData = useMemo(() => {
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return d.toISOString().split('T')[0];
    });

    return last7Days.map(date => {
      const daySessions = sessions.filter(s => new Date(s.timestamp).toISOString().split('T')[0] === date);
      const hours = daySessions.reduce((acc, s) => acc + s.duration, 0) / 3600;
      return {
        name: new Date(date).toLocaleDateString('en-US', { weekday: 'short' }),
        hours: parseFloat(hours.toFixed(1))
      };
    });
  }, [sessions]);

  const quizTrendData = useMemo(() => {
    return sessions
      .filter(s => s.type === 'quiz' && s.data)
      .slice(-10)
      .map((s, idx) => ({
        idx: idx + 1,
        score: Math.round((s.data.score / s.data.total) * 100),
        topic: s.data.topic
      }));
  }, [sessions]);

  const confidenceDistribution = useMemo(() => {
    const levels = [0, 1, 2, 3, 4, 5];
    const labels = ['New', 'Hard', 'Medium', 'Good', 'Very Good', 'Mastered'];
    const colors = ['#D9D9C3', '#FCA5A5', '#FCD34D', '#A78BFA', '#60A5FA', '#34D399'];
    
    return levels.map((lvl, i) => ({
      name: labels[i],
      count: flashcards.filter(c => Math.floor(c.confidence) === lvl).length,
      fill: colors[i]
    }));
  }, [flashcards]);

  const masteryMapData = useMemo(() => {
    if (!user.academicProfile?.subjects) return [];
    
    return user.academicProfile.subjects.map(subject => {
      // Find quiz sessions for this subject
      const subjectQuizzes = sessions.filter(s => 
        s.type === 'quiz' && 
        s.data?.topic?.toLowerCase().includes(subject.toLowerCase())
      );
      
      const avgScore = subjectQuizzes.length > 0 
        ? subjectQuizzes.reduce((acc, s) => acc + (s.data.score / s.data.total), 0) / subjectQuizzes.length * 100
        : 40; // Default baseline

      // Card count bias (more cards = more depth)
      const deckDepth = flashcards.filter(c => 
        c.front.toLowerCase().includes(subject.toLowerCase()) || 
        c.back.toLowerCase().includes(subject.toLowerCase())
      ).length;

      return {
        subject,
        proficiency: Math.min(100, avgScore + (deckDepth * 2)),
        fullMark: 100
      };
    });
  }, [user.academicProfile, sessions, flashcards]);

  return (
    <div className="space-y-6 sm:space-y-10">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 relative">
        <div className="w-full md:w-auto flex items-center gap-6">
          <div className="relative group hidden sm:block">
            <svg className="w-20 h-20 transform -rotate-90">
              <circle
                cx="40"
                cy="40"
                r="36"
                stroke="currentColor"
                strokeWidth="4"
                fill="transparent"
                className="text-[#D9D9C3]/30"
              />
              <motion.circle
                cx="40"
                cy="40"
                r="36"
                stroke="currentColor"
                strokeWidth="6"
                strokeDasharray={226}
                initial={{ strokeDashoffset: 226 }}
                animate={{ strokeDashoffset: 226 - (226 * (flashcards.filter(c => c.confidence >= 4).length / (flashcards.length || 1))) }}
                transition={{ duration: 1.5, ease: "easeOut" }}
                fill="transparent"
                strokeLinecap="round"
                className="text-[#5A5A40]"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <Brain className="w-6 h-6 text-[#5A5A40]" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-4 mb-2">
              <h1 className="text-3xl sm:text-4xl font-serif italic text-[#424231] tracking-tight">
                {user.academicProfile ? `${greeting}, ${user.username}` : "Academic Pulse"}
              </h1>
              <motion.div 
                whileHover={{ scale: 1.05 }}
                className="flex items-center gap-1.5 bg-[#FEFAE0] px-4 py-2 rounded-full border border-[#BC6C25]/20 shadow-sm"
              >
                <Zap className="w-4 h-4 text-[#BC6C25] fill-[#BC6C25]" />
                <span className="text-xs font-black text-[#BC6C25] tracking-tighter">14 DAY STREAK</span>
              </motion.div>
            </div>
            <p className="text-[#8C8C73] font-medium text-sm sm:text-base">
              {user.academicProfile 
                ? `Ready for a focus session in your optimal window: ${user.academicProfile.optimalTimeSuggestion}?`
                : "Your neural pathways are strengthening. Maintain the momentum."}
            </p>
          </div>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          <div className="flex-1 md:flex-none px-4 sm:px-5 py-3 bg-white border border-[#D9D9C3] rounded-full text-[9px] sm:text-[10px] font-bold text-[#5A5A40] uppercase tracking-widest shadow-sm text-center">
            {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
          <div className="flex-1 md:flex-none px-4 sm:px-5 py-3 bg-[#5A5A40] text-white rounded-full text-[9px] sm:text-[10px] font-bold uppercase tracking-widest shadow-md text-center">
            Live Analysis
          </div>
        </div>
      </header>

      {user.academicProfile && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[#FEFAE0] p-6 sm:p-10 rounded-[32px] sm:rounded-[48px] border border-[#E9EDC9] flex flex-col md:flex-row items-center gap-6 sm:gap-10 shadow-sm"
        >
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-white rounded-2xl sm:rounded-3xl flex items-center justify-center shadow-sm shrink-0">
            <Star className="w-8 h-8 sm:w-10 sm:h-10 text-[#BC6C25]" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <h3 className="text-xl sm:text-2xl font-serif italic text-[#424231] mb-2 leading-tight">Neural Strategy</h3>
            <p className="text-[#5A5A40] font-medium leading-relaxed italic opacity-80 text-sm">{user.academicProfile.studyStrategy}</p>
          </div>
          <div className="flex flex-wrap gap-2 justify-center md:justify-end">
            {user.academicProfile.subjects.map((s, i) => (
              <span key={i} className="px-4 py-2 bg-white/60 text-[#8C8C73] text-[9px] font-bold uppercase tracking-[0.15em] rounded-full border border-white">
                {s}
              </span>
            ))}
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {stats.map((stat, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="p-6 sm:p-8 bg-white rounded-[24px] sm:rounded-[32px] shadow-sm border border-[#D9D9C3] flex flex-col gap-4 group hover:border-[#5A5A40] transition-all"
          > 
            <div className={`w-12 h-12 rounded-2xl ${stat.bg} flex items-center justify-center transition-transform group-hover:scale-110`}>
              <stat.icon className={`w-6 h-6 ${stat.color}`} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-[0.2em]">{stat.label}</p>
              <p className="text-3xl font-serif font-bold text-[#2D2D2A] mt-1">{stat.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-[#424231] flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-[#BC6C25]" /> Personalized Recommendations
            </h3>
            <p className="text-xs font-medium text-[#8C8C73] mt-1 uppercase tracking-widest italic opacity-80">AI Analysis of your growth</p>
          </div>
          <button 
            onClick={generateRecommendations}
            disabled={isGeneratingRecs}
            className="text-[10px] font-black text-[#5A5A40] uppercase tracking-widest hover:text-[#BC6C25] transition-colors flex items-center gap-2 group disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isGeneratingRecs ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
            Refresh Insights
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {errorRecs && (
            <div className="md:col-span-2 lg:col-span-3 p-6 bg-red-50 border border-red-100 rounded-3xl text-red-600 text-sm font-medium flex items-center gap-3">
              <HelpCircle className="w-5 h-5" />
              {errorRecs}
            </div>
          )}
          {isGeneratingRecs && recommendations.length === 0 ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 sm:h-48 bg-white rounded-[32px] sm:rounded-[40px] border border-[#D9D9C3] animate-pulse" />
            ))
          ) : (
            recommendations.map((rec, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.1 }}
                className="bg-white p-6 sm:p-8 rounded-[32px] sm:rounded-[40px] border border-[#D9D9C3] shadow-sm hover:border-[#BC6C25] transition-all group flex flex-col h-full"
              >
                <div className="flex justify-between items-start mb-4">
                  <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                    rec.type === 'topic' ? 'bg-[#E9EDC9] text-[#5A5A40]' : 'bg-[#FEFAE0] text-[#BC6C25]'
                  }`}>
                    {rec.type}
                  </span>
                  {rec.priority === 'high' && (
                    <div className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#EF4444] animate-pulse" />
                      <span className="text-[8px] font-black text-[#EF4444] uppercase tracking-widest">High Priority</span>
                    </div>
                  )}
                </div>
                <h4 className="text-base font-bold text-[#424231] mb-2 leading-tight">{rec.title}</h4>
                <p className="text-xs text-[#8C8C73] font-medium leading-relaxed mb-6 flex-1">{rec.content}</p>
                <div className="flex justify-end">
                  <div className="w-8 h-8 rounded-xl bg-[#F5F5F0] flex items-center justify-center group-hover:bg-[#BC6C25]/10 transition-colors">
                    {rec.type === 'topic' ? <BookOpen className="w-4 h-4 text-[#5A5A40] group-hover:text-[#BC6C25]" /> : <Cpu className="w-4 h-4 text-[#5A5A40] group-hover:text-[#BC6C25]" />}
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
        <div className="lg:col-span-8 bg-white p-6 sm:p-10 rounded-[32px] sm:rounded-[40px] border border-[#D9D9C3] shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 sm:mb-10 gap-4">
            <h3 className="text-lg sm:text-xl font-bold text-[#424231] flex items-center gap-3">
              <TrendingUp className="w-5 h-5 text-[#5A5A40]" /> Focus Velocity
            </h3>
            <span className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-wider bg-[#F5F5F0] px-4 py-1.5 rounded-full border border-[#D9D9C3]">Last 7 Cycles</span>
          </div>
          <div className="h-[250px] sm:h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EBEBE0" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#8C8C73' }}
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#8C8C73' }}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', fontSize: '12px', fontWeight: 'bold' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="hours" 
                  stroke="#5A5A40" 
                  strokeWidth={4} 
                  dot={{ r: 6, fill: '#5A5A40', strokeWidth: 2, stroke: '#fff' }} 
                  activeDot={{ r: 8, fill: '#BC6C25' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-4 bg-[#F0EDE4] p-6 sm:p-10 rounded-[32px] sm:rounded-[40px] border border-[#D9D9C3] shadow-sm flex flex-col">
          <h3 className="text-xl font-bold text-[#424231] mb-6 sm:mb-8">Concept Mastery</h3>
          <div className="flex-1 flex flex-col justify-center space-y-4 sm:space-y-6">
            {masteryData.map((item, idx) => (
              <div key={idx} className="space-y-2">
                <div className="flex justify-between items-end">
                  <span className="text-[10px] font-bold text-[#5A5A40] uppercase tracking-widest">{item.name}</span>
                  <span className="text-sm font-bold text-[#424231]">{item.value} cards</span>
                </div>
                <div className="w-full h-3 bg-white rounded-full overflow-hidden border border-[#D9D9C3]">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${(item.value / (flashcards.length || 1)) * 100}%` }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: item.fill }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 pt-8 border-t border-[#D9D9C3] flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-tighter">Total Knowledge</p>
              <p className="text-2xl font-serif italic text-[#424231]">{flashcards.length} Cards</p>
            </div>
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm border border-[#D9D9C3]">
              <Brain className="w-6 h-6 text-[#5A5A40]" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
        <div className="bg-white p-6 sm:p-10 rounded-[32px] sm:rounded-[40px] border border-[#D9D9C3] shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-lg sm:text-xl font-bold text-[#424231] flex items-center gap-3">
              <Award className="w-5 h-5 text-[#BC6C25]" /> Quiz Proficiency
            </h3>
            <span className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-wider bg-[#F5F5F0] px-4 py-1.5 rounded-full border border-[#D9D9C3]">Recent Quizzes</span>
          </div>
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={quizTrendData}>
                <defs>
                  <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#BC6C25" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#BC6C25" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F0F0F0" />
                <XAxis hide dataKey="idx" />
                <YAxis domain={[0, 100]} hide />
                <Tooltip 
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-white p-3 border border-[#D9D9C3] rounded-2xl shadow-xl">
                          <p className="text-xs font-bold text-[#5A5A40] uppercase tracking-widest mb-1">{payload[0].payload.topic}</p>
                          <p className="text-sm font-serif italic text-[#BC6C25]">{payload[0].value}% Score</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area type="monotone" dataKey="score" stroke="#BC6C25" strokeWidth={3} fillOpacity={1} fill="url(#colorScore)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 sm:p-10 rounded-[32px] sm:rounded-[40px] border border-[#D9D9C3] shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-lg sm:text-xl font-bold text-[#424231] flex items-center gap-3">
              <Brain className="w-5 h-5 text-[#5A5A40]" /> Retention Spectrum
            </h3>
            <span className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-wider bg-[#F5F5F0] px-4 py-1.5 rounded-full border border-[#D9D9C3]">Card confidence</span>
          </div>
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={confidenceDistribution}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F0F0F0" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 9, fontWeight: 700, fill: '#8C8C73' }}
                />
                <YAxis hide />
                <Tooltip 
                  cursor={{ fill: '#F5F5F0' }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {confidenceDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 sm:p-10 rounded-[32px] sm:rounded-[40px] border border-[#D9D9C3] shadow-sm">
        <div className="flex flex-col lg:flex-row gap-10 items-center">
          <div className="flex-1 space-y-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-[#BC6C25]/10 rounded-lg flex items-center justify-center">
                  <Compass className="w-5 h-5 text-[#BC6C25]" />
                </div>
                <h3 className="text-xl font-bold text-[#424231]">Neural Mastery Map</h3>
              </div>
              <p className="text-[#8C8C73] font-medium leading-relaxed">
                This radar visualization correlates your quiz scores with deck depth across your target subjects. 
                Identify cognitive gaps and balance your intellectual portfolio.
              </p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              {masteryMapData.map((m, i) => (
                <div key={i} className="p-4 bg-[#F5F5F0] rounded-2xl border border-[#D9D9C3]">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#8C8C73] block mb-1">{m.subject}</span>
                  <div className="flex items-end gap-2">
                    <span className="text-xl font-serif italic text-[#424231]">{Math.round(m.proficiency)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="w-full lg:w-[400px] h-[350px]">
             <ResponsiveContainer width="100%" height="100%">
               <RadarChart cx="50%" cy="50%" outerRadius="80%" data={masteryMapData}>
                 <PolarGrid stroke="#EBEBE0" strokeDasharray="3 3" />
                 <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fontWeight: 800, fill: '#5A5A40' }} />
                 <PolarRadiusAxis angle={30} domain={[0, 100]} hide />
                 <Radar
                   name="Mastery"
                   dataKey="proficiency"
                   stroke="#5A5A40"
                   strokeWidth={3}
                   fill="#5A5A40"
                   fillOpacity={0.15}
                 />
                 <Tooltip 
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }}
                 />
               </RadarChart>
             </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Weekly Study Plan */}
      <div className="bg-white p-10 rounded-[48px] border border-[#D9D9C3] shadow-sm">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
          <div>
            <h3 className="text-xl font-bold text-[#424231] flex items-center gap-3">
              <Calendar className="w-5 h-5 text-[#BC6C25]" /> Weekly Strategic Plan
            </h3>
            <p className="text-xs font-medium text-[#8C8C73] mt-1 uppercase tracking-widest italic opacity-80">AI-Synthesized Schedule</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={generateWeeklyPlan}
              disabled={isGeneratingPlan}
              className="px-8 py-3 bg-[#D9D9C3] text-[#5A5A40] rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-[#D4D4B8] transition-all shadow-sm disabled:opacity-50"
            >
              Update Plan
            </button>
            <button
              onClick={() => onNavigate('weekly')}
              className="px-8 py-3 bg-[#5A5A40] text-white rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-[#424231] transition-all shadow-md"
            >
              Full View
            </button>
          </div>
        </div>

        {studyPlan ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4">
            {studyPlan.map((day, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-[#F5F5F0] p-6 rounded-[32px] border border-[#D9D9C3] hover:border-[#BC6C25] transition-all group flex flex-col h-full"
              >
                <div className="mb-4">
                  <h4 className="text-[10px] font-black text-[#BC6C25] uppercase tracking-widest pb-1 border-b border-[#D9D9C3] group-hover:border-[#BC6C25]/30 transition-colors inline-block">{day.day}</h4>
                  {day.focus && (
                    <p className="text-[9px] font-bold text-[#8C8C73] mt-2 leading-tight uppercase tracking-tighter opacity-70 group-hover:opacity-100 transition-opacity min-h-[2em]">
                      {day.focus}
                    </p>
                  )}
                </div>
                
                <div className="space-y-4 flex-1">
                  {day.goals.map((goal, j) => (
                    <div key={j} className="flex gap-3 items-start p-2 rounded-xl hover:bg-white/50 transition-colors">
                      <div className="w-4 h-4 bg-white border border-[#D9D9C3] rounded-md flex items-center justify-center shrink-0 mt-0.5 group-hover:border-[#BC6C25]">
                        <div className="w-1.5 h-1.5 bg-[#5A5A40] rounded-sm opacity-0 group-hover:opacity-10 transition-opacity" />
                      </div>
                      <p className="text-[11px] font-medium text-[#5A5A40] leading-snug">{goal}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="py-16 text-center border-2 border-dashed border-[#D9D9C3] rounded-[40px]">
            <p className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-[0.2em] mb-4">No active plan synthesized</p>
            <p className="text-[#5A5A40] font-medium text-sm italic opacity-60 px-6">Click synthesize to generate a personalized blueprint based on your recent activity and mastery levels.</p>
          </div>
        )}
      </div>

      <div className="bg-[#EBEBE0] p-12 rounded-[48px] border border-[#D9D9C3] relative overflow-hidden group">
        <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="w-12 h-12 bg-[#5A5A40] rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-[#5A5A40]/30">
              <Star className="text-white w-6 h-6" />
            </div>
            <h3 className="text-3xl font-serif italic text-[#424231] mb-4">The Scholar's Path</h3>
            <p className="text-[#5A5A40]/80 mb-8 font-medium leading-relaxed">Unlock advanced cognitive mapping. Visualize your learning velocity with intricate neural charts and adaptive session planning.</p>
            <button className="px-10 py-4 bg-[#BC6C25] text-white rounded-full font-bold hover:bg-[#A65E1F] transition-all shadow-md text-[10px] uppercase tracking-[0.2em]">
              Explore Mastery Map
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Sessions', value: sessions.length, icon: Clock },
              { label: 'Mastery', value: `${((flashcards.filter(c => c.confidence === 5).length / (flashcards.length || 1)) * 100).toFixed(0)}%`, icon: Award },
            ].map((box, i) => (
              <div key={i} className="bg-white/80 backdrop-blur-sm p-8 rounded-[32px] border border-[#D9D9C3] text-center shadow-sm">
                <box.icon className="w-8 h-8 text-[#BC6C25] mx-auto mb-4" />
                <p className="text-2xl font-serif font-bold text-[#424231]">{box.value}</p>
                <p className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-widest mt-1">{box.label}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#BC6C25]/5 rounded-full blur-[100px] -mr-48 -mt-48 transition-transform group-hover:scale-110" />
      </div>

      {/* Recent Session Insights */}
      <div className="space-y-6">
        <div className="flex items-center justify-between px-6">
          <h3 className="text-xl font-bold text-[#424231] flex items-center gap-3">
            <Cpu className="w-5 h-5 text-[#5A5A40]" /> Neural Insights
          </h3>
          <span className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-[0.2em]">Activity Log</span>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {sessions.slice(0, 4).map((session, i) => (
            <motion.div
              key={session.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.1 }}
              className="bg-white p-8 rounded-[32px] border border-[#D9D9C3] shadow-sm flex flex-col gap-4 relative overflow-hidden"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${
                    session.type === 'timer' ? 'bg-[#FEFAE0] text-[#BC6C25]' : 
                    session.type === 'flashcards' ? 'bg-[#E9EDC9] text-[#5A5A40]' : 
                    'bg-[#CCD5AE] text-[#424231]'
                  }`}>
                    {session.type === 'timer' ? <Timer className="w-4 h-4" /> : 
                     session.type === 'flashcards' ? <Brain className="w-4 h-4" /> : 
                     <BookOpen className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-[#5A5A40] uppercase tracking-widest">{session.type}</p>
                    <p className="text-[10px] font-bold text-[#8C8C73] uppercase opacity-60">
                      {new Date(session.timestamp).toLocaleDateString()} • {Math.round(session.duration / 60)}m
                    </p>
                  </div>
                </div>
                {session.aiSummary && <div className="p-1.5 bg-[#5A5A40] text-white rounded-md"><Bot className="w-3 h-3" /></div>}
              </div>

              <div className="relative">
                {session.aiSummary ? (
                  <p className="text-sm text-[#424231] font-medium leading-relaxed italic border-l-2 border-[#BC6C25]/30 pl-4 py-1">
                    "{session.aiSummary}"
                  </p>
                ) : (
                  <div className="flex items-center gap-3 py-2">
                    <div className="w-2 h-2 bg-[#D9D9C3] rounded-full animate-pulse" />
                    <p className="text-[11px] font-bold text-[#D9D9C3] uppercase tracking-widest">Synthesizing insight...</p>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
          {sessions.length === 0 && (
            <div className="md:col-span-2 py-12 text-center bg-white/50 border-2 border-dashed border-[#D9D9C3] rounded-[48px]">
              <p className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-widest">Your Neural Log is Empty</p>
              <p className="text-sm text-[#5A5A40] mt-2 italic">Begin a session to generate AI-powered performance insights.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const WarmOnboarding = ({ 
  user, 
  onComplete 
}: { 
  user: UserProfile, 
  onComplete: (profile: AcademicProfile) => void 
}) => {
  const [step, setStep] = useState(0);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [newSubject, setNewSubject] = useState('');
  const [routine, setRoutine] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [suggestion, setSuggestion] = useState<{ strategy: string, time: string } | null>(null);

  const steps = [
    {
      title: `Welcome, ${user.username}`,
      subtitle: "Let's personalize your cognitive sanctuary. What subjects are you currently mastering?",
      content: (
        <div className="space-y-6">
          <div className="flex gap-2">
            <input 
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              placeholder="e.g. Astrophysics, Medieval History..."
              className="flex-1 p-5 rounded-[24px] bg-[#F5F5F0] border border-[#D9D9C3] focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/30 text-sm font-semibold"
              onKeyPress={(e) => e.key === 'Enter' && (newSubject.trim() && (setSubjects([...subjects, newSubject.trim()]), setNewSubject('')))}
            />
            <button 
              onClick={() => { if(newSubject.trim()) { setSubjects([...subjects, newSubject.trim()]); setNewSubject(''); } }}
              className="p-5 bg-[#5A5A40] text-white rounded-[24px] hover:bg-[#424231] transition-all"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {subjects.map((s, i) => (
              <motion.span 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                key={i} 
                className="px-4 py-2 bg-[#E9EDC9] text-[#5A5A40] rounded-full text-[10px] font-bold uppercase tracking-widest border border-[#D9D9C3] flex items-center gap-2"
              >
                {s}
                <button onClick={() => setSubjects(subjects.filter((_, idx) => idx !== i))}><X className="w-3 h-3" /></button>
              </motion.span>
            ))}
          </div>
        </div>
      )
    },
    {
      title: "Your Biological Rhythm",
      subtitle: "Describe your typical daily schedule (when you wake up, work, or feel most alert).",
      content: (
        <textarea 
          value={routine}
          onChange={(e) => setRoutine(e.target.value)}
          placeholder="I wake up at 7 AM, work until 4 PM, and usually feel a boost of energy around 8 PM..."
          className="w-full h-40 p-6 rounded-[32px] bg-[#F5F5F0] border border-[#D9D9C3] focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/30 text-sm font-medium resize-none shadow-inner"
        />
      )
    },
    {
      title: "Architecting Your Success",
      subtitle: "Our AI is analyzing your patterns to find your optimal study window.",
      content: (
        <div className="flex flex-col items-center justify-center py-10 min-h-[300px]">
          {isGenerating ? (
            <div className="flex flex-col items-center gap-6">
              <div className="relative">
                <div className="w-20 h-20 border-4 border-[#F5F5F0] border-t-[#5A5A40] rounded-full animate-spin" />
                <Brain className="absolute inset-0 m-auto w-8 h-8 text-[#5A5A40]" />
              </div>
              <p className="text-[10px] font-bold text-[#8C8C73] uppercase tracking-[0.3em] animate-pulse text-center">Synthesizing Neural Schedule...</p>
            </div>
          ) : suggestion ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-[#FEFAE0] p-8 rounded-[40px] border border-[#E9EDC9] space-y-6 w-full"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm border border-[#E9EDC9]">
                  <Clock className="w-6 h-6 text-[#BC6C25]" />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-[#B08968] uppercase tracking-widest">Optimal Window</p>
                  <p className="text-xl font-serif italic text-[#424231]">{suggestion.time}</p>
                </div>
              </div>
              <div className="p-6 bg-white/60 rounded-3xl border border-white">
                <p className="text-[10px] font-bold text-[#BC6C25] uppercase tracking-widest mb-2">Study Strategy</p>
                <p className="text-sm text-[#5A5A40] leading-relaxed font-medium">{suggestion.strategy}</p>
              </div>
            </motion.div>
          ) : null}
        </div>
      )
    }
  ];

  const handleNext = async () => {
    if (step < steps.length - 1) {
      if (step === 1) {
        setIsGenerating(true);
        setStep(step + 1);
        const prompt = `Based on these details, suggest an optimal 2-hour daily study window (as a range) and a one-sentence strategic insight:
        Subjects: ${subjects.join(', ')}
        Routine: ${routine}
        
        Format: { "time": "...", "strategy": "..." }`;
        try {
          const data = await callGemini(prompt);
          setSuggestion(data);
        } catch (error) {
          console.error(error);
          setSuggestion({ time: "8:00 PM - 10:00 PM", strategy: "Focus on your hardest subjects when your house is quietest. Keep sessions short with clear breaks." });
        } finally {
          setIsGenerating(false);
        }
      } else {
        setStep(step + 1);
      }
    } else {
      onComplete({
        subjects,
        dailyRoutine: routine,
        studyStrategy: suggestion?.strategy || "",
        optimalTimeSuggestion: suggestion?.time || ""
      });
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <motion.div 
        key={step}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl w-full bg-white p-12 rounded-[56px] shadow-sm border border-[#D9D9C3] relative overflow-hidden"
      >
        <div className="relative z-10">
          <div className="flex flex-col md:flex-row justify-between items-start mb-12 gap-6">
            <div className="flex-1">
              <h2 className="text-4xl font-serif italic text-[#424231] mb-2">{steps[step].title}</h2>
              <p className="text-[#8C8C73] font-medium leading-relaxed">{steps[step].subtitle}</p>
            </div>
            <div className="flex gap-1.5 pt-4">
              {steps.map((_, i) => (
                <div key={i} className={`h-1.5 rounded-full transition-all duration-700 ${i <= step ? 'w-10 bg-[#BC6C25]' : 'w-3 bg-[#F5F5F0]'}`} />
              ))}
            </div>
          </div>

          <div className="mb-12">
            {steps[step].content}
          </div>

          <div className="flex justify-between items-center">
            <button 
              onClick={() => step > 0 && setStep(step - 1)}
              className={`text-[10px] font-bold uppercase tracking-[0.2em] transition-opacity ${step === 0 || isGenerating ? 'opacity-0 pointer-events-none' : 'text-[#8C8C73] hover:text-[#5A5A40]'}`}
            >
              Backtrack
            </button>
            <button 
              disabled={isGenerating || (step === 0 && subjects.length === 0) || (step === 1 && !routine)}
              onClick={handleNext}
              className="px-12 py-5 bg-[#5A5A40] text-white rounded-full font-bold hover:bg-[#424231] transition-all shadow-xl shadow-[#5A5A40]/20 text-[10px] uppercase tracking-[0.3em] flex items-center gap-3 disabled:opacity-50 disabled:shadow-none"
            >
              {step === steps.length - 1 ? 'Begin Journey' : 'Continue'}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-[#F5F5F0] rounded-full blur-3xl opacity-50" />
      </motion.div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(getStorage<UserProfile | null>(STORAGE_KEYS.USER, null));
  const [flashcards, setFlashcards] = useState<Flashcard[]>(getStorage<Flashcard[]>(STORAGE_KEYS.CARDS, [
    { id: '1', front: 'Mitochondria', back: 'The powerhouse of the cell', confidence: 0 },
    { id: '2', front: 'Osmosis', back: 'Spontaneous net movement of solvent molecules through a selectively permeable membrane', confidence: 0 }
  ]));
  const [sessions, setSessions] = useState<StudySession[]>(getStorage<StudySession[]>(STORAGE_KEYS.SESSIONS, []));
  const [studyPlan, setStudyPlan] = useState<{ day: string, goals: string[], focus?: string }[] | null>(getStorage(STORAGE_KEYS.PLAN, null));
  const [dailyFocus, setDailyFocus] = useState<string>(getStorage('studybuddy_daily_focus', ''));
  
  const [activeView, setActiveView] = useState<View>(currentUser ? 'dashboard' : 'auth');
  const [recommendations, setRecommendations] = useState<{ title: string, content: string, type: 'topic' | 'technique', priority: 'high' | 'medium' }[]>([]);
  const [isGeneratingRecs, setIsGeneratingRecs] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Persistence effects
  useEffect(() => {
    const loadServerData = async () => {
      try {
        // First try Firestore if we have a user
        if (currentUser?.uid) {
          const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
          if (userDoc.exists()) {
            const cloudData = userDoc.data();
            
            // Sync user profile fields if they exist in cloud
            if (cloudData.username || cloudData.academicProfile) {
              setCurrentUser(prev => {
                if (!prev) return prev;
                return {
                  ...prev,
                  username: cloudData.username || prev.username,
                  avatar: cloudData.avatar || prev.avatar,
                  academicProfile: cloudData.academicProfile || prev.academicProfile
                };
              });
            }

            if (cloudData.flashcards) setFlashcards(cloudData.flashcards);
            if (cloudData.sessions) setSessions(cloudData.sessions);
            if (cloudData.studyPlan) setStudyPlan(cloudData.studyPlan);
            if (cloudData.dailyFocus) setDailyFocus(cloudData.dailyFocus);
            return; // Prefer cloud data
          }
        }

        // Fallback to local server API
        const healthRes = await fetch('/api/health').catch(() => null);
        if (healthRes?.ok) {
          const dbRes = await fetch('/api/db');
          const dbData = await dbRes.json();
          
          if (dbData.user && !currentUser) setCurrentUser(dbData.user);
          if (dbData.flashcards?.length > 0 && flashcards.length <= 2) setFlashcards(dbData.flashcards);
          if (dbData.sessions?.length > 0 && sessions.length === 0) setSessions(dbData.sessions);
          if (dbData.studyPlan && !studyPlan) setStudyPlan(dbData.studyPlan);
          if (dbData.dailyFocus && !dailyFocus) setDailyFocus(dbData.dailyFocus);
        }
      } catch (err) {
        console.warn('Sync initialization delayed:', err);
      }
    };
    loadServerData();
  }, [currentUser?.uid]);

  // Redirect logic
  useEffect(() => {
    if (!currentUser && activeView !== 'auth') {
      setActiveView('auth');
    } else if (currentUser && activeView === 'auth') {
      setActiveView('dashboard');
    } else if (currentUser?.academicProfile && activeView === 'onboarding') {
      setActiveView('dashboard');
    }
  }, [currentUser, activeView]);

  // Persistence logic
  useEffect(() => {
    const saveData = async () => {
      setIsSyncing(true);
      try {
        // Save to Firestore if connected
        if (currentUser?.uid) {
          await setDoc(doc(db, 'users', currentUser.uid), {
            username: currentUser.username,
            avatar: currentUser.avatar,
            academicProfile: currentUser.academicProfile,
            flashcards,
            sessions,
            studyPlan,
            dailyFocus,
            lastSync: Date.now()
          }, { merge: true });
        }

        // Always attempt fallback local server sync
        await fetch('/api/db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user: currentUser,
            flashcards,
            sessions,
            studyPlan,
            dailyFocus
          })
        });
      } catch (err) {
        console.warn('Sync point reached offline:', err);
      } finally {
        setTimeout(() => setIsSyncing(false), 1000);
      }
    };

    const timer = setTimeout(() => {
      if (currentUser) saveData();
    }, 5000); // 5s debounce for cloud sync

    setStorage(STORAGE_KEYS.USER, currentUser);
    setStorage(STORAGE_KEYS.CARDS, flashcards);
    setStorage(STORAGE_KEYS.SESSIONS, sessions);
    setStorage(STORAGE_KEYS.PLAN, studyPlan);
    setStorage('studybuddy_daily_focus', dailyFocus);

    return () => clearTimeout(timer);
  }, [currentUser, flashcards, sessions, studyPlan, dailyFocus]);

  const logSession = async (type: StudySession['type'], duration: number, data?: any) => {
    const sessionId = Date.now().toString();
    const newSession: StudySession = {
      id: sessionId,
      type,
      duration,
      timestamp: Date.now(),
      data
    };
    
    setSessions(prev => [newSession, ...prev]);

    // Async generation of AI summary
    try {
      const prompt = `As a supportive study tutor, provide a very brief (max 2 sentences) encouraging insight based on this session:
      Session Type: ${type}
      Duration: ${Math.round(duration / 60)} minutes
      Data: ${JSON.stringify(data)}
      
      Focus on growth and motivation. Keep it conversational and personal.`;

      const summary = await callGemini(prompt, "gemini-3-flash-preview", false);
      
      if (summary) {
        setSessions(prev => prev.map(s => 
          s.id === sessionId ? { ...s, aiSummary: summary } : s
        ));
      }
    } catch (error) {
      console.error('Failed to generate AI summary:', error);
    }
  };

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'tutor', label: 'AI Tutor', icon: MessageSquare },
    { id: 'flashcards', label: 'Flashcards', icon: Brain },
    { id: 'quizzes', label: 'Quizzes', icon: BookOpen },
    { id: 'weekly', label: 'Weekly Plan', icon: Calendar },
    { id: 'about', label: 'About', icon: Info },
    { id: 'timer', label: 'Study Timer', icon: Timer },
  ] as const;

  const dashboardStats = useMemo(() => {
    const totalSeconds = sessions.reduce((acc, s) => acc + s.duration, 0);
    const hours = (totalSeconds / 3600).toFixed(1);
    const masteredCount = flashcards.filter(c => c.confidence === 5).length;
    const streak = 14; // Mocked for now, but could be calculated
    
    return [
      { label: 'Study Hours', value: hours, icon: Clock, color: 'text-[#5A5A40]', bg: 'bg-[#E9EDC9]' },
      { label: 'Cards Mastered', value: masteredCount, icon: Brain, color: 'text-[#B08968]', bg: 'bg-[#FEFAE0]' },
      { label: 'Sessions Keyed', value: sessions.length, icon: CheckCircle2, color: 'text-[#5A5A40]', bg: 'bg-[#D9D9C3]' },
      { label: 'Days Active', value: streak, icon: Calendar, color: 'text-[#BC6C25]', bg: 'bg-[#F0EDE4]' },
    ];
  }, [sessions, flashcards]);

  const handleLogin = (user: UserProfile) => {
    setCurrentUser(user);
    if (!user.academicProfile) {
      setActiveView('onboarding');
    } else {
      setActiveView('dashboard');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setFlashcards([
      { id: '1', front: 'Mitochondria', back: 'The powerhouse of the cell', confidence: 0 },
      { id: '2', front: 'Osmosis', back: 'Spontaneous net movement of solvent molecules through a selectively permeable membrane', confidence: 0 }
    ]);
    setSessions([]);
    setStudyPlan(null);
    setDailyFocus('');
    setActiveView('auth');
    localStorage.removeItem(STORAGE_KEYS.USER);
    localStorage.removeItem(STORAGE_KEYS.CARDS);
    localStorage.removeItem(STORAGE_KEYS.SESSIONS);
    localStorage.removeItem(STORAGE_KEYS.PLAN);
    localStorage.removeItem('studybuddy_daily_focus');
  };

  const renderView = () => {
    switch (activeView) {
      case 'auth': return <AuthView onLogin={handleLogin} />;
      case 'onboarding': return currentUser ? <WarmOnboarding user={currentUser} onComplete={(profile) => {
          const updatedUser = { ...currentUser, academicProfile: profile };
          setCurrentUser(updatedUser);
          setActiveView('dashboard');
        }} /> : <AuthView onLogin={handleLogin} />;
      case 'dashboard': return currentUser ? <DashboardView 
        user={currentUser} 
        stats={dashboardStats} 
        sessions={sessions} 
        flashcards={flashcards} 
        studyPlan={studyPlan} 
        setStudyPlan={setStudyPlan} 
        onNavigate={setActiveView}
        recommendations={recommendations}
        setRecommendations={setRecommendations}
        isGeneratingRecs={isGeneratingRecs}
        setIsGeneratingRecs={setIsGeneratingRecs}
      /> : null;
      case 'weekly': return currentUser ? <WeeklyPlanView 
        user={currentUser} 
        sessions={sessions} 
        flashcards={flashcards} 
        studyPlan={studyPlan} 
        setStudyPlan={setStudyPlan} 
      /> : null;
      case 'about': return <AboutView user={currentUser} />;
      case 'tutor': return <AITutor user={currentUser!} />;
      case 'flashcards': return <FlashcardsView cards={flashcards} setCards={setFlashcards} onReviewComplete={(count) => logSession('flashcards', 300, { count })} />;
      case 'timer': return <StudyTimer onSessionComplete={(duration, type) => logSession('timer', duration, { subtype: type })} />;
      case 'quizzes': return <QuizView sessions={sessions} flashcards={flashcards} onComplete={(score, total, topic) => logSession('quiz', 600, { score, total, topic })} onNavigate={setActiveView} />;
      case 'profile': return currentUser ? <ProfileView user={currentUser} onUpdate={setCurrentUser} onLogout={handleLogout} /> : <AuthView onLogin={handleLogin} />;
      default: return currentUser ? <DashboardView 
        user={currentUser} 
        stats={dashboardStats} 
        sessions={sessions} 
        flashcards={flashcards} 
        studyPlan={studyPlan} 
        setStudyPlan={setStudyPlan} 
        onNavigate={setActiveView}
        recommendations={recommendations}
        setRecommendations={setRecommendations}
        isGeneratingRecs={isGeneratingRecs}
        setIsGeneratingRecs={setIsGeneratingRecs}
      /> : null;
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F0] flex font-sans text-[#2D2D2A]">
      {/* Mobile Toggle */}
      <button 
        onClick={() => setIsSidebarOpen(true)}
        className="lg:hidden fixed top-4 left-4 p-2 bg-white shadow-md rounded-lg z-40 border border-[#D9D9C3]"
      >
        <Menu className="w-6 h-6 text-[#5A5A40]" />
      </button>

      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/10 backdrop-blur-[2px] z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-72 bg-[#EBEBE0] border-r border-[#D9D9C3] lg:static lg:block transition-transform duration-300
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex flex-col h-full">
          <div className="p-10 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#5A5A40] rounded-xl flex items-center justify-center shadow-lg shadow-[#5A5A40]/20">
                  <Brain className="text-white w-5 h-5" />
                </div>
                <span className="text-xl font-bold tracking-tight text-[#424231] font-serif italic">StudyBuddy</span>
              </div>
              <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2 text-[#8C8C73]">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex items-center gap-1.5 ml-13">
              <div className={`w-1.5 h-1.5 rounded-full ${isSyncing ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
              <span className="text-[8px] font-black uppercase tracking-[0.2em] text-[#8C8C73]">
                {isSyncing ? 'Syncing...' : 'Encrypted Sync'}
              </span>
            </div>
          </div>

          {currentUser && (
            <div className="mx-6 mb-8 p-5 bg-[#BC6C25]/5 rounded-[24px] border border-[#BC6C25]/10 group hover:bg-[#BC6C25]/10 transition-colors">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 bg-[#BC6C25]/10 rounded-lg flex items-center justify-center">
                  <Flame className="w-3.5 h-3.5 text-[#BC6C25]" />
                </div>
                <p className="text-[9px] font-black text-[#BC6C25] uppercase tracking-widest leading-none">Neural Scratchpad</p>
              </div>
              <textarea 
                value={dailyFocus} 
                onChange={(e) => {
                  setDailyFocus(e.target.value);
                  setStorage('studybuddy_daily_focus', e.target.value);
                }}
                placeholder="Micro-goal for today?"
                className="w-full bg-transparent border-none text-[11px] font-serif italic text-[#424231] placeholder-[#BC6C25]/30 resize-none focus:ring-0 p-0 leading-relaxed"
                rows={2}
              />
            </div>
          )}

          <nav className="flex-1 px-6 space-y-2 overflow-y-auto no-scrollbar">
            {currentUser && menuItems.map(item => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveView(item.id);
                  setIsSidebarOpen(false);
                }}
                className={`
                  w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl font-bold transition-all group text-sm
                  ${activeView === item.id 
                    ? 'bg-white text-[#5A5A40] shadow-sm border border-[#D9D9C3]' 
                    : 'text-[#8C8C73] hover:text-[#5A5A40] hover:bg-white/50'}
                `}
              >
                <item.icon className={`w-5 h-5 transition-transform group-hover:scale-110 ${activeView === item.id ? 'text-[#5A5A40]' : 'text-[#8C8C73]'}`} />
                {item.label}
              </button>
            ))}
            {!currentUser && (
               <button
                 onClick={() => {
                   setActiveView('auth');
                   setIsSidebarOpen(false);
                 }}
                 className={`
                   w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl font-bold transition-all group text-sm
                   ${activeView === 'auth' 
                     ? 'bg-white text-[#5A5A40] shadow-sm border border-[#D9D9C3]' 
                     : 'text-[#8C8C73] hover:text-[#5A5A40] hover:bg-white/50'}
                 `}
               >
                 <User className={`w-5 h-5 transition-transform group-hover:scale-110 ${activeView === 'auth' ? 'text-[#5A5A40]' : 'text-[#8C8C73]'}`} />
                 Identity Sync
               </button>
            )}
          </nav>

          {currentUser && (
            <div className="p-8">
              <div 
                onClick={() => setActiveView('profile')}
                className={`bg-[#D9D9C3] rounded-[24px] p-5 flex items-center gap-3 cursor-pointer hover:bg-[#D4D4B8] transition-colors ${activeView === 'profile' ? 'ring-2 ring-[#5A5A40]/30' : ''}`}
              >
                <div className="w-10 h-10 rounded-full bg-[#BC6C25] border-2 border-white shadow-sm flex items-center justify-center overflow-hidden">
                  <img src={currentUser.avatar} alt="User Avatar" className="w-full h-full object-cover" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#424231] truncate">{currentUser.username}</p>
                  <p className="text-[10px] text-[#5A5A40] font-bold uppercase tracking-tight opacity-70">Scholar</p>
                </div>
                <ChevronRight className="w-3 h-3 text-[#5A5A40] ml-auto shrink-0" />
              </div>
            </div>
          )}
          
          <div className="px-8 pb-8 pt-2 mt-auto border-t border-[#D9D9C3]/30">
            <p className="text-[10px] font-black text-[#8C8C73] uppercase tracking-[0.3em] text-center opacity-60">
              Made with <span className="text-red-500">♥</span> for Curiosity
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
        <div className="p-6 lg:p-12 flex-1 overflow-y-auto no-scrollbar scroll-smooth">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="max-w-7xl mx-auto h-full"
            >
              {renderView()}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Global CSS Overrides */}
      <style>{`
        .preserve-3d { transform-style: preserve-3d; }
        .backface-hidden { backface-visibility: hidden; }
        .perspective-1000 { perspective: 1000px; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
