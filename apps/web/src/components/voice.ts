/** Gravação do microfone (push-to-talk) e reprodução de áudio base64. */

export interface Recorder {
  stop(): Promise<{ base64: string; mimeType: string }>;
  cancel(): void;
}

export function micSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== 'undefined' &&
    'MediaRecorder' in window
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.includes(',') ? s.slice(s.indexOf(',') + 1) : s);
    };
    r.onerror = () => reject(new Error('read'));
    r.readAsDataURL(blob);
  });
}

export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mr = new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  mr.start();
  const cleanup = () => stream.getTracks().forEach((t) => t.stop());
  return {
    stop: () =>
      new Promise((resolve) => {
        mr.onstop = async () => {
          cleanup();
          const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
          resolve({ base64: await blobToBase64(blob), mimeType: blob.type || 'audio/webm' });
        };
        try { mr.stop(); } catch { cleanup(); }
      }),
    cancel: () => { try { mr.stop(); } catch { /* ignore */ } cleanup(); },
  };
}

let current: HTMLAudioElement | null = null;

export function playBase64Audio(base64: string, mimeType = 'audio/mpeg'): HTMLAudioElement {
  stopAudio();
  const audio = new Audio(`data:${mimeType};base64,${base64}`);
  current = audio;
  void audio.play().catch(() => { /* autoplay bloqueado */ });
  return audio;
}

export function stopAudio(): void {
  if (current) { try { current.pause(); } catch { /* ignore */ } current = null; }
}
