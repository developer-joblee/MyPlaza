import { runtime } from '../runtime';
import { useStore } from '../state/store';

const STEP = 1.25;

export function ZoomControls() {
  const zoomPct = useStore((s) => s.zoomPct);

  return (
    <div className="panel zoom-controls" title="Zoom (ou use a roda do mouse)">
      <button
        type="button"
        className="zoom-btn"
        onClick={() => runtime.game?.zoomBy(1 / STEP)}
        aria-label="Diminuir zoom"
      >
        −
      </button>
      <button
        type="button"
        className="zoom-pct"
        onClick={() => runtime.game?.setZoom(1)}
        title="Redefinir para 100%"
      >
        {zoomPct}%
      </button>
      <button
        type="button"
        className="zoom-btn"
        onClick={() => runtime.game?.zoomBy(STEP)}
        aria-label="Aumentar zoom"
      >
        +
      </button>
    </div>
  );
}
