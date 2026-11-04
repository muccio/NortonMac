import React, { useState, useEffect, useMemo, useRef } from 'react';
import { FilePreview } from '../../types';
import { api } from '../../api';

import Prism from 'prismjs';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-css';

interface ViewModalProps {
  preview: FilePreview | null;
  loading: boolean;
  onClose: () => void;
}

type ViewMode = 'image' | 'audio' | 'video' | 'pdf' | 'syntax' | 'text' | 'hex';

const EXTENSION_LANG_MAP: Record<string, string> = {
  rs: 'rust',
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  sh: 'bash',
  zsh: 'bash',
  bash: 'bash',
  json: 'json',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql',
  md: 'markdown',
  markdown: 'markdown',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  css: 'css',
};

const formatTime = (seconds: number): string => {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export const ViewModal: React.FC<ViewModalProps> = ({ preview, loading, onClose }) => {
  const extension = useMemo(() => {
    if (!preview?.filename) return '';
    return preview.filename.split('.').pop()?.toLowerCase() || '';
  }, [preview?.filename]);

  const detectedLanguage = useMemo(() => {
    return EXTENSION_LANG_MAP[extension] || '';
  }, [extension]);

  // Determine initial view mode
  const initialMode = useMemo<ViewMode>(() => {
    if (preview?.media_type === 'image') return 'image';
    if (preview?.media_type === 'audio') return 'audio';
    if (preview?.media_type === 'video') return 'video';
    if (preview?.media_type === 'pdf' || preview?.is_pdf) return 'pdf';
    if (preview?.is_binary) return 'hex';
    if (detectedLanguage) return 'syntax';
    return 'text';
  }, [preview, detectedLanguage]);

  const [mode, setMode] = useState<ViewMode>(initialMode);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(detectedLanguage || 'javascript');
  const [mediaBlobUrl, setMediaBlobUrl] = useState<string | null>(null);

  // Image controls
  const [imageZoom, setImageZoom] = useState<'fit' | number>('fit');
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);

  // Audio controls
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [audioVolume, setAudioVolume] = useState<number>(0.8);
  const [audioBars, setAudioBars] = useState<number[]>(new Array(16).fill(1));

  // Video info
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoResolution, setVideoResolution] = useState<string>('');

  // Sync mode when preview changes
  useEffect(() => {
    setMode(initialMode);
    if (detectedLanguage) {
      setSelectedLanguage(detectedLanguage);
    }
    setImageZoom('fit');
    setImageDimensions(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [initialMode, detectedLanguage]);

  // Prepare Blob URL for multimedia or PDF
  useEffect(() => {
    const base64Data = preview?.media_data_base64 || preview?.pdf_data_base64;
    const mime = preview?.mime_type || (preview?.is_pdf ? 'application/pdf' : '');

    if (base64Data && mime) {
      try {
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: mime });
        const url = URL.createObjectURL(blob);
        setMediaBlobUrl(url);

        return () => {
          URL.revokeObjectURL(url);
          setMediaBlobUrl(null);
        };
      } catch (err) {
        console.error('Failed to parse media base64 data:', err);
        setMediaBlobUrl(null);
      }
    } else {
      setMediaBlobUrl(null);
    }
  }, [preview?.media_data_base64, preview?.pdf_data_base64, preview?.mime_type, preview?.is_pdf]);

  // Simulated retro equalizer bars when playing audio
  useEffect(() => {
    if (!isPlaying) {
      setAudioBars(new Array(16).fill(1));
      return;
    }
    const interval = setInterval(() => {
      setAudioBars(
        Array.from({ length: 16 }, () => Math.floor(Math.random() * 8) + 1)
      );
    }, 120);
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Handle Tab key to cycle through available modes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        setMode((prev) => {
          if (preview?.media_type === 'image') {
            if (prev === 'image') return preview.text_content ? 'text' : 'hex';
            if (prev === 'text') return 'hex';
            return 'image';
          }
          if (preview?.media_type === 'audio') {
            return prev === 'audio' ? 'hex' : 'audio';
          }
          if (preview?.media_type === 'video') {
            return prev === 'video' ? 'hex' : 'video';
          }
          if (preview?.is_pdf) {
            if (prev === 'pdf') return 'hex';
            return 'pdf';
          }
          if (prev === 'syntax') return 'text';
          if (prev === 'text') return 'hex';
          return detectedLanguage ? 'syntax' : 'text';
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [preview, detectedLanguage]);

  // Syntax highlighted HTML
  const highlightedCodeHtml = useMemo(() => {
    if (!preview?.text_content) return '';
    const lang = selectedLanguage || 'clike';
    const grammar = Prism.languages[lang] || Prism.languages.clike;
    try {
      return Prism.highlight(preview.text_content, grammar, lang);
    } catch {
      return preview.text_content;
    }
  }, [preview?.text_content, selectedLanguage]);

  // Lines for line numbering
  const lines = useMemo(() => {
    return (preview?.text_content || '').split('\n');
  }, [preview?.text_content]);

  const handleOpenNative = async () => {
    if (!preview?.path) return;
    try {
      await api.openFileNative(preview.path);
    } catch (err) {
      alert(`Could not open file in external application: ${err}`);
    }
  };

  const handleTogglePlayAudio = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(console.error);
      setIsPlaying(true);
    }
  };

  const handleStopAudio = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleAudioTimeUpdate = () => {
    if (!audioRef.current) return;
    setCurrentTime(audioRef.current.currentTime);
  };

  const handleAudioLoadedMetadata = () => {
    if (!audioRef.current) return;
    setDuration(audioRef.current.duration || 0);
  };

  const handleAudioSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
      setCurrentTime(val);
    }
  };

  const handleAudioVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setAudioVolume(val);
    if (audioRef.current) {
      audioRef.current.volume = val;
    }
  };

  return (
    <div className="fixed inset-0 bg-nc-black/85 flex items-center justify-center p-3 z-50 font-mono select-none">
      <div className="bg-nc-blue border-4 border-nc-cyan text-nc-white w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Title Bar */}
        <div className="bg-nc-cyan text-nc-black px-3 py-1 font-bold flex justify-between items-center text-xs border-b border-nc-brightcyan">
          <div className="flex items-center space-x-2 truncate">
            <span className="text-nc-darkblue bg-nc-yellow px-1 font-black">
              F3 VIEW
            </span>
            <span className="text-nc-darkblue bg-nc-white px-1.5 py-0.5 font-bold font-mono">
              {preview?.filename || 'Loading...'}
            </span>
            <span className="text-nc-black text-[11px]">
              ({preview?.size?.toLocaleString() || 0} bytes)
            </span>
            {preview?.media_type && (
              <span className="bg-nc-darkblue text-nc-yellow px-1 text-[10px] font-black uppercase">
                {preview.media_type}
              </span>
            )}
          </div>

          {/* Mode Switchers */}
          <div className="flex items-center space-x-1.5">
            {preview?.media_type === 'image' && (
              <button
                onClick={() => setMode('image')}
                className={`px-2 py-0.5 text-xs font-bold border transition-colors ${
                  mode === 'image'
                    ? 'bg-nc-yellow text-nc-black border-nc-black'
                    : 'bg-nc-darkblue text-nc-white border-nc-cyan hover:bg-nc-black'
                }`}
              >
                🖼 IMAGE
              </button>
            )}

            {preview?.media_type === 'audio' && (
              <button
                onClick={() => setMode('audio')}
                className={`px-2 py-0.5 text-xs font-bold border transition-colors ${
                  mode === 'audio'
                    ? 'bg-nc-yellow text-nc-black border-nc-black'
                    : 'bg-nc-darkblue text-nc-white border-nc-cyan hover:bg-nc-black'
                }`}
              >
                🎵 AUDIO
              </button>
            )}

            {preview?.media_type === 'video' && (
              <button
                onClick={() => setMode('video')}
                className={`px-2 py-0.5 text-xs font-bold border transition-colors ${
                  mode === 'video'
                    ? 'bg-nc-yellow text-nc-black border-nc-black'
                    : 'bg-nc-darkblue text-nc-white border-nc-cyan hover:bg-nc-black'
                }`}
              >
                🎬 VIDEO
              </button>
            )}

            {(preview?.is_pdf || preview?.media_type === 'pdf') && (
              <button
                onClick={() => setMode('pdf')}
                className={`px-2 py-0.5 text-xs font-bold border transition-colors ${
                  mode === 'pdf'
                    ? 'bg-nc-yellow text-nc-black border-nc-black'
                    : 'bg-nc-darkblue text-nc-white border-nc-cyan hover:bg-nc-black'
                }`}
              >
                📄 PDF
              </button>
            )}

            {preview?.text_content && (
              <>
                <button
                  onClick={() => setMode('syntax')}
                  className={`px-2 py-0.5 text-xs font-bold border transition-colors ${
                    mode === 'syntax'
                      ? 'bg-nc-yellow text-nc-black border-nc-black'
                      : 'bg-nc-darkblue text-nc-brightcyan border-nc-cyan hover:bg-nc-black'
                  }`}
                  title="Syntax Highlighting (Tab)"
                >
                  ⚡ SYNTAX
                </button>

                <button
                  onClick={() => setMode('text')}
                  className={`px-2 py-0.5 text-xs font-bold border transition-colors ${
                    mode === 'text'
                      ? 'bg-nc-yellow text-nc-black border-nc-black'
                      : 'bg-nc-darkblue text-nc-white border-nc-cyan hover:bg-nc-black'
                  }`}
                  title="Plain Text Mode (Tab)"
                >
                  🔡 TEXT
                </button>
              </>
            )}

            <button
              onClick={() => setMode('hex')}
              className={`px-2 py-0.5 text-xs font-bold border transition-colors ${
                mode === 'hex'
                  ? 'bg-nc-yellow text-nc-black border-nc-black'
                  : 'bg-nc-darkblue text-nc-white border-nc-cyan hover:bg-nc-black'
              }`}
              title="Hex Viewer Mode (Tab)"
            >
              010 HEX
            </button>

            <button
              onClick={handleOpenNative}
              className="bg-nc-darkblue text-nc-yellow hover:bg-nc-black px-2 py-0.5 text-xs font-bold border border-nc-yellow"
              title="Open file in macOS default application"
            >
              ↗ OPEN EXTERNAL
            </button>

            <button
              onClick={onClose}
              className="bg-nc-red text-nc-white hover:bg-nc-brightred px-2 py-0.5 text-xs font-bold"
            >
              ✕ ESC
            </button>
          </div>
        </div>

        {/* Sub-header for Syntax mode (Language Selector) */}
        {mode === 'syntax' && (
          <div className="bg-nc-darkblue text-nc-brightcyan px-3 py-1 text-xs border-b border-nc-cyan flex items-center justify-between font-bold">
            <div className="flex items-center space-x-2">
              <span>SYNTAX HIGHLIGHT:</span>
              <span className="text-nc-yellow uppercase">
                [{selectedLanguage || 'PLAIN TEXT'}]
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-[11px] text-nc-white">Override Language:</span>
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="bg-nc-blue text-nc-yellow text-xs border border-nc-cyan px-1.5 py-0.5 outline-none cursor-pointer"
              >
                <option value="rust">Rust</option>
                <option value="typescript">TypeScript</option>
                <option value="javascript">JavaScript</option>
                <option value="tsx">TSX / React</option>
                <option value="jsx">JSX / React</option>
                <option value="python">Python</option>
                <option value="bash">Shell / Bash</option>
                <option value="json">JSON</option>
                <option value="toml">TOML</option>
                <option value="yaml">YAML</option>
                <option value="markdown">Markdown</option>
                <option value="sql">SQL</option>
                <option value="c">C</option>
                <option value="cpp">C++</option>
                <option value="css">CSS</option>
                <option value="markup">HTML / XML / SVG</option>
              </select>
            </div>
          </div>
        )}

        {/* Sub-header for Image mode (Zoom controls and resolution) */}
        {mode === 'image' && (
          <div className="bg-nc-darkblue text-nc-brightcyan px-3 py-1 text-xs border-b border-nc-cyan flex items-center justify-between font-bold">
            <div className="flex items-center space-x-3">
              <span>IMAGE VIEWER</span>
              {imageDimensions && (
                <span className="text-nc-yellow">
                  [{imageDimensions.width} × {imageDimensions.height} px]
                </span>
              )}
              <span className="text-nc-white text-[11px]">
                Type: {preview?.mime_type || 'image'}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-[11px] text-nc-white">Zoom:</span>
              <button
                onClick={() => setImageZoom((prev) => (prev === 'fit' ? 0.75 : Math.max(0.25, prev - 0.25)))}
                className="px-2 py-0.5 bg-nc-blue text-nc-white border border-nc-cyan hover:bg-nc-cyan hover:text-nc-black"
                title="Zoom Out"
              >
                -
              </button>
              <button
                onClick={() => setImageZoom('fit')}
                className={`px-2 py-0.5 border text-xs ${
                  imageZoom === 'fit'
                    ? 'bg-nc-yellow text-nc-black border-nc-black font-black'
                    : 'bg-nc-blue text-nc-white border-nc-cyan hover:bg-nc-cyan hover:text-nc-black'
                }`}
              >
                Fit
              </button>
              <button
                onClick={() => setImageZoom(1)}
                className={`px-2 py-0.5 border text-xs ${
                  imageZoom === 1
                    ? 'bg-nc-yellow text-nc-black border-nc-black font-black'
                    : 'bg-nc-blue text-nc-white border-nc-cyan hover:bg-nc-cyan hover:text-nc-black'
                }`}
              >
                100%
              </button>
              <button
                onClick={() => setImageZoom(2)}
                className={`px-2 py-0.5 border text-xs ${
                  imageZoom === 2
                    ? 'bg-nc-yellow text-nc-black border-nc-black font-black'
                    : 'bg-nc-blue text-nc-white border-nc-cyan hover:bg-nc-cyan hover:text-nc-black'
                }`}
              >
                200%
              </button>
              <button
                onClick={() => setImageZoom((prev) => (prev === 'fit' ? 1.25 : Math.min(5, prev + 0.25)))}
                className="px-2 py-0.5 bg-nc-blue text-nc-white border border-nc-cyan hover:bg-nc-cyan hover:text-nc-black"
                title="Zoom In"
              >
                +
              </button>
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 bg-nc-darkblue overflow-hidden relative">
          {loading ? (
            <div className="flex items-center justify-center h-full text-nc-yellow text-sm font-bold animate-pulse">
              READING FILE CONTENT...
            </div>
          ) : !preview ? (
            <div className="text-nc-brightred text-center mt-10">
              Failed to load preview for this file.
            </div>
          ) : mode === 'image' ? (
            /* Image Viewer with Transparent Checkerboard Pattern */
            <div
              className="w-full h-full overflow-auto flex items-center justify-center p-4"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, #111 25%, transparent 25%), linear-gradient(-45deg, #111 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #111 75%), linear-gradient(-45deg, transparent 75%, #111 75%)',
                backgroundSize: '24px 24px',
                backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px',
                backgroundColor: '#1c1c1c',
              }}
            >
              {mediaBlobUrl ? (
                <img
                  src={mediaBlobUrl}
                  alt={preview.filename}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                  }}
                  style={{
                    maxHeight: imageZoom === 'fit' ? '100%' : undefined,
                    maxWidth: imageZoom === 'fit' ? '100%' : undefined,
                    transform: typeof imageZoom === 'number' ? `scale(${imageZoom})` : 'none',
                    transformOrigin: 'center center',
                    transition: 'transform 0.15s ease-out',
                  }}
                  className="shadow-2xl border border-nc-cyan select-none pointer-events-auto"
                />
              ) : (
                <div className="flex flex-col items-center space-y-3 text-nc-yellow">
                  <p>Image preview unavailable (file may exceed memory buffer).</p>
                  <button
                    onClick={handleOpenNative}
                    className="bg-nc-cyan text-nc-black px-4 py-1.5 font-bold hover:bg-nc-yellow border border-nc-white text-xs"
                  >
                    Open in macOS Preview.app
                  </button>
                </div>
              )}
            </div>
          ) : mode === 'audio' ? (
            /* Retro DOS Audio Player Console */
            <div className="w-full h-full flex flex-col items-center justify-center p-6 bg-[#000044]">
              {mediaBlobUrl && (
                <audio
                  ref={audioRef}
                  src={mediaBlobUrl}
                  onTimeUpdate={handleAudioTimeUpdate}
                  onLoadedMetadata={handleAudioLoadedMetadata}
                  onEnded={() => setIsPlaying(false)}
                />
              )}

              <div className="w-full max-w-xl bg-nc-blue border-4 border-nc-cyan shadow-2xl p-5 flex flex-col space-y-5">
                {/* Audio Header */}
                <div className="bg-nc-cyan text-nc-black px-3 py-1 font-black text-xs flex justify-between items-center">
                  <span>SOUND BLASTER 16 / NORTON AUDIO PLAYER</span>
                  <span>{preview.mime_type || 'AUDIO'}</span>
                </div>

                {/* Track Info */}
                <div className="border-2 border-nc-cyan bg-nc-black/60 p-3 flex flex-col space-y-1">
                  <div className="text-nc-brightcyan text-[11px] font-bold">TRACK NAME:</div>
                  <div className="text-nc-yellow font-black text-sm truncate">{preview.filename}</div>
                  <div className="text-nc-white text-[11px] flex justify-between pt-1">
                    <span>SIZE: {(preview.size / 1024).toFixed(1)} KB</span>
                    <span>LENGTH: {formatTime(duration)}</span>
                  </div>
                </div>

                {/* Equalizer Visualizer */}
                <div className="border border-nc-cyan/60 bg-nc-black/80 p-3">
                  <div className="text-[10px] text-nc-cyan font-bold mb-2 flex justify-between">
                    <span>SPECTRUM ANALYZER</span>
                    <span>{isPlaying ? 'ACTIVE [PLAY]' : 'STANDBY'}</span>
                  </div>
                  <div className="flex items-end justify-between h-20 gap-1.5 px-2">
                    {audioBars.map((height, i) => (
                      <div key={i} className="flex-1 flex flex-col justify-end items-center h-full gap-0.5">
                        {Array.from({ length: 8 }).map((_, blockIdx) => {
                          const isLit = 8 - blockIdx <= height;
                          const blockColor =
                            blockIdx < 2
                              ? 'bg-nc-brightred'
                              : blockIdx < 4
                              ? 'bg-nc-yellow'
                              : 'bg-nc-brightcyan';
                          return (
                            <div
                              key={blockIdx}
                              className={`w-full h-1.5 transition-colors ${
                                isLit ? blockColor : 'bg-nc-black/50 opacity-20'
                              }`}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Scrubber / Progress */}
                <div className="flex flex-col space-y-1">
                  <div className="flex justify-between text-xs font-bold text-nc-brightcyan">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={duration || 100}
                    step="0.1"
                    value={currentTime}
                    onChange={handleAudioSeek}
                    className="w-full accent-nc-yellow cursor-pointer h-2 bg-nc-darkblue border border-nc-cyan"
                  />
                </div>

                {/* Player Controls */}
                <div className="flex items-center justify-between pt-2 border-t border-nc-cyan/40">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleTogglePlayAudio}
                      className="px-4 py-1.5 bg-nc-yellow text-nc-black font-black text-xs border border-nc-black hover:bg-nc-white active:bg-nc-cyan shadow"
                    >
                      {isPlaying ? '⏸ PAUSE' : '▶ PLAY'}
                    </button>
                    <button
                      onClick={handleStopAudio}
                      className="px-3 py-1.5 bg-nc-red text-nc-white font-black text-xs border border-nc-white hover:bg-nc-brightred shadow"
                    >
                      ■ STOP
                    </button>
                  </div>

                  <div className="flex items-center space-x-2 text-xs">
                    <span className="text-nc-cyan font-bold">VOL:</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={audioVolume}
                      onChange={handleAudioVolumeChange}
                      className="w-24 accent-nc-yellow cursor-pointer h-1.5 bg-nc-darkblue border border-nc-cyan"
                    />
                    <span className="text-nc-yellow font-bold text-[11px] w-8">
                      {Math.round(audioVolume * 100)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : mode === 'video' ? (
            /* Retro Video Player Container */
            <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-black">
              {mediaBlobUrl ? (
                <div className="w-full h-full max-w-5xl max-h-[80vh] flex flex-col border-2 border-nc-cyan bg-nc-black shadow-2xl">
                  <div className="bg-nc-cyan text-nc-black px-3 py-1 font-bold text-xs flex justify-between items-center">
                    <span>VIDEO PLAYBACK: {preview.filename}</span>
                    <span>{videoResolution || preview.mime_type || 'VIDEO'}</span>
                  </div>
                  <div className="flex-1 bg-black flex items-center justify-center overflow-hidden">
                    <video
                      ref={videoRef}
                      src={mediaBlobUrl}
                      controls
                      autoPlay={false}
                      onLoadedMetadata={(e) => {
                        const vid = e.currentTarget;
                        setVideoResolution(`${vid.videoWidth} × ${vid.videoHeight}`);
                      }}
                      className="w-full h-full max-h-[72vh] object-contain"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center space-y-3 text-nc-yellow">
                  <p>Video exceeds preview memory buffer limit.</p>
                  <button
                    onClick={handleOpenNative}
                    className="bg-nc-cyan text-nc-black px-4 py-1.5 font-bold hover:bg-nc-yellow border border-nc-white text-xs"
                  >
                    Open in QuickTime / macOS Player
                  </button>
                </div>
              )}
            </div>
          ) : mode === 'pdf' && (preview.is_pdf || preview.media_type === 'pdf') ? (
            /* PDF Native Viewer via WKWebView */
            <div className="w-full h-full flex flex-col bg-neutral-900">
              {mediaBlobUrl ? (
                <iframe
                  src={mediaBlobUrl}
                  className="w-full h-full border-0 bg-white"
                  title={preview.filename}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-nc-yellow space-y-3">
                  <div className="text-sm font-bold">Rendering PDF preview...</div>
                  <button
                    onClick={handleOpenNative}
                    className="bg-nc-cyan text-nc-black hover:bg-nc-yellow px-4 py-1.5 text-xs font-bold border border-nc-white"
                  >
                    Open in macOS Preview.app
                  </button>
                </div>
              )}
            </div>
          ) : mode === 'syntax' ? (
            /* Syntax Highlighted View with Line Numbers */
            <div className="h-full overflow-auto p-3 text-xs font-mono select-text bg-[#000055]">
              <div className="flex font-mono leading-relaxed min-w-full">
                {/* Line Numbers Column */}
                <div className="select-none pr-3 text-right text-nc-cyan font-bold border-r border-nc-cyan/40 opacity-70">
                  {lines.map((_, i) => (
                    <div key={i}>{i + 1}</div>
                  ))}
                </div>
                {/* Highlighted Code Column */}
                <pre
                  className="pl-3 overflow-x-visible whitespace-pre font-mono text-nc-white flex-1"
                  dangerouslySetInnerHTML={{ __html: highlightedCodeHtml }}
                />
              </div>
            </div>
          ) : mode === 'hex' || preview.is_binary ? (
            /* Hex Viewer */
            <div className="h-full overflow-auto p-3 text-xs font-mono">
              <div className="text-nc-cyan font-bold border-b border-nc-cyan/40 pb-1 mb-2 grid grid-cols-12 text-[11px]">
                <div className="col-span-2">OFFSET</div>
                <div className="col-span-7">HEX BYTES (00 - 0F)</div>
                <div className="col-span-3">ASCII DUMP</div>
              </div>
              {preview.hex_lines.map((line, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 font-mono text-[11px] leading-tight hover:bg-nc-blue"
                >
                  <div className="col-span-2 text-nc-yellow">{line.offset}</div>
                  <div className="col-span-7 text-nc-brightcyan tracking-wider">
                    {line.hex_bytes}
                  </div>
                  <div className="col-span-3 text-nc-white font-mono bg-nc-black/30 px-1 border-l border-nc-cyan/30">
                    {line.ascii}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Plain Text Viewer */
            <div className="h-full overflow-auto p-3 text-xs font-mono select-text bg-nc-darkblue">
              <div className="flex font-mono leading-relaxed min-w-full">
                {/* Line Numbers */}
                <div className="select-none pr-3 text-right text-nc-cyan font-bold border-r border-nc-cyan/40 opacity-60">
                  {lines.map((_, i) => (
                    <div key={i}>{i + 1}</div>
                  ))}
                </div>
                {/* Plain Text */}
                <pre className="pl-3 overflow-x-visible whitespace-pre-wrap font-mono text-nc-white flex-1">
                  {preview.text_content || 'Empty file.'}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Status Bar */}
        <div className="bg-nc-cyan text-nc-black px-3 py-1 text-[11px] font-bold flex justify-between items-center border-t border-nc-brightcyan">
          <div className="flex items-center space-x-3">
            <span>Encoding: {preview?.encoding || 'Auto'}</span>
            {preview?.text_content && lines.length > 0 && <span>Lines: {lines.length}</span>}
            <span className="text-nc-darkblue hidden sm:inline">
              Mode: <span className="uppercase font-black text-nc-red">[{mode}]</span>
            </span>
          </div>

          <div className="flex items-center space-x-3">
            <span className="hidden md:inline text-[10px]">
              Press <span className="underline">Tab</span> to switch mode | <span className="underline">ESC</span> to exit
            </span>
            <button
              onClick={onClose}
              className="bg-nc-darkblue text-nc-white hover:bg-nc-yellow hover:text-nc-black px-3 py-0.5 border border-nc-black"
            >
              Done (ESC)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
