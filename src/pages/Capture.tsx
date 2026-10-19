import { useEffect, useRef, useState } from 'react';
import { compressImage } from '../image';
import { addToQueue, type ReadMode } from '../queue';
import { Segmented } from '../ui';
import { flash } from './Home';
import { BackIcon, CameraIcon, CheckIcon, CloseIcon, ImageIcon } from '../icons';

// Snap a receipt. A long receipt is photographed in parts, top to bottom: after each photo the
// bottom strip of it stays faintly at the top of the camera view, so the next photo lines up with
// a small overlap. All parts go to Claude together and come back as one receipt.

const MAX_PARTS = 6; // same limit as the server
const MAX_SIDE = 2000;
const GHOST = 0.2; // share of the last photo shown as the overlap guide

interface Part {
  blob: Blob;
  url: string;
}

export function Capture({ go }: { go: (to: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const fallback = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [cam, setCam] = useState<'starting' | 'live' | 'none'>('starting');
  const [parts, setParts] = useState<Part[]>([]);
  const [mode, setMode] = useState<ReadMode>('full');
  const [flashOn, setFlashOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stopped = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCam('none');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => undefined);
        }
        setCam('live');
      })
      .catch(() => setCam('none')); // no permission or no camera: use the phone's camera app instead
    return () => {
      stopped = true;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Free the thumbnails' memory when leaving.
  const partsRef = useRef(parts);
  partsRef.current = parts;
  useEffect(() => () => partsRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const addPart = (blob: Blob) => setParts((ps) => (ps.length >= MAX_PARTS ? ps : [...ps, { blob, url: URL.createObjectURL(blob) }]));

  // Takes exactly what is visible in the frame (the video is cropped to fill it).
  const shoot = async () => {
    const v = video.current;
    const b = box.current;
    if (!v || !b || !v.videoWidth || parts.length >= MAX_PARTS) return;
    const boxRatio = b.clientWidth / b.clientHeight;
    const vidRatio = v.videoWidth / v.videoHeight;
    let sw = v.videoWidth;
    let sh = v.videoHeight;
    if (vidRatio > boxRatio) sw = sh * boxRatio;
    else sh = sw / boxRatio;
    const sx = (v.videoWidth - sw) / 2;
    const sy = (v.videoHeight - sh) / 2;
    const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    canvas.getContext('2d')!.drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    if (!blob) return;
    setFlashOn(true);
    setTimeout(() => setFlashOn(false), 120);
    addPart(blob);
  };

  const onFiles = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      if (!f.type.startsWith('image/')) continue;
      addPart(await compressImage(f));
    }
  };

  const remove = (i: number) =>
    setParts((ps) => {
      URL.revokeObjectURL(ps[i].url);
      return ps.filter((_, j) => j !== i);
    });

  const done = async () => {
    if (!parts.length || busy) return;
    setBusy(true);
    await addToQueue(parts.map((p) => p.blob), parts.length > 1 ? 'long-receipt.jpg' : 'receipt.jpg', mode);
    flash(navigator.onLine ? 'Reading… this takes a few seconds.' : 'Saved on this phone. It will be sent when you have signal.');
    go('home');
  };

  const last = parts[parts.length - 1];
  const full = parts.length >= MAX_PARTS;
  const tip = !parts.length
    ? 'Lay it flat in good light with the whole width in. Long slip? Start at the top.'
    : full
      ? `That's the most for one receipt (${MAX_PARTS} photos). Tap Read it.`
      : 'More to go? Slide down so the faint strip lines up, then snap. The TOTAL must be in your last photo.';

  return (
    <div className="flex min-h-dvh flex-col bg-band text-on-band">
      <header className="flex items-center justify-between px-4 py-3">
        <a href="#/home" aria-label="Back to home" className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-band-2">
          <BackIcon size={20} />
        </a>
        <h1 className="font-display text-lg font-semibold text-on-band">{parts.length ? `Photo ${parts.length + (full ? 0 : 1)} of this receipt` : 'Snap a receipt'}</h1>
        <span className="w-11" />
      </header>

      <p className="px-5 pb-2 text-center text-sm text-[#d3ddd5]" aria-live="polite">{tip}</p>

      <div ref={box} className="relative aspect-[3/4] self-center overflow-hidden rounded-[24px] bg-[#0e2217]" style={{ width: `min(calc(100% - 32px), calc((100dvh - ${parts.length ? 450 : 330}px) * 0.75))` }}>
        <video ref={video} playsInline muted className={`absolute inset-0 h-full w-full object-cover ${cam === 'live' ? '' : 'hidden'}`} />
        {cam === 'live' && last && !full && (
          <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: `${GHOST * 100}%` }}>
            <div className="h-full w-full opacity-45" style={{ backgroundImage: `url(${last.url})`, backgroundSize: '100% auto', backgroundPosition: 'bottom' }} />
            <div className="absolute inset-x-0 bottom-0 border-b-2 border-dashed border-gold" />
            <span className="absolute right-2 bottom-1.5 rounded-full bg-gold px-2 py-0.5 text-[11px] font-semibold text-on-gold">line up here</span>
          </div>
        )}
        {cam !== 'live' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            {cam === 'starting' ? (
              <p className="text-sm text-on-band-muted">Starting the camera…</p>
            ) : (
              <>
                {last && <img src={last.url} alt="" className="max-h-[45%] rounded-lg opacity-80" />}
                <p className="text-sm text-[#d3ddd5]">{last ? 'Your last photo is above. Take the next part with a little overlap.' : "The camera opens in your phone's camera app."}</p>
                {!full && (
                  <button type="button" onClick={() => fallback.current?.click()} className="flex min-h-12 items-center gap-2 rounded-[14px] bg-gold px-5 font-semibold text-on-gold">
                    <CameraIcon size={20} /> {last ? 'Take next part' : 'Open camera'}
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {/* Corner guides */}
        {cam === 'live' && (
          <>
            <span className="pointer-events-none absolute top-4 left-4 h-8 w-8 rounded-tl-[12px] border-t-4 border-l-4 border-gold" />
            <span className="pointer-events-none absolute top-4 right-4 h-8 w-8 rounded-tr-[12px] border-t-4 border-r-4 border-gold" />
            <span className="pointer-events-none absolute bottom-4 left-4 h-8 w-8 rounded-bl-[12px] border-b-4 border-l-4 border-gold" />
            <span className="pointer-events-none absolute right-4 bottom-4 h-8 w-8 rounded-br-[12px] border-r-4 border-b-4 border-gold" />
          </>
        )}
        {flashOn && <div className="absolute inset-0 bg-white/70" />}
      </div>

      {parts.length > 0 && (
        <ul className="mx-4 mt-3 flex gap-2 overflow-x-auto" aria-label="Photos of this receipt">
          {parts.map((p, i) => (
            <li key={p.url} className="relative shrink-0">
              <img src={p.url} alt={`Part ${i + 1}`} className="h-16 w-12 rounded-md object-cover" />
              <span className="absolute top-0.5 left-0.5 rounded bg-band/80 px-1 text-[10px] font-semibold">{i + 1}</span>
              <button type="button" aria-label={`Remove part ${i + 1}`} onClick={() => remove(i)} className="absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full bg-gold text-on-gold">
                <CloseIcon size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mx-4 mt-3">
        <Segmented<ReadMode>
          label="What to read"
          value={mode}
          onChange={setMode}
          options={[
            ['full', 'Every line'],
            ['totals', 'Totals only'],
          ]}
        />
        {mode === 'totals' && <p className="mt-1.5 text-center text-xs text-on-band-muted">Just shop, date and total. Best for very long slips. You can photograph only the top and the bottom.</p>}
      </div>

      {parts.length > 0 && (
        <button type="button" onClick={done} disabled={busy} className="mx-4 mt-3 flex min-h-13 items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-gold font-semibold text-gold">
          <CheckIcon /> {parts.length === 1 ? 'Done — read this photo' : `Done — read all ${parts.length} photos as one receipt`}
        </button>
      )}

      <div className="mt-auto flex items-center justify-between px-8 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button type="button" aria-label="Add from gallery" onClick={() => gallery.current?.click()} disabled={full} className="flex h-13 w-13 items-center justify-center rounded-[14px] bg-band-2 disabled:opacity-40">
          <ImageIcon />
        </button>
        <button
          type="button"
          aria-label={parts.length ? 'Take next part' : 'Take photo'}
          onClick={cam === 'live' ? shoot : () => fallback.current?.click()}
          disabled={full || cam === 'starting'}
          className="flex h-20 w-20 items-center justify-center rounded-full bg-gold text-on-gold shadow-[0_0_0_6px_var(--color-band-2),0_0_0_8px_var(--color-gold)] disabled:opacity-40"
        >
          <CameraIcon size={30} />
        </button>
        <span className="h-13 w-13" />
      </div>

      <input ref={fallback} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
    </div>
  );
}
