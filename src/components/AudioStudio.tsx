import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { 
  Play, 
  Square, 
  Upload, 
  Download, 
  Trash2, 
  Volume2, 
  VolumeX, 
  Music,
  Settings2,
  ChevronLeft,
  Maximize2,
  ZoomIn,
  ZoomOut,
  GripVertical
} from 'lucide-react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { 
  AudioTrack, 
  bufferToWav, 
  convertToMp3, 
  convertToOgg,
  drawWaveform 
} from '../lib/audioEngine';

const BASE_PIXELS_PER_SECOND = 40;
const SAMPLE_RATE = 44100;

export default function AudioStudio() {
  const [tracks, setTracks] = useState<AudioTrack[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<'mp3' | 'wav'>('mp3');
  const [projectName, setProjectName] = useState('Mi Mezcla');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [zoom, setZoom] = useState(1);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeSourcesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());
  const activeGainNodesRef = useRef<Map<string, GainNode>>(new Map());
  const startTimeRef = useRef<number>(0);
  const currentTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);

  const pixelsPerSecond = useMemo(() => BASE_PIXELS_PER_SECOND * zoom, [zoom]);

  const getAudioCtx = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioCtxRef.current;
  };

  const stopAll = useCallback(() => {
    activeSourcesRef.current.forEach(source => {
      try {
        source.stop();
        source.disconnect();
      } catch (e) {}
    });
    activeSourcesRef.current.clear();
    activeGainNodesRef.current.clear();
  }, []);

  const scheduleTrackLive = useCallback((track: AudioTrack, projectTime: number) => {
    const ctx = getAudioCtx();
    const trackPlayOffsetInProject = track.offset;
    const trackPlayDuration = track.duration;
    const trackEndInProject = trackPlayOffsetInProject + trackPlayDuration;

    if (trackEndInProject > projectTime) {
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      
      source.buffer = track.buffer;
      gain.gain.value = track.muted ? 0 : track.volume;
      
      source.connect(gain);
      gain.connect(ctx.destination);

      activeGainNodesRef.current.set(track.id, gain);

      let playbackOffsetInBuffer: number;
      let delayInProject: number;

      if (projectTime < trackPlayOffsetInProject) {
        playbackOffsetInBuffer = track.trimStart;
        delayInProject = trackPlayOffsetInProject - projectTime;
      } else {
        const timeSinceClipStart = projectTime - trackPlayOffsetInProject;
        playbackOffsetInBuffer = track.trimStart + timeSinceClipStart;
        delayInProject = 0;
      }

      const remainingDurationInClip = Math.max(0, trackPlayDuration - (playbackOffsetInBuffer - track.trimStart));
      
      if (remainingDurationInClip > 0) {
        source.start(ctx.currentTime + delayInProject, playbackOffsetInBuffer, remainingDurationInClip);
        activeSourcesRef.current.set(track.id, source);
      }
    }
  }, []);

  const startPlayback = useCallback(() => {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    stopAll();
    startTimeRef.current = ctx.currentTime;
    const projectTime = currentTimeRef.current;

    tracks.forEach(track => {
      scheduleTrackLive(track, projectTime);
    });

    setIsPlaying(true);
  }, [tracks, stopAll, scheduleTrackLive]);

  const pausePlayback = useCallback(() => {
    const ctx = getAudioCtx();
    const elapsed = ctx.currentTime - startTimeRef.current;
    currentTimeRef.current += elapsed;
    setCurrentTime(currentTimeRef.current);
    stopAll();
    setIsPlaying(false);
  }, [stopAll]);

  const togglePlay = () => {
    if (isPlaying) {
      pausePlayback();
    } else {
      startPlayback();
    }
  };

  const stopPlayback = () => {
    stopAll();
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setIsPlaying(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;
    
    if (tracks.length > 0) {
      setPendingFiles(files);
    } else {
      processFiles(files, false);
    }
    if (e.target) e.target.value = '';
  };

  const processFiles = async (files: File[], replace: boolean) => {
    const ctx = getAudioCtx();
    const newTracks: AudioTrack[] = [];

    for (const file of files) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = await ctx.decodeAudioData(arrayBuffer);
        
        newTracks.push({
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          buffer,
          offset: replace ? 0 : currentTimeRef.current,
          trimStart: 0,
          duration: buffer.duration,
          volume: 0.8,
          muted: false
        });
      } catch (err) {
        console.error("Error decoding file:", file.name, err);
      }
    }

    if (replace) {
      stopPlayback();
      setTracks(newTracks);
    } else {
      setTracks(prev => [...prev, ...newTracks]);
    }
    setPendingFiles(null);
  };

  const removeTrack = (id: string) => {
    const source = activeSourcesRef.current.get(id);
    if (source) {
      try {
        source.stop();
        source.disconnect();
      } catch (e) {}
      activeSourcesRef.current.delete(id);
      activeGainNodesRef.current.delete(id);
    }
    setTracks(prev => prev.filter(t => t.id !== id));
  };

  const updateTrack = (id: string, updates: Partial<AudioTrack>) => {
    setTracks(prev => {
      const newTracks = prev.map(t => t.id === id ? { ...t, ...updates } : t);
      const track = newTracks.find(t => t.id === id);
      if (!track) return prev;
      
      // Live volume/mute update
      const gainNode = activeGainNodesRef.current.get(id);
      if (gainNode && audioCtxRef.current) {
        const targetVol = track.muted ? 0 : track.volume;
        gainNode.gain.setTargetAtTime(targetVol, audioCtxRef.current.currentTime, 0.05);
      }

      // Live offset/trim/duration update
      const hasStructuralChange = 'offset' in updates || 'trimStart' in updates || 'duration' in updates;
      if (isPlaying && hasStructuralChange && audioCtxRef.current) {
        const source = activeSourcesRef.current.get(id);
        if (source) {
          try {
            source.stop();
            source.disconnect();
          } catch(e) {}
          activeSourcesRef.current.delete(id);
        }
        
        const elapsed = audioCtxRef.current.currentTime - startTimeRef.current;
        const currentProjectTime = currentTimeRef.current + elapsed;
        scheduleTrackLive(track, currentProjectTime);
      }
      
      return newTracks;
    });
  };

  const handleTimelineClick = (e: React.MouseEvent | React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('.track-item-handle')) return;
    if ((e.target as HTMLElement).closest('.track-item-main')) return;

    const containerRect = scrollContainerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    let clientX;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
    } else {
      clientX = (e as React.MouseEvent).clientX;
    }

    const scrollLeft = scrollContainerRef.current?.scrollLeft || 0;
    const x = clientX - containerRect.left + scrollLeft;
    const newTime = Math.max(0, x / pixelsPerSecond);
    
    currentTimeRef.current = newTime;
    setCurrentTime(newTime);
    
    if (isPlaying) {
      startPlayback();
    }
  };

  const exportProject = async () => {
    if (tracks.length === 0) return;
    if (isPlaying) pausePlayback();

    setIsExporting(true);
    setExportUrl(null);

    const maxDuration = Math.max(...tracks.map(t => t.offset + t.duration));
    const offlineCtx = new OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * maxDuration), SAMPLE_RATE);

    tracks.forEach(track => {
      const source = offlineCtx.createBufferSource();
      const gain = offlineCtx.createGain();
      source.buffer = track.buffer;
      gain.gain.value = track.muted ? 0 : track.volume;
      
      source.connect(gain);
      gain.connect(offlineCtx.destination);
      source.start(track.offset, track.trimStart, track.duration);
    });

    try {
      const renderedBuffer = await offlineCtx.startRendering();
      let blob;

      if (exportFormat === 'mp3') {
        blob = await convertToMp3(renderedBuffer);
      } else if (exportFormat === 'ogg') {
        try {
          blob = await convertToOgg(renderedBuffer);
        } catch (e) {
          console.warn("OGG export requires real-time support in this browser, falling back to MP3.");
          blob = await convertToMp3(renderedBuffer);
        }
      } else {
        blob = bufferToWav(renderedBuffer);
      }

      const url = URL.createObjectURL(blob);
      setExportUrl(url);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    const tick = () => {
      if (isPlaying && audioCtxRef.current) {
        const elapsed = audioCtxRef.current.currentTime - startTimeRef.current;
        setCurrentTime(currentTimeRef.current + elapsed);
      }
      animationFrameRef.current = requestAnimationFrame(tick);
    };
    animationFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [isPlaying]);

  const maxTimelineWidth = Math.max(
    window.innerWidth,
    ...tracks.map(t => (t.offset + t.duration) * pixelsPerSecond + 800),
    currentTime * pixelsPerSecond + 800
  );

  const toggleFullscreen = () => {
    const doc = document as any;
    const element = document.documentElement as any;

    if (!doc.fullscreenElement && !doc.webkitFullscreenElement && !doc.mozFullScreenElement && !doc.msFullscreenElement) {
      if (element.requestFullscreen) element.requestFullscreen();
      else if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();
      else if (element.mozRequestFullScreen) element.mozRequestFullScreen();
      else if (element.msRequestFullscreen) element.msRequestFullscreen();
    } else {
      if (doc.exitFullscreen) doc.exitFullscreen();
      else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
      else if (doc.mozCancelFullScreen) doc.mozCancelFullScreen();
      else if (doc.msExitFullscreen) doc.msExitFullscreen();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#050505] text-white font-sans overflow-hidden select-none">
      {/* Orientation Warning */}
      <div className="portrait-notice">
        <div className="p-6 bg-orange-500 rounded-3xl mb-6 animate-pulse">
          <Maximize2 className="w-12 h-12 text-black rotate-90" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Gira tu pantalla</h2>
        <p className="text-white/40 text-sm max-w-xs">
          Audio Studio Pro funciona mejor en modo horizontal para darte más espacio de mezcla.
        </p>
      </div>

      <header className="flex items-center justify-between px-3 h-12 border-b border-white/5 bg-[#111] z-50">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-orange-500 rounded-md">
            <Music className="w-4 h-4 text-black" />
          </div>
          <input 
            type="text" 
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="bg-transparent border-none focus:outline-none font-bold text-sm w-32 truncate"
          />
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1 mr-2">
            <button onClick={() => setZoom(z => Math.max(0.5, z - 0.2))} className="p-1 hover:bg-white/10 rounded"><ZoomOut className="w-4 h-4" /></button>
            <span className="text-[10px] w-8 text-center opacity-50 font-mono">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(4, z + 0.2))} className="p-1 hover:bg-white/10 rounded"><ZoomIn className="w-4 h-4" /></button>
          </div>

          <select 
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as 'mp3' | 'wav' | 'ogg')}
            className="bg-[#222] border-none rounded px-2 py-1 text-[10px] outline-none font-bold"
          >
            <option value="mp3">MP3</option>
            <option value="wav">WAV</option>
            <option value="ogg">OGG</option>
          </select>
          <button 
            onClick={exportProject}
            disabled={tracks.length === 0 || isExporting}
            className="bg-orange-500 text-black px-3 py-1 rounded-md font-bold text-[10px] disabled:opacity-50 transition-all active:scale-95 flex items-center gap-2"
          >
            {isExporting && <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="w-3 h-3 border-2 border-black/30 border-t-black rounded-full" />}
            {isExporting ? "PROCESANDO..." : "EXPORT"}
          </button>
        </div>
      </header>
      <main className="flex-1 flex overflow-hidden relative">
        {/* Left Toolbar: Settings & Upload */}
        <div className="w-14 bg-[#111] border-r border-white/5 flex flex-col items-center justify-center gap-4 z-40">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
            className={`p-2.5 rounded-xl transition-colors ${isSidebarOpen ? 'bg-orange-500 text-black shadow-lg shadow-orange-500/20' : 'text-white/40 hover:bg-white/5 border border-white/5'}`}
          >
            <Settings2 className="w-5 h-5" />
          </button>
          
          <label className="p-2.5 text-orange-500 hover:bg-orange-500/10 rounded-xl cursor-pointer transition-colors active:scale-95 border border-orange-500/10">
            <Upload className="w-5 h-5" />
            <input type="file" className="hidden" multiple accept=".mp3,.wav,.ogg,.m4a,.aac,.flac" onChange={handleFileUpload} />
          </label>
        </div>

        <AnimatePresence>
          {isSidebarOpen && (
            <motion.aside 
              initial={{ x: -300 }}
              animate={{ x: 14 }}
              exit={{ x: -300 }}
              className="absolute left-14 top-4 bottom-4 z-50 w-64 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl flex flex-col"
            >
              <div className="p-4 border-b border-white/5 flex items-center justify-between">
                <span className="font-bold opacity-60 uppercase text-[10px] tracking-widest">Ajustes</span>
                <button onClick={() => setIsSidebarOpen(false)}><ChevronLeft className="w-4 h-4" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {tracks.map((track) => (
                  <div key={track.id} className="p-3 bg-white/5 rounded-xl border border-white/5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] truncate max-w-[140px] font-bold opacity-80">{track.name}</span>
                      <button onClick={() => removeTrack(track.id)} className="text-red-500/60 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => updateTrack(track.id, { muted: !track.muted })}
                        className={`p-1.5 rounded-lg transition-colors ${track.muted ? 'bg-red-500/20 text-red-500' : 'bg-white/5 text-white/40'}`}
                      >
                        {track.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                      </button>
                      <input 
                        type="range" min="0" max="1.5" step="0.05"
                        value={track.volume}
                        onChange={(e) => updateTrack(track.id, { volume: parseFloat(e.target.value) })}
                        className="flex-1 accent-orange-500 h-1 bg-white/10 rounded-full appearance-none"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        <div className="flex-1 flex flex-col relative overflow-hidden">
          <div 
            ref={scrollContainerRef}
            className="flex-1 overflow-auto relative touch-pan-x touch-pan-y"
          >
            <div 
              onClick={handleTimelineClick}
              className="relative min-h-full"
              style={{ width: `${maxTimelineWidth}px` }}
            >
              <div className="h-6 bg-[#0a0a0a] border-b border-white/5 sticky top-0 z-40 flex items-end">
                {Array.from({ length: Math.ceil(maxTimelineWidth / pixelsPerSecond) + 1 }).map((_, i) => (
                  <div key={i} className="absolute bottom-0 border-l border-white/10 h-2" style={{ left: `${i * pixelsPerSecond}px` }}>
                    <span className="absolute -top-4 -left-2 text-[8px] text-white/20 font-mono">{i}s</span>
                  </div>
                ))}
              </div>

              <div className="absolute inset-0 top-6 pointer-events-none"
                style={{ 
                  backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.02) 1px, transparent 1px)`,
                  backgroundSize: `${pixelsPerSecond}px 100%`,
                }}
              />

              <div className="mt-4 space-y-2 px-0 relative z-20">
                {tracks.map((track) => (
                  <TrackItem 
                    key={track.id}
                    track={track}
                    pixelsPerSecond={pixelsPerSecond}
                    onUpdate={(updates) => updateTrack(track.id, updates)}
                    onDelete={() => removeTrack(track.id)}
                  />
                ))}
              </div>

              <div 
                className="absolute top-0 bottom-0 w-[1px] bg-red-500 z-30 pointer-events-none shadow-[0_0_15px_rgba(239,68,68,0.8)]"
                style={{ left: `${currentTime * pixelsPerSecond}px` }}
              >
                <div className="w-2.5 h-2.5 bg-red-500 rounded-full -translate-x-[4.5px] mt-[1.5px] shadow-lg border border-white/20" />
              </div>
            </div>
          </div>
        </div>

        {/* Right Toolbar: Playback Controls & Timer */}
        <div className="w-14 bg-[#111] border-l border-white/5 flex flex-col items-center justify-center gap-4 z-40">
          <button 
            onClick={togglePlay} 
            className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center active:scale-95 transition-transform shadow-lg shadow-orange-500/20"
          >
            {isPlaying ? <Square fill="black" className="w-4 h-4 text-black" /> : <Play fill="black" className="w-4 h-4 text-black ml-0.5" />}
          </button>
          
          <button 
            onClick={stopPlayback} 
            className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-xl flex items-center justify-center text-white/20 active:scale-95 transition-transform border border-white/5"
          >
            <Square fill="currentColor" className="w-3.5 h-3.5" />
          </button>

          <div className="flex flex-col items-center leading-none mt-2">
            <span className="text-orange-500 font-mono text-[9px] font-bold tabular-nums">
              {formatTimeShort(currentTime)}
            </span>
            <span className="text-[6px] text-white/20 uppercase font-black mt-0.5 tracking-tighter">TIME</span>
          </div>
        </div>
      </main>

      {/* Import Choice Dialog */}
      <AnimatePresence>
        {pendingFiles && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 backdrop-blur-sm bg-black/40">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#1a1a1a] border border-white/10 p-6 rounded-3xl shadow-2xl max-w-sm w-full"
            >
              <h3 className="text-lg font-bold mb-2">Importar Archivos</h3>
              <p className="text-white/40 text-sm mb-6">¿Quieres reemplazar los audios actuales o añadirlos a tu mezcla?</p>
              
              <div className="grid grid-cols-1 gap-3">
                <button 
                  onClick={() => processFiles(pendingFiles, true)}
                  className="bg-red-500/10 text-red-500 border border-red-500/20 py-3 rounded-2xl font-bold text-sm active:scale-95 transition-transform"
                >
                  REEMPLAZAR TODO
                </button>
                <button 
                  onClick={() => processFiles(pendingFiles, false)}
                  className="bg-orange-500 text-black py-3 rounded-2xl font-bold text-sm active:scale-95 transition-transform"
                >
                  AÑADIR A LA MEZCLA
                </button>
                <button 
                  onClick={() => setPendingFiles(null)}
                  className="text-white/40 py-2 text-sm"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {exportUrl && (
          <motion.div 
            initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }}
            className="fixed bottom-20 right-6 z-[100]"
          >
            <div className="bg-orange-500 p-3 rounded-2xl shadow-2xl flex items-center gap-4 border border-white/20">
              <div className="flex flex-col">
                <span className="text-[9px] text-black/60 font-bold uppercase truncate max-w-[100px]">{projectName}</span>
                <span className="text-[10px] text-black font-extrabold uppercase">Listo</span>
              </div>
              <a href={exportUrl} download={`${projectName}.${exportFormat}`} className="bg-black text-white px-4 py-2 rounded-xl text-xs font-bold">DESCARGAR</a>
              <button onClick={() => setExportUrl(null)} className="text-black/40 text-xs">✕</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface TrackItemProps {
  track: AudioTrack;
  pixelsPerSecond: number;
  onUpdate: (updates: Partial<AudioTrack>) => void;
  onDelete: () => void;
}

const TrackItem: React.FC<TrackItemProps> = ({ track, pixelsPerSecond, onUpdate, onDelete }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ 
    type: 'move' | 'trim-left' | 'trim-right', 
    startX: number, 
    initialOffset: number, 
    initialTrimStart: number, 
    initialDuration: number 
  } | null>(null);

  useEffect(() => {
    if (canvasRef.current) {
      drawWaveform(track.buffer, canvasRef.current, track.muted ? '#222' : '#f97316');
    }
  }, [track.buffer, track.muted, pixelsPerSecond]);

  const handlePointerDown = (e: React.PointerEvent, type: 'move' | 'trim-left' | 'trim-right') => {
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    
    dragRef.current = {
      type,
      startX: e.clientX,
      initialOffset: track.offset,
      initialTrimStart: track.trimStart,
      initialDuration: track.duration
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    
    const deltaX = e.clientX - dragRef.current.startX;
    const deltaSeconds = deltaX / pixelsPerSecond;

    if (dragRef.current.type === 'move') {
      const newOffset = Math.max(0, dragRef.current.initialOffset + deltaSeconds);
      onUpdate({ offset: newOffset });
    } 
    else if (dragRef.current.type === 'trim-left') {
      // Diff shows how much we are moving the left handle
      const maxTrim = dragRef.current.initialTrimStart + dragRef.current.initialDuration - 0.01;
      const newTrimStart = Math.max(0, Math.min(maxTrim, dragRef.current.initialTrimStart + deltaSeconds));
      const diff = newTrimStart - dragRef.current.initialTrimStart;
      
      onUpdate({
        trimStart: newTrimStart,
        offset: dragRef.current.initialOffset + diff,
        duration: Math.max(0.01, dragRef.current.initialDuration - diff)
      });
    }
    else if (dragRef.current.type === 'trim-right') {
      const maxAllowedDuration = track.buffer.duration - dragRef.current.initialTrimStart;
      const newDuration = Math.max(0.01, Math.min(maxAllowedDuration, dragRef.current.initialDuration + deltaSeconds));
      onUpdate({ duration: newDuration });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
  };

  return (
    <div className="relative h-16 w-full">
      <div 
        className={`absolute h-14 rounded-xl overflow-hidden border transition-shadow touch-none select-none ${
          track.muted ? 'bg-black opacity-40 border-white/5' : 'bg-[#1a1a1a] border-white/10 shadow-lg active:border-orange-500 active:shadow-orange-500/20'
        }`}
        style={{ 
          width: `${track.duration * pixelsPerSecond}px`,
          left: `${track.offset * pixelsPerSecond}px` 
        }}
      >
        {/* Main Move Area */}
        <div 
          onPointerDown={(e) => handlePointerDown(e, 'move')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="absolute inset-x-8 inset-y-0 z-10 cursor-grab active:cursor-grabbing"
        />

        {/* Trim Left Handle */}
        <div 
          onPointerDown={(e) => handlePointerDown(e, 'trim-left')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="absolute left-0 top-0 bottom-0 w-8 z-20 cursor-ew-resize hover:bg-orange-500/10 flex items-center justify-center group active:bg-orange-500/20"
        >
          <div className="w-1 h-6 bg-white/10 rounded-full group-active:bg-orange-500" />
        </div>

        {/* Trim Right Handle */}
        <div 
          onPointerDown={(e) => handlePointerDown(e, 'trim-right')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="absolute right-0 top-0 bottom-0 w-8 z-20 cursor-ew-resize hover:bg-orange-500/10 flex items-center justify-center group active:bg-orange-500/20"
        >
          <div className="w-1 h-6 bg-white/10 rounded-full group-active:bg-orange-500" />
        </div>

        {/* Waveform container */}
        <div 
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ 
            left: `-${track.trimStart * pixelsPerSecond}px`,
            width: `${track.buffer.duration * pixelsPerSecond}px`
          }}
        >
          <canvas 
            ref={canvasRef} 
            width={track.buffer.duration * pixelsPerSecond} 
            height={56} 
            className="w-full h-full opacity-40"
          />
        </div>

        {/* Info Overlay */}
        <div className="absolute top-1 left-9 right-1 z-30 flex items-center justify-between pointer-events-none">
          <div className="flex items-center gap-2">
            <div className="bg-black/80 backdrop-blur-md px-2 py-0.5 rounded text-[8px] font-bold text-white/50 uppercase tracking-widest border border-white/5 whitespace-nowrap overflow-hidden max-w-[120px] truncate">
              {track.name}
            </div>
            <div className="bg-orange-500/20 text-orange-500 text-[7px] font-bold px-1 rounded border border-orange-500/20">
              {track.duration.toFixed(1)}s
            </div>
          </div>
          
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="w-6 h-6 bg-red-500/20 text-red-500 rounded-lg flex items-center justify-center active:scale-90 transition-transform pointer-events-auto border border-red-500/20"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

function formatTimeShort(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
