import { useEffect, useRef, useState, type FormEvent } from "react";
import { cleanBarcode, isValidGtin } from "../../shared/barcode";
import { Dialog, ErrorText, Field } from "./ui";

// Barcode from the camera: native BarcodeDetector (Chrome/Android), @zxing/browser where it's missing (Safari iOS).
// zxing is loaded only when needed, so it never weighs on the main bundle. Typing the code always works too.

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect(source: HTMLVideoElement): Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

async function nativeDetector(): Promise<BarcodeDetectorLike | null> {
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  const supported = (await Ctor.getSupportedFormats?.().catch(() => [])) ?? FORMATS;
  const formats = FORMATS.filter((f) => supported.includes(f));
  return formats.length ? new Ctor({ formats }) : null;
}

function cameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError") return "Permesso per la fotocamera negato: abilitalo nelle impostazioni o digita il codice.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Nessuna fotocamera disponibile: digita il codice.";
  return "Impossibile usare la fotocamera: digita il codice.";
}

/** Live camera preview that reports the first valid EAN/UPC code (check digit verified, so misreads are dropped). */
function CameraScanner({ onDetected }: { onDetected: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<"native" | "zxing" | null>(null);
  const detected = useRef(onDetected);
  useEffect(() => {
    detected.current = onDetected;
  });

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopZxing: (() => void) | undefined;
    const accept = (raw: string) => {
      const code = cleanBarcode(raw);
      if (cancelled || !isValidGtin(code)) return;
      cancelled = true;
      detected.current(code);
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("no camera", "NotFoundError");
        const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        // Closed while the permission prompt was open: the cleanup already ran, so stop this stream here.
        if (cancelled) return camera.getTracks().forEach((t) => t.stop());
        stream = camera;
        const el = video.current!;
        const native = await nativeDetector();
        if (cancelled) return;
        if (native) {
          el.srcObject = stream;
          await el.play();
          setEngine("native");
          let busy = false;
          timer = setInterval(() => {
            if (busy || el.readyState < 2) return;
            busy = true;
            native
              .detect(el)
              .then((codes) => codes.forEach((c) => accept(c.rawValue)))
              .catch(() => undefined)
              .finally(() => (busy = false));
          }, 200);
        } else {
          const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
            import("@zxing/browser"),
            import("@zxing/library"),
          ]);
          if (cancelled) return;
          const hints = new Map([
            [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]],
          ]);
          const controls = await new BrowserMultiFormatReader(hints).decodeFromStream(stream, el, (result) => {
            if (result) accept(result.getText());
          });
          stopZxing = () => controls.stop();
          if (cancelled) stopZxing();
          else setEngine("zxing");
        }
      } catch (err) {
        if (!cancelled) setError(cameraError(err));
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(timer);
      stopZxing?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (error) return <p className="notice warn">{error}</p>;
  return (
    <div className="scanner">
      <video ref={video} className="scanner-video" muted playsInline aria-label="Anteprima della fotocamera" />
      <div className="scanner-frame" aria-hidden="true" />
      <p className="muted small">{engine ? "Inquadra il codice a barre…" : "Avvio della fotocamera…"}</p>
    </div>
  );
}

/** Dialog: camera scan or typed code. Reports a cleaned, check-digit-valid code. */
export function BarcodeScanner({ open, onClose, onDetected }: { open: boolean; onClose: () => void; onDetected: (code: string) => void }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const code = cleanBarcode(typed);
    if (!isValidGtin(code)) return setError("Codice non valido: controlla le cifre (8, 12 o 13 cifre).");
    setTyped("");
    setError(null);
    onDetected(code);
  }

  return (
    <Dialog open={open} title="Scansiona codice a barre" onClose={onClose}>
      <CameraScanner onDetected={onDetected} />
      <form className="form" onSubmit={submit}>
        <Field label="Oppure digita il codice">
          <input className="input" inputMode="numeric" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
        <ErrorText error={error} />
        <div className="actions">
          <button type="submit" className="button primary">
            Usa questo codice
          </button>
        </div>
      </form>
    </Dialog>
  );
}
