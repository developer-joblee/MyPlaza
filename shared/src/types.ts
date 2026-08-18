export interface PlayerState {
  id: string;
  name: string;
  color: number;
  x: number;
  y: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

/**
 * Equivalentes estruturais de RTCSessionDescriptionInit / RTCIceCandidateInit,
 * declarados aqui para o server não depender dos tipos DOM.
 */
export interface SessionDescription {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}

export interface IceCandidate {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface SignalPayload {
  /** preenchido pelo servidor ao repassar */
  from: string;
  to: string;
  description?: SessionDescription;
  candidate?: IceCandidate;
}
