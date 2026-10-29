export type CameraFacing = 'user' | 'environment';
type CameraSource = Pick<MediaDevices, 'getUserMedia'>;
type OpenCamera = { stream: MediaStream; facing: CameraFacing; warning?: string };

export function stopCamera(stream?: MediaStream) { stream?.getTracks().forEach(track => track.stop()); }

async function requestCamera(devices: CameraSource, facing: CameraFacing, exact: boolean): Promise<OpenCamera> {
  const stream = await devices.getUserMedia({
    video: { facingMode: exact ? { exact: facing } : { ideal: facing }, width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  const actual = stream.getVideoTracks()[0]?.getSettings().facingMode;
  if (!stream.getVideoTracks().length || (exact && actual && actual !== facing)) {
    stopCamera(stream);
    throw new DOMException('Requested camera is unavailable.', 'NotFoundError');
  }
  return { stream, facing: actual === 'user' || actual === 'environment' ? actual : facing };
}

export async function replaceCamera(devices: CameraSource, facing: CameraFacing,
  previous?: { stream: MediaStream; facing: CameraFacing }, isCurrent: () => boolean = () => true): Promise<OpenCamera> {
  stopCamera(previous?.stream);
  try { return await requestCamera(devices, facing, !!previous); }
  catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (!previous || !isCurrent() || !['NotFoundError', 'OverconstrainedError'].includes(name)) throw error;
    const restored = await requestCamera(devices, previous.facing, false);
    return { ...restored, warning: (facing === 'user' ? '전면' : '후면') + ' 카메라를 찾지 못했어요.' };
  }
}

export function capture(video: HTMLVideoElement, facing: CameraFacing = 'user') {
  if (!video.videoWidth) throw new Error('카메라가 준비될 때까지 잠시 기다려주세요.');
  const image = document.createElement('canvas');
  image.width = 640; image.height = Math.max(1, Math.round(640 * video.videoHeight / video.videoWidth));
  const context = image.getContext('2d')!;
  if (facing === 'user') { context.translate(image.width, 0); context.scale(-1, 1); }
  context.drawImage(video, 0, 0, image.width, image.height);
  return image;
}
