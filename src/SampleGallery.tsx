import { Check, X } from 'lucide-react';
import type { SavedImage, ImageKind } from './history';
export type Sample = { id: string; name: string; url: string };
export function SampleGallery({ kind, samples, history, selected, disabled, onSample, onHistory, onRemove }: {
  kind: ImageKind; samples: Sample[]; history: SavedImage[]; selected?: string; disabled: boolean;
  onSample(sample: Sample): void; onHistory(image: SavedImage): void; onRemove(id: string): void;
}) {
  const saved = history.filter(image => image.kind === kind);
  return <div className="gallery"><div className="gallery-label"><span>샘플{saved.length > 0 && ' · 최근 사진'}</span>{saved.length > 0 && <small>이 브라우저에 저장돼요</small>}</div>
    <div className="sample-list" aria-label={(kind === 'source' ? '재료' : '얼굴') + ' 샘플'}>
      {samples.map(sample => <button key={sample.id} disabled={disabled} title={sample.name + ' 샘플'} aria-label={sample.name + ' 샘플'} className={selected === sample.id ? 'selected' : ''} onClick={() => onSample(sample)}>
        <img src={sample.url} alt="" /><span>{sample.name}</span>{selected === sample.id && <i><Check size={11} /></i>}</button>)}
      {saved.map(image => <div className="saved-sample" key={image.id}><button disabled={disabled} title={image.name} aria-label={'최근 사진 ' + image.name} className={selected === image.id ? 'selected' : ''} onClick={() => onHistory(image)}>
        <img src={image.thumbnail} alt="" /><span>{image.name}</span>{selected === image.id && <i><Check size={11} /></i>}</button>
        <button className="remove-sample" aria-label={image.name + ' 기록 삭제'} title="기록 삭제" onClick={() => onRemove(image.id)}><X size={13} /></button></div>)}
    </div></div>;
}
