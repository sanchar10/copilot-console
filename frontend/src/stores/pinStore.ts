import { create } from 'zustand';
import { createPin as apiCreatePin, deletePin as apiDeletePin, listPins as apiListPins, updatePin as apiUpdatePin } from '../api/pins';
import type { CreatePinRequest, UpdatePinRequest, Pin } from '../types/pin';

interface PinState {
  pinsPerSession: Record<string, Pin[]>;

  fetchPins: (sessionId: string) => Promise<void>;
  createPin: (sessionId: string, req: CreatePinRequest) => Promise<Pin>;
  updatePin: (sessionId: string, pinId: string, req: UpdatePinRequest) => Promise<Pin>;
  deletePin: (sessionId: string, pinId: string) => Promise<void>;
}

export const usePinStore = create<PinState>((set, _get) => ({
  pinsPerSession: {},

  fetchPins: async (sessionId) => {
    try {
      const pins = await apiListPins(sessionId);
      set((state) => ({
        pinsPerSession: {
          ...state.pinsPerSession,
          [sessionId]: pins,
        },
      }));
    } catch (err) {
      if (import.meta.env.MODE !== 'test') {
        console.error('[PinStore] Failed to fetch pins:', err);
      }
      // Leave existing pins (if any) unchanged.
    }
  },

  createPin: async (sessionId, req) => {
    const pin = await apiCreatePin(sessionId, req);
    set((state) => ({
      pinsPerSession: {
        ...state.pinsPerSession,
        [sessionId]: [...(state.pinsPerSession[sessionId] || []), pin],
      },
    }));
    return pin;
  },

  updatePin: async (sessionId, pinId, req) => {
    const pin = await apiUpdatePin(sessionId, pinId, req);
    set((state) => ({
      pinsPerSession: {
        ...state.pinsPerSession,
        [sessionId]: (state.pinsPerSession[sessionId] || []).map((p) => (p.id === pinId ? pin : p)),
      },
    }));
    return pin;
  },

  deletePin: async (sessionId, pinId) => {
    await apiDeletePin(sessionId, pinId);
    set((state) => ({
      pinsPerSession: {
        ...state.pinsPerSession,
        [sessionId]: (state.pinsPerSession[sessionId] || []).filter((p) => p.id !== pinId),
      },
    }));
  },
}));
