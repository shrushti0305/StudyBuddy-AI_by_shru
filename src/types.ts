export type View = 'dashboard' | 'tutor' | 'flashcards' | 'quizzes' | 'timer' | 'auth' | 'profile' | 'onboarding' | 'weekly' | 'about';

export interface AcademicProfile {
  subjects: string[];
  dailyRoutine: string;
  studyStrategy?: string;
  optimalTimeSuggestion?: string;
}

export interface UserProfile {
  uid: string;
  username: string;
  email: string;
  avatar: string;
  bio?: string;
  joinedAt: number;
  academicProfile?: AcademicProfile;
}

export interface ReviewEntry {
  timestamp: number;
  confidence: number;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  confidence: number; // 0-5
  lastReviewed?: number;
  history?: ReviewEntry[];
}

export interface StudySession {
  id: string;
  type: 'timer' | 'flashcards' | 'quiz';
  duration: number; // in seconds
  timestamp: number;
  data?: any; // Score, card count, etc.
  aiSummary?: string;
}

export interface Message {
  role: 'user' | 'bot';
  text: string;
  timestamp: Date;
  suggestions?: { label: string; type: 'question' | 'topic' | 'practical' }[];
}

export interface QuizQuestion {
  id: string;
  question: string;
  options?: string[]; // Only for multiple choice
  answer: string | boolean;
  explanation: string;
  type: 'multiple-choice' | 'true-false';
}

export interface Quiz {
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  questions: QuizQuestion[];
}

export interface QuizResult {
  score: number;
  total: number;
  timeSpent: number;
}

export interface TimerSettings {
  work: number;
  shortBreak: number;
  longBreak: number;
}
