import { publicAssetUrl } from '../../src/publicAssetUrl.js';
import './LunaMascot.css';

/** Aligned idle and paw frames from the standalone Planner's Luna artwork. */
export default function LunaMascot({ responding = false, active = true }: { responding?: boolean; active?: boolean }) {
  return (
    <span className={`luna-chat-mascot${responding && active ? ' luna-chat-mascot-answering' : ''}${active ? '' : ' luna-chat-mascot-paused'}`} aria-hidden="true">
      <span className="luna-chat-idle"><img src={publicAssetUrl('assets/luna/idle.png')} alt="" draggable={false} width={680} height={400} /></span>
      <span className="luna-chat-bongo"><img src={publicAssetUrl('assets/luna/bongo.png')} alt="" draggable={false} width={1360} height={400} /></span>
    </span>
  );
}
