import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Play, Pause, Activity, MonitorPlay, Maximize } from 'lucide-react';
import type { McapIndexedReader } from '@mcap/core';

import { parseMcap, parseCompressedVideo, type CompressedVideo } from '../lib/mcapReader';
import { EventBus } from '../lib/EventBus';

export const videoEventBus = new EventBus<{ topic: string, frame: CompressedVideo, logTime: bigint }>();

function formatTime(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);

  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');

  if (h > 0) {
    const hh = h.toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

interface DashboardProps {
  file: File;
  onClose: () => void;
}

export default function Dashboard({ file, onClose }: DashboardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [parsing, setParsing] = useState(true);
  const [mcapData, setMcapData] = useState<{
    reader: McapIndexedReader;
    startTime: bigint;
    endTime: bigint;
    channels: ReadonlyMap<number, { topic: string }>;
  } | null>(null);

  const [initialFrames, setInitialFrames] = useState<Record<string, CompressedVideo>>({});

  // Playback state
  const currentTimeRef = useRef<bigint>(0n);
  const readHeadRef = useRef<bigint>(0n);
  const isPlayingRef = useRef<boolean>(false);
  const [displayProgress, setDisplayProgress] = useState(0);

  // Sync refs with state
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    let mounted = true;
    setParsing(true);

    parseMcap(file).then(async (metadata) => {
      if (!mounted) return;
      console.log("Parsed Metadata:", metadata);
      setMcapData({
        ...metadata,
        channels: metadata.channels
      });

      // Fetch first frame for all video channels to populate the dashboard
      const reader = metadata.reader;
      const videoTopics = [
        "/camera/primary/lens_0/video",
        "/camera/primary/lens_1/video",
        "/camera/secondary/lens_2/video",
        "/camera/secondary/lens_3/video",
        "/camera/secondary/lens_4/video",
        "/camera/secondary/lens_5/video"
      ];

      try {
        const messages = reader.readMessages({
          topics: videoTopics,
          startTime: metadata.startTime,
          endTime: metadata.startTime + 1000000000n // first second
        });

        const newFrames: Record<string, CompressedVideo> = {};
        for await (const msg of messages) {
          const channel = metadata.channels.get(msg.channelId);
          if (!channel) continue;
          const topic = channel.topic;

          if (!newFrames[topic]) {
            try {
              const video = parseCompressedVideo(msg.data);
              console.log(`Parsed ${topic}: format="${video.format}", data length=${video.data.length}`);
              newFrames[topic] = video;
            } catch (e) {
              console.error(`Failed to parse CompressedVideo for ${topic}`, e);
            }
          }
          if (Object.keys(newFrames).length === videoTopics.length) {
            break; // got all first frames
          }
        }
        if (mounted) {
          setInitialFrames(newFrames);
        }
      } catch (e) {
        console.error("Error fetching initial frames:", e);
      } finally {
        if (mounted) setParsing(false);
      }

    }).catch(err => {
      console.error(err);
      if (mounted) setParsing(false);
    });

    return () => {
      mounted = false;
    };
  }, [file]);

  // PLAYBACK ENGINE
  useEffect(() => {
    if (!mcapData) return;

    let active = true;
    let lastFrameTime = performance.now();

    const playbackLoop = async () => {
      while (active) {
        if (isPlayingRef.current) {
          const now = performance.now();
          const deltaMs = now - lastFrameTime;
          lastFrameTime = now;

          // Advance time by deltaMs if not buffering
          const playTimeNs = mcapData.startTime + currentTimeRef.current;
          const isBuffering = Math.abs(Number(readHeadRef.current - playTimeNs)) > 1_000_000_000;
          if (!isBuffering) {
            currentTimeRef.current += BigInt(Math.floor(deltaMs * 1_000_000));
          }

          // Wrap around at the end
          const totalDuration = mcapData.endTime - mcapData.startTime;
          if (currentTimeRef.current > totalDuration) {
            currentTimeRef.current = totalDuration;
            setIsPlaying(false); // Stop at end
          }

          // Update UI progress (throttle for performance, approx 10Hz)
          const progressPct = Number((currentTimeRef.current * 10000n) / totalDuration) / 100;
          setDisplayProgress(progressPct);
        } else {
          lastFrameTime = performance.now();
        }
        await new Promise(r => setTimeout(r, 16)); // ~60hz
      }
    };

    const messagePump = async () => {
      readHeadRef.current = mcapData.startTime;

      while (active) {
        // Wait until we are playing
        if (!isPlayingRef.current) {
          await new Promise(r => setTimeout(r, 50));
          // Sync read head when paused
          readHeadRef.current = mcapData.startTime + currentTimeRef.current;
          continue;
        }

        // Start a continuous stream from the current readHead
        const messages = mcapData.reader.readMessages({
          startTime: readHeadRef.current,
          endTime: mcapData.endTime
        });

        for await (const msg of messages) {
          if (!active) break;

          // If user scrubbed or paused, break this stream and restart
          if (!isPlayingRef.current) break;
          const currentPlayTime = mcapData.startTime + currentTimeRef.current;
          if (Math.abs(Number(msg.logTime - currentPlayTime)) > 1_000_000_000) {
            // If read head is completely out of sync (e.g. user scrubbed), break and restart
            readHeadRef.current = currentPlayTime;
            break;
          }

          const channel = mcapData.channels.get(msg.channelId);
          if (!channel) continue;

          if (channel.topic.includes('/video')) {
            try {
              const video = parseCompressedVideo(msg.data);
              videoEventBus.emit({ topic: channel.topic, frame: video, logTime: msg.logTime });
            } catch (e) {
              // Ignore parsing errors for speed
            }
          }

          // Throttle reading to stay at most 200ms ahead of playback time
          readHeadRef.current = msg.logTime;
          while (active && isPlayingRef.current) {
            const playTimeNs = mcapData.startTime + currentTimeRef.current;
            if (readHeadRef.current > playTimeNs + 200_000_000n) {
              await new Promise(r => setTimeout(r, 10)); // Sleep briefly
            } else {
              break;
            }
          }
        }
      }
    };

    playbackLoop();
    messagePump();

    return () => {
      active = false;
    };
  }, [mcapData]);



  return (
    <div className="flex h-screen w-full flex-col bg-surface-soft text-ink font-sans overflow-hidden">
      {/* AIRBNB STYLE TOP NAVIGATION */}
      <header className="flex h-[80px] items-center justify-between border-b border-hairline px-6 lg:px-10 bg-canvas shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-surface-soft transition-colors text-ink">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="h-6 w-px bg-hairline" />
          <div className="flex items-center gap-3">
            <MonitorPlay className="w-6 h-6 text-primary" />
            <span className="truncate max-w-[200px] md:max-w-sm text-[16px] font-semibold tracking-tight text-ink">{file.name}</span>
          </div>
        </div>

        <div className="flex items-center gap-6 text-[14px] font-semibold text-ink">
          <button onClick={() => document.documentElement.classList.toggle('dark')} className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-surface-soft transition-colors text-ink">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
          </button>
        </div>
      </header>


      {/* VIDEO GRID */}
      <main className="flex-1 flex flex-col p-4 md:p-6 lg:p-8 gap-4 md:gap-6 min-h-0 bg-canvas overflow-y-auto max-w-[1440px] w-full mx-auto relative">
        {parsing && (
          <div className="absolute inset-4 md:inset-6 lg:inset-8 z-10 flex items-center justify-center bg-canvas/40 backdrop-blur-sm rounded-md">
            <div className="flex flex-col items-center gap-4 bg-surface-card px-8 py-6 rounded-xl shadow-airbnb border border-hairline">
              <Activity className="w-10 h-10 text-primary animate-spin" />
              <p className="text-[16px] font-medium text-ink">Preparing videos...</p>
            </div>
          </div>
        )}
        {/* Top row: 2 primary cameras */}
        <div className="flex-1 flex flex-col md:flex-row gap-4 md:gap-6 min-h-0">
          <VideoPanel title="/camera/primary/lens_0/video" resolution="1920x1200" frame={initialFrames["/camera/primary/lens_0/video"]} currentTimeRef={currentTimeRef} startTime={mcapData?.startTime} />
          <VideoPanel title="/camera/primary/lens_1/video" resolution="1920x1200" frame={initialFrames["/camera/primary/lens_1/video"]} currentTimeRef={currentTimeRef} startTime={mcapData?.startTime} />
        </div>
        {/* Bottom row: 4 secondary cameras */}
        <div className="h-1/3 flex flex-wrap md:flex-nowrap gap-4 md:gap-6 min-h-0">
          <VideoPanel title="/camera/secondary/lens_2/video" resolution="640x480" frame={initialFrames["/camera/secondary/lens_2/video"]} currentTimeRef={currentTimeRef} startTime={mcapData?.startTime} />
          <VideoPanel title="/camera/secondary/lens_3/video" resolution="640x480" frame={initialFrames["/camera/secondary/lens_3/video"]} currentTimeRef={currentTimeRef} startTime={mcapData?.startTime} />
          <VideoPanel title="/camera/secondary/lens_4/video" resolution="640x480" frame={initialFrames["/camera/secondary/lens_4/video"]} currentTimeRef={currentTimeRef} startTime={mcapData?.startTime} />
          <VideoPanel title="/camera/secondary/lens_5/video" resolution="640x480" frame={initialFrames["/camera/secondary/lens_5/video"]} currentTimeRef={currentTimeRef} startTime={mcapData?.startTime} />
        </div>
      </main>

      <footer className="h-[80px] bg-canvas border-t border-hairline flex flex-col justify-center px-6 lg:px-10 shrink-0">
        <div className="flex items-center gap-6">
          {/* Play/Pause Button */}
          <button
            className="flex items-center justify-center w-12 h-12 bg-surface-soft hover:bg-hairline-soft rounded-full text-ink transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => {
              if (!isPlaying && mcapData) {
                const totalDuration = mcapData.endTime - mcapData.startTime;
                if (currentTimeRef.current >= totalDuration) {
                  currentTimeRef.current = 0n;
                  setDisplayProgress(0);
                }
              }
              setIsPlaying(!isPlaying);
            }}
            disabled={parsing}
          >
            {parsing ? <Activity className="w-5 h-5 animate-spin text-ink" /> : isPlaying ? <Pause className="w-5 h-5 fill-ink" /> : <Play className="w-5 h-5 fill-ink ml-1" />}
          </button>

          {/* Timeline */}
          <div className="flex-1 flex flex-col gap-2">
            <div className="flex-1 flex items-center gap-2 group relative h-6 cursor-pointer" onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pos = (e.clientX - rect.left) / rect.width;
              const targetPct = Math.max(0, Math.min(1, pos));

              if (mcapData) {
                const totalDuration = mcapData.endTime - mcapData.startTime;
                currentTimeRef.current = BigInt(Math.floor(targetPct * Number(totalDuration)));
                setDisplayProgress(targetPct * 100);
              }
            }}>
              {/* Progress bar line */}
              <div className="h-2 w-full bg-surface-soft rounded-full relative overflow-hidden group-hover:bg-hairline-soft transition-colors">
                <div
                  className="absolute top-0 bottom-0 left-0 bg-primary"
                  style={{ width: `${displayProgress}%` }}
                />
              </div>
              {/* Playhead dot */}
              <div
                className="absolute w-4 h-4 bg-primary rounded-full top-1/2 -translate-y-1/2 pointer-events-none transition-transform group-hover:scale-125 shadow-airbnb"
                style={{ left: `calc(${displayProgress}% - 8px)` }}
              />
            </div>
          </div>

          <div className="text-[14px] font-medium text-muted whitespace-nowrap min-w-[120px] text-right">
            {mcapData ? (
              <>
                <span className="text-ink">
                  {formatTime(Math.floor(Number(currentTimeRef.current / 1_000_000_000n)))}
                </span>
                <span className="mx-1">/</span>
                {formatTime(Math.floor(Number((mcapData.endTime - mcapData.startTime) / 1_000_000_000n)))}
              </>
            ) : 'Loading...'}
          </div>
        </div>
      </footer>
    </div>
  );
}
function VideoPanel({ title, resolution, frame: initialFrame, currentTimeRef, startTime }: {
  title: string,
  resolution: string,
  frame?: CompressedVideo,
  currentTimeRef?: React.RefObject<bigint>,
  startTime?: bigint
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);

  // Frame queue for synchronization
  const frameQueue = useRef<{ bmp?: ImageBitmap, vf?: VideoFrame, logTime: bigint }[]>([]);

  // Render loop synchronized to currentTimeRef
  useEffect(() => {
    let rafId: number;
    const renderLoop = () => {
      rafId = requestAnimationFrame(renderLoop);

      if (!canvasRef.current || !currentTimeRef || !currentTimeRef.current || !startTime) return;
      const currentAbsoluteNs = startTime + currentTimeRef.current;
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;

      const queue = frameQueue.current;
      if (queue.length === 0) return;

      // Find the best frame (closest past frame)
      let bestIdx = -1;
      for (let i = 0; i < queue.length; i++) {
        if (queue[i].logTime <= currentAbsoluteNs) {
          bestIdx = i;
        } else {
          break; // queue is sorted by time
        }
      }

      if (bestIdx !== -1) {
        const frameToDraw = queue[bestIdx];
        // Draw it
        if (frameToDraw.bmp) {
          canvasRef.current.width = frameToDraw.bmp.width;
          canvasRef.current.height = frameToDraw.bmp.height;
          ctx.drawImage(frameToDraw.bmp, 0, 0);
        } else if (frameToDraw.vf) {
          canvasRef.current.width = frameToDraw.vf.displayWidth;
          canvasRef.current.height = frameToDraw.vf.displayHeight;
          ctx.drawImage(frameToDraw.vf, 0, 0);
        }

        // Drop older frames and the drawn frame (keep it on canvas)
        const dropped = queue.splice(0, bestIdx + 1);
        for (const d of dropped) {
          if (d.bmp) d.bmp.close();
          if (d.vf) d.vf.close();
        }
      }

      // Cleanup frames that are way too far in the future or queue is too big
      if (queue.length > 60) {
        const excess = queue.splice(0, queue.length - 60);
        for (const e of excess) {
          if (e.bmp) e.bmp.close();
          if (e.vf) e.vf.close();
        }
      }
    };

    rafId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafId);
  }, [currentTimeRef, startTime]);

  // Subscribe to live frames
  useEffect(() => {
    return videoEventBus.subscribe(({ topic, frame, logTime }) => {
      if (topic === title) {
        queueFrame(frame, logTime);
      }
    });
  }, [title]);

  useEffect(() => {
    if (initialFrame && startTime) {
      queueFrame(initialFrame, startTime);
    }
  }, [initialFrame, startTime]);

  const lastLogTimeRef = useRef<bigint>(0n);

  const queueFrame = (frame: CompressedVideo, logTime: bigint) => {
    if (lastLogTimeRef.current !== 0n && Math.abs(Number(logTime - lastLogTimeRef.current)) > 1_000_000_000) {
      frameQueue.current = [];
      if (decoderRef.current && decoderRef.current.state !== 'closed') {
        try { decoderRef.current.close(); } catch (e) { }
        decoderRef.current = null;
      }
    }
    lastLogTimeRef.current = logTime;

    if (frame.format === 'jpeg' || frame.format === 'png') {
      const blob = new Blob([new Uint8Array(frame.data)], { type: `image/${frame.format}` });
      createImageBitmap(blob).then(bmp => {
        frameQueue.current.push({ bmp, logTime });
        frameQueue.current.sort((a, b) => (a.logTime < b.logTime ? -1 : 1));
      }).catch(e => console.error("Failed to decode image:", e));
    } else if (frame.format === 'h264' || frame.format === 'h265') {
      if (!decoderRef.current) {
        const decoder = new VideoDecoder({
          output: (videoFrame) => {
            frameQueue.current.push({ vf: videoFrame, logTime: BigInt(videoFrame.timestamp) * 1000n });
            frameQueue.current.sort((a, b) => (a.logTime < b.logTime ? -1 : 1));
          },
          error: (e) => console.error("VideoDecoder error:", e)
        });

        const codecString = frame.format === 'h265' ? 'hev1.1.6.L93.B0' : 'avc1.42E01E';

        decoder.configure({
          codec: codecString,
          optimizeForLatency: true
        });
        decoderRef.current = decoder;
      }

      // H.265 chunks should ideally be marked key or delta accurately.
      // Since we don't have a parser, we assume most frames are delta unless it's the very first.
      // But if the decoder requires it, WebCodecs actually allows treating everything as 'key' 
      // or we can just guess. Let's try 'delta'.
      const chunk = new EncodedVideoChunk({
        type: 'key', // If we have issues we can switch to 'delta'
        timestamp: Number(logTime / 1000n), // microseconds
        data: frame.data
      });
      decoderRef.current.decode(chunk);
    }
  };;

  const containerRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <div ref={containerRef} className="flex-1 bg-surface-card relative rounded-md overflow-hidden flex flex-col group border border-hairline shadow-sm hover:shadow-airbnb transition-shadow bg-canvas">
      <div className="flex-1 bg-black flex items-center justify-center rounded-t-md overflow-hidden relative">
        <canvas ref={canvasRef} className="w-full h-full object-contain bg-black"></canvas>
        <div className="absolute top-3 left-3 bg-canvas/90 backdrop-blur-sm text-ink text-[11px] font-semibold px-2 py-1 rounded-full shadow-sm">
          {title.split('/').pop()}
        </div>
        <button
          onClick={toggleFullscreen}
          className="absolute top-3 right-3 bg-black/50 hover:bg-black/80 text-white p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          title="Fullscreen"
        >
          <Maximize className="w-4 h-4" />
        </button>
      </div>
      <div className="h-[48px] bg-canvas flex items-center justify-between px-4 shrink-0">
        <span className="text-[14px] font-medium text-ink truncate mr-2">{title}</span>
        <span className="text-[13px] text-muted whitespace-nowrap">{resolution}</span>
      </div>
    </div>
  );
}
