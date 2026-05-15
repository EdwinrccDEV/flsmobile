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
  GripVertical,
  Plus,
  Layers,
  Piano,
  Sliders,
  Scissors,
  FileAudio,
  FolderOpen,
  Keyboard,
  Activity
} from 'lucide-react';
import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { motion, AnimatePresence } from 'motion/react';
import { 
  MidiNote,
  Pattern,
  ClipType,
  AudioClip,
  PatternClip,
  TrackClip,
  Instrument,
  PlaybackTrack,
  bufferToWav, 
  convertToMp3, 
  convertToOgg,
  drawWaveform 
} from '../lib/audioEngine';

const BASE_PIXELS_PER_SECOND = 40;
const SAMPLE_RATE = 44100;

type ViewType = 'playlist' | 'channelrack' | 'pianoroll' | 'mixer';

export default function AudioStudio() {
  // --- DAW STates ---
  const [activeView, setActiveView] = useState<ViewType>('playlist');
  const [instruments, setInstruments] = useState<Instrument[]>([
    { id: 'master-synth', name: 'FL Keys', type: 'synth', volume: 0.8, pan: 0, muted: false, solo: false, color: '#4facfe' }
  ]);
  const [patterns, setPatterns] = useState<Pattern[]>([
    { id: 'pattern-1', name: 'Pattern 1', notes: [], color: '#4facfe' }
  ]);
  const [clips, setClips] = useState<TrackClip[]>([]);
  const [playlistTracks, setPlaylistTracks] = useState<PlaybackTrack[]>(
    Array.from({ length: 10 }, (_, i) => ({ id: `track-${i}`, name: `Track ${i + 1}`, volume: 1, muted: false, solo: false, color: '#222' }))
  );
  
  const [selectedPatternId, setSelectedPatternId] = useState<string>('pattern-1');
  const [selectedInstrumentId, setSelectedInstrumentId] = useState<string>('master-synth');
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [bpm, setBpm] = useState(128);
  const [isExporting, setIsExporting] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<'mp3' | 'wav'>('mp3');
  const [projectName, setProjectName] = useState('Mi Mezcla');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [zoom, setZoom] = useState(1);

  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const pixelsPerSecond = useMemo(() => BASE_PIXELS_PER_SECOND * zoom, [zoom]);

  // --- Tone.js Refs ---
  const playersRef = useRef<Map<string, Tone.Player>>(new Map());
  const instrumentsRef = useRef<Map<string, any>>(new Map());
  const partsRef = useRef<Tone.Part[]>([]);

  useEffect(() => {
    // Initialize default synth
    if (!instrumentsRef.current.has('master-synth')) {
      const synth = new Tone.PolySynth(Tone.Synth).toDestination();
      instrumentsRef.current.set('master-synth', synth);
    }
  }, []);

  useEffect(() => {
    Tone.getTransport().bpm.value = bpm;
  }, [bpm]);

  const initTone = async () => {
    if (Tone.getContext().state !== 'running') {
      await Tone.start();
      console.log('Tone.js started');
    }
  };

  const stopAll = useCallback(() => {
    Tone.getTransport().stop();
    partsRef.current.forEach(part => part.dispose());
    partsRef.current = [];
    playersRef.current.forEach(p => p.stop());
    setIsPlaying(false);
  }, []);

  const startPlayback = useCallback(async () => {
    await initTone();
    stopAll();

    // Schedule Clips
    clips.forEach(clip => {
      if (clip.data.type === 'audio') {
        const player = playersRef.current.get(clip.id);
        if (player) {
          player.start(Tone.now() + clip.offset, (clip.data as AudioClip).trimStart, clip.duration);
        }
      } else {
        const pClip = clip.data as PatternClip;
        const pattern = patterns.find(p => p.id === pClip.patternId);
        const inst = instrumentsRef.current.get(pClip.instrumentId);
        if (pattern && inst) {
          const part = new Tone.Part((time, noteValue) => {
             inst.triggerAttackRelease(
               Tone.Frequency(noteValue.note, "midi").toNote(), 
               noteValue.duration, 
               time, 
               noteValue.velocity
             );
          }, pattern.notes.map(n => ({ ...n, time: n.time })));
          
          part.start(clip.offset);
          partsRef.current.push(part);
        }
      }
    });

    Tone.getTransport().start("+0.1", currentTime);
    setIsPlaying(true);
  }, [clips, patterns, instruments, currentTime, stopAll]);

  const pausePlayback = useCallback(() => {
    Tone.getTransport().pause();
    setCurrentTime(Tone.getTransport().seconds);
    setIsPlaying(false);
  }, []);

  const togglePlay = () => {
    if (isPlaying) {
      pausePlayback();
    } else {
      startPlayback();
    }
  };

  const stopPlayback = () => {
    Tone.getTransport().stop();
    setCurrentTime(0);
    setIsPlaying(false);
    stopAll();
  };

  const sliceAudio = async (buffer: AudioBuffer): Promise<{ start: number, end: number, note: number }[]> => {
    const data = buffer.getChannelData(0);
    const slices: { start: number, end: number, note: number }[] = [];
    const threshold = 0.1;
    const minSliceLength = 0.1; 
    let inSlice = false;
    let sliceStart = 0;

    for (let i = 0; i < data.length; i += 500) {
      const time = i / buffer.sampleRate;
      const amp = Math.abs(data[i]);
      
      if (!inSlice && amp > threshold) {
        inSlice = true;
        sliceStart = time;
      } else if (inSlice && amp < threshold / 2 && (time - sliceStart) > minSliceLength) {
        inSlice = false;
        slices.push({ start: sliceStart, end: time, note: 60 + slices.length });
        if (slices.length >= 16) break;
      }
    }
    if (inSlice) slices.push({ start: sliceStart, end: buffer.duration, note: 60 + slices.length });
    return slices;
  };

  const handleMidiImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const midi = new Midi(arrayBuffer);
      
      const newPatternId = `pattern-${Date.now()}`;
      const newNotes: MidiNote[] = [];

      midi.tracks.forEach(track => {
        track.notes.forEach(note => {
          newNotes.push({
            note: note.midi,
            time: note.time,
            duration: note.duration,
            velocity: note.velocity
          });
        });
      });

      const newPattern: Pattern = {
        id: newPatternId,
        name: file.name.replace('.mid', ''),
        notes: newNotes,
        color: '#f97316'
      };

      setPatterns(prev => [...prev, newPattern]);
      setSelectedPatternId(newPatternId);
    } catch (err) {
      console.error("MIDI import error", err);
    }
    if (e.target) e.target.value = '';
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    for (const file of files) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = await Tone.getContext().decodeAudioData(arrayBuffer);
        const name = file.name.toLowerCase();
        
        if (name.includes('slice') || name.includes('loop')) {
          const slices = await sliceAudio(buffer);
          const instId = `sampler-${Date.now()}`;
          
          const sampler = new Tone.Sampler({
            urls: { C4: URL.createObjectURL(new Blob([arrayBuffer])) },
          }).toDestination();
          
          instrumentsRef.current.set(instId, sampler);
          
          setInstruments(prev => [...prev, {
            id: instId, name: `Slicex: ${file.name}`, type: 'sampler',
            volume: 0.8, pan: 0, muted: false, solo: false, color: '#f97316',
            sampleBuffer: buffer, slices: slices
          }]);
          
          const patId = `pattern-slicex-${Date.now()}`;
          setPatterns(prev => [...prev, {
            id: patId, name: `Slices: ${file.name}`,
            notes: slices.map((s, i) => ({ note: s.note, time: i * 0.5, duration: 0.4, velocity: 0.8 })),
            color: '#f97316'
          }]);
        } else {
          const clipId = `audio-${Date.now()}`;
          const player = new Tone.Player(buffer).toDestination();
          playersRef.current.set(clipId, player);

          setClips(prev => [...prev, {
            id: clipId, trackId: 'track-0', offset: Tone.getTransport().seconds,
            duration: buffer.duration, data: { type: 'audio', buffer, trimStart: 0 }
          }]);
        }
      } catch (err) {
        console.error("Error decoding audio:", err);
      }
    }
    if (e.target) e.target.value = '';
  };

  const processFiles = async (files: File[], clearExisting: boolean) => {
    if (clearExisting) {
      setClips([]);
      playersRef.current.forEach(p => p.dispose());
      playersRef.current.clear();
    }
    setPendingFiles(null);
    const event = { target: { files } } as unknown as React.ChangeEvent<HTMLInputElement>;
    await handleFileUpload(event);
  };

  const handleTimelineClick = (e: React.MouseEvent | React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.clip-item')) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    let clientX;
    if ('touches' in e) clientX = e.touches[0].clientX;
    else clientX = (e as React.MouseEvent).clientX;

    const scrollLeft = (e.currentTarget as HTMLElement).scrollLeft || 0;
    const x = clientX - rect.left + scrollLeft;
    const newTime = Math.max(0, x / pixelsPerSecond);
    
    setCurrentTime(newTime);
    Tone.getTransport().seconds = newTime;
    
    if (isPlaying) {
      startPlayback();
    }
  };

  const exportProject = async () => {
    if (clips.length === 0) return;
    if (isPlaying) pausePlayback();

    setIsExporting(true);
    setExportUrl(null);

    const maxDuration = Math.max(...clips.map(c => c.offset + c.duration));
    
    try {
      const renderedBuffer = await Tone.Offline(async () => {
        for (const clip of clips) {
          if (clip.data.type === 'audio') {
            const player = new Tone.Player(clip.data.buffer).toDestination();
            player.start(clip.offset, clip.data.trimStart, clip.duration);
          } else {
            const pClip = clip.data as PatternClip;
            const pattern = patterns.find(p => p.id === pClip.patternId);
            const inst = instruments.find(i => i.id === pClip.instrumentId);
            if (pattern && inst) {
              const synth = new Tone.PolySynth(Tone.Synth).toDestination();
              pattern.notes.forEach(note => {
                synth.triggerAttackRelease(
                  Tone.Frequency(note.note, "midi").toNote(),
                  note.duration,
                  note.time + clip.offset,
                  note.velocity
                );
              });
            }
          }
        }
      }, maxDuration);

      let blob;
      if (exportFormat === 'mp3') blob = await convertToMp3(renderedBuffer.get());
      else if (exportFormat === 'ogg') blob = await convertToMp3(renderedBuffer.get()); 
      else blob = bufferToWav(renderedBuffer.get());

      setExportUrl(URL.createObjectURL(blob));
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => {
      if (isPlaying) {
        setCurrentTime(Tone.getTransport().seconds);
      }
    }, 50);
    return () => clearInterval(timer);
  }, [isPlaying]);

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

      <header className="flex items-center justify-between px-3 h-14 border-b border-white/5 bg-[#0a0a0a] z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 mr-4">
            <div className="p-1.5 bg-orange-500 rounded-md">
              <Music className="w-4 h-4 text-black" />
            </div>
            <span className="font-black text-sm tracking-tighter italic">FL-WEB</span>
          </div>

          <div className="flex items-center gap-1 bg-white/5 p-1 rounded-lg">
            <button 
              onClick={() => setActiveView('playlist')}
              className={`p-2 rounded-md transition-all ${activeView === 'playlist' ? 'bg-orange-500 text-black shadow-lg shadow-orange-500/20' : 'text-white/40 hover:bg-white/5'}`}
            >
              <Layers className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setActiveView('pianoroll')}
              className={`p-2 rounded-md transition-all ${activeView === 'pianoroll' ? 'bg-orange-500 text-black shadow-lg shadow-orange-500/20' : 'text-white/40 hover:bg-white/5'}`}
            >
              <Piano className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setActiveView('channelrack')}
              className={`p-2 rounded-md transition-all ${activeView === 'channelrack' ? 'bg-orange-500 text-black shadow-lg shadow-orange-500/20' : 'text-white/40 hover:bg-white/5'}`}
            >
              <Keyboard className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setActiveView('mixer')}
              className={`p-2 rounded-md transition-all ${activeView === 'mixer' ? 'bg-orange-500 text-black shadow-lg shadow-orange-500/20' : 'text-white/40 hover:bg-white/5'}`}
            >
              <Sliders className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-3 ml-4 bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">
            <Activity className="w-3.5 h-3.5 text-orange-500" />
            <div className="flex flex-col leading-none">
              <input 
                type="number" 
                value={bpm} 
                onChange={(e) => setBpm(parseInt(e.target.value))}
                className="bg-transparent border-none text-[10px] font-black w-8 focus:outline-none p-0"
              />
              <span className="text-[6px] text-white/40 font-bold">BPM</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
            <button onClick={() => setZoom(z => Math.max(0.5, z - 0.2))} className="p-1 hover:bg-white/10 rounded"><ZoomOut className="w-4 h-4" /></button>
            <span className="text-[10px] w-8 text-center opacity-50 font-mono">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(4, z + 0.2))} className="p-1 hover:bg-white/10 rounded"><ZoomIn className="w-4 h-4" /></button>
          </div>

          <button 
            onClick={exportProject}
            disabled={clips.length === 0 || isExporting}
            className="bg-orange-500 text-black px-4 py-1.5 rounded-lg font-black text-[10px] disabled:opacity-50 transition-all active:scale-95 flex items-center gap-2 shadow-lg shadow-orange-500/20"
          >
            {isExporting ? <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="w-3 h-3 border-2 border-black/30 border-t-black rounded-full" /> : <Download className="w-3 h-3" />}
            {isExporting ? "EXPORTING..." : "EXPORT"}
          </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden relative">
        {/* Left Toolbar: Browser & Shortcuts */}
        <div className="w-14 bg-[#0a0a0a] border-r border-white/5 flex flex-col items-center py-4 gap-6 z-40">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
            className={`p-2.5 rounded-xl transition-colors ${isSidebarOpen ? 'bg-orange-500 text-black' : 'text-white/40 hover:bg-white/5 border border-white/5'}`}
          >
            <FolderOpen className="w-5 h-5" />
          </button>
          
          <label className="p-2.5 text-orange-500 hover:bg-orange-500/10 rounded-xl cursor-pointer transition-colors active:scale-95 border border-orange-500/10 relative">
            <FileAudio className="w-5 h-5" />
            <input type="file" className="hidden" multiple accept=".mp3,.wav,.ogg,.m4a,.aac,.flac" onChange={handleFileUpload} />
          </label>

          <label className="p-2.5 text-blue-500 hover:bg-blue-500/10 rounded-xl cursor-pointer transition-colors active:scale-95 border border-blue-500/10">
            <Music className="w-5 h-5" />
            <input type="file" className="hidden" accept=".mid,.midi" onChange={handleMidiImport} />
          </label>
        </div>

        <AnimatePresence>
          {isSidebarOpen && (
            <motion.aside 
              initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }}
              className="w-64 bg-[#0d0d0d] border-r border-white/5 flex flex-col z-30"
            >
              <div className="p-4 border-b border-white/5 bg-white/5">
                <span className="font-black text-[10px] tracking-widest opacity-40 uppercase">Browser</span>
              </div>
              
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                <div className="px-2 py-1 text-[10px] font-bold text-white/20 uppercase tracking-tighter">Instruments</div>
                {instruments.map(inst => (
                  <button 
                    key={inst.id}
                    onClick={() => { setSelectedInstrumentId(inst.id); setActiveView('channelrack'); }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-colors ${selectedInstrumentId === inst.id ? 'bg-orange-500/10 text-orange-500' : 'text-white/40 hover:bg-white/5'}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: inst.color }} />
                      <span className="truncate max-w-[120px]">{inst.name}</span>
                    </div>
                  </button>
                ))}

                <div className="px-2 py-1 mt-4 text-[10px] font-bold text-white/20 uppercase tracking-tighter">Patterns</div>
                {patterns.map(pat => (
                  <button 
                    key={pat.id}
                    onClick={() => { setSelectedPatternId(pat.id); setActiveView('pianoroll'); }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-colors ${selectedPatternId === pat.id ? 'bg-orange-500/10 text-orange-500' : 'text-white/40 hover:bg-white/5'}`}
                  >
                    <div className="flex items-center gap-2">
                       <Layers className="w-3 h-3" />
                       <span className="truncate max-w-[120px]">{pat.name}</span>
                    </div>
                    <span className="text-[10px] opacity-20">{pat.notes.length}</span>
                  </button>
                ))}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        <div className="flex-1 flex flex-col relative overflow-hidden bg-[#050505]">
          {activeView === 'playlist' && (
             <PlaylistView 
                clips={clips}
                tracks={playlistTracks}
                pixelsPerSecond={pixelsPerSecond}
                currentTime={currentTime}
                onTimelineClick={handleTimelineClick}
                onUpdateClip={(id, updates) => setClips(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c))}
                onDeleteClip={(id) => setClips(prev => prev.filter(c => c.id !== id))}
             />
          )}

          {activeView === 'channelrack' && (
            <ChannelRackView 
              instruments={instruments}
              patterns={patterns}
              onUpdateInstrument={(id, updates) => setInstruments(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i))}
              onAddPattern={() => setPatterns(prev => [...prev, { id: `pat-${Date.now()}`, name: `Pattern ${prev.length + 1}`, notes: [], color: '#4facfe' }])}
            />
          )}

          {activeView === 'pianoroll' && (
             <PianoRollView 
                pattern={patterns.find(p => p.id === selectedPatternId)!}
                instrument={instruments.find(i => i.id === selectedInstrumentId)!}
                onUpdatePattern={(updates) => setPatterns(prev => prev.map(p => p.id === selectedPatternId ? { ...p, ...updates } : p))}
             />
          )}

          {activeView === 'mixer' && <MixerView tracks={playlistTracks} instruments={instruments} />}
        </div>

        {/* Right Toolbar: Playback Controls */}
        <div className="w-16 bg-[#0a0a0a] border-l border-white/5 flex flex-col items-center py-6 gap-6 z-40">
           <button 
             onClick={togglePlay}
             className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${isPlaying ? 'bg-red-500 shadow-lg shadow-red-500/20' : 'bg-orange-500 shadow-lg shadow-orange-500/20'} active:scale-90`}
           >
             {isPlaying ? <Square className="w-5 h-5 text-black" fill="currentColor" /> : <Play className="w-5 h-5 text-black ml-1" fill="currentColor" />}
           </button>
           
           <button 
             onClick={stopPlayback}
             className="w-10 h-10 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl flex items-center justify-center text-white/20 active:scale-95"
           >
             <Square className="w-4 h-4" />
           </button>

           <div className="mt-auto flex flex-col items-center leading-none mb-4">
              <span className="text-orange-500 font-mono text-[10px] font-black">{formatTimeShort(currentTime)}</span>
              <span className="text-[6px] text-white/20 font-bold uppercase mt-1">Time</span>
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

// --- Sub-components ---

interface PlaylistViewProps {
  clips: TrackClip[];
  tracks: PlaybackTrack[];
  pixelsPerSecond: number;
  currentTime: number;
  onTimelineClick: (e: React.MouseEvent | React.TouchEvent) => void;
  onUpdateClip: (id: string, updates: Partial<TrackClip>) => void;
  onDeleteClip: (id: string) => void;
}

const PlaylistView: React.FC<PlaylistViewProps> = ({ 
  clips, tracks, pixelsPerSecond, currentTime, onTimelineClick, onUpdateClip, onDeleteClip 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const maxWidth = Math.max(window.innerWidth, ...clips.map(c => (c.offset + c.duration) * pixelsPerSecond + 1000));

  return (
    <div ref={containerRef} className="flex-1 overflow-auto relative select-none">
      <div 
        onClick={onTimelineClick}
        className="relative min-h-full"
        style={{ width: `${maxWidth}px` }}
      >
        {/* Timeline Header */}
        <div className="h-6 bg-[#0a0a0a] border-b border-white/5 sticky top-0 z-40 flex items-end">
          {Array.from({ length: Math.ceil(maxWidth / pixelsPerSecond) + 1 }).map((_, i) => (
            <div key={i} className="absolute bottom-0 border-l border-white/10 h-2" style={{ left: `${i * pixelsPerSecond}px` }}>
              <span className="absolute -top-4 -left-2 text-[8px] text-white/20 font-mono tracking-tighter">{i}s</span>
            </div>
          ))}
        </div>

        {/* Lane Grid */}
        <div className="absolute inset-x-0 top-6 bottom-0 pointer-events-none opacity-[0.03]">
          {tracks.map((_, i) => (
            <div key={i} className="h-16 border-b border-white" />
          ))}
          <div className="absolute inset-0" style={{ backgroundImage: `linear-gradient(to right, white 1px, transparent 1px)`, backgroundSize: `${pixelsPerSecond}px 100%` }} />
        </div>

        {/* Tracks List (Lanes) */}
        <div className="mt-4 space-y-2 relative z-20">
          {tracks.map((track) => (
            <div key={track.id} className="h-16 flex group">
              <div className="w-10 flex-shrink-0 bg-[#0a0a0a] border-r border-white/5 flex items-center justify-center relative">
                 <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: track.color }} />
                 <span className="[writing-mode:vertical-lr] rotate-180 text-[7px] font-black text-white/20 uppercase tracking-widest">{track.name}</span>
              </div>
              <div className="flex-1 relative">
                {clips.filter(c => c.trackId === track.id).map(clip => (
                  <ClipItem 
                    key={clip.id}
                    clip={clip}
                    pixelsPerSecond={pixelsPerSecond}
                    onUpdate={(u) => onUpdateClip(clip.id, u)}
                    onDelete={() => onDeleteClip(clip.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Playhead */}
        <div 
          className="absolute top-0 bottom-0 w-[1px] bg-red-500 z-30 pointer-events-none shadow-[0_0_15px_rgba(239,68,68,0.8)]"
          style={{ left: `${currentTime * pixelsPerSecond}px` }}
        >
          <div className="w-3 h-3 bg-red-500 rounded-full -translate-x-[5.5px] mt-[1.5px] shadow-lg border border-white/20" />
        </div>
      </div>
    </div>
  );
};

const ClipItem: React.FC<{ 
  clip: TrackClip, pixelsPerSecond: number, onUpdate: (u: Partial<TrackClip>) => void, onDelete: () => void 
}> = ({ clip, pixelsPerSecond, onUpdate, onDelete }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ startX: number, initialOffset: number } | null>(null);

  useEffect(() => {
    if (clip.data.type === 'audio' && canvasRef.current) {
      drawWaveform(clip.data.buffer, canvasRef.current, '#f97316');
    }
  }, [clip]);

  return (
    <motion.div
      drag="x"
      dragMomentum={false}
      onDrag={(_, info) => {
        const deltaSeconds = info.delta.x / pixelsPerSecond;
        onUpdate({ offset: Math.max(0, clip.offset + deltaSeconds) });
      }}
      className={`absolute h-14 rounded-lg border overflow-hidden cursor-grab active:cursor-grabbing transition-shadow ${clip.data.type === 'audio' ? 'bg-[#1a1a1a] border-orange-500/30' : 'bg-[#1a1a1a] border-blue-500/30'}`}
      style={{ 
        width: `${clip.duration * pixelsPerSecond}px`,
        left: `${clip.offset * pixelsPerSecond}px`
      }}
    >
      {clip.data.type === 'audio' ? (
        <div className="absolute inset-0 opacity-20">
          <canvas ref={canvasRef} width={clip.duration * pixelsPerSecond} height={56} className="w-full h-full" />
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center opacity-10">
           <Piano className="w-8 h-8" />
        </div>
      )}
      <div className="absolute top-1 left-2 flex items-center gap-2">
         <span className="text-[8px] font-black uppercase tracking-tighter bg-black/60 px-1.5 rounded">{clip.data.type === 'audio' ? 'AUDIO' : 'PATTERN'}</span>
         <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-0.5 hover:text-red-500 transition-colors"><Trash2 className="w-3 h-3"/></button>
      </div>
    </motion.div>
  );
};

interface ChannelRackViewProps {
  instruments: Instrument[];
  patterns: Pattern[];
  onUpdateInstrument: (id: string, updates: Partial<Instrument>) => void;
  onAddPattern: () => void;
}

const ChannelRackView: React.FC<ChannelRackViewProps> = ({ instruments, patterns, onUpdateInstrument, onAddPattern }) => {
  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-black italic tracking-tighter uppercase">Channel Rack</h2>
        <button onClick={onAddPattern} className="bg-orange-500 text-black px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2">
           <Plus className="w-4 h-4" /> ADD CHANNEL
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2">
        {instruments.map(inst => (
          <div key={inst.id} className="flex items-center gap-4 bg-[#111] p-3 rounded-2xl border border-white/5 group hover:border-orange-500/20 transition-all">
            <div className="flex items-center gap-2">
                <div className="w-1 h-8 rounded-full" style={{ backgroundColor: inst.color }} />
                <button className="w-8 h-8 bg-white/5 rounded-lg flex items-center justify-center"><Volume2 className="w-4 h-4 opacity-40" /></button>
            </div>
            
            <div className="flex-1">
              <span className="text-xs font-bold opacity-80">{inst.name}</span>
              <div className="text-[8px] text-white/20 uppercase font-black tracking-widest">{inst.type}</div>
            </div>

            <div className="flex gap-1">
              {Array.from({ length: 16 }).map((_, i) => (
                <div 
                  key={i} 
                  className={`w-6 h-8 rounded-sm transition-all cursor-pointer ${i % 4 === 0 ? 'opacity-100' : 'opacity-40'} ${i < 4 || (i >= 8 && i < 12) ? 'bg-[#333]' : 'bg-[#555]'}`}
                />
              ))}
            </div>

            <button className="p-2 text-white/10 hover:text-white/40"><Settings2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );
};

interface PianoRollViewProps {
  pattern: Pattern;
  instrument: Instrument;
  onUpdatePattern: (updates: Partial<Pattern>) => void;
}

const PianoRollView: React.FC<PianoRollViewProps> = ({ pattern, instrument, onUpdatePattern }) => {
  const [activeNotes, setActiveNotes] = useState<MidiNote[]>(pattern.notes || []);
  
  useEffect(() => {
     onUpdatePattern({ notes: activeNotes });
  }, [activeNotes]);

  const toggleNote = (note: number, time: number) => {
    setActiveNotes(prev => {
      const exists = prev.find(n => n.note === note && Math.abs(n.time - time) < 0.1);
      if (exists) return prev.filter(n => n !== exists);
      return [...prev, { note, time, duration: 0.5, velocity: 0.8 }];
    });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-white/5 flex items-center justify-between bg-[#0a0a0a]">
        <div className="flex items-center gap-3">
           <Piano className="w-5 h-5 text-orange-500" />
           <div>
              <span className="text-xs font-black uppercase text-white/80">{pattern?.name || 'Piano Roll'}</span>
              <span className="text-[8px] text-white/20 block tracking-widest">TARGET: {instrument?.name}</span>
           </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Piano Keys */}
        <div className="w-16 bg-[#0a0a0a] border-r border-white/5 flex flex-col-reverse overflow-y-auto">
          {Array.from({ length: 48 }).map((_, i) => {
            const note = 36 + i;
            const isBlack = [1, 3, 6, 8, 10].includes(note % 12);
            return (
              <div 
                key={note} 
                className={`h-6 flex-shrink-0 border-b border-white/5 px-2 flex items-center justify-end text-[8px] font-mono ${isBlack ? 'bg-black text-white/20' : 'bg-[#222] text-white/60'}`}
              >
                {Tone.Frequency(note, "midi").toNote()}
              </div>
            );
          })}
        </div>

        {/* Note Grid */}
        <div className="flex-1 flex overflow-auto">
          <div className="relative min-w-full" style={{ width: '2000px', height: `${48 * 24}px` }}>
            <div className="flex flex-col-reverse h-full">
               {Array.from({ length: 48 }).map((_, i) => (
                 <div key={i} className="h-6 flex border-b border-white/5">
                    {Array.from({ length: 32 }).map((_, j) => {
                       const note = 36 + i;
                       const time = j * 0.5;
                       const isSelected = activeNotes.find(n => n.note === note && Math.abs(n.time - time) < 0.1);
                       return (
                         <div 
                           key={j} 
                           onClick={() => toggleNote(note, time)}
                           className={`w-12 h-6 border-r border-white/5 cursor-pointer hover:bg-white/5 transition-colors ${isSelected ? 'bg-orange-500 shadow-inner' : ''}`}
                         />
                       );
                    })}
                 </div>
               ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const MixerView: React.FC<{ tracks: PlaybackTrack[], instruments: Instrument[] }> = ({ tracks, instruments }) => {
  return (
    <div className="flex-1 flex p-6 bg-[#0a0a0a]/50 gap-2 overflow-x-auto">
       <div className="w-24 bg-[#111] rounded-2xl border border-white/5 flex flex-col p-3 mr-4">
          <span className="text-[8px] font-black text-white/20 uppercase tracking-widest text-center mb-4">Master</span>
          <div className="flex-1 bg-black/40 rounded-lg relative overflow-hidden flex flex-col-reverse p-1">
             <div className="h-[70%] bg-gradient-to-t from-orange-500 to-red-500 rounded-sm opacity-50 shadow-[0_0_10px_rgba(249,115,22,0.5)]" />
          </div>
          <div className="h-24 mt-4 flex items-center justify-center">
             <div className="w-1 h-full bg-white/5 rounded-full relative">
                <div className="absolute top-[30%] left-1/2 -translate-x-1/2 w-4 h-6 bg-[#555] rounded-sm border border-white/10" />
             </div>
          </div>
       </div>

       {tracks.map(track => (
          <div key={track.id} className="w-16 bg-[#111] rounded-2xl border border-white/5 flex flex-col p-2 group hover:border-orange-500/20 transition-all">
             <span className="text-[7px] font-black text-white/20 uppercase tracking-tighter truncate text-center mb-4">{track.name}</span>
             <div className="flex-1 bg-black rounded-lg relative overflow-hidden flex flex-col-reverse p-0.5">
                <div className="h-[40%] bg-orange-500/20 rounded-sm" />
             </div>
             <div className="h-20 mt-4 flex items-center justify-center">
                <div className="w-0.5 h-full bg-white/5 rounded-full relative">
                   <div className="absolute top-[50%] left-1/2 -translate-x-1/2 w-3 h-5 bg-[#333] rounded-sm border border-white/5" />
                </div>
             </div>
             <div className="mt-2 flex gap-1 justify-center">
                <div className="w-3 h-3 bg-red-900 rounded-full cursor-pointer" title="Solo" />
                <div className="w-3 h-3 bg-red-500 rounded-full cursor-pointer" title="Mute" />
             </div>
          </div>
       ))}
    </div>
  );
};

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
