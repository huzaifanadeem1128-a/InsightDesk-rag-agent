import { useEffect, useRef, useState } from "react";
import { streamChat, transcribeAudio, extractImageText, getSuggestions } from "../api";
import { useChatsStore, useDocsStore, useStreamStore, useVoiceStore, useUIStore } from "../store";
import type { Message } from "../types";
import { TraceView } from "./TraceView";
import {
  expandAcronymsForSpeech,
  isErrorContent,
  renderMarkdown,
  stripMarkdown,
  formatRelativeTime,
  formatExactTime,
  escapeHtml,
} from "../lib/utils";
import {
  groupVoices,
  speak,
  stopSpeaking,
  splitIntoSentences,
} from "../lib/voice";
import { togglePinMessage } from "../api";

async function generateThumbnail(file: File, maxWidth = 1200, maxHeight = 1200): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let w = img.width;
        let h = img.height;

        if (w > maxWidth) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        }
        if (h > maxHeight) {
          w = Math.round((w * maxHeight) / h);
          h = maxHeight;
        }

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas not supported"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = () => reject(new Error("Could not load image"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export function ChatArea() {
  const {
    messages,
    chatTitle,
    currentChatId,
    currentChatArchived,
    setMessages,
  } = useChatsStore();
  const { selectedDocumentIds } = useDocsStore();
  const { toggleSidebar } = useUIStore();
  const { streaming, startStream, endStream, abort } = useStreamStore();
  const { selectedVoiceURI, voiceRate, currentlySpeakingId, setCurrentlySpeaking, setLastSpoken, setVoice, setRate } = useVoiceStore();
    // ----- Sentence highlighting state -----
  const [speakingMessageIndex, setSpeakingMessageIndex] = useState<number | null>(null);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState<number>(-1);
  const [isPaused, setIsPaused] = useState(false);
  const ttsSentencesRef = useRef<string[]>([]);

  const [input, setInput] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ----- Voice input state -----
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // ----- Image input state -----
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [imageModal, setImageModal] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isExtractingImage, setIsExtractingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  // ------------------------------------------------------------
  // TITLE ANIMATION — character-by-character reveal
  // ------------------------------------------------------------

  const titleAnimationRef = useRef<Map<string, number>>(new Map());

  const animateTitleChange = (chatId: string, fullName: string) => {
    // Clear any existing animation for this chat.
    const existingInterval = titleAnimationRef.current.get(chatId);
    if (existingInterval !== undefined) {
      window.clearInterval(existingInterval);
      titleAnimationRef.current.delete(chatId);
    }

    let index = 0;
    const charsPerTick = 1;
    const tickMs = 30;

    const intervalId = window.setInterval(() => {
      index += charsPerTick;

      if (index >= fullName.length) {
        // Final update + clear interval.
        const s = useChatsStore.getState();
        const updated = s.chats.map((c) =>
          c.chat_id === chatId ? { ...c, name: fullName } : c
        );
        s.setChats(updated);

        window.clearInterval(intervalId);
        titleAnimationRef.current.delete(chatId);
        return;
      }

      const partial = fullName.slice(0, index);

      const s = useChatsStore.getState();
      const updated = s.chats.map((c) =>
        c.chat_id === chatId ? { ...c, name: partial } : c
      );
      s.setChats(updated);
    }, tickMs);

    titleAnimationRef.current.set(chatId, intervalId);
  };

  // Silence detection (VAD) refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadIntervalRef = useRef<number | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());  

  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const load = () => setVoices(speechSynthesis.getVoices());
    load();
    speechSynthesis.onvoiceschanged = load;
  }, []);

  useEffect(() => {
    return () => {
      // Clear all running title animations on unmount.
      titleAnimationRef.current.forEach((intervalId) => {
        window.clearInterval(intervalId);
      });
      titleAnimationRef.current.clear();
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Clear the input field when switching chats.
  useEffect(() => {
    setInput("");
  }, [currentChatId]);

  const handleSubmit = async (
    e?: React.FormEvent,
    overrideQuestion?: string
  ) => {
    e?.preventDefault();

    if (streaming) {
      abort();
      return;
    }

    // If an image is attached, send it (with optional text).
    if (pendingImage && currentChatId) {
      await handleSendWithImage();
      return;
    }

    const question = (overrideQuestion ?? input).trim();
    if (!question || !currentChatId) return;
    if (currentChatArchived) {
      alert("This conversation is archived. Start a new chat to continue.");
      return;
    }

    setInput("");

    // Snapshot the current messages, then add the user + placeholder.
    const store = useChatsStore.getState();
    const baseMessages = [...store.messages];

    const userMessage: Message = { role: "user", content: question };
    const placeholder: Message = {
      role: "assistant",
      content: "",
      sources: [],
      activity: [],
    };

    const placeholderIndex = baseMessages.length + 1;
    store.setMessages([...baseMessages, userMessage, placeholder]);

    let fullAnswer = "";
    let sources: Message["sources"] = [];
    let activity: Message["activity"] = [];

    // Patch a specific index — safe because we know the array hasn't
    // been touched since we set it.
    const patchIndex = (index: number, patch: Partial<Message>) => {
      const s = useChatsStore.getState();
      if (!s.messages[index]) return;
      const arr = [...s.messages];
      arr[index] = { ...arr[index], ...patch };
      s.setMessages(arr);
    };

    const handle = streamChat(
      {
        chat_id: currentChatId,
        question,
        document_ids: selectedDocumentIds.length
          ? selectedDocumentIds
          : undefined,
      },
      {
        onToken: (text) => {
          fullAnswer += text;
          patchIndex(placeholderIndex, {
            content: fullAnswer,
            sources,
            activity,
          });
        },
        onActivity: (type, message) => {
          activity = [...(activity || []), { type, message }];
          patchIndex(placeholderIndex, { activity });
        },
        onTitle: (chatId, name) => {
          animateTitleChange(chatId, name);
        },
        onSaved: async (srcs) => {
          sources = srcs;
          patchIndex(placeholderIndex, { sources });

          // Wait a moment for the backend to finish the DB write,
          // then fetch the persisted chat to grab real IDs.
          setTimeout(async () => {
            try {
              const { getChat } = await import("../api");
              const detail = await getChat(currentChatId);
              useChatsStore.getState().setMessages(detail.messages);
            } catch {
              /* ignore */
            }
          }, 400);
        },
        onError: (detail) => {
          fullAnswer = `_Error: ${detail}_`;
          patchIndex(placeholderIndex, { content: fullAnswer });
        },
        onDone: () => {
          endStream();
        },
      }
    );

    startStream(() => handle.abort());
  };


  const handlePinToggle = async (index: number) => {
    const msg = messages[index];
    if (!msg || !msg.message_id) return;

    try {
      const res = await togglePinMessage(msg.message_id);
      const copy = [...messages];
      copy[index] = { ...copy[index], pinned: res.pinned };
      setMessages(copy);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleCopy = async (index: number) => {
    const msg = messages[index];
    if (!msg) return;
    try {
      await navigator.clipboard.writeText(msg.content);
      // Small visual feedback via button state.
      const btn = document.querySelector(
        `[data-copy-index="${index}"]`
      ) as HTMLButtonElement | null;
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = "✓ Copied";
        setTimeout(() => {
          if (btn) btn.textContent = orig;
        }, 1400);
      }
    } catch {
      alert("Could not copy to clipboard.");
    }
  };

  const handleRegenerate = async (index: number) => {
    if (streaming) return;

    const msg = messages[index];
    if (!msg || msg.role !== "assistant") return;

    // Find the preceding user message.
    let questionIndex = index - 1;
    while (questionIndex >= 0 && messages[questionIndex].role !== "user") {
      questionIndex--;
    }
    if (questionIndex < 0 || !currentChatId) {
      alert("Could not find the original question.");
      return;
    }
    const question = messages[questionIndex].content;

    // Reset the assistant message to a placeholder.
    const store = useChatsStore.getState();
    const copy = [...store.messages];
    copy[index] = {
      role: "assistant",
      content: "",
      sources: [],
      activity: [],
    };
    store.setMessages(copy);

    // Reset our local trackers.
    let fullAnswer = "";
    let sources: Message["sources"] = [];
    let activity: Message["activity"] = [];

    const patchIndex = (patch: Partial<Message>) => {
      const s = useChatsStore.getState();
      if (!s.messages[index]) return;
      const arr = [...s.messages];
      arr[index] = { ...arr[index], ...patch };
      s.setMessages(arr);
    };

    const handle = streamChat(
      {
        chat_id: currentChatId,
        question,
        document_ids: selectedDocumentIds.length
          ? selectedDocumentIds
          : undefined,
        regenerate: true,
      },
      {
        onToken: (text) => {
          fullAnswer += text;
          patchIndex({ content: fullAnswer, sources, activity });
        },
        onActivity: (type, message) => {
          activity = [...(activity || []), { type, message }];
          patchIndex({ activity });
        },
        onSaved: async (srcs) => {
          sources = srcs;
          patchIndex({ sources });

          setTimeout(async () => {
            try {
              const { getChat } = await import("../api");
              const detail = await getChat(currentChatId);
              useChatsStore.getState().setMessages(detail.messages);
            } catch {
              /* ignore */
            }
          }, 400);
        },
        onError: (detail) => {
          fullAnswer = `_Error: ${detail}_`;
          patchIndex({ content: fullAnswer });
        },
        onDone: () => {
          endStream();
        },
      }
    );

    startStream(() => handle.abort());
  };

  const handleJumpToMessage = (index: number) => {
    const el = messageRefs.current.get(index);
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "center" });

    // Flash highlight for 1.5s.
    el.classList.add("flash-highlight");
    setTimeout(() => {
      el.classList.remove("flash-highlight");
    }, 1500);
  };

  const handleListen = (index: number) => {
    // If currently speaking this message, stop.
    if (currentlySpeakingId === index) {
      stopSpeaking();
      setCurrentlySpeaking(null);
      setSpeakingMessageIndex(null);
      setCurrentSentenceIndex(-1);
      setIsPaused(false);
      ttsSentencesRef.current = [];
      return;
    }

    const msg = messages[index];
    if (!msg || msg.role !== "assistant") return;

    const clean = stripMarkdown(msg.content);
    const text = expandAcronymsForSpeech(clean);
    if (!text) return;

    // Stop any existing speech first.
    stopSpeaking();

    // Split into sentences for highlighting.
    const sentences = splitIntoSentences(text);
    if (sentences.length === 0) return;

    ttsSentencesRef.current = sentences;

    setCurrentlySpeaking(index);
    setSpeakingMessageIndex(index);
    setCurrentSentenceIndex(0);
    setIsPaused(false);
    setLastSpoken(text, index);

    playSentence(0, index, sentences);
  };

  const playSentence = (
    sentenceIdx: number,
    messageIndex: number,
    sentences: string[]
  ) => {
    if (sentenceIdx >= sentences.length) {
      // Done with all sentences.
      setCurrentlySpeaking(null);
      setSpeakingMessageIndex(null);
      setCurrentSentenceIndex(-1);
      setIsPaused(false);
      setLastSpoken(null, null);
      ttsSentencesRef.current = [];
      return;
    }

    setCurrentSentenceIndex(sentenceIdx);

    const sentenceText = sentences[sentenceIdx];

    speak({
      text: sentenceText,
      voiceURI: selectedVoiceURI,
      rate: voiceRate,
      voices,
      onStart: () => {},
      onEnd: () => {
        // If user stopped, don't continue.
        if (ttsSentencesRef.current.length === 0) return;

        // Move to next sentence.
        playSentence(sentenceIdx + 1, messageIndex, sentences);
      },
    });
  };

  const handlePause = () => {
    if (typeof speechSynthesis === "undefined") return;

    if (isPaused) {
      speechSynthesis.resume();
      setIsPaused(false);
    } else {
      speechSynthesis.pause();
      setIsPaused(true);
    }
  };

  const handleStopTTS = () => {
    stopSpeaking();
    setCurrentlySpeaking(null);
    setSpeakingMessageIndex(null);
    setCurrentSentenceIndex(-1);
    setIsPaused(false);
    setLastSpoken(null, null);
    ttsSentencesRef.current = [];
  };

  const handleSkipSentence = () => {
    if (
      speakingMessageIndex === null ||
      ttsSentencesRef.current.length === 0
    ) {
      return;
    }

    // Cancel current speech.
    stopSpeaking();

    // Move to next sentence.
    const nextIdx = currentSentenceIndex + 1;
    const sentences = ttsSentencesRef.current;

    if (nextIdx >= sentences.length) {
      // No more sentences.
      handleStopTTS();
      return;
    }

    setIsPaused(false);
    playSentence(nextIdx, speakingMessageIndex, sentences);
  };

  // ------------------------------------------------------------
  // VOICE INPUT — Groq Whisper
  // ------------------------------------------------------------

  // ------------------------------------------------------------
  // VOICE INPUT — Groq Whisper + silence auto-stop
  // ------------------------------------------------------------

  const SILENCE_THRESHOLD = 0.02;      // normalized amplitude (0-1)
  const SILENCE_DURATION_MS = 3000;    // 3 seconds
  const MIN_RECORDING_MS = 1000;       // avoid instant auto-stop
  const VOICE_FRAMES_REQUIRED = 5;     // 5 frames of voice activity (500ms)
  const voiceFramesRef = useRef(0);

  const cleanupVAD = () => {
    if (vadIntervalRef.current !== null) {
      window.clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    silenceStartRef.current = null;
    recordingStartRef.current = null;
  };

  const stopRecording = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    }
    mediaRecorderRef.current = null;
    cleanupVAD();
  };

  const startRecording = async () => {
    if (isRecording || isTranscribing) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Pick a supported mime type.
      let mimeType = "audio/webm";
      if (typeof MediaRecorder !== "undefined") {
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
          mimeType = "audio/webm;codecs=opus";
        } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4";
        }
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());

        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];

        // If user didn't actually speak (too few voice frames),
        // skip transcription entirely — avoids Whisper hallucination.
        const voiceFrames = voiceFramesRef.current;
        voiceFramesRef.current = 0;

        if (blob.size === 0 || voiceFrames < VOICE_FRAMES_REQUIRED) {
          setIsRecording(false);
          setIsTranscribing(false);
          return;
        }

        setIsRecording(false);
        setIsTranscribing(true);

        try {
          const text = await transcribeAudio(blob);
          if (text) {
            setInput((prev) => (prev ? prev + " " + text : text));
          }
        } catch (err) {
          alert("Transcription failed: " + (err as Error).message);
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);

      // ----- Silence detection (VAD) -----
      recordingStartRef.current = Date.now();
      silenceStartRef.current = null;
      voiceFramesRef.current = 0;

      const audioCtx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext)();

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.fftSize);

      vadIntervalRef.current = window.setInterval(() => {
        const a = analyserRef.current;
        if (!a) return;

        a.getByteTimeDomainData(dataArray);

        // Compute RMS amplitude (0-1 range).
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = (dataArray[i] - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);

        const now = Date.now();
        const recordingDuration = now - (recordingStartRef.current || now);

        if (rms > SILENCE_THRESHOLD) {
          // User is speaking — reset silence timer.
          silenceStartRef.current = null;
          // Count this frame as voice activity.
          voiceFramesRef.current += 1;
        } else {
          // Below threshold — check silence duration.
          if (silenceStartRef.current === null) {
            silenceStartRef.current = now;
          } else {
            const silentFor = now - silenceStartRef.current;

            // Only auto-stop if we've recorded long enough to avoid
            // instantaneous stop from mic startup noise.
            if (
              silentFor >= SILENCE_DURATION_MS &&
              recordingDuration >= MIN_RECORDING_MS
            ) {
              stopRecording();
            }
          }
        }
      }, 100);
    } catch (err) {
      alert(
        "Could not access microphone. Please check your browser permissions and try again."
      );
      console.error(err);
    }
  };

  const handleMicClick = () => {
    if (isTranscribing) return;
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // ------------------------------------------------------------
  // IMAGE INPUT — Qwen Vision
  // ------------------------------------------------------------

  const handleAttachClick = () => {
    if (isExtractingImage) return;
    imageInputRef.current?.click();
  };

  const handleImageSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please select an image file.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert("Image too large (max 10MB).");
      return;
    }

    setPendingImage(file);

    // Create preview URL.
    const url = URL.createObjectURL(file);
    setImagePreviewUrl(url);

    // Reset input so the same file can be selected again.
    e.target.value = "";
  };

  const handleRemoveImage = () => {
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setPendingImage(null);
    setImagePreviewUrl(null);
  };

  const handleSendWithImage = async () => {
    if (!pendingImage || !currentChatId) return;
    if (isExtractingImage) return;
    if (currentChatArchived) {
      alert("This conversation is archived. Start a new chat to continue.");
      return;
    }

    setIsExtractingImage(true);

    const imageToSend = pendingImage;
    const previewToRevoke = imagePreviewUrl;
    const userText = input.trim();  // capture before clearing

    let extractedText = "";
    let imageData = "";

    try {
      const [ocrResult, thumb] = await Promise.all([
        extractImageText(imageToSend),
        generateThumbnail(imageToSend),
      ]);
      extractedText = ocrResult;
      imageData = thumb;
    } catch (err) {
      alert("Could not read the image: " + (err as Error).message);
      setIsExtractingImage(false);
      return;
    }

    if (previewToRevoke) {
      URL.revokeObjectURL(previewToRevoke);
    }
    setPendingImage(null);
    setImagePreviewUrl(null);
    setIsExtractingImage(false);
    setInput("");  // clear input

    // Combine user text + OCR text.
    let finalQuestion = extractedText;
    if (userText) {
      finalQuestion = `${userText}\n\n${extractedText}`;
    }

    if (!finalQuestion.trim()) return;

    try {
      await sendMessageFromImage(finalQuestion, imageData);
    } catch (err) {
      alert("Could not send message: " + (err as Error).message);
    }
  };

  // Send a message directly, bypassing the input field.
  // Used by image upload to avoid race conditions.
  const sendMessageFromImage = async (question: string, imageData: string) => {
    if (!question.trim() || !currentChatId) return;
    if (currentChatArchived) return;

    const store = useChatsStore.getState();
    const baseMessages = [...store.messages];

    const userMessage: Message = {
      role: "user",
      content: question,
      image_data: imageData,
    };
    const placeholder: Message = {
      role: "assistant",
      content: "",
      sources: [],
      activity: [],
    };

    const placeholderIndex = baseMessages.length + 1;
    store.setMessages([...baseMessages, userMessage, placeholder]);

    let fullAnswer = "";
    let sources: Message["sources"] = [];
    let activity: Message["activity"] = [];

    const patchIndex = (index: number, patch: Partial<Message>) => {
      const s = useChatsStore.getState();
      if (!s.messages[index]) return;
      const arr = [...s.messages];
      arr[index] = { ...arr[index], ...patch };
      s.setMessages(arr);
    };

    const handle = streamChat(
      {
        chat_id: currentChatId,
        question,
        document_ids: selectedDocumentIds.length
          ? selectedDocumentIds
          : undefined,
        image_data: imageData,
      },
      {
        onToken: (text) => {
          fullAnswer += text;
          patchIndex(placeholderIndex, {
            content: fullAnswer,
            sources,
            activity,
          });
        },
        onActivity: (type, message) => {
          activity = [...(activity || []), { type, message }];
          patchIndex(placeholderIndex, { activity });
        },
        onTitle: (chatId, name) => {
          animateTitleChange(chatId, name);
        },
        onSaved: async (srcs) => {
          sources = srcs;
          patchIndex(placeholderIndex, { sources });
          setTimeout(async () => {
            try {
              const { getChat } = await import("../api");
              const detail = await getChat(currentChatId);
              useChatsStore.getState().setMessages(detail.messages);
            } catch {
              /* ignore */
            }
          }, 400);
        },
        onError: (detail) => {
          fullAnswer = `_Error: ${detail}_`;
          patchIndex(placeholderIndex, { content: fullAnswer });
        },
        onDone: () => {
          endStream();
        },
      }
    );

    startStream(() => handle.abort());
  };

  const voiceGroups = groupVoices(voices);

  return (
    <main className="chat-area">
      <div className="panel chat-header-panel">
        <div className="chat-header">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
            title="Toggle sidebar"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
              <line
                x1="3"
                y1="6"
                x2="21"
                y2="6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <line
                x1="3"
                y1="12"
                x2="21"
                y2="12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <line
                x1="3"
                y1="18"
                x2="21"
                y2="18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <div className="chat-header-info">
            <div className="chat-title">{chatTitle}</div>
            <div className="chat-description">
              Grounded answers from your private knowledge base
            </div>
          </div>
          <div className="status-pill">
            <span className="status-dot" />
            AI AGENT
          </div>
        </div>
      </div>

      <PinnedPanel
        messages={messages}
        onJump={handleJumpToMessage}
        onUnpin={handlePinToggle}
      />

      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <WelcomePanel
            chatId={currentChatId}
            onSuggestion={(q) => {
              // Send directly — do not wait for state to update.
              handleSubmit(undefined, q);
            }}
          />
        ) : (
          <div className="messages">
            {messages.map((msg, i) => {
              // Render user messages and their paired assistant replies separately.
              if (msg.role === "user") {
                return (
                  <div key={`u-${i}`} ref={(el) => { if (el) messageRefs.current.set(i, el); }}>
                    <UserMessage
                      content={msg.content}
                      imageData={msg.image_data}
                      onImageClick={(src) => setImageModal(src)}
                    />
                  </div>
                );
              }

              if (msg.role === "assistant") {
                return (
                  <div key={`a-${i}`} ref={(el) => { if (el) messageRefs.current.set(i, el); }}>
                    <AssistantMessage
                      index={i}
                      content={msg.content}
                      sources={msg.sources || []}
                      activity={msg.activity || []}
                      onListen={handleListen}
                      messageId={msg.message_id}
                      createdAt={msg.created_at}
                      pinned={!!msg.pinned}
                      onPinToggle={() => handlePinToggle(i)}
                      onCopy={() => handleCopy(i)}
                      onRegenerate={() => handleRegenerate(i)}
                      canRegenerate={
                        i > 0 && messages[i - 1]?.role === "user"
                      }
                      isSpeakingThis={speakingMessageIndex === i}
                      currentSentenceIndex={currentSentenceIndex}
                      isPaused={isPaused}
                      onPauseToggle={handlePause}
                      onSkipSentence={handleSkipSentence}
                      onStopTTS={handleStopTTS}
                    />
                  </div>
                );
              }

              return null;
            })}
          </div>
        )}
      </div>

      {currentChatArchived && (
        <div className="archived-banner">
          <span className="archived-banner-icon">🔒</span>
          <span>
            This conversation is archived because a document it referenced was
            deleted. You can read it, but new messages are disabled.
          </span>
        </div>
      )}

      <div className="chat-input-wrap">
        {/* Image preview (above input) */}
        {imagePreviewUrl && (
          <div className="image-preview-container">
            <img
              src={imagePreviewUrl}
              alt="Preview"
              className="image-preview"
              onClick={() => setImageModal(imagePreviewUrl)}
              title="Click to enlarge"
            />
            <button
              type="button"
              className="image-preview-remove"
              onClick={handleRemoveImage}
              aria-label="Remove image"
            >
              ✕
            </button>
          </div>
        )}

        <form className="chat-input-form" onSubmit={handleSubmit}>
          {/* Hidden file input */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleImageSelected}
          />
          <button
            type="button"
            className={
              "mic-btn" +
              (isRecording ? " recording" : "") +
              (isTranscribing ? " transcribing" : "")
            }
            onClick={handleMicClick}
            disabled={isTranscribing || currentChatArchived}
            aria-label={isRecording ? "Stop recording" : "Start voice input"}
            title={
              isRecording
                ? "Stop recording"
                : isTranscribing
                ? "Transcribing..."
                : "Voice input"
            }
          >
            {isRecording ? (
              // Stop icon (square)
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : isTranscribing ? (
              // Loading dots
              <span className="mic-loading">…</span>
            ) : (
              // Mic icon (sleek outline)
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect
                  x="9"
                  y="3"
                  width="6"
                  height="11"
                  rx="3"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="M5 11a7 7 0 0 0 14 0"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  fill="none"
                />
                <line
                  x1="12"
                  y1="18"
                  x2="12"
                  y2="21"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <line
                  x1="8.5"
                  y1="21"
                  x2="15.5"
                  y2="21"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>

          {isRecording ? (
            <div className="recording-indicator">
              <span className="recording-dot" />
              <span>Listening</span>
              <span className="recording-dots">
                <span></span>
                <span></span>
                <span></span>
              </span>
            </div>
          ) : (
            <textarea
              className="chat-input"
              placeholder={
                isTranscribing
                  ? "Transcribing..."
                  : currentChatArchived
                  ? "This conversation is archived"
                  : "Message InsightDesk..."
              }
              value={input}
              disabled={currentChatArchived || isTranscribing}
              onChange={(e) => setInput(e.target.value)}
              onInput={(e) => {
                const el = e.target as HTMLTextAreaElement;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 240) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !streaming) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              rows={1}
            />
          )}

          {/* Attach image button */}
          <button
            type="button"
            className={"attach-btn" + (imagePreviewUrl ? " has-image" : "")}
            onClick={handleAttachClick}
            disabled={isExtractingImage || currentChatArchived || streaming}
            aria-label="Attach image"
            title="Attach image"
          >
            {isExtractingImage ? (
              <span className="mic-loading">…</span>
            ) : (
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>

          <button
            type="submit"
            className={"chat-send-btn" + (streaming ? " stop-mode" : "")}
            aria-label={streaming ? "Stop" : "Send"}
            disabled={currentChatArchived}
          >
            {streaming ? "" : "➤"}
          </button>
        </form>
      </div>

      <VoiceSettings
        voices={voices}
        selectedVoiceURI={selectedVoiceURI}
        voiceRate={voiceRate}
        onVoiceChange={setVoice}
        onRateChange={setRate}
      />

      {/* helper block for voice dropdown visibility inside ChatArea */}
      <span style={{ display: "none" }}>
        {voiceGroups.soft.length} soft voices
      </span>
      {/* Image lightbox modal */}
      {imageModal && (
        <div
          className="image-modal-overlay"
          onClick={() => setImageModal(null)}
        >
          <div
            className="image-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <img src={imageModal} alt="Full size" className="image-modal-img" />
            <button
              type="button"
              className="image-modal-close"
              onClick={() => setImageModal(null)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </main>
  );
}


/* ============================================================
   MESSAGE COMPONENTS
   ============================================================ */

function UserMessage({
  content,
  imageData,
  onImageClick,
}: {
  content: string;
  imageData?: string;
  onImageClick?: (src: string) => void;
}) {
  // If an image is present, hide the text content in the UI.
  const showText = !imageData && content;

  return (
    <div className="user-message">
      <div className="user-bubble">
        {imageData && (
          <img
            src={imageData}
            alt="Uploaded"
            className="user-bubble-image"
            onClick={() => onImageClick && onImageClick(imageData)}
            title="Click to enlarge"
          />
        )}
        {showText && <div className="user-bubble-text">{content}</div>}
      </div>
    </div>
  );
}
interface AssistantProps {
  index: number;
  content: string;
  sources: NonNullable<Message["sources"]>;
  activity: NonNullable<Message["activity"]>;
  onListen: (index: number) => void;
  messageId?: number;
  createdAt?: string;
  pinned?: boolean;
  onPinToggle?: () => void;
  onCopy?: () => void;
  onRegenerate?: () => void;
  canRegenerate?: boolean;
  // NEW — voice polish
  isSpeakingThis?: boolean;
  currentSentenceIndex?: number;
  isPaused?: boolean;
  onPauseToggle?: () => void;
  onSkipSentence?: () => void;
  onStopTTS?: () => void;
}

function AssistantMessage({
  index,
  content,
  sources,
  activity,
  onListen,
  messageId,
  createdAt,
  pinned,
  onPinToggle,
  onCopy,
  onRegenerate,
  canRegenerate,
  isSpeakingThis,
  currentSentenceIndex,
  isPaused,
  onPauseToggle,
  onSkipSentence,
  onStopTTS,
}: AssistantProps) {
  const clean = String(content || "").replace(/【[^】]+】/g, "").trim();
  const showActions = clean && !isErrorContent(clean);

  // Sentence highlighting — split only if this message is speaking.
  let renderedContent = renderMarkdown(clean);
  if (isSpeakingThis && currentSentenceIndex !== undefined && currentSentenceIndex >= 0) {
    const sentences = splitIntoSentences(stripMarkdown(clean));
    if (sentences.length > 0 && currentSentenceIndex < sentences.length) {
      // Escape and re-join with the current sentence wrapped.
      const highlighted = sentences
        .map((s, i) => {
          const esc = escapeHtml(s);
          if (i === currentSentenceIndex) {
            return `<mark class="tts-highlight">${esc}</mark>`;
          }
          return esc;
        })
        .join(" ");
      renderedContent = highlighted;
    }
  }

  return (
    <div className={"assistant-message" + (pinned ? " pinned" : "")}>
      <div className="assistant-avatar">
        <svg viewBox="0 0 64 64" className="prism">
          <use href="#prism-symbol" />
        </svg>
      </div>
      <div className="assistant-content">
        {messageId && (
          <div className="message-meta">
            <span
              className="message-time"
              title={formatExactTime(createdAt)}
            >
              {formatRelativeTime(createdAt)}
            </span>
            {pinned && <span className="message-pinned-tag">📌 Pinned</span>}
          </div>
        )}
        {clean ? (
          <div
            className="assistant-markdown"
            dangerouslySetInnerHTML={{ __html: renderedContent }}
          />
        ) : (
          <div className="typing-indicator">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        )}

        {showActions && (
          <div className="message-actions">
            <div className="message-actions-left">
              {isSpeakingThis ? (
                <>
                  <button
                    className="listen-btn speaking"
                    onClick={onStopTTS}
                    title="Stop"
                  >
                    ⏹ Stop
                  </button>
                  <button
                    className="action-btn"
                    onClick={onPauseToggle}
                    title={isPaused ? "Resume" : "Pause"}
                  >
                    {isPaused ? "▶ Resume" : "⏸ Pause"}
                  </button>
                  <button
                    className="action-btn"
                    onClick={onSkipSentence}
                    title="Next sentence"
                  >
                    ⏭ Skip
                  </button>
                </>
              ) : (
                <button
                  className="listen-btn"
                  onClick={() => onListen(index)}
                >
                  ♪ Listen
                </button>
              )}

              {onCopy && (
                <button
                  className="action-btn"
                  data-copy-index={index}
                  onClick={onCopy}
                  title="Copy message"
                >
                  📋 Copy
                </button>
              )}

              {onPinToggle && messageId && (
                <button
                  className={"action-btn" + (pinned ? " active" : "")}
                  onClick={onPinToggle}
                  title={pinned ? "Unpin message" : "Pin message"}
                >
                  📌 {pinned ? "Pinned" : "Pin"}
                </button>
              )}

              {onRegenerate && canRegenerate && (
                <button
                  className="action-btn"
                  onClick={onRegenerate}
                  title="Generate a new answer"
                >
                  🔄 Regenerate
                </button>
              )}
            </div>


            </div>
        )}

        {sources.length > 0 && (
          <>
            <div className="section-label">SOURCES</div>
            {sources.map((s, i) => {
              const meta: string[] = [];
              if (s.page != null) meta.push(`Page ${s.page}`);
              if (s.document_id) meta.push(`Document ID: ${s.document_id}`);
              return (
                <div className="source-card" key={i}>
                  <div className="source-name">
                    ◈ {s.source || "Unknown document"}
                  </div>
                  <div className="source-meta">{meta.join(" • ")}</div>
                </div>
              );
            })}
          </>
        )}

        <TraceView activity={activity} />
      </div>
    </div>
  );
}

function WelcomePanel({
  chatId,
  onSuggestion,
}: {
  chatId: string | null;
  onSuggestion: (question: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!chatId) return;

    let cancelled = false;
    setLoading(true);

    getSuggestions(chatId)
      .then((res) => {
        if (cancelled) return;
        setSuggestions(res.suggestions || []);
      })
      .catch(() => {
        if (cancelled) return;
        setSuggestions([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chatId]);

  return (
    <div className="welcome">
      <div className="welcome-icon">
        <svg viewBox="0 0 64 64" className="prism-lg">
          <use href="#prism-symbol" />
        </svg>
      </div>
      <div className="welcome-title">Ask your knowledge base anything</div>
      <div className="welcome-description">
        InsightDesk searches your uploaded documents and uses an AI agent to
        provide grounded answers with sources and conversation memory.
      </div>

      <div className="feature-grid">
        <div className="feature-card">
          <div className="feature-icon">◈</div>
          <div className="feature-title">Upload</div>
          <div className="feature-description">
            Add PDF or TXT documents to your workspace.
          </div>
        </div>
        <div className="feature-card">
          <div className="feature-icon">⌕</div>
          <div className="feature-title">Retrieve</div>
          <div className="feature-description">
            Search relevant information from your documents.
          </div>
        </div>
        <div className="feature-card">
          <div className="feature-icon">✦</div>
          <div className="feature-title">Reason</div>
          <div className="feature-description">
            Agent-powered answers with conversation memory.
          </div>
        </div>
      </div>

      {/* Suggestions row — only shown when there are suggestions */}
      {(loading || suggestions.length > 0) && (
        <div className="suggestions-block">
          <div className="suggestions-label">
            {loading ? "Thinking of questions…" : "Try asking"}
          </div>
          <div className="suggestions-list">
            {suggestions.map((q, i) => (
              <button
                key={i}
                type="button"
                className="suggestion-pill"
                onClick={() => onSuggestion(q)}
              >
                <span className="suggestion-arrow">→</span>
                <span className="suggestion-text">{q}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   VOICE SETTINGS (sidebar-driven, kept as inline block here)
   ============================================================ */

interface VoiceSettingsProps {
  voices: SpeechSynthesisVoice[];
  selectedVoiceURI: string | null;
  voiceRate: number;
  onVoiceChange: (uri: string) => void;
  onRateChange: (rate: number) => void;
}

function VoiceSettings({
  voices,
  selectedVoiceURI,
  voiceRate,
  onVoiceChange,
  onRateChange,
}: VoiceSettingsProps) {
  const groups = groupVoices(voices);

  return (
    <div style={{ display: "none" }} data-voice-settings>
      <select
        value={selectedVoiceURI || ""}
        onChange={(e) => onVoiceChange(e.target.value)}
      >
        <option value="">Default voice</option>
        {groups.soft.map((v) => (
          <option key={v.voiceURI} value={v.voiceURI}>
            {v.name} — {v.lang}
          </option>
        ))}
        <option disabled>─────── more voices ───────</option>
        {groups.neutral.map((v) => (
          <option key={v.voiceURI} value={v.voiceURI}>
            {v.name} — {v.lang}
          </option>
        ))}
        {groups.novelty.length > 0 && (
          <>
            <option disabled>─────── novelty ───────</option>
            {groups.novelty.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} — {v.lang}
              </option>
            ))}
          </>
        )}
      </select>
      <input
        type="range"
        min={0.5}
        max={1.5}
        step={0.1}
        value={voiceRate}
        onChange={(e) => onRateChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

/* ============================================================
   PINNED MESSAGES PANEL
   ============================================================ */

interface PinnedPanelProps {
  messages: Message[];
  onJump: (index: number) => void;
  onUnpin: (index: number) => void;
}

function PinnedPanel({ messages, onJump, onUnpin }: PinnedPanelProps) {
  const [open, setOpen] = useState(false);

  const pinned = messages
    .map((msg, index) => ({ msg, index }))
    .filter(({ msg }) => msg.pinned && msg.role === "assistant");

  if (pinned.length === 0) return null;

  const count = pinned.length;
  const label = count === 1 ? "1 pinned message" : `${count} pinned messages`;

  return (
    <div className="pinned-panel">
      <button
        type="button"
        className={"pinned-toggle" + (open ? " open" : "")}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="pinned-toggle-arrow">▸</span>
        <span className="pinned-toggle-icon">📌</span>
        <span className="pinned-toggle-label">{label}</span>
      </button>

      {open && (
        <div className="pinned-list">
          {pinned.map(({ msg, index }) => {
            const preview = stripMarkdown(msg.content)
              .replace(/\s+/g, " ")
              .slice(0, 140)
              .trim();
            const previewText =
              msg.content.length > 140 ? preview + "…" : preview;

            return (
              <div className="pinned-item" key={index}>
                <button
                  type="button"
                  className="pinned-item-body"
                  onClick={() => onJump(index)}
                  title="Jump to message"
                >
                  <div className="pinned-item-preview">{previewText}</div>
                  <div className="pinned-item-meta">
                    {formatRelativeTime(msg.created_at)}
                  </div>
                </button>
                <button
                  type="button"
                  className="pinned-item-unpin"
                  onClick={() => onUnpin(index)}
                  title="Unpin message"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

