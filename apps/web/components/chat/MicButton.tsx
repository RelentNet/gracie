'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';

import { TYPE } from '@/lib/typography';

/**
 * Voice-to-text mic for the Assistant composer. Uses the browser Web Speech API
 * (`SpeechRecognition` / `webkitSpeechRecognition`) entirely client-side — the
 * recognized text is handed back via `onTranscript` and inserted into the input
 * box. NO audio is uploaded, so there's no server change and no edge body-size
 * concern. Browsers without support render a disabled button with a tooltip.
 */

// The Web Speech API isn't in TS's lib.dom, so declare the minimal shape we touch.
interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
interface SpeechResultEventLike {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechResultLike>;
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
type RecognitionCtor = new () => RecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function MicButton({
  onTranscript,
  disabled,
}: {
  /** Called with each finalized utterance; the composer appends it to the input. */
  readonly onTranscript: (text: string) => void;
  readonly disabled: boolean;
}): React.JSX.Element {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<RecognitionLike | null>(null);

  // Feature-detect on the client (window is undefined during SSR) and stop any
  // in-flight recognition on unmount.
  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
    return (): void => recognitionRef.current?.stop();
  }, []);

  function toggle(): void {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = getRecognitionCtor();
    if (Ctor === null) return;

    const recognition = new Ctor();
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event): void => {
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result !== undefined && result.isFinal) finalText += result[0].transcript;
      }
      const trimmed = finalText.trim();
      if (trimmed !== '') onTranscript(trimmed);
    };
    recognition.onend = (): void => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognition.onerror = (): void => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  if (!supported) {
    return (
      <button
        type="button"
        disabled
        aria-label="Voice input is not supported in this browser"
        title="Voice input isn't supported in this browser"
        className="rounded-lg border p-3"
        style={{
          borderColor: 'var(--border-subtle)',
          color: 'var(--text-secondary)',
          opacity: 0.5,
          cursor: 'not-allowed',
        }}
      >
        <Mic aria-hidden="true" size={18} />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label={listening ? 'Stop voice input' : 'Start voice input'}
        aria-pressed={listening}
        title={listening ? 'Listening… click to stop' : 'Voice input'}
        className={`rounded-lg border p-3 transition-colors ${listening ? 'animate-pulse' : ''}`}
        style={{
          borderColor: listening ? 'var(--color-red-500)' : 'var(--border-subtle)',
          color: disabled
            ? 'var(--text-secondary)'
            : listening
              ? 'var(--color-red-500)'
              : 'var(--text-primary)',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <Mic aria-hidden="true" size={18} />
      </button>
      {listening ? (
        <span role="status" aria-live="polite" style={{ ...TYPE.secondary, color: 'var(--color-red-500)' }}>
          Listening…
        </span>
      ) : null}
    </div>
  );
}
